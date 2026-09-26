const MAX_LATE_MS=10*60*1000;
const TRANSPORT_RETRY_MS=30*1000;
const MAX_TRANSPORT_FAILURES=6;

export function emptyState(){
  return {installations:{},sessions:{},actions:[],events:[]};
}

function randomId(){
  return crypto.randomUUID();
}

export class AssistState{
  constructor(data=emptyState()){this.data=data;}

  log(kind,details={},now=Date.now()){
    this.data.events.push({kind,...details,at:now});
    this.data.events=this.data.events.slice(-1000);
  }

  install(subscription,now=Date.now()){
    const existing=Object.values(this.data.installations).find(x=>x.subscription?.endpoint===subscription.endpoint);
    if(existing){existing.subscription=subscription;existing.updatedAt=now;return existing;}
    const id=randomId(),row={id,token:randomId()+randomId(),subscription,createdAt:now,updatedAt:now};
    this.data.installations[id]=row;this.log('installed',{installationId:id},now);return row;
  }

  installationByToken(token){
    return Object.values(this.data.installations).find(x=>x.token===token)||null;
  }

  start(installationId,input,now=Date.now()){
    const session=input.session;
    if(!session?.id||!/^\d{4}-\d{2}-\d{2}$/.test(session.date)||!Array.isArray(input.schedule))throw Error('稼働データが不正です');
    for(const old of Object.values(this.data.sessions))if(old.installationId===installationId&&old.active){old.active=false;old.replacedAt=now;}
    const reminders=input.schedule.map(x=>({
      id:x.id,eventId:`${session.id}:${x.id}`,type:x.type,dueAt:Number(x.dueAt),
      title:String(x.title||'').slice(0,80),body:String(x.body||'').slice(0,180),
      requiresAction:!!x.requiresAction,maxAttempts:Math.min(2,Math.max(1,Number(x.maxAttempts)||1)),
      retryDelayMs:Number(x.retryDelayMs)||0,route:x.route||null,repeat:x.repeat||1,
      voiceKey:x.voiceKey||null,actions:Array.isArray(x.actions)?x.actions.slice(0,3):[],
      deliveries:[],retryAt:null,transportRetryAt:null,transportFailures:0,
      sendingAt:null,completed:false,cancelled:false
    }));
    const row={id:session.id,installationId,date:session.date,active:true,startedAt:session.startedAt||now,updatedAt:now,routes:session.routes||{},timeZone:input.timeZone||'Asia/Tokyo',reminders};
    this.data.sessions[row.id]=row;this.log('session-started',{sessionId:row.id,installationId},now);return row;
  }

  updateRoutes(installationId,sessionId,routes,now=Date.now()){
    const s=this.ownSession(installationId,sessionId);s.routes=routes;s.updatedAt=now;
    for(const r of s.reminders){
      if(!r.route||r.deliveries.length)continue;
      const zero=routes[r.route]===0;
      if(zero){r.cancelled=true;r.cancelReason='route-zero';}
      else if(r.cancelReason==='route-zero'&&r.dueAt>now){r.cancelled=false;r.cancelReason=null;}
    }
    this.log('routes-updated',{sessionId},now);return s;
  }

  action(installationId,{sessionId,eventId,action,actionId},now=Date.now()){
    if(this.data.actions.includes(actionId))return this.ownSession(installationId,sessionId);
    const s=this.ownSession(installationId,sessionId),r=s.reminders.find(x=>x.id===eventId||x.eventId===eventId);
    if(eventId==='checkin'&&action==='done')s.checkinDoneAt=now;
    if(r&&action==='done')r.completed=true;
    if(action==='synchro_done'){
      s.synchroDoneAt=now;
      for(const x of s.reminders)if(x.type==='end'&&!x.deliveries.length)x.cancelled=true;
    }
    if(action==='end')this.end(installationId,sessionId,'notification',now);
    this.data.actions.push(actionId);this.data.actions=this.data.actions.slice(-2000);
    this.log('action',{sessionId,eventId,action},now);return s;
  }

  end(installationId,sessionId,reason='ended',now=Date.now()){
    const s=this.ownSession(installationId,sessionId);s.active=false;s.endedAt=now;s.endReason=reason;
    for(const r of s.reminders)if(!r.deliveries.length)r.cancelled=true;
    this.log('session-ended',{sessionId,reason},now);return s;
  }

  ownSession(installationId,id){
    const s=this.data.sessions[id];
    if(!s||s.installationId!==installationId)throw Error('稼働状態が見つかりません');
    return s;
  }

  dueTime(r){
    if(r.transportRetryAt)return r.transportRetryAt;
    return r.deliveries.length?r.retryAt:r.dueAt;
  }

  nextDue(now=Date.now()){
    let best=null;
    for(const session of Object.values(this.data.sessions)){
      if(!session.active)continue;
      for(const reminder of session.reminders){
        if(reminder.completed||reminder.cancelled||reminder.deliveries.length>=reminder.maxAttempts)continue;
        const at=this.dueTime(reminder);if(!at)continue;
        if(!best||at<best.at)best={session,reminder,at};
      }
    }
    return best;
  }

  claim(now=Date.now()){
    while(true){
      const item=this.nextDue(now);if(!item||item.at>now)return null;
      const {session,reminder}=item;
      if(now-item.at>MAX_LATE_MS){
        reminder.cancelled=true;reminder.cancelReason='expired';this.log('expired',{sessionId:session.id,eventId:reminder.eventId},now);continue;
      }
      if(reminder.sendingAt&&now-reminder.sendingAt<2*60*1000)return null;
      reminder.sendingAt=now;
      return {...item,installation:this.data.installations[session.installationId]};
    }
  }

  accepted(session,reminder,now=Date.now()){
    reminder.sendingAt=null;reminder.transportRetryAt=null;reminder.transportFailures=0;
    reminder.deliveries.push({number:reminder.deliveries.length+1,at:now,status:'accepted'});
    if(reminder.deliveries.length===1&&reminder.maxAttempts>1)reminder.retryAt=now+reminder.retryDelayMs;
    this.log('push-accepted',{sessionId:session.id,eventId:reminder.eventId,number:reminder.deliveries.length},now);
  }

  failed(session,reminder,statusCode=null,now=Date.now()){
    reminder.sendingAt=null;reminder.transportFailures=(reminder.transportFailures||0)+1;
    reminder.transportRetryAt=reminder.transportFailures<MAX_TRANSPORT_FAILURES?now+TRANSPORT_RETRY_MS:null;
    if(!reminder.transportRetryAt){reminder.cancelled=true;reminder.cancelReason='push-failed';}
    this.log('push-failed',{sessionId:session.id,eventId:reminder.eventId,statusCode,transportFailures:reminder.transportFailures},now);
  }

  disableSubscription(session,installation,now=Date.now()){
    installation.subscription=null;session.active=false;session.updatedAt=now;
    this.log('subscription-expired',{sessionId:session.id,installationId:installation.id},now);
  }

  snapshot(installationId){
    return {sessions:Object.values(this.data.sessions).filter(x=>x.installationId===installationId).slice(-14).map(x=>({
      id:x.id,date:x.date,active:x.active,startedAt:x.startedAt,endedAt:x.endedAt,routes:x.routes,
      reminders:x.reminders.map(r=>({id:r.id,eventId:r.eventId,type:r.type,dueAt:r.dueAt,retryAt:r.retryAt,deliveries:r.deliveries,completed:r.completed,cancelled:r.cancelled}))
    }))};
  }
}

export {MAX_LATE_MS,TRANSPORT_RETRY_MS,MAX_TRANSPORT_FAILURES};

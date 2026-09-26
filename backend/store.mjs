import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
export class Store{
  constructor(file){this.file=file;this.data=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{installations:{},sessions:{},actions:[],events:[]};}
  persist(){mkdirSync(dirname(this.file),{recursive:true});writeFileSync(this.file+'.tmp',JSON.stringify(this.data));renameSync(this.file+'.tmp',this.file);}
  log(kind,data={},now=Date.now()){this.data.events.push({kind,...data,at:now});this.data.events=this.data.events.slice(-1000);this.persist();}
  install(subscription,now=Date.now()){const existing=Object.values(this.data.installations).find(x=>x.subscription?.endpoint===subscription.endpoint);if(existing){existing.subscription=subscription;existing.updatedAt=now;this.persist();return existing;}const id=randomUUID(),token=randomUUID()+randomUUID();const row={id,token,subscription,createdAt:now,updatedAt:now};this.data.installations[id]=row;this.log('installed',{installationId:id},now);return row;}
  installationByToken(token){return Object.values(this.data.installations).find(x=>x.token===token)||null;}
  start(installationId,input,now=Date.now()){
    const session=input.session;if(!session?.id||!/^\d{4}-\d{2}-\d{2}$/.test(session.date)||!Array.isArray(input.schedule))throw Error('稼働データが不正です');
    for(const old of Object.values(this.data.sessions))if(old.installationId===installationId&&old.active){old.active=false;old.replacedAt=now;}
    const reminders=input.schedule.map(x=>({id:x.id,eventId:`${session.id}:${x.id}`,type:x.type,dueAt:Number(x.dueAt),title:String(x.title||'').slice(0,80),body:String(x.body||'').slice(0,180),requiresAction:!!x.requiresAction,maxAttempts:Math.min(2,Math.max(1,Number(x.maxAttempts)||1)),retryDelayMs:Number(x.retryDelayMs)||0,route:x.route||null,repeat:x.repeat||1,voiceKey:x.voiceKey||null,actions:Array.isArray(x.actions)?x.actions.slice(0,3):[],attempts:[],retryAt:null,completed:false,cancelled:false}));
    const row={id:session.id,installationId,date:session.date,active:true,startedAt:session.startedAt||now,updatedAt:now,routes:session.routes||{},timeZone:input.timeZone||'Asia/Tokyo',reminders};this.data.sessions[row.id]=row;this.log('session-started',{sessionId:row.id,installationId},now);return row;
  }
  updateRoutes(installationId,sessionId,routes,now=Date.now()){const s=this.ownSession(installationId,sessionId);s.routes=routes;s.updatedAt=now;for(const r of s.reminders){if(!r.route||r.attempts.length)continue;const zero=routes[r.route]===0;if(zero){r.cancelled=true;r.cancelReason='route-zero';}else if(r.cancelReason==='route-zero'&&r.dueAt>now){r.cancelled=false;r.cancelReason=null;}}this.log('routes-updated',{sessionId},now);return s;}
  action(installationId,{sessionId,eventId,action,actionId},now=Date.now()){
    if(this.data.actions.includes(actionId))return this.ownSession(installationId,sessionId);const s=this.ownSession(installationId,sessionId),r=s.reminders.find(x=>x.id===eventId||x.eventId===eventId);
    if(eventId==='checkin'&&action==='done')s.checkinDoneAt=now;
    if(r&&action==='done')r.completed=true;
    if(action==='synchro_done'){s.synchroDoneAt=now;for(const x of s.reminders)if(x.type==='end'&&!x.attempts.length)x.cancelled=true;}
    if(action==='end')this.end(installationId,sessionId,'notification',now);
    this.data.actions.push(actionId);this.data.actions=this.data.actions.slice(-2000);this.log('action',{sessionId,eventId,action},now);return s;
  }
  end(installationId,sessionId,reason='ended',now=Date.now()){const s=this.ownSession(installationId,sessionId);s.active=false;s.endedAt=now;s.endReason=reason;for(const r of s.reminders)if(!r.attempts.length)r.cancelled=true;this.log('session-ended',{sessionId,reason},now);return s;}
  ownSession(installationId,id){const s=this.data.sessions[id];if(!s||s.installationId!==installationId)throw Error('稼働状態が見つかりません');return s;}
  claim(now=Date.now()){
    for(const s of Object.values(this.data.sessions)){
      if(!s.active)continue;
      for(const r of s.reminders){
        if(r.completed||r.cancelled||r.attempts.length>=r.maxAttempts)continue;const due=r.attempts.length?r.retryAt:r.dueAt;if(!due||now<due)continue;
        if(now-due>60000){r.cancelled=true;r.cancelReason='expired';this.log('expired',{sessionId:s.id,eventId:r.eventId},now);continue;}
        const attempt={id:randomUUID(),number:r.attempts.length+1,at:now,status:'claimed'};r.attempts.push(attempt);if(attempt.number===1&&r.maxAttempts>1)r.retryAt=now+r.retryDelayMs;
        this.log('send-attempt',{sessionId:s.id,eventId:r.eventId,attemptId:attempt.id,number:attempt.number},now);return {session:s,reminder:r,attempt,installation:this.data.installations[s.installationId]};
      }
    }return null;
  }
  snapshot(installationId){return {sessions:Object.values(this.data.sessions).filter(x=>x.installationId===installationId).slice(-14).map(x=>({id:x.id,date:x.date,active:x.active,startedAt:x.startedAt,endedAt:x.endedAt,routes:x.routes,reminders:x.reminders.map(r=>({id:r.id,eventId:r.eventId,type:r.type,dueAt:r.dueAt,retryAt:r.retryAt,attempts:r.attempts,completed:r.completed,cancelled:r.cancelled}))}))};}
}

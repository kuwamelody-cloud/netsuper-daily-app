import {AssistState,emptyState} from './state.mjs';
import {decodeBase64url,sendWebPush} from './webpush.mjs';

const ALLOWED_PUSH_HOSTS=new Set(['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com']);
const json=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});

function validSubscription(value){
  try{
    const url=new URL(value.endpoint);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&ALLOWED_PUSH_HOSTS.has(url.hostname)
      &&decodeBase64url(value.keys.p256dh).length===65&&decodeBase64url(value.keys.auth).length===16;
  }catch{return false;}
}

async function sameSecret(actual,expected){
  const bytes=new TextEncoder(),[a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',bytes.encode(String(actual||''))),
    crypto.subtle.digest('SHA-256',bytes.encode(String(expected||'')))
  ]);
  return crypto.subtle.timingSafeEqual?crypto.subtle.timingSafeEqual(a,b):new Uint8Array(a).every((x,i)=>x===new Uint8Array(b)[i]);
}

function bearer(request){
  return (request.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');
}

function cors(response,origin){
  const headers=new Headers(response.headers);
  if(origin){headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');}
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}

function acceptedOrigin(request,env){
  const origin=request.headers.get('Origin');
  return !origin||origin===env.ALLOWED_ORIGIN?origin||'':null;
}

function coordinator(env){
  return env.ASSIST.get(env.ASSIST.idFromName('primary'));
}

export default {
  async fetch(request,env){
    const origin=acceptedOrigin(request,env);
    if(origin===null)return json(403,{error:'許可されていない接続元です'});
    if(request.method==='OPTIONS'){
      return cors(new Response(null,{status:204,headers:{
        'Access-Control-Allow-Headers':'Authorization, Content-Type',
        'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
        'Access-Control-Max-Age':'600'
      }}),origin);
    }
    const url=new URL(request.url);
    if(url.pathname==='/health')return cors(json(200,{ok:true,storage:'durable-object-sqlite'}),origin);
    if(url.pathname==='/api/config')return cors(json(200,{publicKey:env.VAPID_PUBLIC_KEY}),origin);
    if(!url.pathname.startsWith('/api/'))return cors(json(404,{error:'Not found'}),origin);
    const internal=new Request(`https://assist.internal${url.pathname}`,request);
    return cors(await coordinator(env).fetch(internal),origin);
  },

  async scheduled(_controller,env,ctx){
    ctx.waitUntil(coordinator(env).fetch('https://assist.internal/internal/reconcile',{method:'POST',headers:{'X-NS-Internal':'cron'}}));
  }
};

export class AssistCoordinator{
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;
    this.ctx.blockConcurrencyWhile(async()=>{
      if(!await this.ctx.storage.get('state'))await this.ctx.storage.put('state',emptyState());
    });
  }

  async load(){return new AssistState(await this.ctx.storage.get('state')||emptyState());}
  async save(state){await this.ctx.storage.put('state',state.data);}

  async reschedule(state,now=Date.now()){
    const next=state.nextDue(now);
    if(next)await this.ctx.storage.setAlarm(Math.max(now+1000,next.at));
    else await this.ctx.storage.deleteAlarm();
  }

  async fetch(request){
    const path=new URL(request.url).pathname;
    try{
      if(path==='/internal/reconcile'){
        if(request.headers.get('X-NS-Internal')!=='cron')return json(403,{error:'Forbidden'});
        const state=await this.load();await this.reschedule(state);return json(200,{ok:true});
      }
      if(request.method!=='POST'&&path!=='/api/state')return json(405,{error:'Method not allowed'});
      const input=request.method==='POST'?await request.json().catch(()=>({})):{};
      const state=await this.load();
      if(path==='/api/install'){
        let installation=state.installationByToken(bearer(request));
        if(!installation){
          if(!await sameSecret(input.registrationCode,this.env.REGISTRATION_CODE))return json(401,{error:'接続コードが違います'});
          if(!validSubscription(input.subscription))return json(400,{error:'Push購読が不正です'});
          installation=state.install(input.subscription);
        }else if(input.subscription&&validSubscription(input.subscription)){
          installation.subscription=input.subscription;installation.updatedAt=Date.now();
        }
        await this.save(state);return json(200,{token:installation.token});
      }
      const installation=state.installationByToken(bearer(request));
      if(!installation)return json(401,{error:'通知サーバーへ再接続してください'});
      let result;
      if(path==='/api/state')result=state.snapshot(installation.id);
      else if(path==='/api/session/start')result=state.start(installation.id,input);
      else if(path==='/api/session/routes')result=state.updateRoutes(installation.id,input.sessionId,input.routes);
      else if(path==='/api/action')result=state.action(installation.id,{...input,actionId:input.actionId||crypto.randomUUID()});
      else if(path==='/api/session/end')result=state.end(installation.id,input.sessionId,input.reason);
      else return json(404,{error:'Not found'});
      await this.save(state);await this.reschedule(state);return json(200,result);
    }catch(error){return json(400,{error:error.message});}
  }

  async alarm(){
    let state=await this.load(),now=Date.now(),item=state.claim(now);
    while(item){
      await this.save(state);
      const {session,reminder,installation}=item;
      if(!installation?.subscription){
        state.disableSubscription(session,installation||{id:'missing'},now);
      }else{
        const payload={
          sessionId:session.id,eventId:reminder.id,type:reminder.type,title:reminder.title,body:reminder.body,
          requiresAction:reminder.requiresAction,actions:reminder.actions,voiceKey:reminder.voiceKey,
          repeat:reminder.repeat,attempt:reminder.deliveries.length+1,sentAt:now
        };
        try{
          const response=await sendWebPush(installation.subscription,payload,{
            subject:this.env.VAPID_SUBJECT,publicKey:this.env.VAPID_PUBLIC_KEY,
            privateJwk:JSON.parse(this.env.VAPID_PRIVATE_JWK),ttl:60,urgency:'high',
            topic:btoa(reminder.eventId).replace(/[^A-Za-z0-9_-]/g,'').slice(0,32)
          });
          if(response.ok)state.accepted(session,reminder,Date.now());
          else if(response.status===404||response.status===410)state.disableSubscription(session,installation,Date.now());
          else state.failed(session,reminder,response.status,Date.now());
        }catch{state.failed(session,reminder,null,Date.now());}
      }
      await this.save(state);now=Date.now();item=state.claim(now);
    }
    await this.reschedule(state);
  }
}

export {validSubscription,sameSecret};

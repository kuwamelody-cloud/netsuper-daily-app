import {readFile} from 'node:fs/promises';

const vars=Object.fromEntries((await readFile(new URL('../.dev.vars',import.meta.url),'utf8')).trim().split(/\r?\n/).map(line=>{
  const at=line.indexOf('=');return [line.slice(0,at),line.slice(at+1)];
}));
const base=process.argv[2]||'http://127.0.0.1:8788';
const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
const raw=new Uint8Array(await crypto.subtle.exportKey('raw',keys.publicKey));
const b64=value=>Buffer.from(value).toString('base64url');
const subscription={endpoint:'https://web.push.apple.com/local-smoke',keys:{p256dh:b64(raw),auth:b64(crypto.getRandomValues(new Uint8Array(16)))}};
const post=(path,body,token)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});

const health=await fetch(base+'/health');if(!health.ok)throw Error('health failed');
const config=await fetch(base+'/api/config');if((await config.json()).publicKey!==vars.VAPID_PUBLIC_KEY)throw Error('public key mismatch');
const install=await post('/api/install',{registrationCode:vars.REGISTRATION_CODE,subscription});
if(!install.ok)throw Error('install failed: '+await install.text());const {token}=await install.json();
const now=Date.now(),session={id:crypto.randomUUID(),date:new Date().toISOString().slice(0,10),startedAt:now,routes:{1:1}};
const start=await post('/api/session/start',{session,schedule:[{id:'dispatch',type:'dispatch',dueAt:now+60000,title:'確認',body:'完了しましたか',requiresAction:true,maxAttempts:2,retryDelayMs:300000}],timeZone:'Asia/Tokyo'},token);
if(!start.ok)throw Error('start failed: '+await start.text());
const state=await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+token}});
if(!state.ok||(await state.json()).sessions.length!==1)throw Error('state failed');
console.log('Cloudflare local smoke test passed');

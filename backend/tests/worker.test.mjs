import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistCoordinator} from '../src/worker.mjs';
import {base64url} from '../src/webpush.mjs';

class FakeStorage{
  constructor(){this.values=new Map();this.alarm=null;}
  async get(key){return structuredClone(this.values.get(key));}
  async put(key,value){this.values.set(key,structuredClone(value));}
  async setAlarm(value){this.alarm=value;}
  async deleteAlarm(){this.alarm=null;}
}
class FakeContext{
  constructor(){this.storage=new FakeStorage();this.ready=Promise.resolve();}
  blockConcurrencyWhile(fn){this.ready=fn();}
}

async function subscription(){
  const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const raw=await crypto.subtle.exportKey('raw',keys.publicKey);
  return {endpoint:'https://web.push.apple.com/Q',keys:{p256dh:base64url(raw),auth:base64url(crypto.getRandomValues(new Uint8Array(16)))}};
}
const call=(coordinator,path,body,token)=>coordinator.fetch(new Request('https://assist.internal'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)}));

test('existing PWA API can install, start a session and schedule an alarm',async()=>{
  const ctx=new FakeContext(),coordinator=new AssistCoordinator(ctx,{REGISTRATION_CODE:'join-code'});await ctx.ready;
  const install=await call(coordinator,'/api/install',{registrationCode:'join-code',subscription:await subscription()});
  assert.equal(install.status,200);const {token}=await install.json();assert.ok(token);
  const dueAt=Date.now()+60000,session={id:crypto.randomUUID(),date:'2026-09-26',startedAt:Date.now(),routes:{1:1}};
  const start=await call(coordinator,'/api/session/start',{session,schedule:[{id:'dispatch',type:'dispatch',dueAt,title:'確認',body:'完了しましたか',requiresAction:true,maxAttempts:2,retryDelayMs:300000}],timeZone:'Asia/Tokyo'},token);
  assert.equal(start.status,200);assert.equal(ctx.storage.alarm,dueAt);
  const state=await call(coordinator,'/api/state',undefined,token);assert.equal(state.status,200);
  assert.equal((await state.json()).sessions[0].active,true);
});

test('wrong registration code is rejected',async()=>{
  const ctx=new FakeContext(),coordinator=new AssistCoordinator(ctx,{REGISTRATION_CODE:'join-code'});await ctx.ready;
  const response=await call(coordinator,'/api/install',{registrationCode:'wrong',subscription:await subscription()});
  assert.equal(response.status,401);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {AssistState,emptyState,TRANSPORT_RETRY_MS} from '../src/state.mjs';

const installationId='install-1',sessionId='session-1';

function setup({dueAt=1000,maxAttempts=2,retryDelayMs=300000,route=null}={}){
  const state=new AssistState(emptyState());
  state.data.installations[installationId]={id:installationId,token:'token',subscription:{endpoint:'https://web.push.apple.com/x'}};
  state.start(installationId,{session:{id:sessionId,date:'2026-09-26',startedAt:1,routes:{}},schedule:[{id:'dispatch',type:'dispatch',dueAt,title:'確認',body:'完了しましたか',requiresAction:true,maxAttempts,retryDelayMs,route}]},1);
  return state;
}

test('first accepted delivery and one five-minute retry survive serialization',()=>{
  const state=setup(),first=state.claim(1000);assert.ok(first);
  state.accepted(first.session,first.reminder,1000);
  const restored=new AssistState(JSON.parse(JSON.stringify(state.data)));
  assert.equal(restored.nextDue(1001).at,301000);
  const second=restored.claim(301000);assert.ok(second);
  restored.accepted(second.session,second.reminder,301000);
  assert.equal(restored.nextDue(301001),null);
});

test('done cancels retry and duplicate action is idempotent',()=>{
  const state=setup(),first=state.claim(1000);state.accepted(first.session,first.reminder,1000);
  state.action(installationId,{sessionId,eventId:'dispatch',action:'done',actionId:'a1'},2000);
  state.action(installationId,{sessionId,eventId:'dispatch',action:'done',actionId:'a1'},3000);
  assert.equal(state.nextDue(301000),null);assert.equal(state.data.actions.length,1);
});

test('pending keeps retry fixed to five minutes after first delivery',()=>{
  const state=setup(),first=state.claim(1000);state.accepted(first.session,first.reminder,1000);
  state.action(installationId,{sessionId,eventId:'dispatch',action:'pending',actionId:'a2'},60000);
  assert.equal(state.nextDue(60001).at,301000);
});

test('route zero cancels future route notice and can restore before due',()=>{
  const state=setup({dueAt:5000,route:1});
  state.updateRoutes(installationId,sessionId,{1:0},1000);assert.equal(state.nextDue(1000),null);
  state.updateRoutes(installationId,sessionId,{1:2},2000);assert.equal(state.nextDue(2000).at,5000);
});

test('ending session cancels all future reminders',()=>{
  const state=setup({dueAt:5000});state.end(installationId,sessionId,'ended',2000);assert.equal(state.nextDue(5000),null);
});

test('stale reminder expires instead of replaying',()=>{
  const state=setup({dueAt:1000});assert.equal(state.claim(1000+11*60*1000),null);
  assert.equal(state.data.sessions[sessionId].reminders[0].cancelReason,'expired');
});

test('temporary push failure schedules a short transport retry without consuming business retry',()=>{
  const state=setup(),item=state.claim(1000);state.failed(item.session,item.reminder,503,1000);
  assert.equal(state.nextDue(1001).at,1000+TRANSPORT_RETRY_MS);
  assert.equal(item.reminder.deliveries.length,0);
});

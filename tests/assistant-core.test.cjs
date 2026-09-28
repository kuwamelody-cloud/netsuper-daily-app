const test=require('node:test');const assert=require('node:assert/strict');const core=require('../assistant-core.js');
test('assistant starts enabled only when settings are absent',()=>{
  assert.equal(core.DEFAULT_SETTINGS.enabled,true);
  assert.equal(core.mergeSettings().enabled,true);
  assert.equal(core.mergeSettings({enabled:false}).enabled,false);
});
const date='2026-09-26';
test('schedule omits past times and explicitly zero routes',()=>{const now=core.at(date,'12:15');const list=core.makeSchedule({date,now,settings:{enabled:true},routes:[0,null,2,0,null,1]});assert.ok(list.every(x=>x.dueAt>now));assert.ok(!list.some(x=>x.route===1||x.route===4));assert.ok(list.some(x=>x.route===3));});
test('disabled assistant produces no schedule',()=>assert.deepEqual(core.makeSchedule({date,now:0,settings:{enabled:false}}),[]));
test('zero first route skips dispatch and arrival confirmations',()=>{
  const ids=core.makeSchedule({date,now:core.at(date,'09:00'),settings:{enabled:true},routes:[0,1,1,1,1,1]}).map(x=>x.id);
  assert.ok(!ids.includes('dispatch'));
  assert.ok(!ids.includes('arrival-1'));
});
test('confirmation reminders have one five-minute retry',()=>{const list=core.makeSchedule({date,now:core.at(date,'09:00'),settings:{enabled:true},routes:[1]});for(const id of ['dispatch','arrival-1']){const x=list.find(x=>x.id===id);assert.equal(x.maxAttempts,2);assert.equal(x.retryDelayMs,300000);}});
test('scheduled notices use OS notification data without app voice metadata',()=>{const list=core.makeSchedule({date,now:core.at(date,'09:00'),settings:{enabled:true},routes:[1,1,1,1,1,1]});for(const item of list){assert.equal('voiceKey'in item,false);assert.equal('repeat'in item,false);}});
test('end reminders are fixed at 21:00, 21:30 and 22:00',()=>{const list=core.makeSchedule({date,now:core.at(date,'09:00'),settings:{enabled:true},routes:[]}).filter(x=>x.type==='end');assert.deepEqual(list.map(x=>x.dueAt),core.END_TIMES.map(t=>core.at(date,t)));});
test('late start never schedules elapsed notices',()=>{const now=core.at(date,'10:05');const ids=core.makeSchedule({date,now,settings:{enabled:true},routes:[1,1,1,1,1,1]}).map(x=>x.id);assert.ok(!ids.includes('load-1'));assert.ok(!ids.includes('delivery-1'));assert.ok(!ids.includes('dispatch'));assert.ok(!ids.includes('arrival-1'));});
test('state actions preserve records and terminal state',()=>{const s={active:true,routes:{1:null},completed:{}};const a=core.reduceSession(s,{type:'route_count',route:1,value:0},1);const b=core.reduceSession(a,{type:'complete',eventId:'dispatch'},2);const c=core.reduceSession(b,{type:'end'},3);assert.equal(c.routes[1],0);assert.equal(c.completed.dispatch,2);assert.equal(c.active,false);assert.equal(s.active,true);});
test('local date changes at device midnight without UTC conversion',()=>{
  assert.equal(core.localDate(new Date(2026,8,27,0,5)),'2026-09-27');
});
test('business end requires end meter and every route field while accepting zero',()=>{
  const complete=Array.from({length:6},()=>({cases:'0',items:0}));
  assert.deepEqual(core.missingEndFields({endMeter:'123.4',routes:complete}),[]);
  const incomplete=structuredClone(complete);incomplete[2].items='';incomplete[4].cases=null;
  assert.deepEqual(core.missingEndFields({endMeter:'',routes:incomplete}),['終了メーター','3便：個数','5便：件数']);
});

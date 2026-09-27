const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'..','index.html'),'utf8').replace(/\r\n/g,'\n');
const line=name=>{const found=html.split('\n').find(x=>x.startsWith(`function ${name}(`));assert.ok(found,`missing ${name}`);return found;};
test('existing localStorage keys stay unchanged',()=>{assert.match(html,/const RECORDS='netsuperBusinessRecords_v2',SETTINGS='netsuperBusinessSettings_v2'/);});
test('existing record form keeps blank and explicit zero distinct',()=>{const fields={};const c=vm.createContext({$:id=>fields[id]??={value:''},ROUTES:Array(6).fill(null),calc:()=>({c:0,it:0,dist:0}),wd:()=>'',selectedStore:()=>null});vm.runInContext(line('rawNum')+'\n'+line('form'),c);fields.workDate={value:'2026-09-26'};fields.r1c={value:'0'};const result=vm.runInContext('form()',c);assert.equal(result.routes[0].cases,0);assert.equal(result.routes[1].cases,null);});
test('backup remains data version 3 with records and settings',()=>{assert.match(line('backup'),/dataVersion:3/);assert.match(line('backup'),/records:records\(\),settings:settings\(\)/);});
test('existing daily and monthly fields remain present',()=>{for(const id of ['routes','startMeter','endMeter','fuelAmount','dailyMemo','monthCases','avgCases','monthItems','monthDistance','monthFuel','fuelCount','avgFuelPerDay'])assert.match(html,new RegExp(`id="${id}"`));});
test('assistant uses a separate IndexedDB and does not rename record keys',()=>{const db=fs.readFileSync(require('node:path').join(__dirname,'..','assistant-db.js'),'utf8');assert.match(db,/ns-business-assist/);assert.doesNotMatch(db,/netsuperBusinessRecords_v2/);});
test('monthly summary shows average cases in the requested order',()=>{
  const ids=[...html.matchAll(/<div class="sum-num" id="([^"]+)"/g)].map(x=>x[1]);
  assert.ok(ids.indexOf('monthDays')<ids.indexOf('monthCases'));
  assert.ok(ids.indexOf('monthCases')<ids.indexOf('avgCases'));
  assert.ok(ids.indexOf('avgCases')<ids.indexOf('monthItems'));
  assert.match(line('renderMonth'),/avgCases/);
  assert.match(line('renderMonth'),/rows\.length\?fmt\(tc\/rows\.length\):'0'/);
});
test('business end feedback and completion message are present',()=>{
  const assistant=fs.readFileSync(require('node:path').join(__dirname,'..','assistant.js'),'utf8');
  const serviceWorker=fs.readFileSync(require('node:path').join(__dirname,'..','service-worker.js'),'utf8');
  assert.match(assistant,/変更内容は次回の稼働開始から反映されます/);
  assert.match(assistant,/お疲れ様でした！シンクロで業務終了報告をしてください/);
  assert.match(assistant,/audio\.onerror=\(\)=>reject/);
  assert.match(assistant,/document\.addEventListener\('pointerdown',unlockAudio/);
  assert.match(assistant,/await expirePreviousDaySession\(\)/);
  assert.match(html,/id="assistEndValidation"/);
  assert.doesNotMatch(serviceWorker,/directActions=\[[^\]]*'end'/);
});

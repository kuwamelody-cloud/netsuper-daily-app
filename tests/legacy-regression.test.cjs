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
  assert.match(assistant,/voicePlayer\.onerror=\(\)=>reject/);
  assert.match(assistant,/document\.addEventListener\('pointerdown',unlockAudio/);
  assert.match(assistant,/await expirePreviousDaySession\(\)/);
  assert.doesNotMatch(html,/id="assistEndValidation"/);
  assert.match(html,/id="assistMissingPrompt"/);
  assert.match(html,/未入力の項目があります/);
  assert.match(html,/業務終了前に、以下の項目を入力してください/);
  assert.match(html,/固定音声が未実装の通知は短いアラート音になります/);
  assert.match(assistant,/showMissingPrompt\(missing\)/);
  assert.doesNotMatch(assistant,/endAssist'\)\.disabled/);
  assert.doesNotMatch(serviceWorker,/directActions=\[[^\]]*'end'/);
});
test('available fixed Marin assets are bundled and pending clips use fallback',()=>{
  const root=require('node:path').join(__dirname,'..');
  const assistant=fs.readFileSync(require('node:path').join(root,'assistant.js'),'utf8');
  const serviceWorker=fs.readFileSync(require('node:path').join(root,'service-worker.js'),'utf8');
  const available=['checkin','dispatch','arrival-1',...Array.from({length:6},(_,i)=>`load-${i+1}`)];
  const pending=[...Array.from({length:6},(_,i)=>`delivery-${i+1}`),'completion','end'];
  for(const name of available){
    const file=require('node:path').join(root,'audio',`${name}.mp3`);
    assert.ok(fs.existsSync(file),`missing audio/${name}.mp3`);
    assert.ok(fs.statSync(file).size>1000,`empty audio/${name}.mp3`);
    assert.match(serviceWorker,new RegExp(`audio/${name}\\.mp3`));
  }
  for(const name of pending){
    assert.ok(!fs.existsSync(require('node:path').join(root,'audio',`${name}.mp3`)),`unexpected audio/${name}.mp3`);
    assert.doesNotMatch(serviceWorker,new RegExp(`audio/${name}\\.mp3`));
  }
  assert.match(assistant,/playVoice\('completion',1\)/);
  assert.match(assistant,/setTimeout\(resolve,350\)/);
  assert.match(assistant,/await playAlert\(repeat\)/);
});
test('new app icons and cache-busted references are present',()=>{
  const root=require('node:path').join(__dirname,'..');
  for(const name of ['icon-192.png','icon-512.png','apple-touch-icon.png'])assert.ok(fs.statSync(require('node:path').join(root,name)).size>10000);
  assert.match(html,/apple-touch-icon\.png\?v=3/);
  const manifest=fs.readFileSync(require('node:path').join(root,'manifest.json'),'utf8');
  assert.match(manifest,/icon-192\.png\?v=3/);
  assert.match(manifest,/icon-512\.png\?v=3/);
});

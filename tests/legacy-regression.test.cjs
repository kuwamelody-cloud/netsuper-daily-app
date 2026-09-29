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
  assert.match(assistant,/お疲れ様でした！ShinQLOで業務終了報告をしてください/);
  assert.match(assistant,/context\.decodeAudioData/);
  assert.doesNotMatch(assistant,/document\.addEventListener\('pointerdown',unlockAudio/);
  assert.match(assistant,/await expirePreviousDaySession\(\)/);
  assert.doesNotMatch(html,/id="assistEndValidation"/);
  assert.match(html,/id="assistMissingPrompt"/);
  assert.match(html,/未入力の項目があります/);
  assert.match(html,/業務終了前に、以下の項目を入力してください/);
  assert.match(html,/業務開始・業務終了の操作時だけ再生します/);
  assert.match(assistant,/showMissingPrompt\(missing\)/);
  assert.doesNotMatch(assistant,/endAssist'\)\.disabled/);
  assert.doesNotMatch(serviceWorker,/directActions=\[[^\]]*'end'/);
});
test('only start and completion voice assets are bundled and cached with alert fallback',()=>{
  const root=require('node:path').join(__dirname,'..');
  const assistant=fs.readFileSync(require('node:path').join(root,'assistant.js'),'utf8');
  const serviceWorker=fs.readFileSync(require('node:path').join(root,'service-worker.js'),'utf8');
  for(const name of ['checkin','completion']){
    const file=require('node:path').join(root,'audio',`${name}.mp3`);
    assert.ok(fs.existsSync(file),`missing audio/${name}.mp3`);
    assert.ok(fs.statSync(file).size>1000,`empty audio/${name}.mp3`);
    assert.match(serviceWorker,new RegExp(`audio/${name}\\.mp3`));
  }
  const removed=['dispatch','arrival-1',...Array.from({length:6},(_,i)=>`load-${i+1}`),...Array.from({length:6},(_,i)=>`delivery-${i+1}`),'end'];
  for(const name of removed){
    assert.equal(fs.existsSync(require('node:path').join(root,'audio',`${name}.mp3`)),false,`obsolete audio/${name}.mp3 remains`);
    assert.doesNotMatch(serviceWorker,new RegExp(`audio/${name}\\.mp3`));
  }
  assert.match(assistant,/playVoice\('completion',1\)/);
  assert.match(assistant,/playVoice\('checkin',1\)/);
  assert.match(assistant,/await playAlert\(repeat\)/);
  assert.doesNotMatch(assistant,/playVoice\(payload\.voiceKey/);
  assert.doesNotMatch(assistant,/voicePlayer\.play\(\)/);
});
test('notification tap restores confirmation and information messages whenever the PWA resumes',()=>{
  const root=require('node:path').join(__dirname,'..');
  const assistant=fs.readFileSync(require('node:path').join(root,'assistant.js'),'utf8');
  const serviceWorker=fs.readFileSync(require('node:path').join(root,'service-worker.js'),'utf8');
  assert.match(serviceWorker,/if\(payload\.requiresAction\)await NSAssistDB\.set\("pendingPrompt",payload\)/);
  assert.match(serviceWorker,/if\(!payload\.requiresAction\)await NSAssistDB\.set\('pendingInfo',payload\)/);
  assert.match(assistant,/async function restorePendingMessages\(\)/);
  assert.match(assistant,/if\(info\)showInfoMessage\(info\)/);
  assert.match(assistant,/window\.addEventListener\('focus',resume\)/);
  assert.match(assistant,/window\.addEventListener\('pageshow',resume\)/);
  assert.match(assistant,/visibilitychange/);
  assert.doesNotMatch(serviceWorker,/silent:visible/);
});
test('information notification has a close-only modal that locks and restores the background',()=>{
  const root=require('node:path').join(__dirname,'..');
  const assistant=fs.readFileSync(require('node:path').join(root,'assistant.js'),'utf8');
  assert.match(assistant,/function showInfoMessage\(payload\)/);
  assert.match(assistant,/id="closeAssistInfo"[^>]*>閉じる<\/button>/);
  assert.match(assistant,/db\.set\('pendingInfo',null\)/);
  assert.match(assistant,/element\.inert=true/);
  assert.match(assistant,/element\.inert=false/);
  assert.match(assistant,/window\.scrollTo\(0,promptScrollY\)/);
  assert.match(html,/body\.prompt-open\{position:fixed/);
  const infoBody=assistant.slice(assistant.indexOf('function showInfoMessage'),assistant.indexOf('function promptBackgroundTargets'));
  assert.doesNotMatch(infoBody,/queue\(|reduceSession|saveRecords|saveSettings/);
});
test('version 2.00 is defined once and displayed read-only at the bottom of settings',()=>{
  const root=require('node:path').join(__dirname,'..');
  const config=fs.readFileSync(require('node:path').join(root,'assistant-config.js'),'utf8');
  const assistant=fs.readFileSync(require('node:path').join(root,'assistant.js'),'utf8');
  assert.match(config,/appVersion: "2\.00"/);
  assert.equal((config.match(/2\.00/g)||[]).length,1);
  assert.doesNotMatch(html,/2\.00/);
  assert.match(html,/バージョン情報[\s\S]*id="appVersion"/);
  assert.doesNotMatch(html,/<(?:input|select|textarea)[^>]*id="appVersion"/);
  assert.match(assistant,/NS業務アシスト Version \$\{config\.appVersion\|\|'--'\}/);
  assert.ok(html.indexOf('id="appVersion"')>html.indexOf('id="restoreFile"'));
});
test('ShinQLO credentials use a masked field and survive other settings saves',()=>{
  assert.match(html,/ShinQLOログイン情報/);
  assert.match(html,/id="shinQloLoginId"/);
  assert.match(html,/id="shinQloPassword" type="password"/);
  assert.match(html,/id="showShinQloPassword"/);
  assert.match(line('saveStoreEditor'),/\.\.\.old/);
  assert.match(line('saveShinQloSettings'),/shinQloLoginId/);
  assert.match(line('saveShinQloSettings'),/shinQloPassword/);
});
test('manual link is immediately left of settings and targets the published manual site',()=>{
  assert.match(html,/id="manualLink" href="https:\/\/kuwamelody-cloud\.github\.io\/ns-assist-manual\/"[\s\S]*id="manageStoresBtn"/);
  assert.match(html,/aria-label="操作マニュアルを開く"/);
});
test('new app icons and cache-busted references are present',()=>{
  const root=require('node:path').join(__dirname,'..');
  for(const name of ['icon-192.png','icon-512.png','apple-touch-icon.png'])assert.ok(fs.statSync(require('node:path').join(root,name)).size>10000);
  assert.match(html,/apple-touch-icon\.png\?v=3/);
  const manifest=fs.readFileSync(require('node:path').join(root,'manifest.json'),'utf8');
  assert.match(manifest,/icon-192\.png\?v=3/);
  assert.match(manifest,/icon-512\.png\?v=3/);
});

(function(){
  'use strict';
  const core=window.NSAssistCore,db=window.NSAssistDB,config=window.NS_ASSIST_CONFIG||{apiBase:''};
  const $=id=>document.getElementById(id);let swRegistration,currentPrompt=null,timer=null;
  const apiBase=String(config.apiBase||'').replace(/\/$/,'');
  const routes=()=>Array.from({length:6},(_,i)=>{const v=$(`r${i+1}c`)?.value;return v===''?null:Number(v);});
  async function api(path,body){if(!apiBase)throw Error('通知サーバーがまだ設定されていません。');const token=await db.get('installationToken');const r=await fetch(apiBase+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'通知サーバーとの通信に失敗しました。');return data;}
  async function queue(path,body){const id=crypto.randomUUID(),item={id,path,body:path==='/api/action'?{...body,actionId:id}:body,createdAt:Date.now()};await db.putOutbox(item);try{await flush();}catch{}return item;}
  async function flush(){for(const x of await db.listOutbox()){await api(x.path,x.body);await db.deleteOutbox(x.id);}}
  async function settings(){return core.mergeSettings(await db.get('settings'));}
  async function saveSettings(){const s=core.mergeSettings({enabled:$('assistEnabled').checked,method:$('assistMethod').value,loadEnabled:$('loadNotify').checked,deliveryEnabled:$('deliveryNotify').checked,infoRepeats:$('infoRepeats').value,dispatchTime:$('dispatchTime').value,arrivalTime:$('arrivalTime').value});await db.set('settings',s);await db.addEvent('settings-saved',{enabled:s.enabled});toggleSettings(s);render();if(!s.enabled){const session=await db.get('session');if(session?.active){await endSession('disabled');}}}
  function toggleSettings(s){$('assistDetails').classList.toggle('hidden',!s.enabled);}
  async function loadSettings(){const s=await settings();$('assistEnabled').checked=s.enabled;$('assistMethod').value=s.method;$('loadNotify').checked=s.loadEnabled;$('deliveryNotify').checked=s.deliveryEnabled;$('infoRepeats').value=s.infoRepeats;$('dispatchTime').value=s.dispatchTime;$('arrivalTime').value=s.arrivalTime;toggleSettings(s);}
  async function ensurePermission(){if(!('Notification'in window)||!swRegistration)throw Error('この端末では通知を利用できません。');const p=await Notification.requestPermission();if(p!=='granted')throw Error('通知が許可されていません。');if(!apiBase)throw Error('通知サーバーの設定後に有効化できます。');const state=await api('/api/config');const key=Uint8Array.from(atob(state.publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));const subscription=await swRegistration.pushManager.getSubscription()||await swRegistration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});let token=await db.get('installationToken');if(!token){const registrationCode=$('assistRegistrationCode').value.trim();if(!registrationCode)throw Error('初回のみ、通知サーバー接続コードを入力してください。');const result=await api('/api/install',{subscription:subscription.toJSON(),registrationCode});if(result.token){token=result.token;await db.set('installationToken',token);$('assistRegistrationCode').value='';}}else await api('/api/install',{subscription:subscription.toJSON()});await db.set('notificationReady',true);$('assistRegistrationRow').classList.add('hidden');}
  async function startSession(){
    const s=await settings();if(!s.enabled)return showMessage('業務アシストはOFFです。');if($('workDate').value!==localDate(new Date()))return showMessage('稼働開始は今日の画面で行ってください。');
    try{await ensurePermission();}catch(e){return showMessage(e.message,true);}
    const old=await db.get('session');if(old?.active)return;
    const now=Date.now(),session={id:crypto.randomUUID(),date:$('workDate').value,active:true,startedAt:now,updatedAt:now,routes:Object.fromEntries(routes().map((v,i)=>[i+1,v])),completed:{}};
    await db.set('session',session);const schedule=core.makeSchedule({date:session.date,now,settings:s,routes:routes()});
    await queue('/api/session/start',{session,schedule,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});await db.addEvent('session-started',{sessionId:session.id});render();const checkin={eventId:'checkin',...core.CONFIRMATIONS.checkin,type:'checkin',voiceKey:'checkin'};if(s.method==='voice')playVoice('checkin',1);else playAlert(1);showPrompt(checkin);
  }
  async function endSession(reason='ended'){
    const session=await db.get('session');if(!session?.active)return;const next=core.reduceSession(session,{type:reason==='ended'?'end':'cancel'});await db.set('session',next);await queue('/api/session/end',{sessionId:next.id,reason});await db.addEvent('session-ended',{reason});closePrompt();render();
  }
  async function updateRoutes(){const session=await db.get('session');if(!session?.active)return;let next=session;routes().forEach((v,i)=>{if(next.routes?.[i+1]!==v)next=core.reduceSession(next,{type:'route_count',route:i+1,value:v});});await db.set('session',next);await queue('/api/session/routes',{sessionId:next.id,routes:next.routes});}
  async function answer(action){
    if(!currentPrompt)return;const p=currentPrompt,session=await db.get('session');
    if(action==='done'){const next=core.reduceSession(session,{type:'complete',eventId:p.eventId});await db.set('session',next);await queue('/api/action',{sessionId:next.id,eventId:p.eventId,action});}
    else if(action==='end'){await endSession('ended');return;}
    else if(action==='synchro_done'){const next=core.reduceSession(session,{type:'synchro_done'});await db.set('session',next);await queue('/api/action',{sessionId:next.id,eventId:p.eventId,action});}
    else await queue('/api/action',{sessionId:session.id,eventId:p.eventId,action});
    await db.set('pendingPrompt',null);await db.addEvent('answer',{eventId:p.eventId,action});closePrompt();render();
  }
  function showPrompt(p){currentPrompt=p;$('assistPromptTitle').textContent=p.title;$('assistPromptBody').textContent=p.body;const actions=p.actions||[];$('assistPromptActions').innerHTML=actions.map(([value,label])=>`<button class="btn ${value==='done'||value==='end'?'primary':'secondary'}" data-assist-action="${value}">${label}</button>`).join('');$('assistPrompt').classList.add('open');document.querySelectorAll('[data-assist-action]').forEach(b=>b.onclick=()=>answer(b.dataset.assistAction));}
  function closePrompt(){currentPrompt=null;$('assistPrompt').classList.remove('open');}
  function showMessage(message,error=false){$('assistStatus').textContent=message;$('assistStatus').style.color=error?'var(--danger)':'var(--ok)';}
  async function render(){const s=await settings(),session=await db.get('session'),token=await db.get('installationToken');$('assistControls').classList.toggle('hidden',!s.enabled);$('assistRegistrationRow').classList.toggle('hidden',!!token);const active=!!(session?.active&&session.date===localDate(new Date()));$('startAssist').classList.toggle('hidden',active);$('endAssist').classList.toggle('hidden',!active);$('cancelAssist').classList.toggle('hidden',!active);$('assistRunning').classList.toggle('hidden',!active);if(active)$('assistRunning').textContent=`✓ 稼働中（${new Date(session.startedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}開始）`;}
  function localDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  async function foregroundEvent(p){const s=await settings();if(s.method==='voice')playVoice(p.voiceKey,p.repeat||1);else playAlert(p.repeat||1);if(p.requiresAction)showPrompt(p);}
  function playAlert(repeat=1){try{const C=window.AudioContext||window.webkitAudioContext,c=new C();for(let i=0;i<repeat;i++){const o=c.createOscillator(),g=c.createGain(),start=c.currentTime+i*.8;o.frequency.value=740;g.gain.setValueAtTime(.0001,start);g.gain.exponentialRampToValueAtTime(.18,start+.02);g.gain.exponentialRampToValueAtTime(.0001,start+.35);o.connect(g).connect(c.destination);o.start(start);o.stop(start+.4);}}catch{}}
  async function playVoice(key,repeat=1){const src=`./audio/${key}.mp3`;try{for(let i=0;i<repeat;i++){const a=new Audio(src);await a.play();await new Promise(r=>{a.onended=r;a.onerror=r;});}}catch{playAlert(1);showMessage('音声を自動再生できなかったため、アラート音に切り替えました。',true);}}
  async function init(){
    await loadSettings();if('serviceWorker'in navigator){swRegistration=await navigator.serviceWorker.register('./service-worker.js');await navigator.serviceWorker.ready;}
    $('startAssist').onclick=startSession;$('endAssist').onclick=()=>{if(confirm('今日の業務アシストを終了しますか？'))endSession('ended');};$('cancelAssist').onclick=()=>{if(confirm('誤って開始した業務アシストを中止しますか？'))endSession('cancelled');};$('saveAssistSettings').onclick=saveSettings;
    document.querySelectorAll('#routes input').forEach(el=>el.addEventListener('change',()=>updateRoutes().catch(()=>{})));
    navigator.serviceWorker?.addEventListener('message',e=>{if(e.data?.type==='assist-event')foregroundEvent(e.data.payload);if(e.data?.type==='assist-open'&&e.data.payload)showPrompt(e.data.payload);});
    window.addEventListener('online',()=>flush().catch(()=>{}));document.addEventListener('visibilitychange',()=>{if(!document.hidden){flush().catch(()=>{});render().catch(()=>{});}});
    timer=setInterval(()=>{if(!document.hidden)flush().catch(()=>{});},30000);await flush().catch(()=>{});const existing=await db.get('session');if(existing?.active&&existing.date!==localDate(new Date()))await endSession('date-changed');await render();
    const params=new URLSearchParams(location.search);if(params.has('assistEvent')){const pending=await db.get('pendingPrompt');if(pending)showPrompt(pending);}
  }
  window.addEventListener('load',()=>init().catch(e=>showMessage(e.message,true)));
})();

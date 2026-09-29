(function(){
  'use strict';
  const core=window.NSAssistCore,db=window.NSAssistDB,config=window.NS_ASSIST_CONFIG||{apiBase:''};
  const $=id=>document.getElementById(id);
  let swRegistration,currentPrompt=null,timer=null,audioContext=null,promptScrollY=0;
  const voiceBuffers=new Map();
  const apiBase=String(config.apiBase||'').replace(/\/$/,'');
  const routeInputs=()=>Array.from({length:6},(_,i)=>({cases:$(`r${i+1}c`)?.value??'',items:$(`r${i+1}i`)?.value??''}));
  const routes=()=>routeInputs().map(route=>route.cases===''?null:Number(route.cases));

  async function api(path,body){
    if(!apiBase)throw Error('通知サーバーがまだ設定されていません。');
    const token=await db.get('installationToken');
    const response=await fetch(apiBase+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Error(data.error||'通知サーバーとの通信に失敗しました。');
    return data;
  }

  async function queue(path,body){
    const id=crypto.randomUUID(),item={id,path,body:path==='/api/action'?{...body,actionId:id}:body,createdAt:Date.now()};
    await db.putOutbox(item);
    try{await flush();}catch{}
    return item;
  }

  async function flush(){
    for(const item of await db.listOutbox()){
      await api(item.path,item.body);
      await db.deleteOutbox(item.id);
    }
  }

  async function settings(){return core.mergeSettings(await db.get('settings'));}

  async function saveSettings(){
    const saved=core.mergeSettings({
      enabled:$('assistEnabled').checked,
      method:$('assistMethod').value,
      loadEnabled:$('loadNotify').checked,
      deliveryEnabled:$('deliveryNotify').checked,
      dispatchTime:$('dispatchTime').value,
      arrivalTime:$('arrivalTime').value
    });
    await db.set('settings',saved);
    await db.addEvent('settings-saved',{enabled:saved.enabled});
    toggleSettings(saved);
    if(!saved.enabled){
      const session=await db.get('session');
      if(session?.active)await endSession('disabled');
    }
    await render();
    $('assistSettingsStatus').innerHTML='<strong>業務アシスト設定を保存しました。</strong><br>変更内容は次回の稼働開始から反映されます。';
  }

  function toggleSettings(value){$('assistDetails').classList.toggle('hidden',!value.enabled);}

  async function loadSettings(){
    const saved=await settings();
    $('assistEnabled').checked=saved.enabled;
    $('assistMethod').value=saved.method;
    $('loadNotify').checked=saved.loadEnabled;
    $('deliveryNotify').checked=saved.deliveryEnabled;
    $('dispatchTime').value=saved.dispatchTime;
    $('arrivalTime').value=saved.arrivalTime;
    toggleSettings(saved);
  }

  async function ensurePermission(){
    if(!('Notification'in window)||!swRegistration)throw Error('この端末では通知を利用できません。');
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw Error('通知が許可されていません。');
    if(!apiBase)throw Error('通知サーバーの設定後に有効化できます。');
    const state=await api('/api/config');
    const key=Uint8Array.from(atob(state.publicKey.replace(/-/g,'+').replace(/_/g,'/')),character=>character.charCodeAt(0));
    const subscription=await swRegistration.pushManager.getSubscription()||await swRegistration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
    let token=await db.get('installationToken');
    if(!token){
      const registrationCode=$('assistRegistrationCode').value.trim();
      if(!registrationCode)throw Error('初回のみ、通知サーバー接続コードを入力してください。');
      const result=await api('/api/install',{subscription:subscription.toJSON(),registrationCode});
      if(result.token){
        token=result.token;
        await db.set('installationToken',token);
        $('assistRegistrationCode').value='';
      }
    }else{
      await api('/api/install',{subscription:subscription.toJSON()});
    }
    await db.set('notificationReady',true);
    $('assistRegistrationRow').classList.add('hidden');
  }

  async function expirePreviousDaySession(){
    const session=await db.get('session'),today=core.localDate();
    if(session?.active&&session.date!==today){
      await endSession('date-changed');
      return true;
    }
    return false;
  }

  async function startSession(){
    unlockAudio();
    const saved=await settings(),today=core.localDate();
    if(!saved.enabled)return showMessage('業務アシストはOFFです。');
    if($('workDate').value!==today)return showMessage('稼働開始は今日の画面で行ってください。',true);
    await expirePreviousDaySession();
    try{await ensurePermission();}catch(error){return showMessage(error.message,true);}
    const old=await db.get('session');
    if(old?.active)return;
    const now=Date.now(),session={id:crypto.randomUUID(),date:today,active:true,startedAt:now,updatedAt:now,routes:Object.fromEntries(routes().map((value,index)=>[index+1,value])),completed:{}};
    await db.set('session',session);
    const schedule=core.makeSchedule({date:today,now,settings:saved,routes:routes()});
    await queue('/api/session/start',{session,schedule,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
    await db.addEvent('session-started',{sessionId:session.id});
    await render();
    const checkin={eventId:'checkin',...core.CONFIRMATIONS.checkin,type:'checkin'};
    if(saved.method==='voice')playVoice('checkin',1);else playAlert(1);
    showPrompt(checkin);
  }

  async function endSession(reason='ended'){
    const session=await db.get('session');
    if(!session?.active)return;
    const saved=await settings();
    const next=core.reduceSession(session,{type:reason==='ended'?'end':'cancel'});
    await db.set('session',next);
    await queue('/api/session/end',{sessionId:next.id,reason});
    await db.addEvent('session-ended',{reason});
    await db.set('pendingPrompt',null);
    closePrompt();
    closeMissingPrompt();
    await render();
    if(reason==='ended'){
      if(saved.method==='voice')await playVoice('completion',1);else await playAlert(1);
      showMessage('お疲れ様でした！ShinQLOで業務終了報告をしてください。最後に、本日の業務データ入力も忘れずにお願いします');
    }
  }

  function missingEndFields(){return core.missingEndFields({endMeter:$('endMeter')?.value??'',routes:routeInputs()});}

  function showMissingPrompt(missing){
    $('assistMissingList').innerHTML='';
    missing.forEach(item=>{
      const entry=document.createElement('li');
      entry.textContent=item;
      $('assistMissingList').appendChild(entry);
    });
    $('assistMissingPrompt').classList.add('open');
    lockPromptBackground();
  }

  function closeMissingPrompt(){$('assistMissingPrompt').classList.remove('open');unlockPromptBackground();}

  async function requestEnd(){
    unlockAudio();
    const missing=missingEndFields();
    if(missing.length){
      closePrompt();
      showMissingPrompt(missing);
      return;
    }
    closeMissingPrompt();
    if(confirm('今日の業務アシストを終了しますか？'))await endSession('ended');
  }

  async function updateRoutes(){
    const session=await db.get('session');
    if(!session?.active)return;
    let next=session;
    routes().forEach((value,index)=>{
      if(next.routes?.[index+1]!==value)next=core.reduceSession(next,{type:'route_count',route:index+1,value});
    });
    await db.set('session',next);
    await queue('/api/session/routes',{sessionId:next.id,routes:next.routes});
  }

  async function answer(action){
    if(!currentPrompt)return;
    const prompt=currentPrompt,session=await db.get('session');
    if(action==='done'){
      const next=core.reduceSession(session,{type:'complete',eventId:prompt.eventId});
      await db.set('session',next);
      await queue('/api/action',{sessionId:next.id,eventId:prompt.eventId,action});
    }else if(action==='end'){
      await requestEnd();
      return;
    }else if(action==='synchro_done'){
      const next=core.reduceSession(session,{type:'synchro_done'});
      await db.set('session',next);
      await queue('/api/action',{sessionId:next.id,eventId:prompt.eventId,action});
    }else{
      await queue('/api/action',{sessionId:session.id,eventId:prompt.eventId,action});
    }
    await db.set('pendingPrompt',null);
    await db.addEvent('answer',{eventId:prompt.eventId,action});
    closePrompt();
    await render();
  }

  function showPrompt(prompt){
    currentPrompt=prompt;
    db.set('pendingInfo',null).catch(()=>{});
    $('assistPromptTitle').textContent=prompt.title;
    $('assistPromptBody').textContent=prompt.body;
    const actions=prompt.actions||[];
    $('assistPromptActions').innerHTML=actions.map(([value,label])=>`<button class="btn ${value==='done'||value==='end'?'primary':'secondary'}" data-assist-action="${value}">${label}</button>`).join('');
    $('assistPrompt').classList.add('open');
    lockPromptBackground();
    document.querySelectorAll('[data-assist-action]').forEach(button=>button.onclick=()=>answer(button.dataset.assistAction));
  }

  function showInfoMessage(payload){
    currentPrompt=null;
    $('assistPromptTitle').textContent=payload.title||'お知らせ';
    $('assistPromptBody').textContent=payload.body||'';
    $('assistPromptActions').innerHTML='<button class="btn primary" id="closeAssistInfo" type="button">閉じる</button>';
    $('assistPrompt').classList.add('open');
    lockPromptBackground();
    $('closeAssistInfo').onclick=()=>{closePrompt();db.set('pendingInfo',null).catch(()=>{});};
  }

  function promptBackgroundTargets(){return document.querySelectorAll('body > header, body > main, body > .modal');}
  function lockPromptBackground(){
    if(document.body.classList.contains('prompt-open'))return;
    promptScrollY=window.scrollY;
    document.body.style.top=`-${promptScrollY}px`;
    document.body.classList.add('prompt-open');
    promptBackgroundTargets().forEach(element=>element.inert=true);
  }
  function unlockPromptBackground(){
    if(document.querySelector('.prompt-modal.open')||!document.body.classList.contains('prompt-open'))return;
    document.body.classList.remove('prompt-open');
    document.body.style.top='';
    promptBackgroundTargets().forEach(element=>element.inert=false);
    window.scrollTo(0,promptScrollY);
  }
  function closePrompt(){currentPrompt=null;$('assistPrompt').classList.remove('open');unlockPromptBackground();}
  function showMessage(message,error=false){$('assistStatus').textContent=message;$('assistStatus').style.color=error?'var(--danger)':'var(--ok)';}

  async function render(){
    const saved=await settings(),session=await db.get('session'),token=await db.get('installationToken'),today=core.localDate();
    $('assistControls').classList.toggle('hidden',!saved.enabled);
    $('assistRegistrationRow').classList.toggle('hidden',!!token);
    const active=!!(session?.active&&session.date===today);
    $('startAssist').classList.toggle('hidden',active);
    $('endAssist').classList.toggle('hidden',!active);
    $('cancelAssist').classList.toggle('hidden',!active);
    $('assistRunning').classList.toggle('hidden',!active);
    if(active)$('assistRunning').textContent=`✓ 稼働中（${new Date(session.startedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}開始）`;
  }

  async function foregroundEvent(payload){
    if(payload.requiresAction)showPrompt(payload);
  }

  async function restorePendingMessages(){
    const pending=await db.get('pendingPrompt');
    if(pending?.requiresAction){
      const session=await db.get('session');
      if(session?.active&&session.id===pending.sessionId){
        showPrompt(pending);
        return;
      }
      await db.set('pendingPrompt',null);
    }
    const info=await db.get('pendingInfo');
    if(info)showInfoMessage(info);
  }

  function unlockAudio(){
    try{
      if(!audioContext){const AudioContextClass=window.AudioContext||window.webkitAudioContext;audioContext=AudioContextClass?new AudioContextClass():null;}
      if(audioContext?.state==='suspended')audioContext.resume().catch(()=>{});
    }catch{}
    return audioContext;
  }

  async function playAlert(repeat=1){
    try{
      const context=unlockAudio();
      if(!context)return;
      if(context.state==='suspended')await context.resume();
      for(let index=0;index<repeat;index++){
        const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+.04+index*.8;
        oscillator.frequency.value=740;
        gain.gain.setValueAtTime(.0001,start);
        gain.gain.exponentialRampToValueAtTime(.18,start+.02);
        gain.gain.exponentialRampToValueAtTime(.0001,start+.35);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(start);
        oscillator.stop(start+.4);
      }
    }catch{}
  }

  async function playVoice(key,repeat=1){
    const src=`./audio/${key}.mp3`;
    try{
      const context=unlockAudio();
      if(!context)throw Error('audio unavailable');
      if(context.state==='suspended')await context.resume();
      let buffer=voiceBuffers.get(key);
      if(!buffer){
        const response=await fetch(src);
        if(!response.ok)throw Error('voice unavailable');
        buffer=await context.decodeAudioData(await response.arrayBuffer());
        voiceBuffers.set(key,buffer);
      }
      for(let index=0;index<repeat;index++){
        const source=context.createBufferSource();
        source.buffer=buffer;
        source.connect(context.destination);
        await new Promise(resolve=>{source.onended=resolve;source.start();});
        if(index<repeat-1)await new Promise(resolve=>setTimeout(resolve,350));
      }
    }catch{
      await playAlert(repeat);
      showMessage('音声データが利用できないため、アラート音でお知らせしました。');
    }
  }

  async function init(){
    $('appVersion').textContent=`NS業務アシスト Version ${config.appVersion||'--'}`;
    await loadSettings();
    if('serviceWorker'in navigator){
      swRegistration=await navigator.serviceWorker.register('./service-worker.js');
      await navigator.serviceWorker.ready;
    }
    $('startAssist').onclick=startSession;
    $('endAssist').onclick=requestEnd;
    $('closeAssistMissing').onclick=closeMissingPrompt;
    $('cancelAssist').onclick=()=>{if(confirm('誤って開始した業務アシストを中止しますか？'))endSession('cancelled');};
    $('saveAssistSettings').onclick=()=>saveSettings().catch(error=>{$('assistSettingsStatus').textContent=error.message;$('assistSettingsStatus').style.color='var(--danger)';});
    document.querySelectorAll('#routes input').forEach(element=>{
      element.addEventListener('change',()=>updateRoutes().catch(()=>{}));
    });
    navigator.serviceWorker?.addEventListener('message',event=>{
      if(event.data?.type==='assist-event')foregroundEvent(event.data.payload);
      if(event.data?.type==='assist-open'&&event.data.payload){
        if(event.data.payload.requiresAction)showPrompt(event.data.payload);
        else showInfoMessage(event.data.payload);
      }
    });
    window.addEventListener('online',()=>flush().catch(()=>{}));
    const resume=()=>expirePreviousDaySession().then(()=>flush()).then(()=>render()).then(()=>restorePendingMessages()).catch(()=>{});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)resume();});
    window.addEventListener('focus',resume);
    window.addEventListener('pageshow',resume);
    timer=setInterval(()=>{if(!document.hidden)expirePreviousDaySession().then(()=>flush()).then(()=>render()).catch(()=>{});},30000);
    await flush().catch(()=>{});
    await expirePreviousDaySession();
    await render();
    await restorePendingMessages();
  }

  window.addEventListener('load',()=>init().catch(error=>showMessage(error.message,true)));
})();

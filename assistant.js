(function(){
  'use strict';
  const core=window.NSAssistCore,db=window.NSAssistDB,config=window.NS_ASSIST_CONFIG||{apiBase:''};
  const $=id=>document.getElementById(id);
  let swRegistration,currentPrompt=null,timer=null,audioContext=null;
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
      infoRepeats:$('infoRepeats').value,
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
    $('infoRepeats').value=saved.infoRepeats;
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
    const checkin={eventId:'checkin',...core.CONFIRMATIONS.checkin,type:'checkin',voiceKey:'checkin'};
    if(saved.method==='voice')playVoice('checkin',1);else playAlert(1);
    showPrompt(checkin);
  }

  async function endSession(reason='ended'){
    const session=await db.get('session');
    if(!session?.active)return;
    const next=core.reduceSession(session,{type:reason==='ended'?'end':'cancel'});
    await db.set('session',next);
    await queue('/api/session/end',{sessionId:next.id,reason});
    await db.addEvent('session-ended',{reason});
    await db.set('pendingPrompt',null);
    closePrompt();
    await render();
    if(reason==='ended')showMessage('お疲れ様でした！シンクロで業務終了報告をしてください。最後に、本日の業務データ入力も忘れずにお願いします');
  }

  function missingEndFields(){return core.missingEndFields({endMeter:$('endMeter')?.value??'',routes:routeInputs()});}

  function updateEndAvailability(active){
    const missing=active?missingEndFields():[],message=$('assistEndValidation');
    $('endAssist').disabled=active&&missing.length>0;
    message.classList.toggle('hidden',!active||missing.length===0);
    message.style.color='var(--danger)';
    message.textContent=missing.length?`未入力の項目があります\n業務終了前に、各便の件数・個数をすべて入力してください。\n${missing.join('\n')}`:'';
  }

  async function requestEnd(){
    const missing=missingEndFields();
    if(missing.length){
      closePrompt();
      updateEndAvailability(true);
      return;
    }
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
    $('assistPromptTitle').textContent=prompt.title;
    $('assistPromptBody').textContent=prompt.body;
    const actions=prompt.actions||[];
    $('assistPromptActions').innerHTML=actions.map(([value,label])=>`<button class="btn ${value==='done'||value==='end'?'primary':'secondary'}" data-assist-action="${value}">${label}</button>`).join('');
    $('assistPrompt').classList.add('open');
    document.querySelectorAll('[data-assist-action]').forEach(button=>button.onclick=()=>answer(button.dataset.assistAction));
  }

  function closePrompt(){currentPrompt=null;$('assistPrompt').classList.remove('open');}
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
    updateEndAvailability(active);
  }

  async function foregroundEvent(payload){
    const saved=await settings();
    if(saved.method==='voice')playVoice(payload.voiceKey,payload.repeat||1);else playAlert(payload.repeat||1);
    if(payload.requiresAction)showPrompt(payload);
  }

  function unlockAudio(){
    try{
      if(!audioContext){const AudioContextClass=window.AudioContext||window.webkitAudioContext;audioContext=AudioContextClass?new AudioContextClass():null;}
      if(audioContext?.state==='suspended')audioContext.resume().catch(()=>{});
    }catch{}
    return audioContext;
  }

  function playAlert(repeat=1){
    try{
      const context=unlockAudio();
      if(!context)return;
      for(let index=0;index<repeat;index++){
        const oscillator=context.createOscillator(),gain=context.createGain(),start=context.currentTime+index*.8;
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
      for(let index=0;index<repeat;index++){
        const audio=new Audio(src);
        await audio.play();
        await new Promise((resolve,reject)=>{audio.onended=resolve;audio.onerror=()=>reject(Error('voice unavailable'));});
      }
    }catch{
      playAlert(repeat);
      showMessage('音声データが利用できないため、アラート音でお知らせしました。');
    }
  }

  async function init(){
    await loadSettings();
    if('serviceWorker'in navigator){
      swRegistration=await navigator.serviceWorker.register('./service-worker.js');
      await navigator.serviceWorker.ready;
    }
    $('startAssist').onclick=startSession;
    $('endAssist').onclick=requestEnd;
    $('cancelAssist').onclick=()=>{if(confirm('誤って開始した業務アシストを中止しますか？'))endSession('cancelled');};
    $('saveAssistSettings').onclick=()=>saveSettings().catch(error=>{$('assistSettingsStatus').textContent=error.message;$('assistSettingsStatus').style.color='var(--danger)';});
    document.querySelectorAll('#routes input').forEach(element=>{
      element.addEventListener('input',()=>render().catch(()=>{}));
      element.addEventListener('change',()=>updateRoutes().catch(()=>{}));
    });
    $('endMeter').addEventListener('input',()=>render().catch(()=>{}));
    document.addEventListener('pointerdown',unlockAudio,{once:true,capture:true});
    navigator.serviceWorker?.addEventListener('message',event=>{
      if(event.data?.type==='assist-event')foregroundEvent(event.data.payload);
      if(event.data?.type==='assist-open'&&event.data.payload)showPrompt(event.data.payload);
    });
    window.addEventListener('online',()=>flush().catch(()=>{}));
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)expirePreviousDaySession().then(()=>flush()).then(()=>render()).catch(()=>{});});
    timer=setInterval(()=>{if(!document.hidden)expirePreviousDaySession().then(()=>flush()).then(()=>render()).catch(()=>{});},30000);
    await flush().catch(()=>{});
    await expirePreviousDaySession();
    await render();
    const params=new URLSearchParams(location.search);
    if(params.has('assistEvent')){
      const pending=await db.get('pendingPrompt');
      if(pending)showPrompt(pending);
    }
  }

  window.addEventListener('load',()=>init().catch(error=>showMessage(error.message,true)));
})();

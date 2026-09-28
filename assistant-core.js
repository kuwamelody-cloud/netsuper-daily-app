(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.NSAssistCore=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  const LOAD_TIMES=['09:30','11:30','13:30','15:30','17:30','19:30'];
  const DELIVERY_TIMES=['10:00','12:00','14:00','16:00','18:00','20:00'];
  const END_TIMES=['21:00','21:30','22:00'];
  const DEFAULT_SETTINGS=Object.freeze({enabled:true,method:'voice',loadEnabled:true,deliveryEnabled:true,infoRepeats:1,dispatchTime:'09:50',arrivalTime:'09:59'});
  const CONFIRMATIONS={
    arrival:{title:'1便・1件目の到着確認',body:'1便、1件目の到着報告は完了していますか？',actions:[['done','入力済み'],['pending','まだ到着していない']]},
    dispatch:{title:'出庫報告の確認',body:'ShinQLOの出庫報告は完了していますか？',actions:[['done','入力済み'],['pending','未出庫']]},
    checkin:{title:'着車報告の確認',body:'おはようございます！ShinQLOの着車報告は完了していますか？',actions:[['done','入力済み'],['pending','まだ']]},
    end:{title:'業務終了の確認',body:'業務終了が確認できていません。ShinQLOの操作は完了していますか？',actions:[['working','まだ業務中'],['synchro_done','ShinQLO入力済み'],['end','既に業務終了']]}
  };
  function validTime(value){return /^([01]\d|2[0-3]):[0-5]\d$/.test(value||'');}
  function localDate(value=new Date()){
    return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
  }
  function mergeSettings(value={}){
    const s={...DEFAULT_SETTINGS,...value};
    s.enabled=!!s.enabled;s.loadEnabled=!!s.loadEnabled;s.deliveryEnabled=!!s.deliveryEnabled;
    s.method=s.method==='alarm'?'alarm':'voice';s.infoRepeats=Math.min(3,Math.max(1,Number(s.infoRepeats)||1));
    if(!validTime(s.dispatchTime))s.dispatchTime=DEFAULT_SETTINGS.dispatchTime;
    if(!validTime(s.arrivalTime))s.arrivalTime=DEFAULT_SETTINGS.arrivalTime;
    return s;
  }
  function at(date,time){const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);return new Date(y,m-1,d,h,min,0,0).getTime();}
  function makeSchedule({date,now=Date.now(),settings=DEFAULT_SETTINGS,routes=[]}){
    const s=mergeSettings(settings);if(!s.enabled)return[];const events=[];
    const add=(id,type,time,title,body,requiresAction=false,maxAttempts=1,extra={})=>{
      const dueAt=at(date,time);if(dueAt<=now)return;
      events.push({id,type,dueAt,title,body,requiresAction,maxAttempts,retryDelayMs:requiresAction&&maxAttempts>1?300000:0,...extra});
    };
    LOAD_TIMES.forEach((time,i)=>{if(s.loadEnabled&&routes[i]!==0)add(`load-${i+1}`,'info',time,`${i+1}便・積み込み`,` ${i+1}便、積み込み時刻になりました`.trim(),false,1,{route:i+1});});
    DELIVERY_TIMES.forEach((time,i)=>{if(s.deliveryEnabled&&routes[i]!==0)add(`delivery-${i+1}`,'info',time,`${i+1}便・配達開始`,`${i+1}便、配達開始時刻になりました`,false,1,{route:i+1});});
    if(routes[0]!==0){
      add('dispatch','dispatch',s.dispatchTime,CONFIRMATIONS.dispatch.title,CONFIRMATIONS.dispatch.body,true,2,{actions:CONFIRMATIONS.dispatch.actions});
      add('arrival-1','arrival',s.arrivalTime,CONFIRMATIONS.arrival.title,CONFIRMATIONS.arrival.body,true,2,{actions:CONFIRMATIONS.arrival.actions});
    }
    END_TIMES.forEach((time,i)=>add(`end-${i+1}`,'end',time,CONFIRMATIONS.end.title,CONFIRMATIONS.end.body,true,1,{sequence:i+1,actions:CONFIRMATIONS.end.actions}));
    return events.sort((a,b)=>a.dueAt-b.dueAt);
  }
  function reduceSession(session,action,now=Date.now()){
    const next=JSON.parse(JSON.stringify(session));next.updatedAt=now;
    if(action.type==='end'){next.active=false;next.endedAt=now;}
    if(action.type==='cancel'){next.active=false;next.cancelledAt=now;}
    if(action.type==='complete')next.completed={...(next.completed||{}),[action.eventId]:now};
    if(action.type==='synchro_done')next.synchroDoneAt=now;
    if(action.type==='route_count')next.routes={...(next.routes||{}),[action.route]:action.value};
    return next;
  }
  function missingEndFields({endMeter,routes=[]}={}){
    const missing=[];
    if(endMeter===null||endMeter===undefined||String(endMeter).trim()==='')missing.push('終了メーター');
    routes.forEach((route,index)=>{
      if(route?.cases===null||route?.cases===undefined||String(route.cases).trim()==='')missing.push(`${index+1}便：件数`);
      if(route?.items===null||route?.items===undefined||String(route.items).trim()==='')missing.push(`${index+1}便：個数`);
    });
    return missing;
  }
  return {LOAD_TIMES,DELIVERY_TIMES,END_TIMES,DEFAULT_SETTINGS,CONFIRMATIONS,mergeSettings,makeSchedule,reduceSession,missingEndFields,localDate,at};
});

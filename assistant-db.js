(function(root){
  const DB='ns-business-assist',VERSION=1;
  function open(){return new Promise((resolve,reject)=>{const r=indexedDB.open(DB,VERSION);r.onupgradeneeded=()=>{r.result.createObjectStore('kv');r.result.createObjectStore('outbox',{keyPath:'id'});r.result.createObjectStore('events',{autoIncrement:true});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
  async function op(name,mode,fn){const db=await open();return new Promise((resolve,reject)=>{const t=db.transaction(name,mode),r=fn(t.objectStore(name));t.oncomplete=()=>{resolve(r&&r.result);db.close();};t.onerror=()=>{reject(t.error);db.close();};});}
  const get=key=>op('kv','readonly',s=>s.get(key));
  const set=(key,value)=>op('kv','readwrite',s=>s.put(value,key));
  const addEvent=(kind,data={})=>op('events','readwrite',s=>s.add({kind,...data,at:Date.now()}));
  const putOutbox=value=>op('outbox','readwrite',s=>s.put(value));
  const listOutbox=()=>op('outbox','readonly',s=>s.getAll());
  const deleteOutbox=id=>op('outbox','readwrite',s=>s.delete(id));
  root.NSAssistDB={get,set,addEvent,putOutbox,listOutbox,deleteOutbox};
})(globalThis);

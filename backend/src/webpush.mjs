const encoder=new TextEncoder();

export function base64url(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  let binary='';for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
  return btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

export function decodeBase64url(value){
  const padded=String(value).replace(/-/g,'+').replace(/_/g,'/')+'==='.slice((String(value).length+3)%4);
  const binary=atob(padded),out=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);
  return out;
}

function concat(...parts){
  const size=parts.reduce((n,x)=>n+x.length,0),out=new Uint8Array(size);let offset=0;
  for(const part of parts){out.set(part,offset);offset+=part.length;}return out;
}

async function hmac(key,data,cryptoApi=crypto){
  const imported=await cryptoApi.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);
  return new Uint8Array(await cryptoApi.subtle.sign('HMAC',imported,data));
}

async function hkdfExtract(salt,ikm,cryptoApi=crypto){
  return hmac(salt,ikm,cryptoApi);
}

async function hkdfExpand(prk,info,length,cryptoApi=crypto){
  let previous=new Uint8Array(),output=new Uint8Array();
  for(let counter=1;output.length<length;counter++){
    previous=await hmac(prk,concat(previous,info,new Uint8Array([counter])),cryptoApi);
    output=concat(output,previous);
  }
  return output.slice(0,length);
}

export async function encryptPayload(payload,subscription,cryptoApi=crypto){
  const clientPublic=decodeBase64url(subscription.keys.p256dh),auth=decodeBase64url(subscription.keys.auth);
  const clientKey=await cryptoApi.subtle.importKey('raw',clientPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const serverKeys=await cryptoApi.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const serverPublic=new Uint8Array(await cryptoApi.subtle.exportKey('raw',serverKeys.publicKey));
  const shared=new Uint8Array(await cryptoApi.subtle.deriveBits({name:'ECDH',public:clientKey},serverKeys.privateKey,256));
  const authPrk=await hkdfExtract(auth,shared,cryptoApi);
  const keyInfo=concat(encoder.encode('WebPush: info\0'),clientPublic,serverPublic);
  const ikm=await hkdfExpand(authPrk,keyInfo,32,cryptoApi);
  const salt=cryptoApi.getRandomValues(new Uint8Array(16));
  const prk=await hkdfExtract(salt,ikm,cryptoApi);
  const cek=await hkdfExpand(prk,encoder.encode('Content-Encoding: aes128gcm\0'),16,cryptoApi);
  const nonce=await hkdfExpand(prk,encoder.encode('Content-Encoding: nonce\0'),12,cryptoApi);
  const aesKey=await cryptoApi.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['encrypt']);
  const plaintext=concat(encoder.encode(typeof payload==='string'?payload:JSON.stringify(payload)),new Uint8Array([2]));
  const ciphertext=new Uint8Array(await cryptoApi.subtle.encrypt({name:'AES-GCM',iv:nonce},aesKey,plaintext));
  const recordSize=new Uint8Array([0,0,16,0]);
  return {body:concat(salt,recordSize,new Uint8Array([serverPublic.length]),serverPublic,ciphertext),serverPublic};
}

export async function vapidAuthorization(endpoint,{subject,publicKey,privateJwk},now=Date.now(),cryptoApi=crypto){
  const audience=new URL(endpoint).origin;
  const header=base64url(encoder.encode(JSON.stringify({typ:'JWT',alg:'ES256'})));
  const claims=base64url(encoder.encode(JSON.stringify({aud:audience,exp:Math.floor(now/1000)+12*60*60,sub:subject})));
  const unsigned=`${header}.${claims}`;
  const key=await cryptoApi.subtle.importKey('jwk',privateJwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
  const signature=new Uint8Array(await cryptoApi.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${base64url(signature)}, k=${publicKey}`;
}

export async function sendWebPush(subscription,payload,options){
  const endpoint=new URL(subscription.endpoint);
  if(endpoint.protocol!=='https:')throw Error('Push endpoint must use HTTPS');
  const encrypted=await encryptPayload(payload,subscription);
  const authorization=await vapidAuthorization(subscription.endpoint,options);
  return fetch(subscription.endpoint,{
    method:'POST',
    headers:{
      Authorization:authorization,
      'Content-Encoding':'aes128gcm',
      'Content-Type':'application/octet-stream',
      TTL:String(options.ttl??60),
      Urgency:options.urgency||'high',
      ...(options.topic?{Topic:options.topic}: {})
    },
    body:encrypted.body
  });
}

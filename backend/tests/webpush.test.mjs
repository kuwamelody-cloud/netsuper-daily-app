import test from 'node:test';
import assert from 'node:assert/strict';
import {base64url,decodeBase64url,encryptPayload,vapidAuthorization} from '../src/webpush.mjs';

const enc=new TextEncoder(),dec=new TextDecoder();
const concat=(...parts)=>{const out=new Uint8Array(parts.reduce((n,x)=>n+x.length,0));let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;};
async function hmac(key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,data));}
async function expand(prk,info,length){let prev=new Uint8Array(),out=new Uint8Array();for(let i=1;out.length<length;i++){prev=await hmac(prk,concat(prev,info,new Uint8Array([i])));out=concat(out,prev);}return out.slice(0,length);}

test('aes128gcm Web Push payload decrypts with the subscriber private key',async()=>{
  const client=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
  const clientPublic=new Uint8Array(await crypto.subtle.exportKey('raw',client.publicKey)),auth=crypto.getRandomValues(new Uint8Array(16));
  const subscription={keys:{p256dh:base64url(clientPublic),auth:base64url(auth)}};
  const encrypted=await encryptPayload({message:'通知テスト'},subscription);
  const salt=encrypted.body.slice(0,16),keyLength=encrypted.body[20],serverPublic=encrypted.body.slice(21,21+keyLength),ciphertext=encrypted.body.slice(21+keyLength);
  const serverKey=await crypto.subtle.importKey('raw',serverPublic,{name:'ECDH',namedCurve:'P-256'},false,[]);
  const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:serverKey},client.privateKey,256));
  const authPrk=await hmac(auth,shared),ikm=await expand(authPrk,concat(enc.encode('WebPush: info\0'),clientPublic,serverPublic),32);
  const prk=await hmac(salt,ikm),cek=await expand(prk,enc.encode('Content-Encoding: aes128gcm\0'),16),nonce=await expand(prk,enc.encode('Content-Encoding: nonce\0'),12);
  const aes=await crypto.subtle.importKey('raw',cek,{name:'AES-GCM'},false,['decrypt']);
  const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce},aes,ciphertext));
  assert.equal(plain.at(-1),2);assert.deepEqual(JSON.parse(dec.decode(plain.slice(0,-1))),{message:'通知テスト'});
});

test('VAPID authorization contains a verifiable ES256 JWT',async()=>{
  const keys=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const [raw,jwk]=await Promise.all([crypto.subtle.exportKey('raw',keys.publicKey),crypto.subtle.exportKey('jwk',keys.privateKey)]);
  const header=await vapidAuthorization('https://web.push.apple.com/Q',{subject:'https://example.com',publicKey:base64url(raw),privateJwk:jwk},0);
  const token=header.match(/^vapid t=([^,]+), k=/)[1],[head,claims,sig]=token.split('.');
  const ok=await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},keys.publicKey,decodeBase64url(sig),enc.encode(head+'.'+claims));
  assert.equal(ok,true);assert.equal(JSON.parse(dec.decode(decodeBase64url(claims))).aud,'https://web.push.apple.com');
});

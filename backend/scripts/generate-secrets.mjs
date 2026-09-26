import {randomBytes,webcrypto} from 'node:crypto';

const keys=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
const [publicRaw,privateJwk]=await Promise.all([
  webcrypto.subtle.exportKey('raw',keys.publicKey),
  webcrypto.subtle.exportKey('jwk',keys.privateKey)
]);
const b64=value=>Buffer.from(value).toString('base64url');
console.log('VAPID_PUBLIC_KEY='+b64(publicRaw));
console.log('VAPID_PRIVATE_JWK='+JSON.stringify(privateJwk));
console.log('REGISTRATION_CODE='+randomBytes(18).toString('base64url'));

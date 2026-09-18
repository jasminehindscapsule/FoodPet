/* Generates a VAPID key pair for Web Push.
   Public key goes in config.js (shipped to the browser).
   Private key becomes a Worker secret — it never belongs in the repo. */
import { webcrypto as crypto } from 'node:crypto';

const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const pair = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);

const pub = await crypto.subtle.exportKey('raw', pair.publicKey);      // 65-byte point
const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log('VAPID_PUBLIC_KEY  (put in config.js):');
console.log(b64url(pub));
console.log();
console.log('VAPID_PRIVATE_KEY (store as a Worker secret, keep out of git):');
console.log(jwk.d);

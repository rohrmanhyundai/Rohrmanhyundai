import Pusher from 'pusher-js';
import SparkMD5 from 'spark-md5';

const APP_ID  = '2148174';
const KEY     = '459d9c0d3793fadfd5c0';
const SECRET  = '116267cf41f89ea02154';
const CLUSTER = 'us2';

export const ADVISOR_CHANNEL = 'rohrman-advisor-chat';
export const TECH_CHANNEL    = 'rohrman-tech-chat';
export const NEW_MSG_EVENT   = 'new-message';

let _pusher = null;
export function getPusher() {
  if (!_pusher) _pusher = new Pusher(KEY, { cluster: CLUSTER });
  return _pusher;
}

// Trigger a Pusher event from the browser via the REST API
export async function triggerEvent(channel, eventName, data = {}) {
  try {
    const body    = JSON.stringify({ name: eventName, channel, data: JSON.stringify(data) });
    const ts      = Math.floor(Date.now() / 1000).toString();
    const bodyMd5 = SparkMD5.hash(body);

    const toSign = ['POST', `/apps/${APP_ID}/events`,
      `auth_key=${KEY}&auth_timestamp=${ts}&auth_version=1.0&body_md5=${bodyMd5}`,
    ].join('\n');

    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sigBuf = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(toSign));
    const authSig = Array.from(new Uint8Array(sigBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

    const qs = `auth_key=${KEY}&auth_timestamp=${ts}&auth_version=1.0&body_md5=${bodyMd5}&auth_signature=${authSig}`;
    await fetch(`https://api-${CLUSTER}.pusher.com/apps/${APP_ID}/events?${qs}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
  } catch (e) {
    console.warn('Pusher trigger failed:', e);
  }
}

import Pusher from 'pusher-js';
import { apiFetch } from './api.js';

// The app key is public by design (it only lets a browser SUBSCRIBE). The app
// secret, which lets you PUBLISH, lives on the worker — see triggerEvent.
const KEY     = '6c131faa1a5d46e69dca';
const CLUSTER = 'us2';

export const ADVISOR_CHANNEL = 'rohrman-advisor-chat';
export const TECH_CHANNEL    = 'rohrman-tech-chat';
export const SYSTEM_CHANNEL  = 'rohrman-system';
export const GLOBAL_CHANNEL  = 'rohrman-global-msg';
export const NEW_MSG_EVENT       = 'new-message';
export const FORCE_REFRESH_EVENT = 'force-refresh';
export const GLOBAL_MSG_EVENT    = 'global-message';
export const GLOBAL_REPLY_EVENT  = 'global-reply';

let _pusher = null;
export function getPusher() {
  if (!_pusher) _pusher = new Pusher(KEY, { cluster: CLUSTER });
  return _pusher;
}

// Publish an event. The worker signs the request with the Pusher secret;
// a signed-in session is all the browser needs.
export async function triggerEvent(channel, eventName, data = {}) {
  try {
    await apiFetch('/pusher/trigger', { method: 'POST', json: { channel, event: eventName, data } });
  } catch (e) {
    console.warn('Pusher trigger failed:', e);
  }
}

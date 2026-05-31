// Lightweight client-side activity tracker.
//
// Records page views and key actions for the current user, queues them in
// memory, and flushes to GitHub on a schedule and on tab hide / unload. The
// server-side helper (appendUserActivity in utils/github.js) handles the
// 30-day retention prune.
//
// Admins are never tracked.

import { appendUserActivity } from './github';

const FLUSH_INTERVAL_MS = 60 * 1000; // 60s steady-state flush cadence
const MIN_FLUSH_GAP_MS = 8 * 1000;   // never flush more often than every 8s
const MAX_QUEUE = 200;               // safety upper bound on queued events

let _username = null;
let _role = null;
let _queue = [];
let _flushTimer = null;
let _lastFlushAt = 0;
let _initialized = false;

function isAdmin(role) {
  return (role || '').toLowerCase() === 'admin';
}

function scheduleFlush() {
  if (_flushTimer) return;
  _flushTimer = setInterval(() => { flush(); }, FLUSH_INTERVAL_MS);
}

function clearFlushTimer() {
  if (_flushTimer) { clearInterval(_flushTimer); _flushTimer = null; }
}

async function flush(force = false) {
  if (!_username) return;
  if (_queue.length === 0) return;
  const now = Date.now();
  if (!force && now - _lastFlushAt < MIN_FLUSH_GAP_MS) return;
  const batch = _queue.splice(0, _queue.length);
  _lastFlushAt = now;
  try { await appendUserActivity(_username, batch); }
  catch (err) {
    // Network/auth failure: re-queue and try again on the next tick. Cap to
    // MAX_QUEUE so we don't grow unbounded if the user is offline for hours.
    try { console.warn('activity flush failed:', err); } catch {}
    _queue = [...batch, ..._queue].slice(0, MAX_QUEUE);
  }
}

function push(type, label, details) {
  if (!_initialized || !_username) return;
  if (_queue.length >= MAX_QUEUE) _queue.shift(); // oldest dropped
  _queue.push({
    at: new Date().toISOString(),
    type,                       // 'page' | 'action'
    label: String(label || ''), // short noun for the event ("dashboard" or "delete-ro")
    ...(details ? { details: String(details).slice(0, 200) } : {}),
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

// Call from App.jsx once the user is logged in. Restarting / changing user
// flushes any pending events from the previous user first.
export function initActivityTracker(username, role) {
  if (_username && _username !== (username || '').toUpperCase()) {
    flush(true);
  }
  _username = (username || '').toUpperCase() || null;
  _role = role || null;
  _initialized = !!_username && !isAdmin(_role);
  if (!_initialized) {
    clearFlushTimer();
    _queue = [];
    return;
  }
  scheduleFlush();

  // Flush on tab hide / unload so we don't lose the tail of a session.
  if (typeof window !== 'undefined' && !window.__activityListenersAttached) {
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); };
    const onBeforeUnload = () => { flush(true); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    window.__activityListenersAttached = true;
  }
}

// Tear down on logout — flush any pending events first.
export function shutdownActivityTracker() {
  flush(true);
  _initialized = false;
  _username = null;
  _role = null;
  _queue = [];
  clearFlushTimer();
}

// Record a page view. Pass the route key (matching App.jsx's `page` string).
export function trackPage(pageKey, details) {
  push('page', pageKey, details);
}

// Record a noteworthy action. `label` should be short and consistent
// (e.g. 'delete-ro', 'save-wip-row', 'generate-ai-report').
export function trackAction(label, details) {
  push('action', label, details);
}

// Force-flush right now. Useful for testing.
export function flushActivityNow() { return flush(true); }

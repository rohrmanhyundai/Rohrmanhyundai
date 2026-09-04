#!/usr/bin/env node
/**
 * Message retention — runs nightly via GitHub Actions.
 *
 * Global messages are kept for 30 days and then deleted for good. The app also
 * hides anything past the window on screen, so a message disappears from view
 * the moment it ages out; this is what actually removes it from the file.
 *
 * A thread's age is its NEWEST activity, not the original send: a month-old
 * message someone replied to yesterday is a live conversation and stays.
 */

const fs = require('fs');
const path = require('path');

const MESSAGES_FILE = path.join(__dirname, '..', 'public', 'data', 'global-messages.json');
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

function lastActivity(m) {
  const replies = Array.isArray(m.replies) ? m.replies : [];
  return replies.reduce((max, r) => Math.max(max, Number(r.timestamp) || 0), Number(m.timestamp) || 0);
}

function main() {
  let raw;
  try {
    raw = fs.readFileSync(MESSAGES_FILE, 'utf8');
  } catch {
    console.log('No global-messages.json — nothing to prune.');
    return;
  }

  let all;
  try {
    all = JSON.parse(raw);
  } catch (err) {
    // Never rewrite a file we could not read: an unreadable file plus a blind
    // write is how a log gets wiped.
    console.error('global-messages.json is not valid JSON — leaving it alone.', err.message);
    process.exitCode = 1;
    return;
  }
  if (!Array.isArray(all)) {
    console.error('global-messages.json is not an array — leaving it alone.');
    process.exitCode = 1;
    return;
  }

  const cutoff = Date.now() - RETENTION_MS;
  // A message carrying no usable timestamp is kept. Guessing "ancient" and
  // deleting it is the one mistake here that can't be undone.
  const kept = all.filter(m => { const t = lastActivity(m); return !t || t >= cutoff; });
  const dropped = all.length - kept.length;

  if (!dropped) {
    console.log(`Nothing older than ${RETENTION_DAYS} days (${all.length} message${all.length === 1 ? '' : 's'} kept).`);
    return;
  }

  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(kept, null, 2), 'utf8');
  console.log(`Pruned ${dropped} message${dropped === 1 ? '' : 's'} older than ${RETENTION_DAYS} days; ${kept.length} kept.`);
}

main();

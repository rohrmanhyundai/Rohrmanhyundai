// Coordination between the chat panels and the app-level @mention watcher.
//
// While a chat panel (Chat / TechChat) is mounted it live-polls its own channel
// and feeds every message straight to the mention checker. That lets the global
// watcher SKIP re-reading a channel a panel is already watching — so we get a
// live chat box + reliable @mention popups without doubling GitHub reads.
export const chatLive = { advisor: 0, tech: 0 };

let _consider = null;
export function setMentionConsider(fn) { _consider = fn; }
export function feedMention(msg, channel) { try { if (_consider) _consider(msg, channel); } catch {} }

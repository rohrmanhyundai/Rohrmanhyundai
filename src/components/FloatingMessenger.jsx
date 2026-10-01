import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EMOJIS } from '../utils/emoji';
import { sendGlobalMessage, replyToGlobalMessage, deleteGlobalMessage } from '../utils/github';
import { uploadMessageMediaToS3, MESSAGE_MEDIA_MAX } from '../utils/s3';
import { triggerEvent, GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, GLOBAL_REPLY_EVENT } from '../utils/pusher';

const uid = () => `gm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const rid = () => `rp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const timeLabel = (ts) => {
  try {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
};

// In a 340px panel a full date on every row wraps onto two lines and pushes the
// message down. Today's messages only need the clock; older ones only the day.
const shortTime = (ts) => {
  try {
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return sameDay
      ? d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
};

// "You → BRYSON, CARTER, CORY, DERRICK, GAVEN, JACOB, KADEN, WEI" ate three
// lines. One name plus a count keeps the row to one, and the full list is in
// the tooltip.
const toSummary = (to = []) => {
  const names = (to || []).map(n => String(n).toUpperCase()).filter(Boolean);
  if (!names.length) return '';
  if (names.length <= 2) return names.join(', ');
  return `${names[0]} +${names.length - 1}`;
};

const BUBBLE = 56;
const PANEL_W = 340;
const PANEL_H = 720;   // roster + message + media; clamped to the window below
const DRAG_SLOP = 4; // px of movement before a press counts as a drag, not a click

function clampToScreen(x, y, w, h) {
  const maxX = Math.max(0, window.innerWidth - w - 8);
  const maxY = Math.max(0, window.innerHeight - h - 8);
  return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
}

// A draggable bubble that lives above the page switch, so it stays put as the
// user moves between screens. Reading and sending both happen here; the
// blocking pop-up still fires separately and is untouched.
// Messages are kept for 30 days. A nightly job prunes the stored file; this
// cutoff is what stops an old thread showing in the hours before it runs.
const RETENTION_DAYS = 30;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

// The newest thing in a thread — a month-old message with a reply from
// yesterday is still live and must not age out on the original timestamp.
export function lastActivity(m) {
  const replies = Array.isArray(m.replies) ? m.replies : [];
  return replies.reduce((max, r) => Math.max(max, Number(r.timestamp) || 0), Number(m.timestamp) || 0);
}

// Undated messages are shown, and the nightly prune keeps them for the same
// reason: better a stray row than a deleted one nobody can get back.
export function withinRetention(m, windowMs = RETENTION_MS) {
  const t = lastActivity(m);
  return !t || Date.now() - t < windowMs;
}

/* A 😊 button with a grid of emoji above it.
 *
 * The panel floats over the message list rather than pushing it around — the
 * reply box sits inches from the bottom of a small window, and a picker that
 * grew the layout shoved the Send button out of reach. Clicking outside or
 * pressing Escape closes it; picking one drops it in and closes it, because
 * hunting for the close button after every emoji is the annoying part.
 *
 * It is positioned fixed from the button's own rectangle and clamped to the
 * window. Anchored inside the messenger it hung off the left edge of that
 * narrow panel and got clipped — half the emoji were unreachable.
 */
const EMOJI_PANEL_W = 250;

// Pictures attached to a message ({ url, name, type }). Click one to open it
// full size in a new tab. Also used by the message pop-up in App.jsx.
export function MessageMedia({ media, size = 110 }) {
  if (!Array.isArray(media) || !media.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
      {media.map((m, i) => (
        <a key={i} href={m.url} target="_blank" rel="noreferrer" title={m.name || 'Open picture'}
          style={{ display: 'block', width: size, height: size, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(148,163,184,.35)', background: 'rgba(2,6,23,.5)' }}>
          <img src={m.url} alt={m.name || 'picture'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </a>
      ))}
    </div>
  );
}

function EmojiPicker({ onPick, title = 'Add an emoji' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);      // { left, bottom, width } in viewport px
  const wrapRef = useRef(null);
  const btnRef = useRef(null);

  const place = React.useCallback(() => {
    const b = btnRef.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    const width = Math.min(EMOJI_PANEL_W, window.innerWidth - 16);
    // Right-align with the button, then pull it back inside the window.
    const left = Math.max(8, Math.min(r.right - width, window.innerWidth - width - 8));
    setPos({ left, bottom: Math.max(8, window.innerHeight - r.top + 6), width });
  }, []);

  React.useLayoutEffect(() => { if (open) place(); }, [open, place]);
  useEffect(() => {
    if (!open) return;
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: 'relative', flexShrink: 0 }}>
      <button
        ref={btnRef}
        type="button"
        title={title}
        onClick={() => setOpen(o => !o)}
        style={{
          background: open ? 'rgba(56,189,248,.18)' : 'transparent',
          border: `1px solid ${open ? 'rgba(56,189,248,.45)' : 'transparent'}`,
          borderRadius: 8, padding: '5px 7px', fontSize: 17, lineHeight: 1,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
        😊
      </button>
      {open && pos && (
        <div style={{
          position: 'fixed', left: pos.left, bottom: pos.bottom, zIndex: 2000,
          width: pos.width, maxHeight: '45vh', overflowY: 'auto',
          background: '#1e293b', border: '1px solid rgba(255,255,255,0.14)',
          borderRadius: 12, padding: 8, display: 'flex', flexWrap: 'wrap', gap: 2,
          boxShadow: '0 -8px 26px rgba(0,0,0,0.55)',
        }}>
          {EMOJIS.map(e => (
            <button key={e} type="button"
              onClick={() => { onPick(e); setOpen(false); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 19, padding: '3px 4px', borderRadius: 7, lineHeight: 1, fontFamily: 'inherit' }}
              onMouseEnter={el => el.currentTarget.style.background = 'rgba(255,255,255,0.1)'}
              onMouseLeave={el => el.currentTarget.style.background = 'none'}>
              {e}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FloatingMessenger({
  currentUser, currentRole, users, messages, unread, canSend, onMarkSeen, onMessagesChange, openSignal = 0,
}) {
  const me = (currentUser || '').toUpperCase();
  const canDelete = currentRole === 'admin' || (currentRole || '').includes('manager');
  const posKey = `floatingMsgPos:${me}`;

  const [pos, setPos] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(posKey) || 'null');
      if (saved && typeof saved.x === 'number') return clampToScreen(saved.x, saved.y, BUBBLE, BUBBLE);
    } catch {}
    return clampToScreen(window.innerWidth - BUBBLE - 16, window.innerHeight - BUBBLE - 96, BUBBLE, BUBBLE);
  });
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('inbox');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyingId, setReplyingId] = useState('');
  const [replyOpenId, setReplyOpenId] = useState('');   // which message has its reply box open
  const [selected, setSelected] = useState(() => new Set());
  const [text, setText] = useState('');
  // 📎 Send media: pictures / screenshots waiting to go with the message.
  // Picked, dragged in, or pasted (⌘/Ctrl+V); uploaded when Send is pressed.
  const [attachments, setAttachments] = useState([]);   // [{ id, file, preview }]
  const [dragOver, setDragOver] = useState(false);
  const mediaInputRef = useRef(null);
  const [alert, setAlert] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  // The pop-up hands off to the bubble: dismissing a message opens this panel
  // on the inbox so the reply is right there. A counter rather than a boolean,
  // so a second pop-up re-opens a panel the user just closed.
  useEffect(() => {
    if (!openSignal) return;
    setTab('inbox');
    setOpen(true);
  }, [openSignal]);
  // Looking at the inbox is what clears the unread count.
  useEffect(() => {
    if (open && tab === 'inbox' && onMarkSeen) onMarkSeen();
  }, [open, tab, onMarkSeen, unread]);

  const composeRef = useRef(null);
  const replyInputRef = useRef(null);   // the one open reply box, so a send can hand focus back
  const panelRef = useRef(null);
  const bubbleRef = useRef(null);

  // Click anywhere off the panel and it closes. The bubble is excluded because
  // its own handler already toggles — closing here first would just reopen it.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (panelRef.current?.contains(e.target)) return;
      if (bubbleRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    // Capture, so a click that a page handler stops still closes the panel.
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const dragRef = useRef({ active: false, moved: false, dx: 0, dy: 0 });
  // Mirror of `pos` that's current *within* a gesture. React hasn't re-rendered
  // yet when pointerup lands in the same tick as the last pointermove, so
  // reading state there can save the position the bubble started at.
  const posRef = useRef(pos);
  const setPosBoth = useCallback((next) => { posRef.current = next; setPos(next); }, []);

  // Keep the bubble on screen when the window is resized or the phone rotates.
  useEffect(() => {
    const onResize = () => setPosBoth(clampToScreen(posRef.current.x, posRef.current.y, BUBBLE, BUBBLE));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [setPosBoth]);

  const onPointerDown = (e) => {
    const p = posRef.current;
    dragRef.current = { active: true, moved: false, dx: e.clientX - p.x, dy: e.clientY - p.y, startX: p.x, startY: p.y };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch {}
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d.active) return;
    const nx = e.clientX - d.dx, ny = e.clientY - d.dy;
    if (!d.moved && (Math.abs(nx - d.startX) > DRAG_SLOP || Math.abs(ny - d.startY) > DRAG_SLOP)) d.moved = true;
    if (d.moved) setPosBoth(clampToScreen(nx, ny, BUBBLE, BUBBLE));
  };
  const onPointerUp = (e) => {
    const d = dragRef.current;
    if (!d.active) return;
    dragRef.current.active = false;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    if (d.moved) {
      try { localStorage.setItem(posKey, JSON.stringify(posRef.current)); } catch {}
    } else {
      // A press that never moved is a click → open/close the panel.
      // Opens on Send (inbox only if this user can't send); unread stays
      // badged on the Inbox chip until they actually look at the inbox.
      setOpen(v => {
        const next = !v;
        if (next) setTab(canSend ? 'send' : 'inbox');
        return next;
      });
    }
  };

  const mine = useMemo(() => (messages || [])
    .filter(m => withinRetention(m))
    .filter(m => {
      const to = Array.isArray(m.to) ? m.to.map(u => String(u).toUpperCase()) : [];
      return to.includes(me) || (m.from || '').toUpperCase() === me;
    })
    .slice()
    // Newest activity first, not newest send: a reply pulls its thread back to
    // the top, which is where you look for what just came in.
    .sort((a, b) => lastActivity(b) - lastActivity(a)), [messages, me]);

  // Every user in the system until they're deleted — hidden ones included.
  // Only the sender is left out.
  const roster = useMemo(() => (users || [])
    .filter(u => u.username)
    .map(u => ({ name: u.username.toUpperCase(), role: (u.role || '').toLowerCase() }))
    .filter(u => u.name !== me)
    .sort((a, b) => a.name.localeCompare(b.name)), [users, me]);

  // The roster grouped by what people do — each heading selects its group.
  // A role lands in the first category it matches (a parts manager is Parts,
  // a service manager is Managers), so nobody shows twice.
  const categories = useMemo(() => {
    const CATS = [
      { key: 'mgr', label: '👔 Managers', test: r => r === 'admin' || (r.includes('manager') && !r.includes('part')) },
      { key: 'advisor', label: '📋 Advisors', test: r => r.includes('advisor') },
      { key: 'tech', label: '🔧 Technicians', test: r => r.includes('technician') },
      { key: 'parts', label: '📦 Parts', test: r => r.includes('part') },
      { key: 'warranty', label: '🛡 Warranty', test: r => r.includes('warranty') },
      { key: 'other', label: '👥 Other', test: () => true },
    ];
    const used = new Set();
    return CATS.map(c => {
      const people = roster.filter(u => !used.has(u.name) && c.test(u.role));
      people.forEach(u => used.add(u.name));
      return { ...c, people, names: people.map(u => u.name) };
    }).filter(c => c.people.length);
  }, [roster]);
  const everyone = useMemo(() => roster.map(u => u.name), [roster]);

  const toggle = (name) => setSelected(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });
  const addGroup = (names) => setSelected(prev => {
    const next = new Set(prev);
    const allIn = names.every(n => next.has(n));
    names.forEach(n => allIn ? next.delete(n) : next.add(n));
    return next;
  });

  function insertIntoCompose(emoji) {
    const el = composeRef.current;
    if (!el) { setText(t => t + emoji); return; }
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    // Put the caret after the emoji once React has repainted the value.
    setTimeout(() => { el.selectionStart = el.selectionEnd = start + emoji.length; el.focus(); }, 0);
  }

  function addMedia(fileList) {
    const files = [...(fileList || [])];
    const pics = files.filter(f => /^image\//.test(f.type || ''));
    const tooBig = pics.filter(f => f.size > MESSAGE_MEDIA_MAX);
    const ok = pics.filter(f => f.size <= MESSAGE_MEDIA_MAX);
    if (files.length && !pics.length) setStatus('⚠️ Only pictures and screenshots can be sent.');
    else if (tooBig.length) setStatus(`⚠️ ${tooBig.length === 1 ? 'That picture is' : `${tooBig.length} pictures are`} over 20 MB.`);
    else setStatus('');
    if (ok.length) setAttachments(a => [...a, ...ok.map(f => ({ id: uid(), file: f, preview: URL.createObjectURL(f) }))].slice(0, 6));
  }
  function removeMedia(id) {
    setAttachments(a => { const x = a.find(m => m.id === id); if (x) URL.revokeObjectURL(x.preview); return a.filter(m => m.id !== id); });
  }
  function onPasteMedia(e) {
    const files = [...((e.clipboardData && e.clipboardData.files) || [])];
    if (files.some(f => /^image\//.test(f.type || ''))) { e.preventDefault(); addMedia(files); }
  }

  const handleSend = useCallback(async () => {
    if (sending) return;
    if (!selected.size) { setStatus('⚠️ Pick who it goes to.'); return; }
    if (!text.trim() && !attachments.length) { setStatus('⚠️ Type a message or add a picture first.'); return; }
    setSending(true); setStatus('');
    try {
      const media = [];
      for (let i = 0; i < attachments.length; i++) {
        setStatus(`⏳ Uploading picture ${i + 1} of ${attachments.length}…`);
        const f = attachments[i].file;
        media.push({ url: await uploadMessageMediaToS3(f), name: f.name || 'screenshot.png', type: f.type || 'image/png' });
      }
      setStatus('');
      // A picture on its own still needs text — the pop-up and inbox key off it.
      const body = text.trim() || (media.length === 1 ? '📷 Sent a picture' : `📷 Sent ${media.length} pictures`);
      const entry = { id: uid(), from: me, to: [...selected], text: body, ...(media.length ? { media } : {}), alert, requireReply: false, replies: [], timestamp: Date.now() };
      const next = await sendGlobalMessage(entry);
      try { await triggerEvent(GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, entry); } catch {}
      onMessagesChange?.(Array.isArray(next) ? next : [...(messages || []), entry]);
      setText(''); setSelected(new Set()); setAlert(false);
      attachments.forEach(a => URL.revokeObjectURL(a.preview)); setAttachments([]);
      setStatus(`✅ Sent to ${entry.to.length} user${entry.to.length === 1 ? '' : 's'}`);
      setTimeout(() => setStatus(s => (s && s.startsWith('✅')) ? '' : s), 4000);
      // Sending is the end of the job — get the panel out of the way rather
      // than leaving it parked over the page. It reopens on Send.
      setTab('send');
      setOpen(false);
    } catch (e) {
      setStatus('⚠️ ' + (e.message || 'Send failed'));
    } finally {
      setSending(false);
    }
  }, [sending, selected, text, attachments, alert, me, messages, onMessagesChange]);

  // Managers and admins can take a message down for everyone. Optimistic: the
  // row goes immediately and comes back if the write fails, so a slow token
  // doesn't leave them clicking twice.
  const [deletingId, setDeletingId] = useState('');
  const handleDelete = useCallback(async (msg) => {
    if (!window.confirm('Delete this message for everyone? This cannot be undone.')) return;
    setDeletingId(msg.id);
    setStatus('');
    const before = messages || [];
    onMessagesChange?.(before.filter(m => m.id !== msg.id));
    try {
      // Deliberately not adopting the array the write returns: one bad read on
      // the other end would replace the whole inbox with a short list. The one
      // row we removed above is the only change we know is right.
      await deleteGlobalMessage(msg.id);
    } catch (e) {
      onMessagesChange?.(before);
      setStatus('⚠️ ' + (e.message || 'Delete failed'));
    } finally {
      setDeletingId('');
    }
  }, [messages, onMessagesChange]);

  async function sendReply(msg) {
    const t = (replyDrafts[msg.id] || '').trim();
    if (!t) return;
    setReplyingId(msg.id);
    try {
      const reply = { id: rid(), from: me, text: t, timestamp: Date.now() };
      await replyToGlobalMessage(msg.id, reply);
      const notify = [...(Array.isArray(msg.to) ? msg.to : []), msg.from]
        .map(u => String(u || '').toUpperCase()).filter(u => u && u !== me);
      try { await triggerEvent(GLOBAL_CHANNEL, GLOBAL_REPLY_EVENT, { msgId: msg.id, replyId: reply.id, replyFrom: reply.from, replyText: reply.text, notify }); } catch {}
      setReplyDrafts(d => ({ ...d, [msg.id]: '' }));
      // Append locally rather than adopting the array the write returns: if the
      // read behind that write came back empty, taking it wholesale would clear
      // the whole inbox. The poll picks up everyone else's messages anyway.
      onMessagesChange?.((messages || []).map(m =>
        m.id === msg.id ? { ...m, replies: [...(m.replies || []), reply] } : m));
    } catch (e) {
      setStatus('⚠️ ' + (e.message || 'Reply failed'));
    } finally {
      setReplyingId('');
      // The box stays open after a send so the conversation can keep going —
      // closing it meant clicking Reply again for every follow-up. Clicking
      // Send moved focus to the button, so hand it back to the input.
      replyInputRef.current?.focus();
    }
  }

  // Panel opens toward whichever side of the screen has room, so a bubble
  // parked in a corner doesn't push it off-screen.
  const panelH = Math.min(PANEL_H, Math.max(160, window.innerHeight - 24));
  const panelPos = (() => {
    const left = pos.x + BUBBLE + 12 + PANEL_W < window.innerWidth
      ? pos.x + BUBBLE + 12
      : Math.max(8, pos.x - PANEL_W - 12);
    const top = Math.min(Math.max(8, pos.y + BUBBLE / 2 - panelH / 2), Math.max(8, window.innerHeight - panelH - 8));
    return { left, top };
  })();

  const chip = (on) => ({
    background: on ? 'rgba(56,189,248,.2)' : 'rgba(255,255,255,0.05)',
    border: `1px solid ${on ? 'rgba(56,189,248,.6)' : 'rgba(255,255,255,0.14)'}`,
    color: on ? '#7dd3fc' : '#cbd5e1',
    borderRadius: 999, padding: '5px 10px', fontSize: 11.5, fontWeight: 700,
    cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <>
      {open && (
        <div ref={panelRef} style={{
          position: 'fixed', left: panelPos.left, top: panelPos.top, width: PANEL_W, height: panelH,
          background: '#111d33', border: '1px solid rgba(56,189,248,.35)', borderRadius: 14,
          boxShadow: '0 18px 50px rgba(0,0,0,.55)', zIndex: 2147483000,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: 'Inter, sans-serif', color: '#e2e8f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: '#7dd3fc' }}>Messages</span>
            <button onClick={() => setTab('inbox')} style={{ ...chip(tab === 'inbox'), marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              Inbox
              {unread > 0 && tab !== 'inbox' && (
                <span style={{ minWidth: 17, height: 17, borderRadius: 999, background: '#ef4444', color: '#fff', fontSize: 10.5, fontWeight: 900,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>{unread > 99 ? '99+' : unread}</span>
              )}
            </button>
            {canSend && <button onClick={() => setTab('send')} style={chip(tab === 'send')}>Send</button>}
            <button onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: '#7a92b8', fontSize: 18, fontWeight: 700, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>

          {status && (
            <div style={{ padding: '8px 12px', fontSize: 12, fontWeight: 700, color: status.startsWith('✅') ? '#4ade80' : '#fca5a5' }}>
              {status}
            </div>
          )}

          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 12px' }}>
            {tab === 'inbox' ? (
              mine.length === 0 ? (
                <div style={{ color: '#7a92b8', fontSize: 13, padding: '10px 0' }}>No messages.</div>
              ) : mine.map(m => {
                const fromMe = (m.from || '').toUpperCase() === me;
                const replies = Array.isArray(m.replies) ? m.replies : [];
                const open = replyOpenId === m.id;
                return (
                  <div key={m.id} style={{
                    background: m.alert ? 'rgba(248,113,113,.09)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${m.alert ? 'rgba(248,113,113,.4)' : 'rgba(255,255,255,0.09)'}`,
                    borderRadius: 10, padding: '10px 12px', marginBottom: 10,
                  }}>
                    {/* Who and when, on one line that never wraps */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span
                        title={fromMe ? `To: ${(m.to || []).join(', ')}` : `From ${m.from}`}
                        style={{
                          fontWeight: 800, fontSize: 12, letterSpacing: '.02em',
                          color: m.alert ? '#fca5a5' : fromMe ? '#7dd3fc' : '#c4b5fd',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: 1,
                        }}>
                        {m.alert ? '🚨 ' : ''}{fromMe ? `You → ${toSummary(m.to)}` : String(m.from || 'Management').toUpperCase()}
                      </span>
                      <span title={timeLabel(m.timestamp)}
                        style={{ color: '#64748b', fontSize: 10.5, whiteSpace: 'nowrap', flexShrink: 0 }}>
                        {shortTime(m.timestamp)}
                      </span>
                      {canDelete && (
                        <button onClick={() => handleDelete(m)} disabled={deletingId === m.id} title="Delete for everyone"
                          style={{
                            flexShrink: 0,
                            background: 'transparent', border: 'none',
                            color: '#7d8ba3', padding: '0 2px', fontSize: 12,
                            cursor: deletingId === m.id ? 'default' : 'pointer', fontFamily: 'inherit', lineHeight: 1.4,
                          }}>
                          {deletingId === m.id ? '⏳' : '🗑'}
                        </button>
                      )}
                    </div>

                    <div style={{ fontSize: 13.5, lineHeight: 1.45, marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.text}</div>
                    <MessageMedia media={m.media} />

                    {replies.length > 0 && (
                      <div style={{ marginTop: 9, borderLeft: '2px solid rgba(125,211,252,.35)', paddingLeft: 10, display: 'grid', gap: 7 }}>
                        {replies.map(rep => (
                          <div key={rep.id}>
                            <div style={{ fontSize: 10.5, fontWeight: 800, color: (rep.from || '').toUpperCase() === me ? '#6ee7b7' : '#c4b5fd' }}>
                              {(rep.from || '').toUpperCase() === me ? 'You' : String(rep.from || '').toUpperCase()}
                              <span style={{ color: '#64748b', fontWeight: 600 }}> · {shortTime(rep.timestamp)}</span>
                            </div>
                            <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{rep.text}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* The reply box is out of the way until it's wanted — a box
                        under every message is most of what made this hard to read.
                        Once open it stays open across sends (Escape or ✕ closes it),
                        so a back-and-forth doesn't mean re-opening it every turn. */}
                    {open ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 9 }}>
                        <input
                          autoFocus
                          ref={replyInputRef}
                          value={replyDrafts[m.id] || ''}
                          onChange={e => setReplyDrafts(d => ({ ...d, [m.id]: e.target.value }))}
                          onKeyDown={e => {
                            if (e.key === 'Enter') sendReply(m);
                            if (e.key === 'Escape') setReplyOpenId('');
                          }}
                          placeholder={replies.length ? 'Continue…' : 'Reply…'}
                          style={{
                            flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
                            border: '1px solid rgba(56,189,248,.45)', borderRadius: 8, color: '#e2e8f0',
                            padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', outline: 'none',
                          }}
                        />
                        <EmojiPicker title="Add an emoji to your reply"
                          onPick={e => setReplyDrafts(d => ({ ...d, [m.id]: (d[m.id] || '') + e }))} />
                        <button onClick={() => sendReply(m)} disabled={replyingId === m.id}
                          style={{ flexShrink: 0, background: 'rgba(56,189,248,.15)', border: '1px solid rgba(56,189,248,.45)', color: '#7dd3fc', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                          {replyingId === m.id ? '…' : 'Send'}
                        </button>
                        <button type="button" onClick={() => setReplyOpenId('')} title="Close (Esc)"
                          style={{ flexShrink: 0, background: 'transparent', border: 'none', color: '#7d8ba3', padding: '4px 2px', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', lineHeight: 1 }}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button onClick={() => setReplyOpenId(m.id)}
                        style={{
                          marginTop: 8, background: 'transparent', border: 'none', padding: 0,
                          color: '#7dd3fc', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit',
                        }}>
                        {replies.length ? `💬 Continue · ${replies.length}` : '↩ Reply'}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              <>
                <div style={{ color: '#7a92b8', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                  Send to
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                  <button onClick={() => addGroup(everyone)} style={chip(everyone.length > 0 && everyone.every(n => selected.has(n)))}>👥 Everyone</button>
                  {selected.size > 0 && (
                    <button onClick={() => setSelected(new Set())} style={{ ...chip(false), color: '#94a3b8' }}>Clear ({selected.size})</button>
                  )}
                </div>
                {/* Each category: click the heading for the whole group, or pick names under it. */}
                {categories.map(c => {
                  const all = c.names.every(n => selected.has(n));
                  const some = !all && c.names.some(n => selected.has(n));
                  return (
                    <div key={c.key} style={{ marginBottom: 10 }}>
                      <button onClick={() => addGroup(c.names)} title={all ? `Unselect all ${c.label.replace(/^\S+\s/, '')}` : `Select all ${c.label.replace(/^\S+\s/, '')}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, width: '100%', background: 'none', border: 'none', padding: '2px 0 5px', cursor: 'pointer', fontFamily: 'inherit',
                          color: all ? '#7dd3fc' : '#a5b4c8', fontSize: 11.5, fontWeight: 900, letterSpacing: '.06em', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,.08)', marginBottom: 6 }}>
                        <span>{c.label}</span>
                        <span style={{ color: '#64748b', fontWeight: 700 }}>· {c.people.length}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 10.5, letterSpacing: 0, textTransform: 'none', color: all ? '#7dd3fc' : some ? '#fbbf24' : '#64748b' }}>
                          {all ? '✓ all' : some ? `${c.names.filter(n => selected.has(n)).length} picked` : 'select all'}
                        </span>
                      </button>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                        {c.people.map(u => (
                          <button key={u.name} onClick={() => toggle(u.name)} style={chip(selected.has(u.name))}>{u.name}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <textarea
                  ref={composeRef}
                  value={text}
                  onChange={e => setText(e.target.value)}
                  onPaste={onPasteMedia}
                  rows={4}
                  placeholder="Type your message…"
                  style={{
                    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: '#e2e8f0',
                    padding: '9px 11px', fontSize: 13.5, lineHeight: 1.45, resize: 'vertical', fontFamily: 'inherit',
                  }}
                />
                {/* An emoji lands where the cursor is, not tacked on the end —
                    people add one mid-sentence as often as at the finish. */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                  <EmojiPicker onPick={insertIntoCompose} />
                </div>
                {/* 📎 Send media — click, drag a picture in, or paste a screenshot. */}
                <input ref={mediaInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
                  onChange={e => { addMedia(e.target.files); e.target.value = ''; }} />
                <div
                  onClick={() => mediaInputRef.current && mediaInputRef.current.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); addMedia(e.dataTransfer.files); }}
                  onPaste={onPasteMedia}
                  tabIndex={0}
                  style={{
                    marginTop: 8, padding: '12px 10px', borderRadius: 10, cursor: 'pointer', textAlign: 'center',
                    border: `1.5px dashed ${dragOver ? 'rgba(56,189,248,.9)' : 'rgba(148,163,184,.4)'}`,
                    background: dragOver ? 'rgba(56,189,248,.12)' : 'rgba(255,255,255,.03)',
                    color: dragOver ? '#7dd3fc' : '#94a3b8', fontSize: 12.5, fontWeight: 700,
                  }}>
                  📎 <span style={{ color: '#e2e8f0' }}>Send media</span> — click, drag a picture here, or paste a screenshot
                </div>
                {attachments.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {attachments.map(a => (
                      <div key={a.id} style={{ position: 'relative', width: 72, height: 72, borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(148,163,184,.4)' }}>
                        <img src={a.preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                        <button onClick={() => removeMedia(a.id)} title="Remove"
                          style={{ position: 'absolute', top: 2, right: 2, width: 20, height: 20, padding: 0, borderRadius: 999, fontSize: 12, lineHeight: '18px', background: 'rgba(2,6,23,.85)', border: '1px solid rgba(255,255,255,.3)', color: '#f1f5f9', cursor: 'pointer' }}>×</button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Send sits outside the scroll area — the roster grows with the
              staff list, and the button was ending up below the fold. */}
          {tab === 'send' && (
            <div style={{ flexShrink: 0, padding: '8px 12px 10px', borderTop: '1px solid rgba(255,255,255,0.08)', background: 'rgba(2,6,23,.35)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '2px 0 8px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#cbd5e1', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={alert} onChange={e => setAlert(e.target.checked)} />
                  🚨 Mark as an alert
                </label>
                <div style={{ flex: 1 }} />
                {/* Always in view, even when the roster pushes the drop zone below the fold. */}
                <button onClick={() => mediaInputRef.current && mediaInputRef.current.click()} title="Attach a picture or screenshot"
                  onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); addMedia(e.dataTransfer.files); }}
                  style={{ background: attachments.length ? 'rgba(56,189,248,.2)' : 'rgba(255,255,255,.06)', border: `1px solid ${attachments.length ? 'rgba(125,211,252,.6)' : 'rgba(255,255,255,.18)'}`, color: '#e0f2fe', borderRadius: 999, padding: '4px 11px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                  📎 {attachments.length ? `${attachments.length} picture${attachments.length === 1 ? '' : 's'}` : 'Add picture'}
                </button>
              </div>
              <button onClick={handleSend} disabled={sending}
                style={{
                  width: '100%', background: sending ? 'rgba(255,255,255,.06)' : 'linear-gradient(180deg,#38bdf8,#0284c7)',
                  border: '1px solid rgba(56,189,248,.6)', color: sending ? '#cbd5e1' : '#06232f',
                  borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 800,
                  cursor: sending ? 'default' : 'pointer', fontFamily: 'inherit',
                }}>
                {sending ? '⏳ Sending…' : '📣 Send Message'}
              </button>
            </div>
          )}
        </div>
      )}

      <div
        ref={bubbleRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        title="Messages — drag to move"
        style={{
          position: 'fixed', left: pos.x, top: pos.y, width: BUBBLE, height: BUBBLE,
          borderRadius: '50%', zIndex: 2147483001, cursor: 'grab', touchAction: 'none',
          background: 'linear-gradient(180deg,#38bdf8,#0369a1)',
          border: '1px solid rgba(125,211,252,.7)',
          boxShadow: '0 8px 24px rgba(0,0,0,.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 24, userSelect: 'none',
        }}>
        💬
        {unread > 0 && !(open && tab === 'inbox') && (
          <span style={{
            position: 'absolute', top: -4, right: -4, minWidth: 22, height: 22,
            borderRadius: 999, background: '#ef4444', color: '#fff',
            fontSize: 12, fontWeight: 900, fontFamily: 'Inter, sans-serif',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #0d1627', padding: '0 5px',
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </div>
    </>
  );
}

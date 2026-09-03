import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sendGlobalMessage, replyToGlobalMessage } from '../utils/github';
import { triggerEvent, GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, GLOBAL_REPLY_EVENT } from '../utils/pusher';

const uid = () => `gm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const rid = () => `rp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const timeLabel = (ts) => {
  try {
    return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch { return ''; }
};

const BUBBLE = 56;
const PANEL_W = 340;
const PANEL_H = 460;
const DRAG_SLOP = 4; // px of movement before a press counts as a drag, not a click

function clampToScreen(x, y, w, h) {
  const maxX = Math.max(0, window.innerWidth - w - 8);
  const maxY = Math.max(0, window.innerHeight - h - 8);
  return { x: Math.min(Math.max(8, x), maxX), y: Math.min(Math.max(8, y), maxY) };
}

// A draggable bubble that lives above the page switch, so it stays put as the
// user moves between screens. Reading and sending both happen here; the
// blocking pop-up still fires separately and is untouched.
export default function FloatingMessenger({
  currentUser, users, messages, unread, canSend, onMarkSeen, onMessagesChange,
}) {
  const me = (currentUser || '').toUpperCase();
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
  const [selected, setSelected] = useState(() => new Set());
  const [text, setText] = useState('');
  const [alert, setAlert] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

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
      setOpen(v => {
        const next = !v;
        if (next) onMarkSeen?.();
        return next;
      });
    }
  };

  const mine = useMemo(() => (messages || [])
    .filter(m => {
      const to = Array.isArray(m.to) ? m.to.map(u => String(u).toUpperCase()) : [];
      return to.includes(me) || (m.from || '').toUpperCase() === me;
    })
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)), [messages, me]);

  const roster = useMemo(() => (users || [])
    .filter(u => u.username && u.username.toLowerCase() !== 'admin')
    .map(u => ({ name: u.username.toUpperCase(), role: (u.role || '').toLowerCase() }))
    .filter(u => u.name !== me)
    .sort((a, b) => a.name.localeCompare(b.name)), [users, me]);

  const groups = useMemo(() => {
    const by = (pred) => roster.filter(u => pred(u.role)).map(u => u.name);
    return [
      { key: 'all', label: '👥 Everyone', names: roster.map(u => u.name) },
      { key: 'tech', label: '🔧 Techs', names: by(r => r.includes('technician')) },
      { key: 'advisor', label: '📋 Advisors', names: by(r => r.includes('advisor')) },
      { key: 'parts', label: '📦 Parts', names: by(r => r.includes('part')) },
    ].filter(g => g.names.length);
  }, [roster]);

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

  const handleSend = useCallback(async () => {
    if (sending) return;
    if (!selected.size) { setStatus('⚠️ Pick who it goes to.'); return; }
    if (!text.trim()) { setStatus('⚠️ Type a message first.'); return; }
    setSending(true); setStatus('');
    try {
      const entry = { id: uid(), from: me, to: [...selected], text: text.trim(), alert, requireReply: false, replies: [], timestamp: Date.now() };
      const next = await sendGlobalMessage(entry);
      try { await triggerEvent(GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, entry); } catch {}
      onMessagesChange?.(Array.isArray(next) ? next : [...(messages || []), entry]);
      setText(''); setSelected(new Set()); setAlert(false);
      setStatus(`✅ Sent to ${entry.to.length} user${entry.to.length === 1 ? '' : 's'}`);
      setTimeout(() => setStatus(s => (s && s.startsWith('✅')) ? '' : s), 4000);
    } catch (e) {
      setStatus('⚠️ ' + (e.message || 'Send failed'));
    } finally {
      setSending(false);
    }
  }, [sending, selected, text, alert, me, messages, onMessagesChange]);

  async function sendReply(msg) {
    const t = (replyDrafts[msg.id] || '').trim();
    if (!t) return;
    setReplyingId(msg.id);
    try {
      const reply = { id: rid(), from: me, text: t, timestamp: Date.now() };
      const next = await replyToGlobalMessage(msg.id, reply);
      const notify = [...(Array.isArray(msg.to) ? msg.to : []), msg.from]
        .map(u => String(u || '').toUpperCase()).filter(u => u && u !== me);
      try { await triggerEvent(GLOBAL_CHANNEL, GLOBAL_REPLY_EVENT, { msgId: msg.id, replyId: reply.id, replyFrom: reply.from, replyText: reply.text, notify }); } catch {}
      setReplyDrafts(d => ({ ...d, [msg.id]: '' }));
      onMessagesChange?.(Array.isArray(next) ? next
        : (messages || []).map(m => m.id === msg.id ? { ...m, replies: [...(m.replies || []), reply] } : m));
    } catch (e) {
      setStatus('⚠️ ' + (e.message || 'Reply failed'));
    } finally {
      setReplyingId('');
    }
  }

  // Panel opens toward whichever side of the screen has room, so a bubble
  // parked in a corner doesn't push it off-screen.
  const panelPos = (() => {
    const left = pos.x + BUBBLE + 12 + PANEL_W < window.innerWidth
      ? pos.x + BUBBLE + 12
      : Math.max(8, pos.x - PANEL_W - 12);
    const top = Math.min(Math.max(8, pos.y + BUBBLE / 2 - PANEL_H / 2), Math.max(8, window.innerHeight - PANEL_H - 8));
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
        <div style={{
          position: 'fixed', left: panelPos.left, top: panelPos.top, width: PANEL_W, height: PANEL_H,
          background: '#111d33', border: '1px solid rgba(56,189,248,.35)', borderRadius: 14,
          boxShadow: '0 18px 50px rgba(0,0,0,.55)', zIndex: 2147483000,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          fontFamily: 'Inter, sans-serif', color: '#e2e8f0',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <span style={{ fontWeight: 800, fontSize: 14, color: '#7dd3fc' }}>Messages</span>
            <button onClick={() => setTab('inbox')} style={{ ...chip(tab === 'inbox'), marginLeft: 'auto' }}>Inbox</button>
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
                return (
                  <div key={m.id} style={{
                    background: m.alert ? 'rgba(248,113,113,.09)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${m.alert ? 'rgba(248,113,113,.4)' : 'rgba(255,255,255,0.09)'}`,
                    borderRadius: 10, padding: '10px 12px', marginBottom: 8,
                  }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 12.5, color: m.alert ? '#fca5a5' : '#7dd3fc' }}>
                        {m.alert ? '🚨 ' : ''}{fromMe ? `You → ${(m.to || []).join(', ')}` : (m.from || 'Management')}
                      </span>
                      <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 10.5 }}>{timeLabel(m.timestamp)}</span>
                    </div>
                    <div style={{ fontSize: 13.5, lineHeight: 1.45, marginTop: 5, whiteSpace: 'pre-wrap' }}>{m.text}</div>

                    {(m.replies || []).map(rep => (
                      <div key={rep.id} style={{ marginTop: 8, paddingLeft: 10, borderLeft: '2px solid rgba(255,255,255,0.12)' }}>
                        <div style={{ color: '#94a3b8', fontSize: 11, fontWeight: 700 }}>
                          {(rep.from || '').toUpperCase() === me ? 'You' : rep.from} · {timeLabel(rep.timestamp)}
                        </div>
                        <div style={{ fontSize: 13, lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{rep.text}</div>
                      </div>
                    ))}

                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                      <input
                        value={replyDrafts[m.id] || ''}
                        onChange={e => setReplyDrafts(d => ({ ...d, [m.id]: e.target.value }))}
                        onKeyDown={e => { if (e.key === 'Enter') sendReply(m); }}
                        placeholder="Reply…"
                        style={{
                          flex: 1, minWidth: 0, boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
                          border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: '#e2e8f0',
                          padding: '7px 10px', fontSize: 13, fontFamily: 'inherit',
                        }}
                      />
                      <button onClick={() => sendReply(m)} disabled={replyingId === m.id}
                        style={{ flexShrink: 0, background: 'rgba(56,189,248,.15)', border: '1px solid rgba(56,189,248,.45)', color: '#7dd3fc', borderRadius: 8, padding: '7px 12px', fontSize: 12, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit' }}>
                        {replyingId === m.id ? '…' : 'Send'}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <>
                <div style={{ color: '#7a92b8', fontSize: 11.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 6 }}>
                  Send to
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 8 }}>
                  {groups.map(g => (
                    <button key={g.key} onClick={() => addGroup(g.names)} style={chip(g.names.every(n => selected.has(n)))}>
                      {g.label}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                  {roster.map(u => (
                    <button key={u.name} onClick={() => toggle(u.name)} style={chip(selected.has(u.name))}>
                      {u.name}
                    </button>
                  ))}
                </div>
                <textarea
                  value={text}
                  onChange={e => setText(e.target.value)}
                  rows={4}
                  placeholder="Type your message…"
                  style={{
                    width: '100%', boxSizing: 'border-box', background: 'rgba(255,255,255,0.07)',
                    border: '1px solid rgba(255,255,255,0.14)', borderRadius: 8, color: '#e2e8f0',
                    padding: '9px 11px', fontSize: 13.5, lineHeight: 1.45, resize: 'vertical', fontFamily: 'inherit',
                  }}
                />
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '10px 0', color: '#cbd5e1', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                  <input type="checkbox" checked={alert} onChange={e => setAlert(e.target.checked)} />
                  🚨 Mark as an alert
                </label>
                <button onClick={handleSend} disabled={sending}
                  style={{
                    width: '100%', background: sending ? 'rgba(255,255,255,.06)' : 'linear-gradient(180deg,#38bdf8,#0284c7)',
                    border: '1px solid rgba(56,189,248,.6)', color: sending ? '#cbd5e1' : '#06232f',
                    borderRadius: 10, padding: '11px', fontSize: 14, fontWeight: 800,
                    cursor: sending ? 'default' : 'pointer', fontFamily: 'inherit',
                  }}>
                  {sending ? '⏳ Sending…' : '📣 Send Message'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div
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
        {unread > 0 && !open && (
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

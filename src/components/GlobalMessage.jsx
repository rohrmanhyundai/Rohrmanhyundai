import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { sendGlobalMessage, loadGlobalMessages, pollGlobalMessages, replyToGlobalMessage } from '../utils/github';
import { triggerEvent, GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, GLOBAL_REPLY_EVENT } from '../utils/pusher';

const uid = () => `gm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const rid = () => `rp-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const timeLabel = (ts) => { try { return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

// Compose a pop-up message and send it to one or more users. It lands on their
// screen instantly (same popup as an @mention). Optionally require a reply to
// close it; replies land back here in the log below.
export default function GlobalMessage({ currentUser, users, onBack }) {
  const me = (currentUser || '').toUpperCase();
  const [selected, setSelected] = useState(() => new Set()); // UPPERCASE usernames
  const [text, setText] = useState('');
  const [alert, setAlert] = useState(false);
  const [requireReply, setRequireReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  const [messages, setMessages] = useState([]);   // all global messages (for the log)
  const [replyDrafts, setReplyDrafts] = useState({}); // msgId -> in-thread reply text
  const [replyingId, setReplyingId] = useState('');

  // Load the log on mount, then keep it fresh with a cheap conditional poll.
  const refresh = useCallback(async () => {
    try { const all = await loadGlobalMessages(); setMessages(Array.isArray(all) ? all : []); } catch {}
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(async () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      try { const r = await pollGlobalMessages(); if (r && r.changed && Array.isArray(r.data)) setMessages(r.data); } catch {}
    }, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  const roster = useMemo(() => (users || [])
    .filter(u => u.username && u.username.toLowerCase() !== 'admin')
    .map(u => ({ name: u.username.toUpperCase(), role: (u.role || '').toLowerCase() }))
    .sort((a, b) => a.name.localeCompare(b.name)), [users]);

  const groupNames = (pred) => roster.filter(u => pred(u.role)).map(u => u.name);
  const groups = [
    { key: 'all', label: '👥 Everyone', names: roster.map(u => u.name) },
    { key: 'tech', label: '🔧 All Techs', names: groupNames(r => r.includes('technician')) },
    { key: 'advisor', label: '📋 All Advisors', names: groupNames(r => r.includes('advisor')) },
    { key: 'parts', label: '📦 All Parts', names: groupNames(r => r.includes('part')) },
  ].filter(g => g.names.length);

  const toggle = (name) => setSelected(prev => { const next = new Set(prev); next.has(name) ? next.delete(name) : next.add(name); return next; });
  const addGroup = (names) => setSelected(prev => { const next = new Set(prev); const allIn = names.every(n => next.has(n)); names.forEach(n => allIn ? next.delete(n) : next.add(n)); return next; });
  const clearAll = () => setSelected(new Set());

  const canSend = selected.size > 0 && text.trim().length > 0 && !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true); setStatus('');
    try {
      const entry = { id: uid(), from: me, to: [...selected], text: text.trim(), alert, requireReply, replies: [], timestamp: Date.now() };
      const n = entry.to.length;
      await sendGlobalMessage(entry);
      try { await triggerEvent(GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, entry); } catch {}
      setStatus(`✅ Sent — pop-up delivered to ${n} user${n === 1 ? '' : 's'}`);
      setText(''); setSelected(new Set()); setAlert(false); setRequireReply(false);
      setMessages(prev => [...prev, entry]);
      setTimeout(() => setStatus(s => (s && s.startsWith('✅')) ? '' : s), 5000);
    } catch (e) {
      setStatus('⚠️ ' + (e.message || 'Send failed'));
    } finally {
      setSending(false);
    }
  }

  // Reply back inside a thread (from the manager side). Notifies the recipients.
  async function sendThreadReply(msg) {
    const t = (replyDrafts[msg.id] || '').trim();
    if (!t) return;
    setReplyingId(msg.id);
    try {
      const reply = { id: rid(), from: me, text: t, timestamp: Date.now() };
      await replyToGlobalMessage(msg.id, reply);
      const notify = (Array.isArray(msg.to) ? msg.to : []).map(u => String(u).toUpperCase()).filter(u => u !== me);
      try { await triggerEvent(GLOBAL_CHANNEL, GLOBAL_REPLY_EVENT, { msgId: msg.id, replyId: reply.id, replyFrom: reply.from, replyText: reply.text, notify }); } catch {}
      setReplyDrafts(d => ({ ...d, [msg.id]: '' }));
      setMessages(prev => prev.map(m => m.id === msg.id ? { ...m, replies: [...(m.replies || []), reply] } : m));
    } catch (e) {
      setStatus('⚠️ ' + (e.message || 'Reply failed'));
    } finally {
      setReplyingId('');
    }
  }

  // Messages I sent, newest first, that have recipients — the log.
  const myThreads = useMemo(() => (messages || [])
    .filter(m => (m.from || '').toUpperCase() === me)
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)), [messages, me]);

  const chip = (active) => ({
    background: active ? 'rgba(251,191,36,.22)' : 'rgba(30,41,59,.6)',
    border: `1px solid ${active ? 'rgba(251,191,36,.7)' : 'rgba(148,163,184,.22)'}`,
    color: active ? '#fde68a' : '#cbd5e1',
    borderRadius: 999, padding: '7px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap',
  });
  const cardStyle = { background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '16px 18px' };
  const stepLbl = { fontSize: 13, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fde68a' };

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">📣 Global Message</div>
          <div className="adv-sub">Send a pop-up to one or more users — it appears on their screen instantly</div>
        </div>
        <div style={{ flex: 1 }} />
        <button className="secondary" onClick={onBack}>← Manager Hub</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', display: 'grid', gap: 20 }}>

          {/* Recipients */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div style={stepLbl}>1 · Who gets it</div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{selected.size} selected</span>
              {selected.size > 0 && <button onClick={clearAll} style={{ marginLeft: 10, background: 'transparent', border: '1px solid rgba(148,163,184,.3)', color: '#94a3b8', borderRadius: 8, padding: '3px 10px', cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>Clear</button>}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {groups.map(g => {
                const allIn = g.names.every(n => selected.has(n));
                return <button key={g.key} onClick={() => addGroup(g.names)} style={{ ...chip(allIn), background: allIn ? 'rgba(251,191,36,.28)' : 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.5)', color: '#fde68a' }}>{g.label} ({g.names.length})</button>;
              })}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {roster.map(u => (
                <button key={u.name} onClick={() => toggle(u.name)} style={chip(selected.has(u.name))}>
                  {selected.has(u.name) ? '✓ ' : ''}{u.name}
                </button>
              ))}
              {!roster.length && <div style={{ color: '#64748b', fontSize: 13 }}>No users found.</div>}
            </div>
          </section>

          {/* Message */}
          <section style={cardStyle}>
            <div style={{ ...stepLbl, marginBottom: 12 }}>2 · Your message</div>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Type the message they'll see in the pop-up…"
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#f1f5f9', padding: '12px 14px', fontSize: 15, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 22, marginTop: 12 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#fca5a5', fontWeight: 700, fontSize: 13.5 }}>
                <input type="checkbox" checked={alert} onChange={e => setAlert(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                🚨 Mark as alert (red pop-up)
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#93c5fd', fontWeight: 700, fontSize: 13.5 }}>
                <input type="checkbox" checked={requireReply} onChange={e => setRequireReply(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                ✍️ Require a reply to close (instead of just OK)
              </label>
            </div>
          </section>

          {/* Send */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {status && <span style={{ fontWeight: 800, fontSize: 13.5, color: status.startsWith('⚠️') ? '#f87171' : '#4ade80' }}>{status}</span>}
            <div style={{ flex: 1 }} />
            <button onClick={handleSend} disabled={!canSend}
              style={{
                background: canSend ? 'linear-gradient(180deg,#f59e0b,#d97706)' : 'rgba(255,255,255,.06)',
                border: `1px solid ${canSend ? 'rgba(251,191,36,.6)' : 'rgba(255,255,255,.12)'}`,
                color: canSend ? '#1a1205' : '#64748b', borderRadius: 12, padding: '12px 32px',
                cursor: canSend ? 'pointer' : 'default', fontWeight: 900, fontSize: 15.5,
              }}>
              {sending ? '⏳ Sending…' : '📣 Send Pop-Up'}
            </button>
          </div>

          {/* Sent messages & replies log */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div style={stepLbl}>Sent messages &amp; replies</div>
              <div style={{ flex: 1 }} />
              <button onClick={refresh} style={{ background: 'transparent', border: '1px solid rgba(148,163,184,.3)', color: '#94a3b8', borderRadius: 8, padding: '4px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>↻ Refresh</button>
            </div>
            {!myThreads.length ? (
              <div style={{ color: '#64748b', fontSize: 13.5, padding: '14px 0' }}>Nothing sent yet. Replies to your messages will show here.</div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                {myThreads.map(m => {
                  const replies = Array.isArray(m.replies) ? m.replies : [];
                  return (
                    <div key={m.id} style={{ background: 'rgba(2,6,23,.4)', border: '1px solid rgba(148,163,184,.16)', borderRadius: 12, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 14.5, fontWeight: 800, color: '#e2e8f0', flex: 1, minWidth: 0 }}>{m.text}</span>
                        <span style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>{timeLabel(m.timestamp)}</span>
                      </div>
                      <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>
                        To: {(m.to || []).join(', ')}
                        {m.alert ? <span style={{ color: '#fca5a5', fontWeight: 700 }}> · 🚨 alert</span> : null}
                        {m.requireReply ? <span style={{ color: '#93c5fd', fontWeight: 700 }}> · reply required</span> : null}
                      </div>

                      {/* Replies */}
                      {replies.length > 0 && (
                        <div style={{ marginTop: 10, display: 'grid', gap: 6, borderTop: '1px solid rgba(148,163,184,.12)', paddingTop: 10 }}>
                          {replies.map(rep => (
                            <div key={rep.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                              <span style={{ fontSize: 11.5, fontWeight: 800, color: (rep.from || '').toUpperCase() === me ? '#6ee7b7' : '#a78bfa', minWidth: 64 }}>{String(rep.from || '').toUpperCase()}</span>
                              <span style={{ fontSize: 13.5, color: '#cbd5e1', flex: 1 }}>{rep.text}</span>
                              <span style={{ fontSize: 10.5, color: '#64748b', whiteSpace: 'nowrap' }}>{timeLabel(rep.timestamp)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Reply back */}
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <input value={replyDrafts[m.id] || ''} onChange={e => setReplyDrafts(d => ({ ...d, [m.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === 'Enter') sendThreadReply(m); }}
                          placeholder="Reply back…"
                          style={{ flex: 1, background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, color: '#f1f5f9', padding: '7px 11px', fontSize: 13.5, outline: 'none', fontFamily: 'inherit' }} />
                        <button onClick={() => sendThreadReply(m)} disabled={replyingId === m.id || !(replyDrafts[m.id] || '').trim()}
                          style={{ background: (replyingId === m.id || !(replyDrafts[m.id] || '').trim()) ? 'rgba(255,255,255,.06)' : 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.45)', color: '#93c5fd', borderRadius: 8, padding: '7px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>
                          {replyingId === m.id ? '⏳' : 'Reply'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}

import React, { useState, useMemo } from 'react';
import { sendGlobalMessage } from '../utils/github';
import { triggerEvent, GLOBAL_CHANNEL, GLOBAL_MSG_EVENT } from '../utils/pusher';

const uid = () => `gm-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Compose a pop-up message and send it to one or more users. It lands on their
// screen instantly (same popup as an @mention) and they click OK to clear it.
export default function GlobalMessage({ currentUser, users, onBack }) {
  const [selected, setSelected] = useState(() => new Set()); // UPPERCASE usernames
  const [text, setText] = useState('');
  const [alert, setAlert] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState('');

  // Everyone with a login (drop the generic admin account), sorted, with role.
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

  const toggle = (name) => setSelected(prev => {
    const next = new Set(prev);
    next.has(name) ? next.delete(name) : next.add(name);
    return next;
  });
  const addGroup = (names) => setSelected(prev => {
    const next = new Set(prev);
    const allIn = names.every(n => next.has(n));
    names.forEach(n => allIn ? next.delete(n) : next.add(n)); // toggle the whole group
    return next;
  });
  const clearAll = () => setSelected(new Set());

  const canSend = selected.size > 0 && text.trim().length > 0 && !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true); setStatus('');
    try {
      const entry = { id: uid(), from: currentUser, to: [...selected], text: text.trim(), alert, timestamp: Date.now() };
      const n = entry.to.length;
      await sendGlobalMessage(entry);
      try { await triggerEvent(GLOBAL_CHANNEL, GLOBAL_MSG_EVENT, entry); } catch {}
      setStatus(`✅ Sent — pop-up delivered to ${n} user${n === 1 ? '' : 's'}`);
      setText(''); setSelected(new Set()); setAlert(false);
      setTimeout(() => setStatus(s => (s && s.startsWith('✅')) ? '' : s), 5000);
    } catch (e) {
      setStatus('⚠️ ' + (e.message || 'Send failed'));
    } finally {
      setSending(false);
    }
  }

  const chip = (active) => ({
    background: active ? 'rgba(251,191,36,.22)' : 'rgba(30,41,59,.6)',
    border: `1px solid ${active ? 'rgba(251,191,36,.7)' : 'rgba(148,163,184,.22)'}`,
    color: active ? '#fde68a' : '#cbd5e1',
    borderRadius: 999, padding: '7px 14px', cursor: 'pointer', fontWeight: 800, fontSize: 13.5, whiteSpace: 'nowrap',
  });

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
          <section style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fde68a' }}>1 · Who gets it</div>
              <div style={{ flex: 1 }} />
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{selected.size} selected</span>
              {selected.size > 0 && <button onClick={clearAll} style={{ marginLeft: 10, background: 'transparent', border: '1px solid rgba(148,163,184,.3)', color: '#94a3b8', borderRadius: 8, padding: '3px 10px', cursor: 'pointer', fontSize: 11.5, fontWeight: 700 }}>Clear</button>}
            </div>

            {/* Quick group picks */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {groups.map(g => {
                const allIn = g.names.every(n => selected.has(n));
                return <button key={g.key} onClick={() => addGroup(g.names)} style={{ ...chip(allIn), background: allIn ? 'rgba(251,191,36,.28)' : 'rgba(251,191,36,.1)', border: '1px solid rgba(251,191,36,.5)', color: '#fde68a' }}>{g.label} ({g.names.length})</button>;
              })}
            </div>

            {/* Individual users */}
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
          <section style={{ background: 'rgba(30,41,59,.5)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 900, letterSpacing: '.05em', textTransform: 'uppercase', color: '#fde68a', marginBottom: 12 }}>2 · Your message</div>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="Type the message they'll see in the pop-up…"
              style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 10, color: '#f1f5f9', padding: '12px 14px', fontSize: 15, fontFamily: 'inherit', resize: 'vertical', outline: 'none' }} />
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 12, cursor: 'pointer', color: '#fca5a5', fontWeight: 700, fontSize: 13.5 }}>
              <input type="checkbox" checked={alert} onChange={e => setAlert(e.target.checked)} style={{ width: 16, height: 16, cursor: 'pointer' }} />
              🚨 Mark as alert (red pop-up)
            </label>
          </section>

          {/* Send */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {status && (
              <span style={{ fontWeight: 800, fontSize: 13.5, color: status.startsWith('⚠️') ? '#f87171' : '#4ade80' }}>
                {status}
              </span>
            )}
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

        </div>
      </div>
    </div>
  );
}

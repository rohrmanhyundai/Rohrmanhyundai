import React, { useState } from 'react';
import {
  loadWipData, saveWipData, loadAwaitingData, saveAwaitingData, listWipTechs,
  updateTechChatMessages,
} from '../utils/github';
import { triggerEvent, TECH_CHANNEL, NEW_MSG_EVENT } from '../utils/pusher';
import { trackAction } from '../utils/activityTracker';

// Who may use the Parts Received tool: anyone in parts, plus managers/admins.
export function canUsePartsReceived(role) {
  return role === 'admin' || role === 'parts' || (role || '').includes('manager');
}

const todayUS = () => new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });

// Throttled fan-out so a wide tech roster doesn't trip GitHub's rate limit and
// silently drop matches (mirrors the WIP search behavior).
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// Post a message to the Tech Chat from `username` and broadcast it so every
// open chat refreshes immediately.
async function postTechChat(username, text) {
  const newMsg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    username,
    text,
    timestamp: Date.now(),
  };
  // Append against the fresh server list so a simultaneous chat send isn't lost.
  await updateTechChatMessages(cur => [...cur, newMsg]);
  triggerEvent(TECH_CHANNEL, NEW_MSG_EVENT);
}

const overlaySt = {
  position: 'fixed', inset: 0, background: 'rgba(2,6,23,.7)', backdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: '8vh 16px',
};
const panelSt = {
  background: '#0f172a', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16,
  width: '100%', maxWidth: 520, boxShadow: '0 18px 60px rgba(0,0,0,.6)', overflow: 'hidden',
};
const inpSt = {
  background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.18)',
  borderRadius: 8, color: '#f1f5f9', padding: '9px 12px', fontSize: 14,
  outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};

export default function PartsReceived({ currentUser, onClose, onPosted }) {
  const [ro, setRo] = useState('');
  const [searching, setSearching] = useState(false);
  const [matches, setMatches] = useState(null); // null = not searched yet; [] = searched, none found
  const [error, setError] = useState('');
  const [markingId, setMarkingId] = useState(null);
  const [done, setDone] = useState(''); // success banner text
  const [chatText, setChatText] = useState('');
  const [sendingChat, setSendingChat] = useState(false);

  async function handleSearch() {
    const q = ro.trim();
    if (!q) return;
    setSearching(true);
    setError('');
    setDone('');
    setMatches(null);
    try {
      let owners = [];
      try { owners = await listWipTechs(); } catch { owners = []; }
      const scanSet = [];
      const seen = new Set();
      for (const t of owners) {
        const name = String(t || '').trim();
        if (!name || seen.has(name.toUpperCase())) continue;
        seen.add(name.toUpperCase());
        scanSet.push(name);
      }
      const wipResults = await mapLimit(scanSet, 4, async tech => {
        try {
          const data = await loadWipData(tech);
          return (data || [])
            .filter(r => (r.ro || '').trim() === q || (r.ro || '').toLowerCase().includes(q.toLowerCase()))
            .map(r => ({ ...r, techName: tech, _source: 'wip' }));
        } catch { return []; }
      });
      let awaitingMatches = [];
      try {
        const aw = await loadAwaitingData();
        awaitingMatches = (aw || [])
          .filter(r => (r.ro || '').trim() === q || (r.ro || '').toLowerCase().includes(q.toLowerCase()))
          .map(r => ({ ...r, techName: 'Cars Awaiting', _source: 'awaiting' }));
      } catch {}
      setMatches([...wipResults.flat(), ...awaitingMatches]);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSearching(false);
    }
  }

  async function markPartsIn(match) {
    setMarkingId(match.id);
    setError('');
    const today = todayUS();
    try {
      if (match._source === 'awaiting') {
        const existing = await loadAwaitingData();
        const updated = (existing || []).map(r => r.id === match.id
          ? { ...r, partsArrived: true, partsArrivedDate: today } : r);
        await saveAwaitingData(updated);
      } else {
        const existing = await loadWipData(match.techName);
        const updated = (existing || []).map(r => r.id === match.id
          ? { ...r, partsArrived: true, partsArrivedDate: today } : r);
        await saveWipData(match.techName, updated);
      }
      // Auto-post to Tech Chat
      await postTechChat(currentUser, `RO ${match.ro} parts have been received`);
      onPosted && onPosted();
      trackAction('parts-received-mark', `RO ${match.ro || '?'}`);
      setMatches(prev => (prev || []).map(m => m.id === match.id ? { ...m, partsArrived: true, partsArrivedDate: today } : m));
      setDone(`RO ${match.ro} marked Parts In and posted to Tech Chat.`);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setMarkingId(null);
    }
  }

  async function sendStandaloneChat() {
    const t = chatText.trim();
    if (!t) return;
    setSendingChat(true);
    setError('');
    try {
      await postTechChat(currentUser, t);
      onPosted && onPosted();
      trackAction('parts-received-chat', t.slice(0, 60));
      setDone('Message sent to Tech Chat.');
      setChatText('');
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setSendingChat(false);
    }
  }

  const noMatches = matches !== null && matches.length === 0;

  return (
    <div style={overlaySt} onClick={onClose}>
      <div style={panelSt} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#6ee7b7' }}>📦 Parts Received</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>

        <div style={{ padding: 20 }}>
          {error && <div style={{ marginBottom: 12, padding: '9px 12px', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: '#f87171', fontSize: 13 }}>{error}</div>}
          {done && <div style={{ marginBottom: 12, padding: '9px 12px', background: 'rgba(74,222,128,.1)', border: '1px solid rgba(74,222,128,.35)', borderRadius: 8, color: '#4ade80', fontSize: 13, fontWeight: 700 }}>✓ {done}</div>}

          {/* RO entry */}
          <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Repair Order #</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              autoFocus
              value={ro}
              onChange={e => setRo(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
              placeholder="Enter RO #"
              style={inpSt}
            />
            <button
              onClick={handleSearch}
              disabled={searching || !ro.trim()}
              style={{ background: 'rgba(61,214,195,.2)', border: '1px solid rgba(61,214,195,.4)', color: '#6ee7b7', borderRadius: 8, padding: '9px 16px', cursor: ro.trim() ? 'pointer' : 'default', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap' }}
            >{searching ? '⏳' : '🔍 Find'}</button>
          </div>

          {/* Matches */}
          {matches !== null && matches.length > 0 && (
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {matches.map(m => (
                <div key={m.id} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 10, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 800, color: '#f1f5f9', fontSize: 15 }}>{m.ro}</span>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>· {m.techName}</span>
                    {m.advisor && <span style={{ fontSize: 12, color: '#94a3b8' }}>· {m.advisor}</span>}
                  </div>
                  {m.jobDesc && <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 4 }}>{m.jobDesc}</div>}
                  <div style={{ marginTop: 10 }}>
                    {m.partsArrived === true ? (
                      <span style={{ fontSize: 13, color: '#4ade80', fontWeight: 700 }}>✓ Parts In{m.partsArrivedDate ? ` · ${m.partsArrivedDate}` : ''}</span>
                    ) : (
                      <button
                        onClick={() => markPartsIn(m)}
                        disabled={markingId === m.id}
                        style={{ background: 'rgba(74,222,128,.2)', border: '1px solid rgba(74,222,128,.45)', color: '#4ade80', borderRadius: 8, padding: '8px 18px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}
                      >{markingId === m.id ? '⏳ Marking…' : '✓ Mark Parts In'}</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* No matching saved RO — offer to send a chat message instead */}
          {noMatches && (
            <div style={{ marginTop: 16, background: 'rgba(251,191,36,.08)', border: '1px solid rgba(251,191,36,.3)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ color: '#fbbf24', fontSize: 13, fontWeight: 700, marginBottom: 10 }}>
                No saved RO matches “{ro.trim()}”. Send a message to the Tech Chat instead.
              </div>
              <textarea
                value={chatText}
                onChange={e => setChatText(e.target.value)}
                placeholder="Message to Tech Chat…"
                rows={3}
                style={{ ...inpSt, resize: 'vertical' }}
              />
              <div style={{ marginTop: 10, textAlign: 'right' }}>
                <button
                  onClick={sendStandaloneChat}
                  disabled={sendingChat || !chatText.trim()}
                  style={{ background: 'rgba(59,130,246,.22)', border: '1px solid rgba(96,165,250,.5)', color: '#93c5fd', borderRadius: 8, padding: '8px 18px', cursor: chatText.trim() ? 'pointer' : 'default', fontWeight: 800, fontSize: 13 }}
                >{sendingChat ? '⏳ Sending…' : '💬 Send to Chat'}</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

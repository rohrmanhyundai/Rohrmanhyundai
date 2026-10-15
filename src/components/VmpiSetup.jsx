// ⚙️ VMPI Setup — managers/admins write the rules of the VMPI program (what
// counts, what's expected). Add, edit, reorder, remove; the list is saved to
// data/vmpi/rules.json in one go and shows at the top of everyone's My VMPI.
import React, { useEffect, useState } from 'react';
import * as github from '../utils/github';

const uid = () => `vr-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const inp = { background: 'rgba(2,6,23,.6)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8, color: '#e2e8f0', padding: '7px 10px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', width: '100%' };
const iconBtn = { background: 'rgba(255,255,255,.05)', border: '1px solid rgba(148,163,184,.3)', color: '#cbd5e1', borderRadius: 7, width: 30, height: 28, cursor: 'pointer', fontSize: 13, fontWeight: 900, fontFamily: 'inherit' };

export default function VmpiSetup({ currentUser, onClose, onSaved, io }) {
  const { loadVmpiRules, updateVmpiRules } = io || github;
  const [rules, setRules] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    loadVmpiRules().then(d => setRules(((d && d.rules) || []).map(r => ({ id: r.id || uid(), title: r.title || '', detail: r.detail || '' }))));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next) => { setRules(next); setDirty(true); setMsg(''); };
  const setField = (id, k, v) => change(rules.map(r => (r.id === id ? { ...r, [k]: v } : r)));
  const move = (i, d) => { const j = i + d; if (j < 0 || j >= rules.length) return; const next = rules.slice(); [next[i], next[j]] = [next[j], next[i]]; change(next); };
  const remove = (r) => { if (r.title.trim() || r.detail.trim() ? window.confirm(`Remove "${r.title || 'this rule'}"?`) : true) change(rules.filter(x => x.id !== r.id)); };

  async function save() {
    const clean = rules.map(r => ({ id: r.id, title: r.title.trim(), detail: r.detail.trim() })).filter(r => r.title || r.detail);
    setBusy(true); setMsg('');
    try {
      const res = await updateVmpiRules(cur => ({ ...cur, rules: clean, updatedAt: new Date().toISOString(), by: currentUser }));
      const saved = (res && res.rules) || clean;
      setRules(saved); setDirty(false);
      onSaved && onSaved(saved);
      setMsg('✅ Saved — everyone sees these on My VMPI.');
    } catch (e) { setMsg('❌ ' + (e.message || e)); }
    finally { setBusy(false); }
  }
  const close = () => { if (!dirty || window.confirm('Close without saving your changes?')) onClose(); };

  return (
    <div onClick={close} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 760, background: 'linear-gradient(180deg,#141c2e,#0d1424)', border: '1px solid rgba(103,232,249,.3)', borderRadius: 18, boxShadow: '0 30px 80px -30px rgba(0,0,0,.9)', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 20px', borderBottom: '1px solid rgba(103,232,249,.2)' }}>
          <span style={{ fontSize: 22 }}>⚙️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>VMPI Setup — program rules</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>These show at the top of every tech's My VMPI page, in this order.</div>
          </div>
          <button className="secondary" onClick={close}>✕</button>
        </div>
        <div style={{ padding: 20 }}>
          {msg && <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 10, color: msg.startsWith('❌') ? '#fca5a5' : '#86efac' }}>{msg}</div>}
          {rules == null ? <div style={{ color: '#94a3b8' }}>Loading…</div> : (
            <>
              {rules.length === 0 && <div style={{ color: '#94a3b8', marginBottom: 12 }}>No rules yet.</div>}
              <div style={{ display: 'grid', gap: 10 }}>
                {rules.map((r, i) => (
                  <div key={r.id} style={{ display: 'flex', gap: 10, padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(148,163,184,.2)' }}>
                    <div style={{ fontWeight: 1000, color: '#67e8f9', fontSize: 15, minWidth: 22, paddingTop: 6 }}>{i + 1}.</div>
                    <div style={{ flex: 1, display: 'grid', gap: 6 }}>
                      <input value={r.title} onChange={e => setField(r.id, 'title', e.target.value)} placeholder="Rule — e.g. Every customer-pay RO needs a video" style={{ ...inp, fontWeight: 800 }} />
                      <textarea value={r.detail} onChange={e => setField(r.id, 'detail', e.target.value)} rows={2} placeholder="Details (optional)" style={{ ...inp, resize: 'vertical' }} />
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <button style={iconBtn} title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
                      <button style={iconBtn} title="Move down" disabled={i === rules.length - 1} onClick={() => move(i, 1)}>▼</button>
                      <button style={{ ...iconBtn, color: '#fca5a5' }} title="Remove" onClick={() => remove(r)}>✕</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                <button className="secondary" onClick={() => change([...rules, { id: uid(), title: '', detail: '' }])}>＋ Add rule</button>
                <span style={{ flex: 1 }} />
                <button disabled={busy || !dirty} onClick={save}
                  style={{ background: 'rgba(74,222,128,.15)', border: '1px solid rgba(74,222,128,.5)', color: '#86efac', borderRadius: 9, padding: '8px 18px', fontWeight: 800, fontSize: 13.5, cursor: busy || !dirty ? 'default' : 'pointer', opacity: busy || !dirty ? 0.55 : 1 }}>
                  {busy ? '⏳ Saving…' : '✓ Save rules'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadServicePricing, saveServicePricing } from '../utils/github';

const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// laborCost = labor $ charged to the customer, laborHours = the job's hours.
// Both are editor-only and never shown on the View menu.
const emptyService = () => ({ id: uid('svc'), name: '', price: '', desc: '', opCode: '', laborCost: '', laborHours: '' });
const emptyCategory = () => ({ id: uid('cat'), name: '', services: [emptyService()] });

const numOf = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : null; };

// Effective labor rate ($/hr) and its % of the door rate for one service.
// ELR$ = labor charged ÷ hours; ELR% = ELR$ ÷ door rate × 100.
function computeElr(service, doorRate) {
  const dr = numOf(doorRate), lc = numOf(service.laborCost), lh = numOf(service.laborHours);
  if (!lc) return { state: 'idle' };                          // nothing to show until labor $ entered
  if (!lh) return { state: 'need-hours' };
  const rate = lc / lh;
  if (!dr) return { state: 'need-door', rate };
  return { state: 'ok', rate, pct: (rate / dr) * 100 };
}

// Shared input styling for the editor.
const editInp = {
  background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.3)', borderRadius: 8,
  color: '#f1f5f9', padding: '9px 12px', fontSize: 14, outline: 'none', fontFamily: 'inherit',
  width: '100%', boxSizing: 'border-box',
};
const lbl = { fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#64748b', marginBottom: 4 };

export default function ServicePricingMenu({ currentUser, currentRole, onBack, backLabel = '← Back' }) {
  const isEditor = currentRole === 'admin' || (currentRole || '').includes('manager');
  const [categories, setCategories] = useState([]);
  const [doorRate, setDoorRate] = useState(''); // shop door/posted labor rate ($/hr) — editor only
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');   // saved/error message
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tab, setTab] = useState('view');      // view | edit
  const [dirty, setDirty] = useState(false);
  const savedRef = useRef('');                 // JSON snapshot of last-saved categories

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadServicePricing();
      const cats = Array.isArray(d.categories) ? d.categories : [];
      const dr = d.doorRate || '';
      setCategories(cats);
      setDoorRate(dr);
      setUpdatedAt(d.updatedAt || null);
      savedRef.current = JSON.stringify({ doorRate: dr, categories: cats });
      setDirty(false);
    } catch (e) {
      setStatus('Could not load the pricing menu.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Track unsaved edits so the Save button and a leave-warning can react.
  useEffect(() => {
    setDirty(JSON.stringify({ doorRate, categories }) !== savedRef.current);
  }, [categories, doorRate]);

  // ── Editor mutations ──────────────────────────────────────────────────────
  const addCategory = () => setCategories(cs => [...cs, emptyCategory()]);
  const renameCategory = (ci, name) => setCategories(cs => cs.map((c, i) => i === ci ? { ...c, name } : c));
  const deleteCategory = (ci) => {
    const c = categories[ci];
    if ((c.services || []).some(s => s.name || s.price || s.desc) && !window.confirm(`Delete the "${c.name || 'untitled'}" category and all its services?`)) return;
    setCategories(cs => cs.filter((_, i) => i !== ci));
  };
  const moveCategory = (ci, dir) => setCategories(cs => {
    const j = ci + dir;
    if (j < 0 || j >= cs.length) return cs;
    const next = [...cs]; [next[ci], next[j]] = [next[j], next[ci]]; return next;
  });
  const addService = (ci) => setCategories(cs => cs.map((c, i) => i === ci ? { ...c, services: [...(c.services || []), emptyService()] } : c));
  const updateService = (ci, si, field, value) => setCategories(cs => cs.map((c, i) =>
    i === ci ? { ...c, services: c.services.map((s, k) => k === si ? { ...s, [field]: value } : s) } : c));
  const deleteService = (ci, si) => setCategories(cs => cs.map((c, i) =>
    i === ci ? { ...c, services: c.services.filter((_, k) => k !== si) } : c));
  const moveService = (ci, si, dir) => setCategories(cs => cs.map((c, i) => {
    if (i !== ci) return c;
    const j = si + dir; if (j < 0 || j >= c.services.length) return c;
    const next = [...c.services]; [next[si], next[j]] = [next[j], next[si]]; return { ...c, services: next };
  }));

  async function handleSave() {
    setSaving(true); setStatus('');
    try {
      // Drop fully-blank service rows so a stray "add" doesn't leave empties.
      const clean = categories
        .map(c => ({ ...c, name: (c.name || '').trim(), services: (c.services || []).map(s => ({ ...s, name: (s.name || '').trim(), price: (s.price || '').trim(), desc: (s.desc || '').trim(), opCode: (s.opCode || '').trim(), laborCost: (s.laborCost || '').trim(), laborHours: (s.laborHours || '').trim() })).filter(s => s.name) }))
        .filter(c => c.name || c.services.length);
      const dr = (doorRate || '').trim();
      const saved = await saveServicePricing({ by: (currentUser || '').toUpperCase(), doorRate: dr, categories: clean });
      setCategories(clean);
      setDoorRate(dr);
      savedRef.current = JSON.stringify({ doorRate: dr, categories: clean });
      setUpdatedAt(saved.updatedAt || Date.now());
      setDirty(false);
      setStatus('saved');
      setTimeout(() => setStatus(s => s === 'saved' ? '' : s), 3000);
    } catch (e) {
      setStatus('error');
    } finally {
      setSaving(false);
    }
  }

  const totalServices = categories.reduce((n, c) => n + (c.services || []).filter(s => s.name).length, 0);

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      {/* Topbar */}
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
        <div>
          <div className="adv-title">💲 Service Pricing Menu</div>
          <div className="adv-sub">{tab === 'edit' ? 'Editing — changes go live when you save' : `${totalServices} service${totalServices === 1 ? '' : 's'}${updatedAt ? ` · updated ${new Date(updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}`}</div>
        </div>
        <div style={{ flex: 1 }} />
        {/* View / Edit tabs */}
        <div style={{ display: 'flex', gap: 6, background: 'rgba(255,255,255,.05)', borderRadius: 10, padding: 4 }}>
          <button onClick={() => setTab('view')} style={pillTab(tab === 'view')}>📋 View Menu</button>
          {isEditor && <button onClick={() => setTab('edit')} style={pillTab(tab === 'edit')}>✏️ Edit Menu</button>}
        </div>
        <button className="secondary" onClick={onBack}>{backLabel}</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 26px' }}>
        {loading ? (
          <div style={{ color: '#475569', textAlign: 'center', padding: '60px 0' }}>Loading…</div>
        ) : tab === 'edit' && isEditor ? (
          <EditView
            categories={categories} doorRate={doorRate} setDoorRate={setDoorRate}
            addCategory={addCategory} renameCategory={renameCategory} deleteCategory={deleteCategory} moveCategory={moveCategory}
            addService={addService} updateService={updateService} deleteService={deleteService} moveService={moveService}
            saving={saving} dirty={dirty} status={status} onSave={handleSave}
          />
        ) : (
          <ReadView categories={categories} />
        )}
      </div>
    </div>
  );
}

// The auto-computed ELR readout for a service. Shows the % and the effective
// $/hr once labor $, hours and a door rate are all present; otherwise a hint.
function ElrBadge({ elr }) {
  if (elr.state === 'idle') return null;
  if (elr.state === 'need-hours')
    return <span style={{ fontSize: 12, color: '#64748b' }}>· enter labor hours for ELR</span>;
  if (elr.state === 'need-door')
    return <span style={{ fontSize: 12, color: '#fbbf24' }}>· ${elr.rate.toFixed(2)}/hr — set the door rate above for ELR%</span>;
  // ok
  const good = elr.pct >= 100;
  const color = good ? '#4ade80' : elr.pct >= 80 ? '#fbbf24' : '#fb7185';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginLeft: 2 }}>
      <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' }}>ELR</span>
      <span style={{ fontSize: 15, fontWeight: 900, color }}>{elr.pct.toFixed(1)}%</span>
      <span style={{ fontSize: 12, color: '#94a3b8' }}>(${elr.rate.toFixed(2)}/hr)</span>
    </span>
  );
}

function pillTab(active) {
  return {
    background: active ? 'rgba(110,231,183,.2)' : 'transparent',
    border: `1px solid ${active ? 'rgba(110,231,183,.5)' : 'transparent'}`,
    color: active ? '#6ee7b7' : '#94a3b8', borderRadius: 8, padding: '6px 14px',
    cursor: 'pointer', fontWeight: 800, fontSize: 13, whiteSpace: 'nowrap',
  };
}

// ── Modern read-only menu (all advisors) ─────────────────────────────────────
function ReadView({ categories }) {
  const [copiedId, setCopiedId] = useState('');
  const copyOp = (code, id) => {
    const v = String(code || '').trim();
    if (!v) return;
    const done = () => { setCopiedId(id); setTimeout(() => setCopiedId(c => c === id ? '' : c), 1400); };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(v).then(done).catch(() => {});
    } else {
      const ta = document.createElement('textarea');
      ta.value = v; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch {}
      document.body.removeChild(ta);
    }
  };
  const populated = categories.map(c => ({ ...c, services: (c.services || []).filter(s => s.name) })).filter(c => c.services.length || c.name);
  if (!populated.length) {
    return <div style={{ color: '#475569', textAlign: 'center', padding: '60px 0', fontSize: 15 }}>No services listed yet.</div>;
  }
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', display: 'grid', gap: 22 }}>
      {populated.map(cat => (
        <section key={cat.id} style={{
          background: 'linear-gradient(180deg, rgba(30,41,59,.7), rgba(15,23,42,.6))',
          border: '1px solid rgba(148,163,184,.16)', borderRadius: 18, overflow: 'hidden',
          boxShadow: '0 12px 34px -20px rgba(0,0,0,.8)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 22px', background: 'linear-gradient(90deg, rgba(110,231,183,.16), rgba(110,231,183,0))', borderBottom: '1px solid rgba(148,163,184,.14)' }}>
            <span style={{ width: 4, height: 22, borderRadius: 2, background: 'linear-gradient(180deg,#34d399,#6ee7b7)' }} />
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: '#f1f5f9', letterSpacing: '-.01em' }}>{cat.name || 'Services'}</h2>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#64748b' }}>{cat.services.length} item{cat.services.length === 1 ? '' : 's'}</span>
          </div>
          <div>
            {cat.services.map((s, i) => (
              <div key={s.id} style={{
                display: 'flex', alignItems: 'baseline', gap: 18, padding: '14px 22px',
                borderTop: i === 0 ? 'none' : '1px solid rgba(148,163,184,.09)',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15.5, fontWeight: 700, color: '#e2e8f0' }}>{s.name}</div>
                  {s.desc && <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 3, lineHeight: 1.45 }}>{s.desc}</div>}
                </div>
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14 }}>
                  {s.opCode && (
                    <button
                      onClick={() => copyOp(s.opCode, s.id)}
                      title="Copy op code"
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                        background: copiedId === s.id ? 'rgba(74,222,128,.2)' : 'rgba(110,231,249,.12)',
                        border: `1px solid ${copiedId === s.id ? 'rgba(74,222,128,.55)' : 'rgba(110,231,249,.4)'}`,
                        color: copiedId === s.id ? '#4ade80' : '#6ee7f9',
                        borderRadius: 8, padding: '5px 11px', cursor: 'pointer', fontWeight: 800, fontSize: 12,
                      }}
                    >{copiedId === s.id ? '✓ Copied' : '⧉ Copy Op Code'}</button>
                  )}
                  {s.price && (
                    <div style={{ fontSize: 17, fontWeight: 900, color: '#6ee7b7', letterSpacing: '-.01em', whiteSpace: 'nowrap' }}>{s.price}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Full-area editor (managers / admins) ─────────────────────────────────────
function EditView({ categories, doorRate, setDoorRate, addCategory, renameCategory, deleteCategory, moveCategory, addService, updateService, deleteService, moveService, saving, dirty, status, onSave }) {
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 90 }}>
      {/* Door rate — one value for the whole menu, editor-only. Drives every ELR%. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'rgba(96,165,250,.08)', border: '1px solid rgba(96,165,250,.28)', borderRadius: 14, padding: '14px 18px', marginBottom: 18 }}>
        <span style={{ fontSize: 24 }}>🚪</span>
        <div>
          <div style={{ ...lbl, marginBottom: 2, color: '#93c5fd' }}>Door Rate ($ / hour)</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Your posted labor rate. Used to figure the ELR% on each service below.</div>
        </div>
        <div style={{ flex: 1 }} />
        <input value={doorRate} onChange={e => setDoorRate(e.target.value)} placeholder="$0.00" inputMode="decimal"
          style={{ ...editInp, width: 140, fontSize: 18, fontWeight: 900, color: '#93c5fd', textAlign: 'center' }} />
      </div>

      {categories.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0', fontSize: 15 }}>No categories yet. Add one to get started.</div>
      )}

      {categories.map((cat, ci) => (
        <div key={cat.id} style={{ background: 'rgba(30,41,59,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 16, padding: '16px 18px', marginBottom: 18 }}>
          {/* Category header row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={lbl}>Category name</div>
              <input value={cat.name} onChange={e => renameCategory(ci, e.target.value)} placeholder="e.g. Maintenance, Brakes, Tires, Accessories…"
                style={{ ...editInp, fontSize: 16, fontWeight: 800, color: '#f8fafc' }} />
            </div>
            <div style={{ display: 'flex', gap: 4, alignSelf: 'flex-end' }}>
              <button title="Move up" onClick={() => moveCategory(ci, -1)} disabled={ci === 0} style={iconBtn(ci === 0)}>↑</button>
              <button title="Move down" onClick={() => moveCategory(ci, 1)} disabled={ci === categories.length - 1} style={iconBtn(ci === categories.length - 1)}>↓</button>
              <button title="Delete category" onClick={() => deleteCategory(ci)} style={{ ...iconBtn(false), color: '#f87171', borderColor: 'rgba(248,113,113,.35)', background: 'rgba(248,113,113,.1)' }}>🗑</button>
            </div>
          </div>

          {/* Column headers */}
          <div style={{ display: 'flex', gap: 10, padding: '0 4px 6px', color: '#64748b', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em' }}>
            <div style={{ flex: '2 1 190px' }}>Service</div>
            <div style={{ flex: '0 0 110px' }}>Op Code</div>
            <div style={{ flex: '0 0 110px' }}>Price</div>
            <div style={{ flex: '3 1 240px' }}>Description (optional)</div>
            <div style={{ flex: '0 0 74px' }} />
          </div>

          {(cat.services || []).map((s, si) => {
            const elr = computeElr(s, doorRate);
            return (
            <div key={s.id} style={{ marginBottom: 12, borderBottom: '1px solid rgba(148,163,184,.1)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <input value={s.name} onChange={e => updateService(ci, si, 'name', e.target.value)} placeholder="Service name"
                  style={{ ...editInp, flex: '2 1 190px' }} />
                <input value={s.opCode || ''} onChange={e => updateService(ci, si, 'opCode', e.target.value)} placeholder="Op code"
                  style={{ ...editInp, flex: '0 0 110px', color: '#6ee7f9', fontWeight: 700 }} />
                <input value={s.price} onChange={e => updateService(ci, si, 'price', e.target.value)} placeholder="$0.00"
                  style={{ ...editInp, flex: '0 0 110px', color: '#6ee7b7', fontWeight: 800 }} />
                <input value={s.desc} onChange={e => updateService(ci, si, 'desc', e.target.value)} placeholder="Short description…"
                  style={{ ...editInp, flex: '3 1 240px' }} />
                <div style={{ flex: '0 0 74px', display: 'flex', gap: 3 }}>
                  <button title="Move up" onClick={() => moveService(ci, si, -1)} disabled={si === 0} style={iconBtn(si === 0)}>↑</button>
                  <button title="Move down" onClick={() => moveService(ci, si, 1)} disabled={si === cat.services.length - 1} style={iconBtn(si === cat.services.length - 1)}>↓</button>
                  <button title="Remove service" onClick={() => deleteService(ci, si)} style={{ ...iconBtn(false), color: '#f87171' }}>✕</button>
                </div>
              </div>

              {/* Labor / ELR — editor-only, never shown on the View menu. */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 7, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', color: '#64748b' }}>Internal</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
                  Labor $
                  <input value={s.laborCost || ''} onChange={e => updateService(ci, si, 'laborCost', e.target.value)} placeholder="$0.00" inputMode="decimal"
                    style={{ ...editInp, width: 92, padding: '6px 9px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#94a3b8' }}>
                  Labor hrs
                  <input value={s.laborHours || ''} onChange={e => updateService(ci, si, 'laborHours', e.target.value)} placeholder="0.0" inputMode="decimal"
                    style={{ ...editInp, width: 72, padding: '6px 9px', fontSize: 13, fontWeight: 700, color: '#e2e8f0' }} />
                </label>
                <ElrBadge elr={elr} />
              </div>
            </div>
            );
          })}

          <button onClick={() => addService(ci)}
            style={{ marginTop: 6, background: 'rgba(110,231,183,.12)', border: '1px dashed rgba(110,231,183,.4)', color: '#6ee7b7', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>
            + Add Service
          </button>
        </div>
      ))}

      <button onClick={addCategory}
        style={{ background: 'rgba(167,139,250,.15)', border: '1px solid rgba(167,139,250,.4)', color: '#c4b5fd', borderRadius: 10, padding: '11px 22px', cursor: 'pointer', fontWeight: 800, fontSize: 14 }}>
        + Add Category
      </button>

      {/* Sticky save bar */}
      <div style={{ position: 'sticky', bottom: 0, marginTop: 24, padding: '14px 0 4px', background: 'linear-gradient(180deg, rgba(15,23,42,0), rgba(15,23,42,.92) 40%)', display: 'flex', alignItems: 'center', gap: 14 }}>
        {status === 'saved' && <span style={{ color: '#4ade80', fontWeight: 800, fontSize: 13.5 }}>✅ Saved — live for all advisors</span>}
        {status === 'error' && <span style={{ color: '#f87171', fontWeight: 800, fontSize: 13.5 }}>⚠️ Save failed — check your connection / GitHub token</span>}
        {status !== 'saved' && status !== 'error' && dirty && <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: 13 }}>● Unsaved changes</span>}
        <div style={{ flex: 1 }} />
        <button onClick={onSave} disabled={saving || !dirty}
          style={{
            background: (saving || !dirty) ? 'rgba(255,255,255,.06)' : 'linear-gradient(180deg,#34d399,#10b981)',
            border: `1px solid ${(saving || !dirty) ? 'rgba(255,255,255,.12)' : 'rgba(52,211,153,.6)'}`,
            color: (saving || !dirty) ? '#64748b' : '#04121a', borderRadius: 10, padding: '11px 28px',
            cursor: (saving || !dirty) ? 'default' : 'pointer', fontWeight: 900, fontSize: 15,
          }}>
          {saving ? '⏳ Saving…' : '💾 Save & Publish'}
        </button>
      </div>
    </div>
  );
}

function iconBtn(disabled) {
  return {
    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.14)', color: disabled ? '#475569' : '#cbd5e1',
    borderRadius: 7, width: 30, height: 34, cursor: disabled ? 'default' : 'pointer', fontWeight: 800, fontSize: 13,
    opacity: disabled ? 0.5 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  };
}

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { loadServicePricing, saveServicePricing } from '../utils/github';

const uid = (p) => `${p}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// laborCost = labor $ charged to the customer, laborHours = the job's hours.
// Both are editor-only and never shown on the View menu.
const emptyService = () => ({ id: uid('svc'), name: '', price: '', desc: '', opCode: '', laborCost: '', laborHours: '' });
const emptyCategory = () => ({ id: uid('cat'), name: '', services: [emptyService()] });

const numOf = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : null; };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (n) => `$${round2(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// ── Package math ──────────────────────────────────────────────────────────────
// A package item keeps its PARTS (auto-filled from the menu, adjustable) and
// gets its LABOR from the ELR% the user sets: labor $ = (ELR% ÷ 100) × door rate
// × hours. The line TOTAL is figured automatically = parts + labor. Package
// price = the sum of the line totals.
function itemMath(item, doorRate) {
  const dr = numOf(doorRate) || 0;
  const hrs = numOf(item.laborHours) || 0;
  const elr = numOf(item.elrPct);
  const laborCost = (elr != null && dr > 0 && hrs > 0) ? (elr / 100) * dr * hrs : 0;
  // `parts` is the source of truth; older items that stored `total` instead
  // fall back to total − labor so their parts still resolve.
  const hasParts = item.parts != null && String(item.parts).trim() !== '';
  const parts = hasParts ? (numOf(item.parts) || 0) : Math.max(0, (numOf(item.total) || 0) - laborCost);
  return { parts, laborCost, total: parts + laborCost };
}
// Roll every line up into the package-level totals, then let the user override
// the aggregate hours / ELR% / labor / parts to fine-tune the final price. Each
// override defaults to the summed value (null = "track the lines"). Labor is
// figured from ELR% × door × hours; editing labor back-solves the ELR%. Tax
// defaults to 7% on parts only. Grand total = parts + labor + tax.
function packageSummary(pkg, doorRate) {
  const dr = numOf(doorRate) || 0;
  let autoParts = 0, autoLabor = 0, autoHours = 0;
  for (const it of (pkg.items || [])) {
    const m = itemMath(it, doorRate);
    autoParts += m.parts; autoLabor += m.laborCost; autoHours += numOf(it.laborHours) || 0;
  }
  const autoElr = (autoHours > 0 && dr > 0) ? (autoLabor / autoHours) / dr * 100 : null;

  const ovrHours = numOf(pkg.ovrHours), ovrElr = numOf(pkg.ovrElr), ovrParts = numOf(pkg.ovrParts);
  const hours = ovrHours != null ? ovrHours : autoHours;
  const elr = ovrElr != null ? ovrElr : autoElr;
  const parts = ovrParts != null ? ovrParts : autoParts;
  // Labor from ELR% when we can figure it, else fall back to the summed labor.
  const labor = (elr != null && dr > 0 && hours > 0) ? (elr / 100) * dr * hours : autoLabor;

  const subtotal = parts + labor;
  const rate = numOf(pkg.taxRate);
  const taxRate = rate == null ? 0 : rate;
  const taxBase = pkg.taxBase === 'subtotal' ? 'subtotal' : 'parts';
  const taxAmt = (taxRate / 100) * (taxBase === 'subtotal' ? subtotal : parts);
  return {
    parts, labor, hours, elr, subtotal, taxRate, taxBase, taxAmt, grand: subtotal + taxAmt,
    autoParts, autoLabor, autoHours, autoElr,
    overridden: ovrHours != null || ovrElr != null || ovrParts != null,
  };
}
// Build a package item from one of the menu's services. Parts = price − labor
// (whole price is parts if no labor is set); ELR starts at the service's own
// effective rate when it has labor+hours, otherwise 100% (full door rate). The
// line total is always figured as parts + labor.
function itemFromService(s, doorRate) {
  const price = numOf(s.price) || 0;
  const labor = numOf(s.laborCost) || 0;
  const hrs = numOf(s.laborHours) || 0;
  const dr = numOf(doorRate) || 0;
  const parts = Math.max(0, price - labor);
  let elr = 100;
  if (labor > 0 && hrs > 0 && dr > 0) elr = round2((labor / hrs) / dr * 100);
  return { id: uid('item'), name: s.name || '', opCode: s.opCode || '', parts: String(round2(parts)), laborHours: hrs ? String(hrs) : '', elrPct: String(elr) };
}

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
  const [packages, setPackages] = useState([]); // built service packages (draft + published)
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');   // saved/error message
  const [updatedAt, setUpdatedAt] = useState(null);
  const [tab, setTab] = useState('view');      // view | edit
  const [dirty, setDirty] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false); // package builder modal
  const savedRef = useRef('');                 // JSON snapshot of last-saved data

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await loadServicePricing();
      const cats = Array.isArray(d.categories) ? d.categories : [];
      const dr = d.doorRate || '';
      const pks = Array.isArray(d.packages) ? d.packages : [];
      setCategories(cats);
      setDoorRate(dr);
      setPackages(pks);
      setUpdatedAt(d.updatedAt || null);
      savedRef.current = JSON.stringify({ doorRate: dr, categories: cats, packages: pks });
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
    setDirty(JSON.stringify({ doorRate, categories, packages }) !== savedRef.current);
  }, [categories, doorRate, packages]);

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

  // Clean + assemble the full data object. Optional overrides let the package
  // builder persist a fresh packages array alongside the current categories.
  function serialize(over = {}) {
    const clean = categories
      .map(c => ({ ...c, name: (c.name || '').trim(), services: (c.services || []).map(s => ({ ...s, name: (s.name || '').trim(), price: (s.price || '').trim(), desc: (s.desc || '').trim(), opCode: (s.opCode || '').trim(), laborCost: (s.laborCost || '').trim(), laborHours: (s.laborHours || '').trim() })).filter(s => s.name) }))
      .filter(c => c.name || c.services.length);
    const dr = (doorRate || '').trim();
    const pks = over.packages != null ? over.packages : packages;
    return { by: (currentUser || '').toUpperCase(), doorRate: dr, categories: clean, packages: pks, _clean: clean, _dr: dr, _pks: pks };
  }

  async function handleSave() {
    setSaving(true); setStatus('');
    try {
      const { _clean, _dr, _pks, ...data } = serialize();
      const saved = await saveServicePricing(data);
      setCategories(_clean);
      setDoorRate(_dr);
      savedRef.current = JSON.stringify({ doorRate: _dr, categories: _clean, packages: _pks });
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

  // Save one package (draft or published) immediately, upserting into the list
  // and persisting the whole menu so the builder's Save Project / Submit land
  // without needing the main Save button.
  async function savePackage(pkg, pkgStatus) {
    const priced = {
      ...pkg,
      status: pkgStatus,
      price: round2(packageSummary(pkg, doorRate).grand),
      updatedAt: Date.now(),
    };
    const i = packages.findIndex(p => p.id === priced.id);
    const next = i >= 0 ? packages.map((p, k) => k === i ? priced : p) : [...packages, priced];
    const { _clean, _dr, _pks, ...data } = serialize({ packages: next });
    const saved = await saveServicePricing(data);
    setCategories(_clean); setDoorRate(_dr); setPackages(next);
    savedRef.current = JSON.stringify({ doorRate: _dr, categories: _clean, packages: next });
    setUpdatedAt(saved.updatedAt || Date.now());
    setDirty(false);
    return priced;
  }

  async function deletePackage(id) {
    const next = packages.filter(p => p.id !== id);
    const { _clean, _dr, _pks, ...data } = serialize({ packages: next });
    const saved = await saveServicePricing(data);
    setCategories(_clean); setDoorRate(_dr); setPackages(next);
    savedRef.current = JSON.stringify({ doorRate: _dr, categories: _clean, packages: next });
    setUpdatedAt(saved.updatedAt || Date.now());
    setDirty(false);
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
            categories={categories} doorRate={doorRate} setDoorRate={setDoorRate} packages={packages}
            addCategory={addCategory} renameCategory={renameCategory} deleteCategory={deleteCategory} moveCategory={moveCategory}
            addService={addService} updateService={updateService} deleteService={deleteService} moveService={moveService}
            saving={saving} dirty={dirty} status={status} onSave={handleSave}
            onOpenBuilder={() => setBuilderOpen(true)}
          />
        ) : (
          <ReadView categories={categories} packages={packages} />
        )}
      </div>

      {builderOpen && (
        <PackageBuilderModal
          categories={categories} doorRate={doorRate} packages={packages}
          onSavePackage={savePackage} onDeletePackage={deletePackage}
          onClose={() => setBuilderOpen(false)}
        />
      )}
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
function ReadView({ categories, packages }) {
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
  const posted = (packages || []).filter(p => p.status === 'published' && (p.items || []).length);
  const populated = categories.map(c => ({ ...c, services: (c.services || []).filter(s => s.name) })).filter(c => c.services.length || c.name);
  if (!populated.length && !posted.length) {
    return <div style={{ color: '#475569', textAlign: 'center', padding: '60px 0', fontSize: 15 }}>No services listed yet.</div>;
  }
  return (
    <div style={{ maxWidth: 920, margin: '0 auto', display: 'grid', gap: 22 }}>
      {posted.length > 0 && (
        <section style={{
          background: 'linear-gradient(180deg, rgba(76,29,149,.42), rgba(15,23,42,.6))',
          border: '1px solid rgba(167,139,250,.35)', borderRadius: 18, overflow: 'hidden',
          boxShadow: '0 12px 34px -20px rgba(0,0,0,.8)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 22px', background: 'linear-gradient(90deg, rgba(167,139,250,.22), rgba(167,139,250,0))', borderBottom: '1px solid rgba(167,139,250,.24)' }}>
            <span style={{ fontSize: 20 }}>📦</span>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 900, color: '#f1f5f9', letterSpacing: '-.01em' }}>Service Packages</h2>
            <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color: '#a78bfa' }}>{posted.length} package{posted.length === 1 ? '' : 's'}</span>
          </div>
          <div>
            {posted.map((pkg, i) => (
              <div key={pkg.id} style={{ padding: '16px 22px', borderTop: i === 0 ? 'none' : '1px solid rgba(167,139,250,.16)' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 16.5, fontWeight: 800, color: '#f1f5f9' }}>{pkg.name || 'Package'}</div>
                    {pkg.desc && <div style={{ fontSize: 13, color: '#c4b5fd', marginTop: 3, lineHeight: 1.45 }}>{pkg.desc}</div>}
                  </div>
                  <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ fontSize: 19, fontWeight: 900, color: '#c4b5fd', letterSpacing: '-.01em' }}>{money(pkg.price || 0)}</div>
                    {numOf(pkg.taxRate) > 0 && <div style={{ fontSize: 10.5, color: '#94a3b8', fontWeight: 600 }}>incl. {numOf(pkg.taxRate)}% tax</div>}
                  </div>
                </div>
                <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 5 }}>
                  {(pkg.items || []).map(it => (
                    <li key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: '#cbd5e1' }}>
                      <span style={{ color: '#a78bfa' }}>✓</span>
                      <span style={{ flex: 1, minWidth: 0 }}>{it.name}</span>
                      {it.opCode && (
                        <button onClick={() => copyOp(it.opCode, `${pkg.id}:${it.id}`)} title="Copy op code"
                          style={{
                            background: copiedId === `${pkg.id}:${it.id}` ? 'rgba(74,222,128,.2)' : 'rgba(110,231,249,.12)',
                            border: `1px solid ${copiedId === `${pkg.id}:${it.id}` ? 'rgba(74,222,128,.55)' : 'rgba(110,231,249,.4)'}`,
                            color: copiedId === `${pkg.id}:${it.id}` ? '#4ade80' : '#6ee7f9',
                            borderRadius: 7, padding: '3px 9px', cursor: 'pointer', fontWeight: 800, fontSize: 11, whiteSpace: 'nowrap',
                          }}>{copiedId === `${pkg.id}:${it.id}` ? '✓ Copied' : '⧉ Op Code'}</button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
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
function EditView({ categories, doorRate, setDoorRate, packages, addCategory, renameCategory, deleteCategory, moveCategory, addService, updateService, deleteService, moveService, saving, dirty, status, onSave, onOpenBuilder }) {
  const pubCount = (packages || []).filter(p => p.status === 'published').length;
  const draftCount = (packages || []).filter(p => p.status !== 'published').length;
  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', paddingBottom: 90 }}>
      {/* Door rate — one value for the whole menu, editor-only. Drives every ELR%. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'rgba(96,165,250,.08)', border: '1px solid rgba(96,165,250,.28)', borderRadius: 14, padding: '14px 18px', marginBottom: 14 }}>
        <span style={{ fontSize: 24 }}>🚪</span>
        <div>
          <div style={{ ...lbl, marginBottom: 2, color: '#93c5fd' }}>Door Rate ($ / hour)</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>Your posted labor rate. Used to figure the ELR% on each service below.</div>
        </div>
        <div style={{ flex: 1 }} />
        <input value={doorRate} onChange={e => setDoorRate(e.target.value)} placeholder="$0.00" inputMode="decimal"
          style={{ ...editInp, width: 140, fontSize: 18, fontWeight: 900, color: '#93c5fd', textAlign: 'center' }} />
      </div>

      {/* Package builder launcher */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', background: 'rgba(167,139,250,.09)', border: '1px solid rgba(167,139,250,.3)', borderRadius: 14, padding: '14px 18px', marginBottom: 18 }}>
        <span style={{ fontSize: 24 }}>📦</span>
        <div>
          <div style={{ ...lbl, marginBottom: 2, color: '#c4b5fd' }}>Package Tool Builder</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            Bundle services into a package, tune each labor time &amp; ELR%, then post it to the View menu.
            {(pubCount || draftCount) ? <> · <span style={{ color: '#c4b5fd', fontWeight: 700 }}>{pubCount} posted{draftCount ? `, ${draftCount} draft` : ''}</span></> : null}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onOpenBuilder}
          style={{ background: 'linear-gradient(180deg,#a78bfa,#8b5cf6)', border: '1px solid rgba(167,139,250,.6)', color: '#0b0716', borderRadius: 10, padding: '11px 22px', cursor: 'pointer', fontWeight: 900, fontSize: 14, whiteSpace: 'nowrap' }}>
          🔧 Open Package Builder
        </button>
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

const newPackage = () => ({ id: uid('pkg'), name: '', desc: '', status: 'draft', items: [], taxRate: '7', taxBase: 'parts' });

// ── Package Tool Builder ─────────────────────────────────────────────────────
// Landing lists saved packages (draft + posted); the editor bundles services,
// tunes each one's labor hours / ELR% (which back-solves the labor $), and
// posts the finished package to the View menu — or saves it as a draft.
function PackageBuilderModal({ categories, doorRate, packages, onSavePackage, onDeletePackage, onClose }) {
  const [screen, setScreen] = useState((packages || []).length ? 'list' : 'edit');
  const [draft, setDraft] = useState(() => (packages || []).length ? null : newPackage());
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState('');   // '', 'draft', 'publish'
  const [flash, setFlash] = useState(''); // transient banner
  const [err, setErr] = useState('');

  const dr = numOf(doorRate) || 0;
  const groups = (categories || [])
    .map(c => ({ name: c.name || 'Services', services: (c.services || []).filter(s => s.name) }))
    .filter(g => g.services.length);
  const q = search.trim().toLowerCase();
  const shownGroups = q
    ? groups.map(g => ({ ...g, services: g.services.filter(s => `${s.name} ${s.opCode || ''}`.toLowerCase().includes(q)) })).filter(g => g.services.length)
    : groups;

  const sum = draft ? packageSummary(draft, doorRate) : null;
  const setItems = (fn) => setDraft(d => ({ ...d, items: fn(d.items || []) }));
  // Package-level total overrides. Editing labor back-solves the ELR% (holding
  // hours); a reset clears every override so the totals track the lines again.
  const setLabor = (value) => setDraft(d => {
    const s = packageSummary(d, doorRate);
    if (dr > 0 && s.hours > 0) return { ...d, ovrElr: String(round2((numOf(value) || 0) / (dr * s.hours) * 100)) };
    return d;
  });
  const resetTotals = () => setDraft(d => ({ ...d, ovrHours: undefined, ovrElr: undefined, ovrParts: undefined }));
  const addService = (s) => setItems(items => [...items, itemFromService(s, doorRate)]);
  const updateItem = (id, field, value) => setItems(items => items.map(it => it.id === id ? { ...it, [field]: value } : it));
  const removeItem = (id) => setItems(items => items.filter(it => it.id !== id));
  const moveItem = (id, dir) => setItems(items => {
    const i = items.findIndex(it => it.id === id); const j = i + dir;
    if (i < 0 || j < 0 || j >= items.length) return items;
    const next = [...items]; [next[i], next[j]] = [next[j], next[i]]; return next;
  });
  const countInPkg = (name) => (draft?.items || []).filter(it => it.name === name).length;

  const startNew = () => { setDraft(newPackage()); setErr(''); setFlash(''); setScreen('edit'); };
  const editExisting = (pkg) => {
    const d = JSON.parse(JSON.stringify(pkg));
    if (d.taxRate == null) d.taxRate = '7';       // backfill for pre-tax packages
    if (d.taxBase == null) d.taxBase = 'parts';
    setDraft(d); setErr(''); setFlash(''); setScreen('edit');
  };
  const isSaved = draft && (packages || []).some(p => p.id === draft.id);

  async function doSave(status) {
    setErr('');
    if (!draft.name.trim()) { setErr('Give the package a name first.'); return; }
    if (status === 'published' && !(draft.items || []).length) { setErr('Add at least one service before posting.'); return; }
    setBusy(status === 'published' ? 'publish' : 'draft');
    try {
      const saved = await onSavePackage({ ...draft, name: draft.name.trim(), desc: (draft.desc || '').trim() }, status);
      setDraft(saved);
      if (status === 'published') { setScreen('list'); }
      else { setFlash('Draft saved — come back anytime to keep building.'); setTimeout(() => setFlash(f => f ? '' : f), 3500); }
    } catch (e) {
      setErr('Save failed — check your connection / GitHub token.');
    } finally {
      setBusy('');
    }
  }

  async function doDelete(pkg) {
    if (!window.confirm(`Delete the package "${pkg.name || 'untitled'}"?`)) return;
    setBusy('del');
    try {
      await onDeletePackage(pkg.id);
      if (draft && draft.id === pkg.id) { setDraft(null); setScreen('list'); }
    } catch (e) { setErr('Delete failed.'); }
    finally { setBusy(''); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '4vh 16px', overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: 1080, background: 'linear-gradient(180deg,#141c2e,#0d1424)', border: '1px solid rgba(167,139,250,.3)', borderRadius: 18, boxShadow: '0 30px 80px -30px rgba(0,0,0,.9)', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '15px 20px', background: 'linear-gradient(90deg, rgba(167,139,250,.2), rgba(167,139,250,0))', borderBottom: '1px solid rgba(167,139,250,.24)' }}>
          <span style={{ fontSize: 22 }}>📦</span>
          <div style={{ fontSize: 17, fontWeight: 900, color: '#f1f5f9' }}>Package Tool Builder</div>
          {screen === 'edit' && (packages || []).length > 0 && (
            <button onClick={() => { setScreen('list'); }} className="secondary" style={{ marginLeft: 8, fontSize: 12, padding: '5px 12px' }}>← All packages</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...iconBtn(false), width: 34 }}>✕</button>
        </div>

        {flash && <div style={{ padding: '10px 20px', background: 'rgba(52,211,153,.12)', color: '#6ee7b7', fontWeight: 700, fontSize: 13 }}>✅ {flash}</div>}
        {err && <div style={{ padding: '10px 20px', background: 'rgba(248,113,113,.12)', color: '#fca5a5', fontWeight: 700, fontSize: 13 }}>⚠️ {err}</div>}

        {screen === 'list' ? (
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 13, color: '#94a3b8' }}>{(packages || []).length} saved package{(packages || []).length === 1 ? '' : 's'}</div>
              <div style={{ flex: 1 }} />
              <button onClick={startNew} style={{ background: 'linear-gradient(180deg,#a78bfa,#8b5cf6)', border: '1px solid rgba(167,139,250,.6)', color: '#0b0716', borderRadius: 10, padding: '9px 18px', cursor: 'pointer', fontWeight: 900, fontSize: 13 }}>＋ New Package</button>
            </div>
            {!(packages || []).length ? (
              <div style={{ color: '#64748b', textAlign: 'center', padding: '40px 0' }}>No packages yet. Start a new one.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                {packages.map(pkg => {
                  const published = pkg.status === 'published';
                  return (
                    <div key={pkg.id} style={{ display: 'flex', alignItems: 'center', gap: 14, background: 'rgba(30,41,59,.55)', border: '1px solid rgba(148,163,184,.18)', borderRadius: 12, padding: '12px 16px' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>{pkg.name || 'Untitled package'}</span>
                          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.05em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, ...(published ? { background: 'rgba(52,211,153,.16)', color: '#6ee7b7' } : { background: 'rgba(251,191,36,.16)', color: '#fbbf24' }) }}>{published ? 'Posted' : 'Draft'}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{(pkg.items || []).length} service{(pkg.items || []).length === 1 ? '' : 's'} · {money(pkg.price || 0)}</div>
                      </div>
                      <button onClick={() => editExisting(pkg)} className="secondary" style={{ fontSize: 12, padding: '7px 14px' }}>✏️ Edit</button>
                      <button onClick={() => doDelete(pkg)} disabled={busy === 'del'} style={{ ...iconBtn(false), color: '#f87171', borderColor: 'rgba(248,113,113,.35)', background: 'rgba(248,113,113,.1)' }}>🗑</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ) : draft && (
          <div style={{ display: 'flex', gap: 0, flexWrap: 'wrap', alignItems: 'stretch' }}>
            {/* Palette */}
            <div style={{ flex: '1 1 320px', minWidth: 280, borderRight: '1px solid rgba(148,163,184,.14)', maxHeight: '68vh', overflowY: 'auto', padding: 16 }}>
              <div style={{ ...lbl, marginBottom: 8 }}>Add services · click to add</div>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search services…" style={{ ...editInp, marginBottom: 12 }} />
              {!shownGroups.length ? (
                <div style={{ color: '#64748b', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>No matching services.</div>
              ) : shownGroups.map(g => (
                <div key={g.name} style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 800, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>{g.name}</div>
                  <div style={{ display: 'grid', gap: 6 }}>
                    {g.services.map(s => {
                      const n = countInPkg(s.name);
                      return (
                        <button key={s.id} onClick={() => addService(s)} style={{ display: 'flex', alignItems: 'center', gap: 8, textAlign: 'left', background: 'rgba(30,41,59,.6)', border: '1px solid rgba(148,163,184,.16)', borderRadius: 9, padding: '8px 11px', cursor: 'pointer' }}>
                          <span style={{ color: '#a78bfa', fontWeight: 900, fontSize: 15 }}>＋</span>
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
                            {s.price && <span style={{ fontSize: 11.5, color: '#6ee7b7' }}>{s.price}</span>}
                          </span>
                          {n > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: '#6ee7b7', background: 'rgba(52,211,153,.15)', borderRadius: 999, padding: '2px 7px' }}>×{n}</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Builder */}
            <div style={{ flex: '2 1 460px', minWidth: 320, maxHeight: '68vh', overflowY: 'auto', padding: 18 }}>
              {dr <= 0 && <div style={{ background: 'rgba(251,191,36,.12)', border: '1px solid rgba(251,191,36,.3)', color: '#fbbf24', borderRadius: 10, padding: '9px 13px', fontSize: 12.5, fontWeight: 700, marginBottom: 14 }}>Set a Door Rate in the Edit menu so labor $ can be figured from ELR%.</div>}

              <div style={{ marginBottom: 12 }}>
                <div style={lbl}>Package name</div>
                <input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. Hyundai 30k Mile Service" style={{ ...editInp, fontSize: 16, fontWeight: 800, color: '#f8fafc' }} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <div style={lbl}>Description (shown on the menu)</div>
                <input value={draft.desc} onChange={e => setDraft(d => ({ ...d, desc: e.target.value }))} placeholder="Short description customers will see…" style={editInp} />
              </div>

              {/* Item column headers. LABOR comes from ELR%; PARTS is auto-filled
                  from the menu (adjustable); TOTAL = parts + labor, figured live. */}
              {(draft.items || []).length > 0 && (
                <div style={{ display: 'flex', gap: 8, padding: '0 2px 6px', color: '#64748b', fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.05em' }}>
                  <div style={{ flex: '1 1 auto' }}>Service</div>
                  <div style={{ flex: '0 0 56px' }}>Hrs</div>
                  <div style={{ flex: '0 0 62px' }}>ELR %</div>
                  <div style={{ flex: '0 0 76px', textAlign: 'right' }}>Labor $</div>
                  <div style={{ flex: '0 0 82px', textAlign: 'right' }}>Parts $</div>
                  <div style={{ flex: '0 0 84px', textAlign: 'right' }}>Total</div>
                  <div style={{ flex: '0 0 54px' }} />
                </div>
              )}

              {(draft.items || []).length === 0 ? (
                <div style={{ color: '#64748b', textAlign: 'center', padding: '30px 0', border: '1px dashed rgba(148,163,184,.25)', borderRadius: 12, fontSize: 13.5 }}>Click services on the left to add them here.</div>
              ) : (draft.items || []).map((it, idx) => {
                const m = itemMath(it, doorRate);
                return (
                  <div key={it.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 2px', borderBottom: '1px solid rgba(148,163,184,.1)' }}>
                    <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                      <div style={{ fontSize: 13.5, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                      {it.opCode && <div style={{ fontSize: 11, color: '#6ee7f9', fontWeight: 700 }}>{it.opCode}</div>}
                    </div>
                    <input value={it.laborHours} onChange={e => updateItem(it.id, 'laborHours', e.target.value)} inputMode="decimal" placeholder="0.0" style={{ ...editInp, flex: '0 0 56px', padding: '6px 8px', fontSize: 12.5, textAlign: 'right' }} />
                    <input value={it.elrPct} onChange={e => updateItem(it.id, 'elrPct', e.target.value)} inputMode="decimal" placeholder="100" style={{ ...editInp, flex: '0 0 62px', padding: '6px 8px', fontSize: 12.5, textAlign: 'right', color: elrColor(numOf(it.elrPct)), fontWeight: 800 }} />
                    <div style={{ flex: '0 0 76px', textAlign: 'right', fontSize: 12.5, color: '#cbd5e1', fontWeight: 700 }}>{money(m.laborCost)}</div>
                    <input value={it.parts != null && it.parts !== '' ? it.parts : String(round2(m.parts))} onChange={e => updateItem(it.id, 'parts', e.target.value)} inputMode="decimal" placeholder="0.00" title="Parts $ — auto-filled from the menu, adjust as needed"
                      style={{ ...editInp, flex: '0 0 82px', padding: '6px 8px', fontSize: 12.5, textAlign: 'right', color: '#e2e8f0', fontWeight: 700 }} />
                    <div title="Parts + Labor" style={{ flex: '0 0 84px', textAlign: 'right', fontSize: 13.5, color: '#6ee7b7', fontWeight: 900 }}>{money(m.total)}</div>
                    <div style={{ flex: '0 0 54px', display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                      <button title="Up" onClick={() => moveItem(it.id, -1)} disabled={idx === 0} style={{ ...iconBtn(idx === 0), width: 24, height: 28, fontSize: 11 }}>↑</button>
                      <button title="Remove" onClick={() => removeItem(it.id)} style={{ ...iconBtn(false), width: 24, height: 28, fontSize: 11, color: '#f87171' }}>✕</button>
                    </div>
                  </div>
                );
              })}

              {/* Package summary — auto-filled from the lines, all adjustable. */}
              <div style={{ marginTop: 16, padding: '14px 16px', background: 'rgba(167,139,250,.1)', border: '1px solid rgba(167,139,250,.3)', borderRadius: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ ...lbl, marginBottom: 0, color: '#c4b5fd' }}>Package Totals · adjustable</span>
                  <div style={{ flex: 1 }} />
                  {sum.overridden && <button onClick={resetTotals} style={{ background: 'transparent', border: '1px solid rgba(148,163,184,.3)', color: '#94a3b8', borderRadius: 7, padding: '3px 9px', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}>↻ Reset to line totals</button>}
                </div>
                <SummaryEdit label="Parts $" prefix="$" value={String(round2(sum.parts))} onChange={v => setDraft(d => ({ ...d, ovrParts: v }))} />
                <SummaryEdit label="Labor $" prefix="$" value={String(round2(sum.labor))} onChange={setLabor} />
                <SummaryEdit label="Labor hours" suffix="hrs" value={String(round2(sum.hours))} onChange={v => setDraft(d => ({ ...d, ovrHours: v }))} />
                <SummaryEdit label="ELR %" suffix="%" value={sum.elr == null ? '' : String(round2(sum.elr))} onChange={v => setDraft(d => ({ ...d, ovrElr: v }))} color={elrColor(sum.elr)} />
                <SummaryRow label="Subtotal" value={money(sum.subtotal)} strong />
                {/* Tax — adjustable rate (default 7%) and what it applies to. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid rgba(148,163,184,.14)' }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: '#cbd5e1' }}>Tax</span>
                  <input value={draft.taxRate} onChange={e => setDraft(d => ({ ...d, taxRate: e.target.value }))} inputMode="decimal" placeholder="7"
                    style={{ ...editInp, width: 58, padding: '5px 8px', fontSize: 12.5, textAlign: 'right', fontWeight: 800, color: '#fbbf24' }} />
                  <span style={{ fontSize: 12.5, color: '#94a3b8' }}>%</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>on</span>
                  <select value={draft.taxBase} onChange={e => setDraft(d => ({ ...d, taxBase: e.target.value }))}
                    style={{ ...editInp, width: 'auto', padding: '5px 8px', fontSize: 12.5, cursor: 'pointer' }}>
                    <option value="parts">Parts only</option>
                    <option value="subtotal">Parts + Labor</option>
                  </select>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 14, fontWeight: 800, color: '#cbd5e1' }}>{money(sum.taxAmt)}</span>
                </div>
                {/* Grand total */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 10, marginTop: 4, borderTop: '1px solid rgba(167,139,250,.3)' }}>
                  <span style={{ fontSize: 13, fontWeight: 900, color: '#c4b5fd', textTransform: 'uppercase', letterSpacing: '.05em' }}>Package Total</span>
                  <div style={{ flex: 1 }} />
                  <span style={{ fontSize: 24, fontWeight: 900, color: '#c4b5fd' }}>{money(sum.grand)}</span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
                {isSaved && <button onClick={() => doDelete(draft)} disabled={!!busy} style={{ background: 'rgba(248,113,113,.1)', border: '1px solid rgba(248,113,113,.35)', color: '#f87171', borderRadius: 10, padding: '10px 16px', cursor: 'pointer', fontWeight: 800, fontSize: 13 }}>🗑 Delete</button>}
                <div style={{ flex: 1 }} />
                <button onClick={() => doSave('draft')} disabled={!!busy} style={{ background: 'rgba(251,191,36,.14)', border: '1px solid rgba(251,191,36,.45)', color: '#fbbf24', borderRadius: 10, padding: '11px 20px', cursor: busy ? 'default' : 'pointer', fontWeight: 900, fontSize: 14 }}>{busy === 'draft' ? '⏳ Saving…' : '💾 Save Project'}</button>
                <button onClick={() => doSave('published')} disabled={!!busy} style={{ background: busy ? 'rgba(255,255,255,.06)' : 'linear-gradient(180deg,#a78bfa,#8b5cf6)', border: '1px solid rgba(167,139,250,.6)', color: busy ? '#64748b' : '#0b0716', borderRadius: 10, padding: '11px 24px', cursor: busy ? 'default' : 'pointer', fontWeight: 900, fontSize: 14 }}>{busy === 'publish' ? '⏳ Posting…' : (draft.status === 'published' ? '📤 Update Post' : '📤 Submit — Post to Menu')}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function elrColor(pct) {
  if (pct == null) return '#e2e8f0';
  return pct >= 100 ? '#4ade80' : pct >= 80 ? '#fbbf24' : '#fb7185';
}

function SummaryRow({ label, value, valueColor = '#cbd5e1', strong }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '6px 0' }}>
      <span style={{ fontSize: 13.5, fontWeight: strong ? 800 : 600, color: strong ? '#e2e8f0' : '#94a3b8' }}>{label}</span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 14, fontWeight: strong ? 900 : 700, color: valueColor }}>{value}</span>
    </div>
  );
}

// An editable package-total row: auto-filled value the user can override.
function SummaryEdit({ label, value, onChange, prefix, suffix, color = '#e2e8f0' }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '5px 0' }}>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: '#94a3b8' }}>{label}</span>
      <div style={{ flex: 1 }} />
      <span style={{ fontSize: 12.5, color: '#94a3b8', marginRight: 3, width: 10, textAlign: 'right' }}>{prefix || ''}</span>
      <input value={value} onChange={e => onChange(e.target.value)} inputMode="decimal"
        style={{ ...editInp, width: 92, padding: '5px 9px', fontSize: 13, textAlign: 'right', fontWeight: 800, color }} />
      <span style={{ fontSize: 12.5, color: '#94a3b8', marginLeft: 5, width: 26 }}>{suffix || ''}</span>
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { loadTirePromos, saveTirePromo, deleteTirePromo, reorderTirePromos } from '../utils/github';
import { uploadTirePromoToS3 } from '../utils/s3';

const TIRE_CENTER_URL = 'https://hyundaitirecenter.com/InitDealer?dealer=IN007';

// Managers and admins get the Manage tab. Same test the Service Pricing Menu
// uses, so "who may edit" stays one idea across the app.
const isEditor = role => role === 'admin' || (role || '').includes('manager');

// A promotion has to go somewhere. Anything without a scheme is treated as
// https:// so a manager can paste "goodyear.com/rebates" and have it work.
function normalizeUrl(raw) {
  const url = (raw || '').trim();
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `https://${url}`;
}

function openPromo(url) {
  const dest = normalizeUrl(url);
  if (dest) window.open(dest, '_blank', 'noopener,noreferrer');
}

export default function TireQuote({ currentUser, currentRole, onBack, backLabel }) {
  const canEdit = isEditor(currentRole);
  const [tab, setTab] = useState('pricing');   // pricing | promos | manage
  const [promos, setPromos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    loadTirePromos()
      .then(rows => { if (alive) setPromos(rows); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const TABS = [
    { key: 'pricing', label: '🛞 Tire Pricing' },
    { key: 'promos',  label: '🏷 Promotions' },
    canEdit && { key: 'manage', label: '⚙️ Manage Promotions' },
  ].filter(Boolean);

  return (
    <div className="adv-page">
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button className="secondary" onClick={onBack}>{backLabel || '← Back'}</button>
        <div style={{ flex: 1 }}>
          <div className="adv-title">Tire Quote</div>
          <div className="adv-sub">Pricing and current tire promotions</div>
        </div>
      </div>

      <div className="adv-advisor-tabs" style={{ justifyContent: 'center' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            className={`adv-advisor-tab${tab === t.key ? ' adv-advisor-tab--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px 48px' }}>
        {tab === 'pricing' && <PricingPanel />}
        {tab === 'promos'  && <PromoBoard promos={promos} loading={loading} canEdit={canEdit} onManage={() => setTab('manage')} />}
        {tab === 'manage'  && canEdit && (
          <ManagePanel
            promos={promos}
            currentUser={currentUser}
            onChange={setPromos}
          />
        )}
      </div>
    </div>
  );
}

/* ── Tire Pricing ─────────────────────────────────────────────────────────────
   The quote tool is someone else's site and it refuses to be framed, so this
   hands it off in a new tab rather than pretending to embed it. */
function PricingPanel() {
  return (
    <div style={{ maxWidth: 620, margin: '0 auto', textAlign: 'center' }}>
      <div style={{
        border: '1px solid rgba(74,222,128,.35)',
        background: 'linear-gradient(160deg,rgba(74,222,128,.14),rgba(34,197,94,.05))',
        borderRadius: 18, padding: '38px 28px',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,.06), 0 10px 30px rgba(2,6,23,.35)',
      }}>
        <div style={{ fontSize: 46, lineHeight: 1 }}>🛞</div>
        <div style={{ fontSize: 21, fontWeight: 900, color: '#e8f1ff', marginTop: 14 }}>Hyundai Tire Center</div>
        <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 8, lineHeight: 1.6 }}>
          Look up tire pricing and build a quote for a customer. Opens in a new tab,
          already set to our dealer code.
        </div>
        <button
          onClick={() => window.open(TIRE_CENTER_URL, '_blank', 'noopener,noreferrer')}
          style={{
            marginTop: 22, padding: '13px 30px', fontSize: 15, fontWeight: 800,
            background: 'linear-gradient(135deg,rgba(74,222,128,.32),rgba(34,197,94,.22))',
            border: '1px solid rgba(74,222,128,.55)', color: '#bbf7d0', borderRadius: 12,
          }}
        >
          Open Tire Pricing ↗
        </button>
      </div>
    </div>
  );
}

/* ── Promotions ────────────────────────────────────────────────────────────── */
function PromoBoard({ promos, loading, canEdit, onManage }) {
  if (loading) return <div style={{ textAlign: 'center', color: '#7a92b8' }}>Loading promotions…</div>;

  if (!promos.length) {
    return (
      <div style={{ textAlign: 'center', color: '#7a92b8', maxWidth: 460, margin: '40px auto 0', lineHeight: 1.7 }}>
        <div style={{ fontSize: 40 }}>🏷</div>
        <div style={{ marginTop: 10, fontSize: 15 }}>No tire promotions posted right now.</div>
        {canEdit && (
          <button className="secondary" onClick={onManage} style={{ marginTop: 16 }}>
            Post the first one
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(min(320px, 100%), 1fr))',
      gap: 22, maxWidth: 1180, margin: '0 auto',
    }}>
      {promos.map(p => (
        <button
          key={p.id}
          onClick={() => openPromo(p.linkUrl)}
          title={p.linkUrl ? `Opens ${normalizeUrl(p.linkUrl)}` : p.label}
          style={{
            padding: 0, border: '1px solid rgba(148,163,184,.2)', borderRadius: 16,
            background: 'rgba(255,255,255,.03)', overflow: 'hidden', textAlign: 'left',
            cursor: p.linkUrl ? 'pointer' : 'default',
            transition: 'transform .16s, border-color .16s, box-shadow .16s',
            display: 'block', width: '100%',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.transform = 'translateY(-3px)';
            e.currentTarget.style.borderColor = 'rgba(110,231,249,.5)';
            e.currentTarget.style.boxShadow = '0 12px 30px rgba(2,6,23,.45)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.transform = '';
            e.currentTarget.style.borderColor = 'rgba(148,163,184,.2)';
            e.currentTarget.style.boxShadow = '';
          }}
        >
          <img
            src={p.imageUrl}
            alt={p.label || 'Tire promotion'}
            style={{ width: '100%', display: 'block', background: 'rgba(2,6,23,.5)' }}
          />
          {p.label && (
            <div style={{ padding: '11px 14px', fontSize: 14, fontWeight: 800, color: '#e8f1ff' }}>
              {p.label}
              {p.linkUrl && <span style={{ color: '#6ee7f9', fontWeight: 700 }}> ↗</span>}
            </div>
          )}
        </button>
      ))}
    </div>
  );
}

/* ── Manage (managers / admins) ────────────────────────────────────────────── */
function ManagePanel({ promos, currentUser, onChange }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [label, setLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // Revoke the object URL when the picked file changes, or the preview leaks.
  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function pickFile(f) {
    setError('');
    if (!f) return;
    if (!f.type.startsWith('image/')) { setError('That is not an image. Use a .jpg, .png or .webp.'); return; }
    if (f.size > 8 * 1024 * 1024) { setError('That image is over 8 MB — please shrink it first.'); return; }
    setFile(f);
  }

  async function post() {
    if (!file) { setError('Pick a promotion image first.'); return; }
    if (!linkUrl.trim()) { setError('Add the web address the picture should open.'); return; }
    setError('');
    setBusy('Uploading image…');
    try {
      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const safeName = `${id}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const imageUrl = await uploadTirePromoToS3(safeName, file);
      setBusy('Posting…');
      const promo = {
        id,
        label: label.trim(),
        linkUrl: normalizeUrl(linkUrl),
        imageUrl,
        postedBy: currentUser || '',
        postedAt: new Date().toISOString(),
      };
      await saveTirePromo(promo);
      onChange([...promos, promo]);
      setFile(null); setLabel(''); setLinkUrl('');
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  }

  async function remove(promo) {
    if (!window.confirm(`Remove "${promo.label || 'this promotion'}"? It comes off the board for everyone.`)) return;
    setBusy('Removing…');
    setError('');
    try {
      await deleteTirePromo(promo);
      onChange(promos.filter(p => p.id !== promo.id));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy('');
    }
  }

  async function move(index, delta) {
    const next = promos.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
    try {
      await reorderTirePromos(next.map(p => p.id));
    } catch (err) {
      setError('Order not saved: ' + (err.message || err));
    }
  }

  const inputStyle = {
    width: '100%', background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.25)',
    borderRadius: 10, padding: '10px 12px', color: '#e8f1ff', fontSize: 14, fontWeight: 600,
    fontFamily: 'inherit', outline: 'none',
  };

  return (
    <div style={{ maxWidth: 780, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 26 }}>

      {/* Add */}
      <div style={{
        border: '1px solid rgba(110,231,249,.25)', borderRadius: 16, padding: '20px 22px',
        background: 'linear-gradient(180deg,rgba(110,231,249,.07),rgba(110,231,249,.02))',
      }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: '#bfdbfe', marginBottom: 4 }}>Post a promotion</div>
        <div style={{ fontSize: 12.5, color: '#8296b4', marginBottom: 16, lineHeight: 1.6 }}>
          Pick the picture, then paste the web address it should open when someone taps it.
          Everyone with Tire Quote access sees it as soon as you post.
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em', color: '#7f93b0', textTransform: 'uppercase' }}>Promotion picture</label>
            <input className="promo-file" type="file" accept="image/*"
              onChange={e => pickFile(e.target.files && e.target.files[0])}
              style={{ display: 'block', marginTop: 8 }} />
          </div>

          {preview && (
            <img src={preview} alt="Promotion preview"
              style={{ maxWidth: '100%', maxHeight: 260, borderRadius: 12, border: '1px solid rgba(148,163,184,.25)' }} />
          )}

          <div>
            <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em', color: '#7f93b0', textTransform: 'uppercase' }}>Link (opens when clicked)</label>
            <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="hyundaitirecenter.com/promotions"
              style={{ ...inputStyle, marginTop: 6 }} />
          </div>

          <div>
            <label style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em', color: '#7f93b0', textTransform: 'uppercase' }}>Caption <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>(optional)</span></label>
            <input value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. Buy 3 get 1 free — through October"
              style={{ ...inputStyle, marginTop: 6 }} />
          </div>

          {error && <div style={{ fontSize: 13, color: '#fca5a5', fontWeight: 700 }}>⚠ {error}</div>}

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={post} disabled={!!busy}
              style={{
                background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.45)',
                color: '#93c5fd', borderRadius: 10, padding: '10px 22px', fontWeight: 800, fontSize: 14,
              }}>
              {busy || 'Post Promotion'}
            </button>
          </div>
        </div>
      </div>

      {/* Existing */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.14em', color: '#8fa7c8', marginBottom: 12 }}>
          Posted promotions ({promos.length})
        </div>
        {!promos.length && <div style={{ color: '#7a92b8', fontSize: 14 }}>Nothing posted yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {promos.map((p, i) => (
            <div key={p.id} style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: 12, flexWrap: 'wrap',
              border: '1px solid rgba(148,163,184,.18)', borderRadius: 14, background: 'rgba(255,255,255,.03)',
            }}>
              <img src={p.imageUrl} alt="" style={{ width: 108, height: 68, objectFit: 'cover', borderRadius: 9, flexShrink: 0, background: 'rgba(2,6,23,.5)' }} />
              <div style={{ flex: 1, minWidth: 170 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#e8f1ff' }}>{p.label || <span style={{ color: '#64748b' }}>No caption</span>}</div>
                <a href={normalizeUrl(p.linkUrl)} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 12, color: '#6ee7f9', wordBreak: 'break-all' }}>{p.linkUrl}</a>
                <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                  {p.postedBy ? `Posted by ${p.postedBy}` : 'Posted'}{p.postedAt ? ` · ${new Date(p.postedAt).toLocaleDateString()}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button className="secondary" onClick={() => move(i, -1)} disabled={i === 0} title="Move up">↑</button>
                <button className="secondary" onClick={() => move(i, 1)} disabled={i === promos.length - 1} title="Move down">↓</button>
                <button className="secondary" onClick={() => remove(p)} disabled={!!busy}
                  style={{ color: '#fca5a5', borderColor: 'rgba(248,113,113,.35)' }}>Remove</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

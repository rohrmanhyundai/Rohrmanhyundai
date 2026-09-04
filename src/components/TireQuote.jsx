import React, { useState, useEffect } from 'react';
import { loadTirePromos, saveTirePromo, deleteTirePromo, reorderTirePromos } from '../utils/github';
import { uploadTirePromoToS3, deleteS3ObjectByUrl } from '../utils/s3';

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

// Expiry is a plain YYYY-MM-DD, compared as text against today's local date.
// Storing a timestamp instead would make a promo set to "the 30th" vanish on the
// evening of the 29th for anyone in a westward timezone.
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// A promotion runs THROUGH its expiry date — one set to the 30th is still on the
// board all day on the 30th and gone on the 1st. No date means it runs until a
// manager takes it down.
function isExpired(promo, today = todayStr()) {
  return !!promo.expiresOn && promo.expiresOn < today;
}

function prettyDate(ymd) {
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-').map(Number);
  if (!y || !m || !d) return ymd;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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

  // Promotions sit on the Tire Pricing page under the tire-center card, not
  // behind a tab of their own — nobody goes looking for a promotion, so it has
  // to be on the page they already opened.
  const TABS = [
    { key: 'pricing', label: '🛞 Tire Pricing' },
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

      {TABS.length > 1 && (
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
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '28px 24px 48px' }}>
        {tab === 'pricing' && (
          <>
            <PricingPanel />
            <PromoBoard promos={promos} loading={loading} canEdit={canEdit} onManage={() => setTab('manage')} />
          </>
        )}
        {tab === 'manage' && canEdit && (
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
function PromoBoard({ promos: allPromos, loading, canEdit, onManage }) {
  // Expired promotions come off the board on their own — no one has to remember
  // to pull last month's sale down. They stay in Manage so a manager can extend
  // or delete them.
  const promos = allPromos.filter(p => !isExpired(p));

  if (loading) return null;

  // Nothing running: say so only to the people who can do something about it,
  // rather than parking an empty state under the pricing card for everyone.
  if (!promos.length) {
    if (!canEdit) return null;
    return (
      <div style={{ textAlign: 'center', color: '#7a92b8', maxWidth: 460, margin: '34px auto 0', lineHeight: 1.7 }}>
        <div style={{ fontSize: 13.5 }}>
          {allPromos.length
            ? 'Every posted promotion has passed its end date.'
            : 'No tire promotions posted right now.'}
        </div>
        <button className="secondary" onClick={onManage} style={{ marginTop: 12 }}>
          {allPromos.length ? 'Manage promotions' : 'Post the first one'}
        </button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1180, margin: '38px auto 0' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18,
        fontSize: 11.5, fontWeight: 800, letterSpacing: '.16em', textTransform: 'uppercase', color: '#8fa7c8',
      }}>
        <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,transparent,rgba(148,163,184,.28))' }} />
        Current Promotions
        <span style={{ flex: 1, height: 1, background: 'linear-gradient(90deg,rgba(148,163,184,.28),transparent)' }} />
      </div>
      {/* Capped, centred tracks — a lone promotion sits under the card rather
          than stranded in the left column of a full-width grid. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(320px, 100%), 380px))',
        justifyContent: 'center',
        gap: 22,
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
    </div>
  );
}

/* ── Manage (managers / admins) ────────────────────────────────────────────── */
function ManagePanel({ promos, currentUser, onChange }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [label, setLabel] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [expiresOn, setExpiresOn] = useState('');
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
    if (expiresOn && expiresOn < todayStr()) { setError('That end date has already passed — the promotion would never show.'); return; }
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
        expiresOn: expiresOn || '',
        postedBy: currentUser || '',
        postedAt: new Date().toISOString(),
      };
      await saveTirePromo(promo);
      onChange([...promos, promo]);
      setFile(null); setLabel(''); setLinkUrl(''); setExpiresOn('');
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

  // Editing writes the whole promotion back through the same upsert a post
  // uses. A replaced picture is uploaded first and the old S3 object dropped
  // only after the index write lands, so a failure never leaves the promo
  // pointing at an image that no longer exists.
  async function saveEdits(promo, fields) {
    setError('');
    setBusy(fields.file ? 'Uploading new picture…' : 'Saving…');
    try {
      let imageUrl = promo.imageUrl;
      if (fields.file) {
        const safeName = `${promo.id}-${Date.now().toString(36)}-${fields.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
        imageUrl = await uploadTirePromoToS3(safeName, fields.file);
        setBusy('Saving…');
      }
      const updated = {
        ...promo,
        label: (fields.label || '').trim(),
        linkUrl: normalizeUrl(fields.linkUrl),
        expiresOn: fields.expiresOn || '',
        imageUrl,
        editedBy: currentUser || '',
        editedAt: new Date().toISOString(),
      };
      await saveTirePromo(updated);
      onChange(promos.map(x => (x.id === promo.id ? updated : x)));
      if (fields.file && promo.imageUrl && promo.imageUrl !== imageUrl) {
        try { await deleteS3ObjectByUrl(promo.imageUrl); } catch { /* orphan is harmless */ }
      }
      return true;
    } catch (err) {
      setError(err.message || String(err));
      return false;
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

  const expiredCount = promos.filter(p => isExpired(p)).length;

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
            <label style={{ display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em', color: '#7f93b0', textTransform: 'uppercase' }}>
              Runs through <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>(optional end date)</span>
            </label>
            <input type="date" value={expiresOn} min={todayStr()} onChange={e => setExpiresOn(e.target.value)}
              style={{ ...inputStyle, marginTop: 6, maxWidth: 220 }} />
            <div style={{ fontSize: 11.5, color: '#8296b4', marginTop: 5 }}>
              {expiresOn
                ? `Shows through ${prettyDate(expiresOn)}, then comes off the board on its own.`
                : 'Leave blank and it stays up until you remove it.'}
            </div>
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
          Posted promotions ({promos.filter(p => !isExpired(p)).length} live{expiredCount ? ` · ${expiredCount} expired` : ''})
        </div>
        {!promos.length && <div style={{ color: '#7a92b8', fontSize: 14 }}>Nothing posted yet.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {promos.map((p, i) => (
            <PromoRow
              key={p.id}
              promo={p}
              isFirst={i === 0}
              isLast={i === promos.length - 1}
              busy={busy}
              inputStyle={inputStyle}
              onMoveUp={() => move(i, -1)}
              onMoveDown={() => move(i, 1)}
              onSave={fields => saveEdits(p, fields)}
              onRemove={() => remove(p)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* One posted promotion: a summary row that flips into an edit form in place, so
   fixing a typo or swapping the picture never means deleting and re-posting. */
function PromoRow({ promo, isFirst, isLast, busy, inputStyle, onMoveUp, onMoveDown, onSave, onRemove }) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(promo.label || '');
  const [linkUrl, setLinkUrl] = useState(promo.linkUrl || '');
  const [expiresOn, setExpiresOn] = useState(promo.expiresOn || '');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [rowError, setRowError] = useState('');

  useEffect(() => {
    if (!file) { setPreview(''); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const expired = isExpired(promo);

  function open() {
    // Always start from what is actually stored, not from a half-finished edit
    // someone cancelled earlier.
    setLabel(promo.label || '');
    setLinkUrl(promo.linkUrl || '');
    setExpiresOn(promo.expiresOn || '');
    setFile(null);
    setRowError('');
    setEditing(true);
  }

  function pickFile(f) {
    setRowError('');
    if (!f) return;
    if (!f.type.startsWith('image/')) { setRowError('That is not an image. Use a .jpg, .png or .webp.'); return; }
    if (f.size > 8 * 1024 * 1024) { setRowError('That image is over 8 MB — please shrink it first.'); return; }
    setFile(f);
  }

  async function save() {
    if (!linkUrl.trim()) { setRowError('A promotion needs a web address to open.'); return; }
    const ok = await onSave({ label, linkUrl, expiresOn, file });
    if (ok) { setFile(null); setEditing(false); }
  }

  const shell = {
    padding: 12, borderRadius: 14, flexWrap: 'wrap',
    border: `1px solid ${expired ? 'rgba(248,113,113,.3)' : 'rgba(148,163,184,.18)'}`,
    background: expired ? 'rgba(248,113,113,.06)' : 'rgba(255,255,255,.03)',
  };

  if (editing) {
    return (
      <div style={{ ...shell, borderColor: 'rgba(110,231,249,.4)', background: 'rgba(110,231,249,.05)' }}>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          <img src={preview || promo.imageUrl} alt=""
            style={{ width: 150, height: 94, objectFit: 'cover', borderRadius: 9, background: 'rgba(2,6,23,.5)' }} />
          <div style={{ flex: 1, minWidth: 230, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={labelStyle}>Caption</label>
              <input value={label} onChange={e => setLabel(e.target.value)} placeholder="No caption"
                style={{ ...inputStyle, marginTop: 5 }} />
            </div>
            <div>
              <label style={labelStyle}>Link</label>
              <input value={linkUrl} onChange={e => setLinkUrl(e.target.value)}
                style={{ ...inputStyle, marginTop: 5 }} />
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label style={labelStyle}>Runs through</label>
                <input type="date" value={expiresOn} onChange={e => setExpiresOn(e.target.value)}
                  style={{ ...inputStyle, marginTop: 5, width: 168 }} />
              </div>
              {expiresOn && (
                <button className="secondary" onClick={() => setExpiresOn('')} style={{ fontSize: 11.5 }}
                  title="Runs until someone removes it">Clear end date</button>
              )}
            </div>
            <div>
              <label style={labelStyle}>Replace picture <span style={{ fontWeight: 600, letterSpacing: 0, textTransform: 'none' }}>(optional)</span></label>
              <input className="promo-file" type="file" accept="image/*"
                onChange={e => pickFile(e.target.files && e.target.files[0])}
                style={{ display: 'block', marginTop: 7 }} />
              {file && <div style={{ fontSize: 11.5, color: '#6ee7b7', marginTop: 5 }}>New picture ready — Save to swap it in.</div>}
            </div>
            {rowError && <div style={{ fontSize: 12.5, color: '#fca5a5', fontWeight: 700 }}>⚠ {rowError}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={save} disabled={!!busy}
                style={{ background: 'rgba(96,165,250,.2)', border: '1px solid rgba(96,165,250,.45)', color: '#93c5fd', padding: '8px 18px' }}>
                {busy || 'Save Changes'}
              </button>
              <button className="secondary" onClick={() => { setEditing(false); setFile(null); }} disabled={!!busy}>Cancel</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ ...shell, display: 'flex', alignItems: 'center', gap: 14 }}>
      <img src={promo.imageUrl} alt=""
        style={{ width: 108, height: 68, objectFit: 'cover', borderRadius: 9, flexShrink: 0, background: 'rgba(2,6,23,.5)', opacity: expired ? .5 : 1 }} />
      <div style={{ flex: 1, minWidth: 170 }}>
        <div style={{ fontWeight: 800, fontSize: 14, color: '#e8f1ff', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {promo.label || <span style={{ color: '#64748b' }}>No caption</span>}
          {expired && (
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: '.08em', color: '#fca5a5', background: 'rgba(248,113,113,.14)', border: '1px solid rgba(248,113,113,.4)', borderRadius: 6, padding: '2px 7px' }}>
              EXPIRED — OFF THE BOARD
            </span>
          )}
        </div>
        <a href={normalizeUrl(promo.linkUrl)} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 12, color: '#6ee7f9', wordBreak: 'break-all' }}>{promo.linkUrl}</a>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
          {promo.postedBy ? `Posted by ${promo.postedBy}` : 'Posted'}{promo.postedAt ? ` · ${new Date(promo.postedAt).toLocaleDateString()}` : ''}
          {promo.editedBy ? ` · edited by ${promo.editedBy}` : ''}
        </div>
        <div style={{ fontSize: 11.5, marginTop: 4, color: expired ? '#fca5a5' : '#8296b4' }}>
          {promo.expiresOn
            ? `${expired ? 'Ended' : 'Runs through'} ${prettyDate(promo.expiresOn)}`
            : 'No end date'}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button className="secondary" onClick={onMoveUp} disabled={isFirst} title="Move up">↑</button>
        <button className="secondary" onClick={onMoveDown} disabled={isLast} title="Move down">↓</button>
        <button className="secondary" onClick={open} disabled={!!busy}
          style={{ color: '#93c5fd', borderColor: 'rgba(96,165,250,.4)' }}>Edit</button>
        <button className="secondary" onClick={onRemove} disabled={!!busy}
          style={{ color: '#fca5a5', borderColor: 'rgba(248,113,113,.35)' }}>Remove</button>
      </div>
    </div>
  );
}

const labelStyle = {
  display: 'block', fontSize: 10.5, fontWeight: 800, letterSpacing: '.11em',
  color: '#7f93b0', textTransform: 'uppercase',
};

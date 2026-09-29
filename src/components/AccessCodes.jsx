import React, { useMemo, useState } from 'react';
import { saveGithubFile } from '../utils/github';
import { hasAccessCode } from '../utils/accessCode';
import { ACCESS_PATH, DEFAULT_LOCKED, PAGE_GROUPS, PAGE_LABEL } from './AccessGate';

// ── Access Codes screen ───────────────────────────────────────────────────────
// Opened from Edit Dashboard → Users (the 🔐 button by Access Code). Two tabs:
//   Locked pages — every page in the app; click one to put it behind the code.
//   Users        — pick a user, tick which locked pages they may open.
// Admins edit; managers can look. See AccessGate.jsx for how it's enforced.

const up = (s) => String(s || '').trim().toUpperCase();

// Never saved → Payroll + Applicants start locked and NOBODY is given access
// yet: the admin grants each user by hand. Codes already set on users are
// untouched (they live on the user records, not in this file).
function initialDraft(cfg) {
  if (cfg) return { locked: { ...(cfg.locked || {}) }, users: JSON.parse(JSON.stringify(cfg.users || {})) };
  return { locked: { ...DEFAULT_LOCKED }, users: {} };
}

export default function AccessCodes({ users = [], cfg, currentUser, currentRole, onSaved, onBack }) {
  const isAdmin = currentRole === 'admin';
  const [draft, setDraft] = useState(() => initialDraft(cfg));
  const [tab, setTab] = useState('pages');
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dirty, setDirty] = useState(!cfg);

  const people = useMemo(() => (users || [])
    .filter(u => u && u.username && !u.disabled)
    .map(u => ({ key: up(u.username), name: u.username, role: u.role || '', hasCode: hasAccessCode(u) }))
    .sort((a, b) => a.key.localeCompare(b.key)), [users]);
  const lockedPages = PAGE_GROUPS.flatMap(g => g.pages).filter(([k]) => draft.locked[k]);
  const grantCount = (page) => people.filter(p => draft.users[p.key] && draft.users[p.key][page]).length;
  const userCount = (key) => lockedPages.filter(([k]) => draft.users[key] && draft.users[key][k]).length;

  const change = (fn) => { if (!isAdmin) return; setDraft(d => fn(JSON.parse(JSON.stringify(d)))); setDirty(true); setMsg(''); };
  const toggleLock = (page) => change(d => { if (d.locked[page]) delete d.locked[page]; else d.locked[page] = true; return d; });
  const toggleGrant = (user, page) => change(d => {
    const g = d.users[user] || (d.users[user] = {});
    if (g[page]) delete g[page]; else g[page] = true;
    return d;
  });
  const setAllGrants = (user, on) => change(d => {
    d.users[user] = on ? Object.fromEntries(lockedPages.map(([k]) => [k, true])) : {};
    return d;
  });

  async function save() {
    setBusy(true); setMsg('');
    try {
      const next = { updatedAt: new Date().toISOString(), by: up(currentUser), locked: draft.locked, users: draft.users };
      await saveGithubFile(ACCESS_PATH, next, `Access codes (${up(currentUser)})`);
      onSaved(next); setDirty(false);
      setMsg('✓ Saved — takes effect on each person\'s next page load');
    } catch (e) { setMsg('⚠️ ' + (e.message || 'Save failed')); }
    finally { setBusy(false); }
  }

  const tabBtn = (key, label) => (
    <button onClick={() => setTab(key)} className={tab === key ? '' : 'secondary'}
      style={tab === key ? { background: 'linear-gradient(180deg,rgba(110,231,249,.35),rgba(56,189,248,.2))', borderColor: 'rgba(110,231,249,.7)', fontWeight: 900 } : undefined}>{label}</button>
  );
  const selPerson = people.find(p => p.key === sel);

  return (
    <div className="adv-page" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="adv-topbar" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div className="adv-title">🔐 Access Codes</div>
          <div className="adv-sub">{isAdmin ? 'Choose which pages need a code, and who may open them' : 'View only — an admin makes changes here'}</div>
        </div>
        <div style={{ flex: 1 }} />
        {tabBtn('pages', `🔒 Locked pages (${lockedPages.length})`)}
        {tabBtn('users', `👤 Users (${people.length})`)}
        {isAdmin && (
          <button onClick={save} disabled={busy || !dirty}
            style={{ background: dirty ? 'linear-gradient(180deg,rgba(52,211,153,.4),rgba(16,185,129,.25))' : undefined, borderColor: 'rgba(52,211,153,.6)', fontWeight: 900 }}>
            {busy ? '⏳ Saving…' : dirty ? '💾 Save' : '✓ Saved'}
          </button>
        )}
        <button className="secondary" onClick={onBack}>← Back</button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '22px 32px' }}>
        <div style={{ maxWidth: 1100, margin: '0 auto' }}>
          {!cfg && (
            <div style={{ marginBottom: 14, padding: '10px 14px', borderRadius: 10, background: 'rgba(250,204,21,.1)', border: '1px solid rgba(250,204,21,.4)', color: '#fde68a', fontSize: 13, lineHeight: 1.5 }}>
              Not set up yet — right now Payroll and Employee Applicants are open to anyone with a code. Nobody is given access below yet:
              pick each user on the Users tab and tick what they can open. Existing codes stay as they are. Nothing changes until you press Save.
            </div>
          )}
          {msg && <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 800, color: msg.startsWith('⚠') ? '#fca5a5' : '#4ade80' }}>{msg}</div>}

          {tab === 'pages' ? (
            <>
              <div style={{ fontSize: 13, color: '#94a3b8', marginBottom: 14, lineHeight: 1.5 }}>
                Click a page to lock it. A locked page asks for the user's 4-digit code, and only users given it on the Users tab can open it (admins always can).
              </div>
              {PAGE_GROUPS.map(g => (
                <div key={g.group} style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 900, letterSpacing: '.12em', textTransform: 'uppercase', color: '#7dd3fc', marginBottom: 8 }}>{g.group}</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
                    {g.pages.map(([k, label]) => {
                      const on = !!draft.locked[k];
                      return (
                        <button key={k} onClick={() => toggleLock(k)} disabled={!isAdmin}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '10px 12px', borderRadius: 11,
                            cursor: isAdmin ? 'pointer' : 'default', fontFamily: 'inherit',
                            background: on ? 'linear-gradient(135deg,rgba(248,113,113,.22),rgba(239,68,68,.1))' : 'rgba(255,255,255,.035)',
                            border: `1px solid ${on ? 'rgba(248,113,113,.6)' : 'rgba(148,163,184,.2)'}`, color: '#e2e8f0',
                          }}>
                          <span style={{ fontSize: 18 }}>{on ? '🔒' : '🔓'}</span>
                          <span style={{ flex: 1 }}>
                            <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800 }}>{label}</span>
                            <span style={{ display: 'block', fontSize: 11, color: on ? '#fca5a5' : '#64748b', fontWeight: 700, marginTop: 1 }}>
                              {on ? `Locked · ${grantCount(k)} user${grantCount(k) === 1 ? '' : 's'} can open` : 'Open — no code'}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 18, alignItems: 'start' }}>
              <div style={{ display: 'grid', gap: 6 }}>
                {people.map(p => (
                  <button key={p.key} onClick={() => setSel(p.key)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '9px 12px', borderRadius: 10, fontFamily: 'inherit', cursor: 'pointer',
                      background: sel === p.key ? 'rgba(110,231,249,.16)' : 'rgba(255,255,255,.035)',
                      border: `1px solid ${sel === p.key ? 'rgba(110,231,249,.65)' : 'rgba(148,163,184,.18)'}`, color: '#e2e8f0',
                    }}>
                    <span style={{ flex: 1 }}>
                      <span style={{ display: 'block', fontSize: 13.5, fontWeight: 800 }}>{p.name}</span>
                      <span style={{ display: 'block', fontSize: 11, color: '#64748b', textTransform: 'capitalize' }}>{p.role}</span>
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 800, color: p.hasCode ? '#6ee7b7' : '#fbbf24', whiteSpace: 'nowrap' }}>
                      {p.hasCode ? `🔑 ${userCount(p.key)}/${lockedPages.length}` : '⚠ no code'}
                    </span>
                  </button>
                ))}
              </div>
              <div style={{ border: '1px solid rgba(148,163,184,.2)', borderRadius: 14, padding: '16px 18px', background: 'rgba(255,255,255,.03)', minHeight: 200 }}>
                {!selPerson ? (
                  <div style={{ color: '#94a3b8', fontSize: 13.5 }}>← Pick a user to choose which locked pages they can open.</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                      <div style={{ fontSize: 18, fontWeight: 900, color: '#f1f5f9' }}>{selPerson.name}</div>
                      <span style={{ fontSize: 12, color: '#94a3b8', textTransform: 'capitalize' }}>{selPerson.role}</span>
                      <div style={{ flex: 1 }} />
                      {isAdmin && lockedPages.length > 0 && <>
                        <button className="secondary" onClick={() => setAllGrants(selPerson.key, true)}>Give all</button>
                        <button className="secondary" onClick={() => setAllGrants(selPerson.key, false)}>Clear</button>
                      </>}
                    </div>
                    <div style={{ fontSize: 12.5, marginBottom: 12, color: selPerson.hasCode ? '#6ee7b7' : '#fbbf24', fontWeight: 700 }}>
                      {selPerson.hasCode ? '🔑 Access code is set.' : '⚠ No access code yet — they can\'t open any locked page until one is set in Edit Dashboard → Users → Access Code.'}
                      {selPerson.role === 'admin' && <span style={{ color: '#94a3b8' }}> Admins can open every locked page with their code.</span>}
                    </div>
                    {lockedPages.length === 0 ? (
                      <div style={{ color: '#94a3b8', fontSize: 13.5 }}>No pages are locked. Lock some on the Locked pages tab first.</div>
                    ) : (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 7 }}>
                        {lockedPages.map(([k, label]) => {
                          const on = !!(draft.users[selPerson.key] && draft.users[selPerson.key][k]);
                          return (
                            <label key={k} style={{
                              display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 10, cursor: isAdmin ? 'pointer' : 'default',
                              background: on ? 'rgba(52,211,153,.14)' : 'rgba(255,255,255,.03)', border: `1px solid ${on ? 'rgba(52,211,153,.55)' : 'rgba(148,163,184,.18)'}`,
                            }}>
                              <input type="checkbox" checked={on} disabled={!isAdmin} onChange={() => toggleGrant(selPerson.key, k)} style={{ width: 17, height: 17, accentColor: '#34d399' }} />
                              <span style={{ fontSize: 13.5, fontWeight: 700, color: on ? '#d1fae5' : '#cbd5e1' }}>{PAGE_LABEL[k] || label}</span>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

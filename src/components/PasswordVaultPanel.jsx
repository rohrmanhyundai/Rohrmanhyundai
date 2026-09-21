import React, { useState, useEffect } from 'react';
import { loadUsers, savePasswordVault } from '../utils/github';
import { createVault, unlockVault, decryptWithVault, rewrapVault, vaultReady, inVault } from '../utils/passwordVault';
import { hashLegacyPasswords, isHashed } from '../utils/password';
import { trackAction } from '../utils/activityTracker';

// Admin-only panel in Edit Dashboard → Users. Sets up the password vault
// (passphrase → keypair), unlocks it for this session, and reveals any user's
// password that has a vault copy. See utils/passwordVault.js for the model.

const box = { background: 'rgba(139,92,246,.08)', border: '1px solid rgba(167,139,250,.35)', borderRadius: 12, padding: '12px 14px', marginBottom: 12 };
const inputStyle = { background: 'rgba(2,6,23,.55)', border: '1px solid rgba(148,163,184,.35)', borderRadius: 8, padding: '7px 10px', fontSize: 13, color: '#e2e8f0', outline: 'none', width: 220 };

export default function PasswordVaultPanel({ users, onUsersChange, currentUser }) {
  const [vault, setVault] = useState(undefined);   // undefined = loading, null = none
  const [privKey, setPrivKey] = useState(null);    // unlocked private key (this session only)
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [oldPass, setOldPass] = useState('');
  const [mode, setMode] = useState('');            // '' | 'setup' | 'change'
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [revealed, setRevealed] = useState({});    // { username: password }

  const reload = async () => { try { const l = await loadUsers(); setVault(l && l.passwordVault ? l.passwordVault : null); } catch { setVault(null); } };
  useEffect(() => { reload(); }, []);

  const ready = vaultReady(vault);
  const inCount = ready ? users.filter(u => inVault(u, vault)).length : 0;
  const plainCount = users.filter(u => !isHashed(u) && u.password != null && u.password !== '').length;

  async function setup() {
    if (pass !== pass2) { setMsg('❌ The two passphrases don\'t match.'); return; }
    setBusy('setup'); setMsg('');
    try {
      const v = await createVault(pass, currentUser);
      // Anything still in plain text gets hashed AND put in the vault right now.
      const [list, changed] = await hashLegacyPasswords(users, v);
      await savePasswordVault(v, list);
      onUsersChange(list);
      setVault(v); setPrivKey(await unlockVault(v, pass));
      setPass(''); setPass2(''); setMode('');
      setMsg(`✅ Vault created. ${changed} password${changed === 1 ? '' : 's'} put in the vault now; everyone else's goes in the next time they log in or a password is set.`);
      trackAction('password-vault-created');
    } catch (e) { setMsg('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  async function unlock() {
    setBusy('unlock'); setMsg('');
    try { setPrivKey(await unlockVault(vault, pass)); setPass(''); setMsg('🔓 Vault unlocked for this session.'); trackAction('password-vault-unlock'); }
    catch (e) { setMsg('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  async function changePass() {
    if (pass !== pass2) { setMsg('❌ The two new passphrases don\'t match.'); return; }
    setBusy('change'); setMsg('');
    try {
      const v = await rewrapVault(vault, oldPass, pass);
      await savePasswordVault(v);
      setVault(v); setPrivKey(await unlockVault(v, pass));
      setOldPass(''); setPass(''); setPass2(''); setMode('');
      setMsg('✅ Vault passphrase changed.');
      trackAction('password-vault-rewrap');
    } catch (e) { setMsg('❌ ' + (e?.message || e)); }
    finally { setBusy(''); }
  }

  async function reveal(u) {
    if (!privKey) return;
    const pw = await decryptWithVault(privKey, u.passwordEnc);
    setRevealed(r => ({ ...r, [u.username]: pw == null ? '(could not decrypt)' : pw }));
    trackAction('password-reveal', u.username);
  }

  if (vault === undefined) return <div style={box}><span style={{ fontSize: 12, color: '#94a3b8' }}>⏳ Checking the password vault…</span></div>;

  return (
    <div style={box}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: '#e9d5ff' }}>🔐 Password vault</div>
        <div style={{ fontSize: 11.5, color: '#a78bfa' }}>
          {!ready ? 'Not set up — admins can\'t see passwords until it is.'
            : privKey ? `Unlocked · ${inCount} of ${users.length} passwords in the vault`
            : `Locked · ${inCount} of ${users.length} passwords in the vault`}
        </div>
        <div style={{ flex: 1 }} />
        {ready && privKey && <button className="secondary" onClick={() => { setPrivKey(null); setRevealed({}); setMsg('🔒 Vault locked.'); }} style={{ fontSize: 11.5 }}>🔒 Lock</button>}
        {ready && privKey && <button className="secondary" onClick={() => { setMode(mode === 'change' ? '' : 'change'); setMsg(''); }} style={{ fontSize: 11.5 }}>Change passphrase</button>}
      </div>

      {!ready && mode !== 'setup' && (
        <div style={{ marginTop: 8, fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
          Every password stays hashed for login, and is <b>also</b> stored encrypted so an admin can look it up. Only someone with the vault passphrase can read them — the file itself is public.
          {plainCount > 0 && <> The {plainCount} password{plainCount === 1 ? '' : 's'} still in plain text go straight in when you set this up.</>}
          <div style={{ marginTop: 8 }}><button onClick={() => { setMode('setup'); setMsg(''); }} style={{ fontSize: 12.5 }}>🔐 Set up the vault</button></div>
        </div>
      )}

      {mode === 'setup' && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="password" autoComplete="new-password" placeholder="Vault passphrase (6+ characters)" value={pass} onChange={e => setPass(e.target.value)} style={inputStyle} />
          <input type="password" autoComplete="new-password" placeholder="Repeat passphrase" value={pass2} onChange={e => setPass2(e.target.value)} onKeyDown={e => e.key === 'Enter' && setup()} style={inputStyle} />
          <button onClick={setup} disabled={!!busy || !pass} style={{ fontSize: 12.5 }}>{busy === 'setup' ? '⏳ Creating…' : 'Create vault'}</button>
          <button className="secondary" onClick={() => { setMode(''); setPass(''); setPass2(''); }} style={{ fontSize: 12 }}>Cancel</button>
          <div style={{ width: '100%', fontSize: 11.5, color: '#fbbf24', lineHeight: 1.5 }}>⚠️ Write this passphrase down somewhere safe. It is never stored — if it's lost, the vault can't be opened and you'd start a new one (passwords refill as people log in).</div>
        </div>
      )}

      {ready && !privKey && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="password" autoComplete="off" placeholder="Vault passphrase" value={pass} onChange={e => setPass(e.target.value)} onKeyDown={e => e.key === 'Enter' && unlock()} style={inputStyle} />
          <button onClick={unlock} disabled={!!busy || !pass} style={{ fontSize: 12.5 }}>{busy === 'unlock' ? '⏳' : '🔓 Unlock'}</button>
          <span style={{ fontSize: 11.5, color: '#94a3b8' }}>Unlock to reveal passwords. Locks again when you leave.</span>
        </div>
      )}

      {mode === 'change' && privKey && (
        <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="password" autoComplete="off" placeholder="Current passphrase" value={oldPass} onChange={e => setOldPass(e.target.value)} style={inputStyle} />
          <input type="password" autoComplete="new-password" placeholder="New passphrase" value={pass} onChange={e => setPass(e.target.value)} style={inputStyle} />
          <input type="password" autoComplete="new-password" placeholder="Repeat new" value={pass2} onChange={e => setPass2(e.target.value)} style={inputStyle} />
          <button onClick={changePass} disabled={!!busy || !oldPass || !pass} style={{ fontSize: 12.5 }}>{busy === 'change' ? '⏳' : 'Change'}</button>
          <button className="secondary" onClick={() => { setMode(''); setOldPass(''); setPass(''); setPass2(''); }} style={{ fontSize: 12 }}>Cancel</button>
        </div>
      )}

      {ready && privKey && (
        <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 6 }}>
          {[...users].sort((a, b) => (a.username || '').localeCompare(b.username || '')).map(u => {
            const has = inVault(u, vault);
            const pw = revealed[u.username];
            return (
              <div key={u.username} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(2,6,23,.4)', border: '1px solid rgba(148,163,184,.14)', borderRadius: 8, padding: '6px 10px' }}>
                <span style={{ fontWeight: 800, fontSize: 12.5, color: '#f1f5f9', minWidth: 80 }}>{(u.username || '').toUpperCase()}</span>
                <span style={{ flex: 1, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12.5, color: pw ? '#fde047' : '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {pw ? pw : has ? '••••••••' : <span style={{ fontSize: 11, fontStyle: 'italic' }}>not in vault yet — fills on their next login</span>}
                </span>
                {has && (pw
                  ? <button className="secondary" onClick={() => setRevealed(r => { const n = { ...r }; delete n[u.username]; return n; })} style={{ fontSize: 11, padding: '3px 8px' }}>Hide</button>
                  : <button className="secondary" onClick={() => reveal(u)} style={{ fontSize: 11, padding: '3px 8px', color: '#e9d5ff', borderColor: 'rgba(167,139,250,.5)' }}>👁 Reveal</button>)}
              </div>
            );
          })}
        </div>
      )}

      {msg && <div style={{ marginTop: 8, fontSize: 12, fontWeight: 700, color: msg.startsWith('❌') ? '#f87171' : '#c4b5fd' }}>{msg}</div>}
    </div>
  );
}

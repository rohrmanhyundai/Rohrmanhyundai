import React, { useState, useEffect } from 'react';
import { loadUsers } from '../utils/github';
import SalesDashboard from './SalesDashboard';
import SalesAdmin from './SalesAdmin';

const ROLES_WITH_ADMIN = ['admin', 'manager'];

function isAdminOrManager(role) {
  return ROLES_WITH_ADMIN.includes((role || '').toLowerCase());
}

export default function SalesApp() {
  const [users, setUsers]         = useState([]);
  const [currentUser, setCurrentUser] = useState(null); // { username, role }
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr]   = useState('');
  const [view, setView]           = useState('dashboard'); // 'dashboard' | 'admin'

  // Restore session
  useEffect(() => {
    const saved = sessionStorage.getItem('salesUser');
    if (saved) { try { setCurrentUser(JSON.parse(saved)); } catch {} }
    loadUsers().then(u => setUsers(u?.users || [])).catch(() => {});
  }, []);

  function handleLogin(e) {
    e.preventDefault();
    setLoginErr('');
    const found = users.find(u =>
      u.username.toLowerCase() === loginUser.toLowerCase() &&
      u.password === loginPass
    );
    if (!found) { setLoginErr('Invalid username or password.'); return; }
    // Check if user has sales page access or is admin/manager
    if (!isAdminOrManager(found.role) && found.pages?.sales === false) {
      setLoginErr('You do not have access to the Sales Board.');
      return;
    }
    const session = { username: found.username, role: found.role };
    setCurrentUser(session);
    sessionStorage.setItem('salesUser', JSON.stringify(session));
  }

  function handleLogout() {
    setCurrentUser(null);
    sessionStorage.removeItem('salesUser');
    setView('dashboard');
    setLoginUser(''); setLoginPass('');
  }

  // ── Login screen ──────────────────────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div style={{ minHeight: '100vh', background: '#0b1120', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ width: 360, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.1)', borderRadius: 20, padding: '36px 32px', boxShadow: '0 24px 64px rgba(0,0,0,.6)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🏆</div>
            <div style={{ fontWeight: 900, fontSize: 22, color: '#e2e8f0' }}>Sales Board</div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>Bob Rohrman Hyundai</div>
          </div>
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>Username</label>
              <input
                value={loginUser} onChange={e => setLoginUser(e.target.value)}
                autoFocus
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 10, color: '#e2e8f0', padding: '11px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 6 }}>Password</label>
              <input
                type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 10, color: '#e2e8f0', padding: '11px 14px', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
              />
            </div>
            {loginErr && <div style={{ color: '#f87171', fontSize: 13, marginBottom: 14, fontWeight: 600 }}>{loginErr}</div>}
            <button type="submit" style={{ width: '100%', background: 'linear-gradient(135deg,#3b82f6,#1d4ed8)', border: 'none', color: '#fff', borderRadius: 10, padding: '13px', fontSize: 15, fontWeight: 800, cursor: 'pointer' }}>
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ── Logged in ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#0b1120', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      {/* Nav bar */}
      <div style={{ height: 52, background: 'rgba(255,255,255,.03)', borderBottom: '1px solid rgba(255,255,255,.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', position: 'sticky', top: 0, zIndex: 50 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ fontWeight: 900, fontSize: 16, color: '#e2e8f0' }}>🏆 Sales Board</div>
          {isAdminOrManager(currentUser.role) && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setView('dashboard')} style={{ background: view === 'dashboard' ? 'rgba(59,130,246,.2)' : 'transparent', border: 'none', borderRadius: 8, padding: '5px 14px', color: view === 'dashboard' ? '#60a5fa' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>Dashboard</button>
              <button onClick={() => setView('admin')} style={{ background: view === 'admin' ? 'rgba(251,191,36,.15)' : 'transparent', border: 'none', borderRadius: 8, padding: '5px 14px', color: view === 'admin' ? '#fbbf24' : '#64748b', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>⚙️ Admin</button>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 13, color: '#475569' }}>{currentUser.username} · <span style={{ color: '#64748b' }}>{currentUser.role}</span></span>
          <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.1)', color: '#94a3b8', borderRadius: 8, padding: '5px 14px', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Sign Out</button>
        </div>
      </div>

      {view === 'admin' && isAdminOrManager(currentUser.role)
        ? <SalesAdmin currentUser={currentUser} users={users} onUsersChange={setUsers} />
        : <SalesDashboard currentUser={currentUser} isAdmin={isAdminOrManager(currentUser.role)} />
      }
    </div>
  );
}

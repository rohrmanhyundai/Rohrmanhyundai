import React, { useState, useEffect } from 'react';
import { n, pct, safe } from '../utils/formatters';

export default function Header({ data, isLoggedIn, currentUser, currentRole, userPages, canEditDashboard, onLogin, onLogout, onEdit, onAdvisor, onTechnician, onParts, onManager, onWarranty, onUsedCar, advisorUnread, techUnread }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [clock, setClock] = useState({ date: '', time: '' });

  useEffect(() => {
    function tick() {
      const now = new Date();
      setClock({
        date: now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      });
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  function handleLogin() {
    onLogin(username, password);
    setUsername('');
    setPassword('');
  }

  const stats = [
    ['Tech Week Total', n(data.techTotals.week_total, 1)],
    ['Tech Goal %', pct(data.techTotals.week_pct, 0)],
    ['Advisor MTD Hrs', n(data.advisorSummary.total_hours, 1)],
    ['CSI Avg', Math.round(safe(data.advisorSummary.csi, 0)).toString()],
  ];

  return (
    <section className="hero">
      <div className="card">
        <div className="eyebrow">Service Operations Dashboard</div>
        <div className="header-row">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1>{data.title || 'Bob Rohrman Hyundai Daily Summary'}</h1>
            <div className="sub">Samsung TV browser fit version</div>
          </div>
          <div className="rightHeader">
            <div className="login">
              {!isLoggedIn ? (
                <>
                  <span>LOGIN</span>
                  <input placeholder="user" style={{ width: 70 }} value={username} onChange={e => setUsername(e.target.value)} />
                  <input type="password" placeholder="pass" style={{ width: 80 }} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                  <button onClick={handleLogin}>Login</button>
                </>
              ) : (
                <>
                  {(currentRole === 'advisor' || currentRole === 'admin' || (currentRole || '').includes('manager') || (currentRole === 'warranty' && userPages && userPages.advisorCalendar !== false)) && (
                    <button onClick={onAdvisor} style={{ background: 'linear-gradient(180deg,rgba(61,214,195,.35),rgba(61,214,195,.22))', borderColor: 'rgba(61,214,195,.4)', position: 'relative' }}>
                      Advisor
                      {advisorUnread > 0 && (
                        <span style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxShadow: '0 0 0 2px rgba(0,0,0,0.4)', lineHeight: 1 }}>
                          {advisorUnread > 99 ? '99+' : advisorUnread}
                        </span>
                      )}
                    </button>
                  )}
                  {(currentRole === 'technician' || currentRole === 'admin' || (currentRole || '').includes('manager')) && (
                    <button onClick={onTechnician} style={{ background: 'linear-gradient(180deg,rgba(167,139,250,.35),rgba(139,92,246,.22))', borderColor: 'rgba(167,139,250,.4)', position: 'relative' }}>
                      Technicians
                      {techUnread > 0 && (
                        <span style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff', borderRadius: '50%', minWidth: 18, height: 18, fontSize: 11, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', boxShadow: '0 0 0 2px rgba(0,0,0,0.4)', lineHeight: 1 }}>
                          {techUnread > 99 ? '99+' : techUnread}
                        </span>
                      )}
                    </button>
                  )}
                  {(currentRole === 'warranty' || currentRole === 'admin' || (currentRole || '').includes('manager')) && (
                    <button onClick={onWarranty} style={{ background: 'linear-gradient(180deg,rgba(52,211,153,.35),rgba(16,185,129,.22))', borderColor: 'rgba(52,211,153,.4)' }}>
                      Warranty
                    </button>
                  )}
                  {(currentRole === 'parts' || currentRole === 'parts manager' || currentRole === 'admin' || (currentRole || '').includes('manager')) && (
                    <button onClick={onParts} style={{ background: 'linear-gradient(180deg,rgba(251,191,36,.35),rgba(245,158,11,.22))', borderColor: 'rgba(251,191,36,.4)' }}>
                      Parts
                    </button>
                  )}
                  {(currentRole === 'used car manager' || currentRole === 'admin' || (currentRole || '').includes('manager')) && (
                    <button onClick={onUsedCar} style={{ background: 'linear-gradient(180deg,rgba(96,165,250,.35),rgba(59,130,246,.22))', borderColor: 'rgba(96,165,250,.4)' }}>
                      Used Cars
                    </button>
                  )}
                  {(currentRole === 'admin' || currentRole === 'parts manager' || currentRole === 'service manager' || (currentRole || '').includes('manager')) && (
                    <button onClick={onManager} style={{ background: 'linear-gradient(180deg,rgba(167,139,250,.35),rgba(139,92,246,.22))', borderColor: 'rgba(167,139,250,.4)' }}>
                      Manager
                    </button>
                  )}
                  {canEditDashboard && (
                    <button className="secondary" onClick={onEdit}>Edit Dashboard</button>
                  )}
                  <button className="secondary" onClick={onLogout}>Logout</button>
                </>
              )}
            </div>
            <div className="clock">
              <div className="date">
                {clock.date}
                {isLoggedIn && currentUser && (
                  <span className="clock-user"> &nbsp;·&nbsp; {currentUser}</span>
                )}
              </div>
              <div className="time">{clock.time}</div>
            </div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="stats">
          {stats.map(([k, v]) => (
            <div className="stat" key={k}>
              <div className="k">{k}</div>
              <div className="v">{v}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

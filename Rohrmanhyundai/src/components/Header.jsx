import React, { useState, useEffect } from 'react';
import { n, pct, safe } from '../utils/formatters';

export default function Header({ data, isLoggedIn, onLogin, onLogout, onEdit }) {
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
              <span>LOGIN</span>
              {!isLoggedIn ? (
                <>
                  <input placeholder="user" style={{ width: 70 }} value={username} onChange={e => setUsername(e.target.value)} />
                  <input type="password" placeholder="password" style={{ width: 88 }} value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleLogin()} />
                  <button onClick={handleLogin}>Login</button>
                </>
              ) : (
                <>
                  <button className="secondary" onClick={onLogout}>Logout</button>
                  <button onClick={onEdit}>Edit Dashboard</button>
                </>
              )}
            </div>
            <div className="clock">
              <div className="date">{clock.date}</div>
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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import TechProduction from './components/TechProduction';
import TrainingRotator from './components/TrainingRotator';
import AdvisorPerformance from './components/AdvisorPerformance';
import Gauges from './components/Gauges';
import AdminPanel from './components/AdminPanel';
import { recalcTech, recalcAdvisorSummary } from './utils/calculations';

const AUTH_KEY = 'serviceDashboardAuthV1';
const USERS_KEY = 'dashboardUsersV1';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'Hyundai2026';

const BASE = import.meta.env.BASE_URL;

const emptyData = {
  title: 'Bob Rohrman Hyundai Daily Summary',
  technicians: [],
  advisors: [],
  advisorTraining: [],
  vacations: [],
  advisorSummary: { date: '', total_hours: 0, align: 0, tires: 0, valvoline: 0, csi: 0 },
  techTotals: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, week_total: 0, week_pct: 0 },
  grossGoal: 0, grossActual: 0, cpGoal: 0, cpActual: 0, advisorMonthlyWorkdays: 27,
};

export default function App() {
  const [data, setData] = useState(emptyData);
  const [vacations, setVacations] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(localStorage.getItem(AUTH_KEY) === 'true');
  const [currentUser, setCurrentUser] = useState(localStorage.getItem('currentUser') || '');
  const [adminOpen, setAdminOpen] = useState(false);
  const stageRef = useRef(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`${BASE}data/data.json?v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
        const payload = await res.json();
        if (payload && payload.data) {
          const d = payload.data;
          recalcTech(d);
          recalcAdvisorSummary(d);
          setData(d);
          setVacations(Array.isArray(payload.vacations) ? payload.vacations : (d.vacations || []));
        }
      } catch (err) {
        console.warn('Failed to load data.json, using empty state', err);
      }
    }
    load();
  }, []);

  const fitStage = useCallback(() => {
    if (!stageRef.current) return;
    const baseW = 1920, baseH = 1080;
    const vw = window.innerWidth, vh = window.innerHeight;
    const safeW = Math.max(320, vw - 24);
    const safeH = Math.max(240, vh - 36);
    const scale = Math.min(safeW / baseW, safeH / baseH) * 0.985;
    const left = Math.max(0, (vw - baseW * scale) / 2);
    const top = Math.max(0, (vh - baseH * scale) / 2);
    stageRef.current.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  }, []);

  useEffect(() => {
    fitStage();
    window.addEventListener('resize', fitStage);
    return () => window.removeEventListener('resize', fitStage);
  }, [fitStage]);

  function handleLogin(username, password) {
    const stored = JSON.parse(localStorage.getItem(USERS_KEY) || 'null') || [{ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD }];
    const match = stored.find(u => u.username === username && u.password === password);
    if (match) {
      localStorage.setItem(AUTH_KEY, 'true');
      localStorage.setItem('currentUser', match.username);
      setIsLoggedIn(true);
      setCurrentUser(match.username);
    } else {
      alert('Login failed.');
    }
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem('currentUser');
    setIsLoggedIn(false);
    setCurrentUser('');
    setAdminOpen(false);
  }

  function handleDataChange(newData, newVacations) {
    recalcTech(newData);
    recalcAdvisorSummary(newData);
    newData.advisors.forEach(a => {
      const p = newData.advisorMonthlyWorkdays || 27;
      // daily_avg gets recalculated in the component
    });
    setData({ ...newData });
    setVacations([...newVacations]);
  }

  return (
    <div className="viewport">
      <div className="stage" ref={stageRef}>
        <div className="dashboard">
          <Header
            data={data}
            isLoggedIn={isLoggedIn}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onEdit={() => setAdminOpen(true)}
          />

          <section className="top">
            <TechProduction data={data} />
            <TrainingRotator data={data} vacations={vacations} />
          </section>

          <AdvisorPerformance data={data} />
          <Gauges data={data} />
        </div>

        <AdminPanel
          data={data}
          vacations={vacations}
          isOpen={adminOpen}
          onClose={() => setAdminOpen(false)}
          onDataChange={handleDataChange}
          currentUser={currentUser}
        />
      </div>
    </div>
  );
}

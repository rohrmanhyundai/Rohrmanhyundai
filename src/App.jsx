import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import MobileDashboard from './components/MobileDashboard';
import TechProduction from './components/TechProduction';
import TickerPanel from './components/TickerPanel';
import AdvisorPerformance from './components/AdvisorPerformance';
import Gauges from './components/Gauges';
import AdminPanel from './components/AdminPanel';
import AdvisorCalendar from './components/AdvisorCalendar';
import AdvisorDayForm from './components/AdvisorDayForm';
import DocumentLibrary from './components/DocumentLibrary';
import { recalcTech, recalcAdvisorSummary } from './utils/calculations';
import { loadUsers, saveUsers, setGithubToken, loadDashboardData, loadSchedules } from './utils/github';
import WorkSchedule from './components/WorkSchedule';
import TechResources from './components/TechResources';

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
  const [users, setUsers] = useState(() => {
    // Use localStorage cache so login works instantly on any device
    const cached = localStorage.getItem(USERS_KEY);
    if (cached) {
      try { return JSON.parse(cached); } catch {}
    }
    return [{ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD }];
  });
  const [isLoggedIn, setIsLoggedIn] = useState(localStorage.getItem(AUTH_KEY) === 'true');
  const [currentUser, setCurrentUser] = useState(localStorage.getItem('currentUser') || '');
  const [currentRole, setCurrentRole] = useState(localStorage.getItem('currentRole') || '');
  const [canEditDashboard, setCanEditDashboard] = useState(localStorage.getItem('canEditDashboard') === 'true');
  const [sharedSaveCode, setSharedSaveCode] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [schedules, setSchedules] = useState({});
  const [selectedDay, setSelectedDay] = useState(null);
  const [viewingAdvisor, setViewingAdvisor] = useState('');
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const stageRef = useRef(null);

  const loadDashboard = useCallback(async () => {
    try {
      // Try GitHub API first — instant after a save, no GitHub Pages rebuild wait
      let payload = await loadDashboardData();
      if (!payload) {
        // Fallback: GitHub Pages CDN (no auth token or API unavailable)
        const res = await fetch(`${BASE}data/data.json?v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`Failed to load data.json (${res.status})`);
        payload = await res.json();
      }
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
  }, []);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(loadDashboard, 90 * 1000); // refresh every 90 seconds
    return () => clearInterval(interval);
  }, [loadDashboard]);

  useEffect(() => {
    loadSchedules().then(s => setSchedules(s || {})).catch(() => {});
  }, []);

  useEffect(() => {
    loadUsers().then(result => {
      if (!result) return;
      const { users: githubUsers, sharedSaveCode: code } = result;
      // Auto-apply the shared save code so all advisor devices stay in sync —
      // admin updates it once in GitHub Settings and everyone gets it automatically.
      if (code) {
        setGithubToken(code);
        setSharedSaveCode(code);
      }
      if (githubUsers && githubUsers.length > 0) {
        const hasAdmin = githubUsers.find(u => u.username === DEFAULT_USERNAME);
        if (!hasAdmin) githubUsers.push({ username: DEFAULT_USERNAME, password: DEFAULT_PASSWORD });
        setUsers(githubUsers);
        localStorage.setItem(USERS_KEY, JSON.stringify(githubUsers));
      }
    });
  }, []);

  const fitStage = useCallback(() => {
    if (!stageRef.current) return;
    const baseW = 1920, baseH = 1080;
    const vw = window.innerWidth, vh = window.innerHeight;
    const scale = Math.min(vw / baseW, vh / baseH);
    const left = Math.max(0, (vw - baseW * scale) / 2);
    const top  = Math.max(0, (vh - baseH * scale) / 2);
    stageRef.current.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  }, []);

  useEffect(() => {
    fitStage();
    window.addEventListener('resize', fitStage);
    return () => window.removeEventListener('resize', fitStage);
  }, [fitStage]);

  function handleLogin(username, password) {
    const match = users.find(u => u.username === username && u.password === password);
    if (match) {
      const canEdit = match.role === 'admin' || (match.role || '').includes('manager') || !!match.canEditDashboard;
      localStorage.setItem(AUTH_KEY, 'true');
      localStorage.setItem('currentUser', match.username);
      localStorage.setItem('currentRole', match.role || '');
      localStorage.setItem('canEditDashboard', String(canEdit));
      setIsLoggedIn(true);
      setCurrentUser(match.username);
      setCurrentRole(match.role || '');
      setCanEditDashboard(canEdit);
    } else {
      alert('Login failed.');
    }
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentRole');
    localStorage.removeItem('canEditDashboard');
    setIsLoggedIn(false);
    setCurrentUser('');
    setCurrentRole('');
    setCanEditDashboard(false);
    setAdminOpen(false);
    setPage('dashboard');
    setViewingAdvisor('');
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

  const advisorList = users.filter(u => u.role === 'advisor').map(u => u.username.toUpperCase());
  const techList = users.filter(u => u.role === 'technician').map(u => u.username.toUpperCase());
  const ownAdvisor = currentUser.toUpperCase();
  const activeAdvisor = viewingAdvisor || ownAdvisor;

  // Technician pages
  if (page === 'tech-resources') {
    return (
      <TechResources
        currentUser={currentUser.toUpperCase()}
        onWorkSchedule={() => setPage('tech-work-schedule')}
        onAdvisorSchedule={() => setPage('tech-view-advisor-schedule')}
        onBack={() => setPage('dashboard')}
      />
    );
  }

  if (page === 'tech-work-schedule') {
    const allTechUsers = techList.length > 0 ? techList : users.map(u => u.username.toUpperCase());
    return (
      <WorkSchedule
        schedules={schedules}
        employeeNames={allTechUsers}
        currentUser={currentUser.toUpperCase()}
        onBack={() => setPage('tech-resources')}
      />
    );
  }

  if (page === 'tech-view-advisor-schedule') {
    const allAdvisorUsers = advisorList.length > 0 ? advisorList : users.map(u => u.username.toUpperCase());
    return (
      <WorkSchedule
        schedules={schedules}
        employeeNames={allAdvisorUsers}
        currentUser={currentUser.toUpperCase()}
        onBack={() => setPage('tech-resources')}
      />
    );
  }

  if (page === 'advisor-view-tech-schedule') {
    const allTechUsers = techList.length > 0 ? techList : users.map(u => u.username.toUpperCase());
    return (
      <WorkSchedule
        schedules={schedules}
        employeeNames={allTechUsers}
        currentUser={currentUser.toUpperCase()}
        onBack={() => setPage('advisor-calendar')}
      />
    );
  }

  // Advisor pages render full-screen outside the scaled stage
  if (page === 'work-schedule') {
    const allUsers = users.map(u => u.username.toUpperCase());
    return (
      <WorkSchedule
        schedules={schedules}
        employeeNames={allUsers}
        currentUser={currentUser.toUpperCase()}
        onBack={() => setPage('advisor-calendar')}
      />
    );
  }

  if (page === 'advisor-calendar') {
    return (
      <AdvisorCalendar
        ownAdvisor={ownAdvisor}
        viewingAdvisor={activeAdvisor}
        advisorList={advisorList}
        onViewingChange={name => setViewingAdvisor(name)}
        onSelectDay={day => { setSelectedDay(day); setPage('advisor-day'); }}
        onBack={() => { setViewingAdvisor(''); setPage('dashboard'); }}
        onDocumentLibrary={() => setPage('document-library')}
        onWorkSchedule={() => setPage('work-schedule')}
        onTechSchedule={() => setPage('advisor-view-tech-schedule')}
        refreshKey={calendarRefreshKey}
      />
    );
  }
  if (page === 'advisor-day' && selectedDay) {
    return (
      <AdvisorDayForm
        advisorName={activeAdvisor}
        ownAdvisor={ownAdvisor}
        date={selectedDay}
        onBack={() => { setCalendarRefreshKey(k => k + 1); setPage('advisor-calendar'); }}
      />
    );
  }
  if (page === 'document-library') {
    return (
      <DocumentLibrary
        currentUser={currentUser}
        currentRole={currentRole}
        onBack={() => setPage('advisor-calendar')}
      />
    );
  }

  // Phone-only mobile view — tablet/desktop/TV use the existing scaled layout unchanged
  if (window.innerWidth < 600) {
    return (
      <>
        <MobileDashboard
          data={data} vacations={vacations}
          isLoggedIn={isLoggedIn} currentUser={currentUser}
          currentRole={currentRole} canEditDashboard={canEditDashboard}
          onLogin={handleLogin} onLogout={handleLogout}
          onEdit={() => setAdminOpen(true)} onAdvisor={() => setPage('advisor-calendar')} onTechnician={() => setPage('tech-resources')}
        />
        <AdminPanel
          data={data} vacations={vacations} isOpen={adminOpen}
          onClose={() => setAdminOpen(false)} onDataChange={handleDataChange}
          onRefresh={loadDashboard} currentUser={currentUser} currentRole={currentRole}
          users={users} sharedSaveCode={sharedSaveCode}
          onSharedSaveCodeChange={setSharedSaveCode}
          onUsersChange={updated => { setUsers(updated); localStorage.setItem(USERS_KEY, JSON.stringify(updated)); }}
          schedules={schedules} onSchedulesChange={setSchedules}
        />
      </>
    );
  }

  return (
    <div className="viewport">
      <div className="stage" ref={stageRef}>
        <div className="dashboard">
          <Header
            data={data}
            isLoggedIn={isLoggedIn}
            currentUser={currentUser}
            currentRole={currentRole}
            canEditDashboard={canEditDashboard}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onEdit={() => setAdminOpen(true)}
            onAdvisor={() => setPage('advisor-calendar')}
            onTechnician={() => setPage('tech-resources')}
          />

          <TechProduction data={data} />
          <TickerPanel data={data} vacations={vacations} />
          <AdvisorPerformance data={data} />
          <Gauges data={data} />
        </div>
      </div>

      {/* AdminPanel rendered outside the scaled stage so position:fixed covers the real viewport */}
      <AdminPanel
        data={data}
        vacations={vacations}
        isOpen={adminOpen}
        onClose={() => setAdminOpen(false)}
        onDataChange={handleDataChange}
        onRefresh={loadDashboard}
        currentUser={currentUser}
        currentRole={currentRole}
        users={users}
        sharedSaveCode={sharedSaveCode}
        onSharedSaveCodeChange={setSharedSaveCode}
        onUsersChange={updated => { setUsers(updated); localStorage.setItem(USERS_KEY, JSON.stringify(updated)); }}
        schedules={schedules}
        onSchedulesChange={setSchedules}
      />
    </div>
  );
}

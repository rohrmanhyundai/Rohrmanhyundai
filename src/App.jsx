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
import AftermarketWarranty from './components/AftermarketWarranty';
import { recalcTech, recalcAdvisorSummary } from './utils/calculations';
import { loadUsers, saveUsers, setGithubToken, loadDashboardData, loadSchedules } from './utils/github';
import WorkSchedule from './components/WorkSchedule';
import TechResources from './components/TechResources';
import MobileSchedule from './components/MobileSchedule';
import PartsHub from './components/PartsHub';
import SurveyReports from './components/SurveyReports';

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
  const [currentPages, setCurrentPages] = useState(() => { try { const p = localStorage.getItem('currentPages'); return p ? JSON.parse(p) : null; } catch { return null; } });
  const [sharedSaveCode, setSharedSaveCode] = useState('');
  const [adminOpen, setAdminOpen] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [prevPage, setPrevPage] = useState('dashboard');

  // Navigate to a page while remembering where we came from
  function goTo(dest, from) {
    if (from !== undefined) setPrevPage(from);
    setPage(dest);
  }
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
      const pages = match.pages || null;
      localStorage.setItem(AUTH_KEY, 'true');
      localStorage.setItem('currentUser', match.username);
      localStorage.setItem('currentRole', match.role || '');
      localStorage.setItem('canEditDashboard', String(canEdit));
      localStorage.setItem('currentPages', JSON.stringify(pages));
      setIsLoggedIn(true);
      setCurrentUser(match.username);
      setCurrentRole(match.role || '');
      setCanEditDashboard(canEdit);
      setCurrentPages(pages);
    } else {
      alert('Login failed.');
    }
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem('currentUser');
    localStorage.removeItem('currentRole');
    localStorage.removeItem('canEditDashboard');
    localStorage.removeItem('currentPages');
    setIsLoggedIn(false);
    setCurrentUser('');
    setCurrentRole('');
    setCanEditDashboard(false);
    setCurrentPages(null);
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

  // Check if the current user can access a page key.
  // Admins and managers always have full access. Others use their saved pages map.
  const isAdminOrManager = currentRole === 'admin' || (currentRole || '').includes('manager');
  // Keys that are OFF by default — must be explicitly granted in user pages settings
  const DEFAULT_OFF_KEYS = new Set(['surveyReports']);
  function canAccess(key) {
    if (isAdminOrManager) return true;
    if (DEFAULT_OFF_KEYS.has(key)) {
      // Feature is off unless explicitly set to true in user's pages
      return !!(currentPages && currentPages[key] === true);
    }
    if (!currentPages) return true; // no restrictions saved yet
    return currentPages[key] !== false;
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
    if (window.innerWidth < 600) return (
      <MobileSchedule schedules={schedules} employeeNames={techList}
        currentUser={currentUser.toUpperCase()} title="Tech Schedule"
        onBack={() => setPage('tech-resources')} />
    );
    return (
      <WorkSchedule schedules={schedules} employeeNames={techList}
        currentUser={currentUser.toUpperCase()} title="Tech Schedule"
        onBack={() => setPage('tech-resources')} />
    );
  }

  if (page === 'tech-view-advisor-schedule') {
    if (window.innerWidth < 600) return (
      <MobileSchedule schedules={schedules} employeeNames={advisorList}
        currentUser={currentUser.toUpperCase()} title="Advisor Schedule"
        onBack={() => setPage('tech-resources')} />
    );
    return (
      <WorkSchedule schedules={schedules} employeeNames={advisorList}
        currentUser={currentUser.toUpperCase()} title="Advisor Schedule"
        onBack={() => setPage('tech-resources')} />
    );
  }

  if (page === 'advisor-view-tech-schedule') {
    const tsBackLabel = prevPage === 'parts-hub' ? '← Parts Hub' : '← Advisor Calendar';
    if (window.innerWidth < 600) return (
      <MobileSchedule schedules={schedules} employeeNames={techList}
        currentUser={currentUser.toUpperCase()} title="Tech Schedule"
        onBack={() => setPage(prevPage || 'advisor-calendar')} />
    );
    return (
      <WorkSchedule schedules={schedules} employeeNames={techList}
        currentUser={currentUser.toUpperCase()}
        title="Tech Schedule"
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={tsBackLabel} />
    );
  }

  // Parts Hub
  if (page === 'parts-hub') {
    return (
      <PartsHub
        currentUser={currentUser.toUpperCase()}
        currentRole={currentRole}
        userPages={currentPages}
        onBack={() => setPage('dashboard')}
        onAftermarketWarranty={() => goTo('aftermarket-warranty', 'parts-hub')}
        onDocumentLibrary={() => goTo('document-library', 'parts-hub')}
        onAdvisorSchedule={() => goTo('work-schedule', 'parts-hub')}
        onTechSchedule={() => goTo('advisor-view-tech-schedule', 'parts-hub')}
        onAdvisorRankBoard={() => window.open('https://dealerplateguy.github.io/Advisor-Rank-Board/', '_blank')}
      />
    );
  }

  // Advisor pages render full-screen outside the scaled stage
  if (page === 'work-schedule') {
    const wsBackLabel = prevPage === 'parts-hub' ? '← Parts Hub' : '← Advisor Calendar';
    const backDest = prevPage || 'advisor-calendar';
    // Technicians routed here should see the tech schedule, not advisor schedule
    if (currentRole === 'technician') {
      if (window.innerWidth < 600) return (
        <MobileSchedule schedules={schedules} employeeNames={techList}
          currentUser={currentUser.toUpperCase()} title="Tech Schedule"
          onBack={() => setPage(backDest)} />
      );
      return (
        <WorkSchedule schedules={schedules} employeeNames={techList}
          currentUser={currentUser.toUpperCase()}
          onBack={() => setPage(backDest)}
          backLabel={wsBackLabel} />
      );
    }
    if (window.innerWidth < 600) return (
      <MobileSchedule schedules={schedules} employeeNames={advisorList}
        currentUser={currentUser.toUpperCase()} title="Advisor Schedule"
        onBack={() => setPage(backDest)} />
    );
    return (
      <WorkSchedule schedules={schedules} employeeNames={advisorList}
        currentUser={currentUser.toUpperCase()}
        title="Advisor Schedule"
        onBack={() => setPage(backDest)}
        backLabel={wsBackLabel} />
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
        onDocumentLibrary={() => goTo('document-library', 'advisor-calendar')}
        onWorkSchedule={() => goTo('work-schedule', 'advisor-calendar')}
        onTechSchedule={() => goTo('advisor-view-tech-schedule', 'advisor-calendar')}
        onAftermarketWarranty={() => goTo('aftermarket-warranty', 'advisor-calendar')}
        onSurveyReports={() => setPage('survey-reports')}
        refreshKey={calendarRefreshKey}
        userPages={currentPages}
        currentRole={currentRole}
      />
    );
  }

  if (page === 'survey-reports') {
    if (!canAccess('surveyReports')) { setPage('advisor-calendar'); return null; }
    return (
      <SurveyReports
        advisorList={advisorList}
        canDelete={isAdminOrManager}
        onBack={() => setPage('advisor-calendar')}
      />
    );
  }
  if (page === 'advisor-day' && selectedDay) {
    return (
      <AdvisorDayForm
        advisorName={activeAdvisor}
        ownAdvisor={ownAdvisor}
        date={selectedDay}
        currentRole={currentRole}
        canEditDashboard={canEditDashboard}
        onBack={() => { setCalendarRefreshKey(k => k + 1); setPage('advisor-calendar'); }}
      />
    );
  }
  if (page === 'document-library') {
    const dlBackLabel = prevPage === 'parts-hub' ? '← Parts Hub' : '← Advisor Calendar';
    return (
      <DocumentLibrary
        currentUser={currentUser}
        currentRole={currentRole}
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={dlBackLabel}
      />
    );
  }

  if (page === 'aftermarket-warranty') {
    if (!canAccess('aftermarketWarranty')) { setPage(prevPage || 'advisor-calendar'); return null; }
    const awBackLabel = prevPage === 'parts-hub' ? '← Parts Hub' : '← Advisor Calendar';
    return (
      <AftermarketWarranty
        currentUser={currentUser}
        currentRole={currentRole}
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={awBackLabel}
      />
    );
  }

  // Phone-only mobile view — tablet/desktop/TV use the existing scaled layout unchanged
  if (window.innerWidth < 600) {
    if (page === 'mobile-advisor-schedule') {
      return (
        <MobileSchedule
          schedules={schedules}
          employeeNames={advisorList}
          currentUser={currentUser.toUpperCase()}
          title="Advisor Schedule"
          onBack={() => setPage('dashboard')}
        />
      );
    }
    if (page === 'mobile-tech-schedule') {
      return (
        <MobileSchedule
          schedules={schedules}
          employeeNames={techList}
          currentUser={currentUser.toUpperCase()}
          title="Tech Schedule"
          onBack={() => setPage('dashboard')}
        />
      );
    }

    return (
      <>
        <MobileDashboard
          data={data} vacations={vacations}
          isLoggedIn={isLoggedIn} currentUser={currentUser}
          currentRole={currentRole} canEditDashboard={canEditDashboard}
          onLogin={handleLogin} onLogout={handleLogout}
          onEdit={() => setAdminOpen(true)} onAdvisor={() => setPage('advisor-calendar')} onTechnician={() => setPage('tech-resources')}
          onAdvisorSchedule={() => setPage('mobile-advisor-schedule')}
          onTechSchedule={() => setPage('mobile-tech-schedule')}
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
            onParts={() => setPage('parts-hub')}
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

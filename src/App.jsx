import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import MobileDashboard from './components/MobileDashboard';
import TechProduction from './components/TechProduction';
import TickerPanel from './components/TickerPanel';
import AdvisorPerformance from './components/AdvisorPerformance';
import Gauges from './components/Gauges';
import AdminPanel from './components/AdminPanel';
import { getPusher, SYSTEM_CHANNEL, FORCE_REFRESH_EVENT, ADVISOR_CHANNEL, TECH_CHANNEL, NEW_MSG_EVENT } from './utils/pusher';
import { isMentioned } from './utils/mentions';
import { initActivityTracker, shutdownActivityTracker, trackPage, trackAction } from './utils/activityTracker';
import AdvisorCalendar from './components/AdvisorCalendar';
import RoUpload from './components/RoUpload';
import AdvisorDayForm from './components/AdvisorDayForm';
import AfterCallReport from './components/AfterCallReport';
import DocumentLibrary from './components/DocumentLibrary';
import ServicePricingMenu from './components/ServicePricingMenu';
import LivePay from './components/LivePay';
import AftermarketWarranty from './components/AftermarketWarranty';
import TireWarranty from './components/TireWarranty';
import OriginalOwnerAffidavit from './components/OriginalOwnerAffidavit';
import ManagerHub from './components/ManagerHub';
import RepairOrderDatabase from './components/RepairOrderDatabase';
import UserDataTracker from './components/UserDataTracker';
import GoalForecast from './components/GoalForecast';
import AdvisorGoals from './components/AdvisorGoals';
import EmployeeReviewHub from './components/EmployeeReviewHub';
import TechReview from './components/TechReview';
import AdvisorReview from './components/AdvisorReview';
import ChargeAccountList from './components/ChargeAccountList';
import { recalcTech, recalcAdvisorSummary } from './utils/calculations';
import { userDisplayName } from './utils/userDisplay';

function openRankBoard() {
  navigator.clipboard.writeText('infinitepursuit').catch(() => {});
  window.open('https://dealerplateguy.github.io/Advisor-Rank-Board/', '_blank');
}
import { loadUsers, saveUsers, setGithubToken, loadDashboardData, saveDashboardToGitHub, loadSchedules, loadChatMessages, loadTechChatMessages, loadForceRefresh, loadFormerEmployees } from './utils/github';
import WorkSchedule from './components/WorkSchedule';
import TechResources from './components/TechResources';
import HotRepairs from './components/HotRepairs';
import WorkInProgress from './components/WorkInProgress';
import MobileSchedule from './components/MobileSchedule';
import PartsHub from './components/PartsHub';
import WarrantyHub from './components/WarrantyHub';
import UsedCarHub from './components/UsedCarHub';
import SurveyReports from './components/SurveyReports';
import ATDiagWorksheet from './components/ATDiagWorksheet';
import DCTMTMWorksheet from './components/DCTMTMWorksheet';
import IVTWorksheet from './components/IVTWorksheet';
import ATMWorksheet from './components/ATMWorksheet';
import ATTNTTWorksheet from './components/ATTNTTWorksheet';
import TechSelfReview from './components/TechSelfReview';
import PerformanceReport from './components/PerformanceReport';
import ManagerReports from './components/ManagerReports';

const AUTH_KEY = 'serviceDashboardAuthV1';
const USERS_KEY = 'dashboardUsersV1';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'Hyundai2026';

const BASE = import.meta.env.BASE_URL;

// A user can be granted Management Access without their job title being a
// "manager" role — e.g. a lead advisor who also manages the department. The
// whole app gates manager features by testing whether the role string
// `.includes('manager')`, so we fold that grant into the *effective* role used
// for gating. The user's stored `role` is left untouched (so advisor rosters,
// surveys, goals, schedules still list them as an advisor); only the logged-in
// session's role string picks up a "manager" marker. `currentRole` is never
// shown to the user, so this marker is invisible in the UI.
function effectiveRole(record) {
  const base = (record && record.role) || '';
  if (record && record.managementAccess && base !== 'admin' && !base.includes('manager')) {
    return `${base} manager`.trim();
  }
  return base;
}

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
    pageRef.current = dest;
    setPage(dest);
    trackPage(dest);
  }
  function navTo(dest) { pageRef.current = dest; setPage(dest); trackPage(dest); }
  const [schedules, setSchedules] = useState({});
  const schedulesRef = useRef({});
  useEffect(() => { schedulesRef.current = schedules; }, [schedules]);
  const [selectedDay, setSelectedDay] = useState(null);
  const [viewingAdvisor, setViewingAdvisor] = useState('');
  const [livePayFocus, setLivePayFocus] = useState(''); // advisor to open Live Pay on
  const [surveyFocus, setSurveyFocus] = useState('');   // advisor to preselect on Survey Reports
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [advisorUnread, setAdvisorUnread] = useState(0);
  const [techUnread, setTechUnread] = useState(0);
  const [wipInitialRO, setWipInitialRO] = useState(null);
  const pageRef = useRef(page);
  const stageRef = useRef(null);
  const adminOpenRef = useRef(false);
  // Freshly-uploaded gauge actuals (grossActual/cpActual). The 90s poll wholesale-
  // replaces `data` from the server; for a short window after an upload we keep the
  // just-applied values so a stale-replica read can't revert the gauges.
  const gaugeActualsRef = useRef(null); // { grossActual?, cpActual?, ts }
  const formerRef = useRef({ set: null, ts: 0 }); // cached former-employee first names (5-min TTL)
  // @mention alert: a blocking popup when someone @tags the current user in chat.
  const [mention, setMention] = useState(null);    // { id, from, text, channel } showing now, or null
  const mentionAckRef = useRef(new Set());          // ids already OK'd (persisted per user)
  const mentionQueueRef = useRef([]);               // pending mentions waiting to show
  const mentionPersistRef = useRef(() => {});       // persists the ack set to localStorage
  const considerMentionRef = useRef(null);          // shared checker used by the poll safety-net

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
        // Keep just-uploaded gauge actuals from being reverted by a stale-replica
        // read during the save's propagation window (~30s).
        const g = gaugeActualsRef.current;
        if (g && Date.now() - g.ts < 30000) {
          if (g.grossActual != null) d.grossActual = g.grossActual;
          if (g.cpActual != null) d.cpActual = g.cpActual;
        }
        // Former employees are the authority on who's gone. Filter them out of
        // the roster on every load so a concurrent stale save from another
        // tab/device can't resurrect a deleted tech/advisor (this is why WEST
        // kept reappearing after being deleted). Cached 5 min to limit reads.
        try {
          const fr = formerRef.current;
          if (!fr.set || Date.now() - fr.ts > 5 * 60 * 1000) {
            const former = await loadFormerEmployees();
            const firstWord = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
            fr.set = new Set((Array.isArray(former) ? former : []).map(f => firstWord(f.username)));
            fr.ts = Date.now();
          }
          if (fr.set && fr.set.size) {
            const fw = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();
            d.technicians = (d.technicians || []).filter(t => !fr.set.has(fw(t.name)));
            d.advisors = (d.advisors || []).filter(a => !fr.set.has(fw(a.name)));
          }
        } catch { /* non-fatal — fall back to unfiltered roster */ }
        recalcTech(d, schedulesRef.current);
        recalcAdvisorSummary(d);
        setData(d);
        setVacations(Array.isArray(payload.vacations) ? payload.vacations : (d.vacations || []));
      }
    } catch (err) {
      console.warn('Failed to load data.json, using empty state', err);
    }
  }, []);

  useEffect(() => { adminOpenRef.current = adminOpen; }, [adminOpen]);

  useEffect(() => {
    loadDashboard();
    const interval = setInterval(() => {
      if (!adminOpenRef.current) loadDashboard();
    }, 90 * 1000); // refresh every 90 seconds, but skip while Edit Dashboard is open
    return () => clearInterval(interval);
  }, [loadDashboard]);

  useEffect(() => {
    loadSchedules().then(s => {
      setSchedules(s || {});
      schedulesRef.current = s || {};
      // Re-apply schedule-driven hours (holiday/vacation/training → 8.0)
      // now that schedules are available.
      loadDashboard();
    }).catch(() => {});
  }, [loadDashboard]);

  // Chat notification polling — check for new messages every 5s
  // Bring the activity tracker up on hard refresh / resume from cached login,
  // and tear it down on logout. Tracker is a no-op for admins by design.
  useEffect(() => {
    if (isLoggedIn && currentUser) {
      initActivityTracker(currentUser, currentRole);
    } else {
      shutdownActivityTracker();
    }
  }, [isLoggedIn, currentUser, currentRole]);

  // Admin-triggered force refresh. The "Force Refresh All Users" button does two
  // things: fires a realtime Pusher event AND bumps a stored timestamp. Every
  // logged-in browser reloads (cache-busted) when it sees a newer timestamp —
  // instantly via Pusher, or within 60s via a poll/reconnect fallback so a
  // client that missed the live event (e.g. a TV whose socket slept) still
  // catches up. Both carry the SAME timestamp, so a healthy client reloads once.
  useEffect(() => {
    if (!isLoggedIn) return;

    const applyRefresh = (ts, fromPoll) => {
      if (!ts) return;
      const stored = localStorage.getItem('forceRefreshSeen');
      // First poll on a brand-new session: baseline silently, don't reload.
      if (fromPoll && stored == null) { localStorage.setItem('forceRefreshSeen', String(ts)); return; }
      const lastSeen = parseInt(stored || '0', 10);
      if (ts <= lastSeen) return; // stale / already handled
      localStorage.setItem('forceRefreshSeen', String(ts));
      try { console.log('[force-refresh] reloading at', new Date(ts).toISOString()); } catch {}
      // Plain reload() can be served the cached index.html (GitHub Pages sends
      // Cache-Control: max-age=600 on it), which still points at the OLD hashed
      // bundle — so a deploy wouldn't actually reach the client. Navigating with
      // a fresh ?_v= makes the URL a cache miss, forcing a fresh index.html that
      // references the newest bundle. replace() avoids a back-button trap.
      setTimeout(() => {
        try {
          const u = new URL(window.location.href);
          u.searchParams.set('_v', String(ts));
          window.location.replace(u.toString());
        } catch { window.location.reload(); }
      }, 250);
    };
    const checkSignal = async () => {
      try { const rec = await loadForceRefresh(); if (rec && rec.ts) applyRefresh(rec.ts, true); } catch {}
    };

    let ch;
    try {
      ch = getPusher().subscribe(SYSTEM_CHANNEL);
      ch.bind(FORCE_REFRESH_EVENT, (payload) => applyRefresh(payload && payload.ts ? payload.ts : Date.now(), false));
      getPusher().connection.bind('connected', checkSignal); // re-check on (re)connect
    } catch (e) { console.warn('force-refresh subscribe failed:', e); }

    checkSignal();                                  // initial catch-up on load
    const poll = setInterval(checkSignal, 60000);   // durable 60s fallback

    return () => {
      clearInterval(poll);
      try {
        if (ch) ch.unbind(FORCE_REFRESH_EVENT);
        getPusher().connection.unbind('connected', checkSignal);
        getPusher().unsubscribe(SYSTEM_CHANNEL);
      } catch {}
    };
  }, [isLoggedIn]);

  // ── @mention alerts ─────────────────────────────────────────────────────────
  // When someone types "@<you>" in either chat, pop a blocking OK popup on this
  // user's screen. Real-time via the chat Pusher events (which now carry the
  // message text); a scan on login/reconnect catches any that fired while this
  // browser was asleep. Acknowledged ids are remembered so a popup shows once.
  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;
    const meU = currentUser.toUpperCase();
    const ackKey = `chatMentionAck:${meU}`;
    const baseKey = `chatMentionBaseline:${meU}`;

    try { mentionAckRef.current = new Set(JSON.parse(localStorage.getItem(ackKey) || '[]')); } catch { mentionAckRef.current = new Set(); }
    let baseline = parseInt(localStorage.getItem(baseKey) || '0', 10);
    if (!baseline) { baseline = Date.now(); try { localStorage.setItem(baseKey, String(baseline)); } catch {} }

    mentionPersistRef.current = () => {
      try { localStorage.setItem(ackKey, JSON.stringify([...mentionAckRef.current].slice(-500))); } catch {}
    };

    // Decide whether one message should alert this user, and if so enqueue it.
    const consider = (msg, channel) => {
      if (!msg || !msg.id || !msg.text) return;
      if ((msg.username || '').toUpperCase() === meU) return;            // not my own message
      if (msg.timestamp && msg.timestamp < baseline) return;            // predates this session's baseline
      if (mentionAckRef.current.has(msg.id)) return;                    // already acknowledged
      if (mentionQueueRef.current.some(x => x.id === msg.id)) return;   // already queued
      if (!isMentioned(msg.text, currentUser)) return;
      mentionQueueRef.current.push({ id: msg.id, from: msg.username || 'Someone', text: String(msg.text), channel });
      setMention(cur => cur || mentionQueueRef.current[0]);
    };
    considerMentionRef.current = consider; // let the 5-min pollChats safety-net reuse it

    // Read one chat file and surface any unacknowledged @mentions in it.
    const scanAdvisor = async () => { try { const a = await loadChatMessages(); (Array.isArray(a) ? a : []).forEach(m => consider(m, 'Advisor Chat')); } catch {} };
    const scanTech = async () => { try { const t = await loadTechChatMessages(); (Array.isArray(t) ? t : []).forEach(m => consider(m, 'Tech Chat')); } catch {} };

    let advCh, techCh, pusher;
    // On a new-message ping: if the event carries the message (sender on this
    // build) check it instantly with no read; otherwise (older sender, whose
    // event has no payload) re-read the chat file. Either way only the RECEIVER
    // needs this code — so an @mention pops even if the sender hasn't updated.
    const onAdv = (data) => { if (data && data.text) consider(data, 'Advisor Chat'); else scanAdvisor(); };
    const onTech = (data) => { if (data && data.text) consider(data, 'Tech Chat'); else scanTech(); };
    const onConnect = () => { scanAdvisor(); scanTech(); };
    try {
      pusher = getPusher();
      advCh = pusher.subscribe(ADVISOR_CHANNEL);
      techCh = pusher.subscribe(TECH_CHANNEL);
      advCh.bind(NEW_MSG_EVENT, onAdv);
      techCh.bind(NEW_MSG_EVENT, onTech);
      pusher.connection.bind('connected', onConnect); // re-scan after a reconnect
    } catch (e) { console.warn('mention watcher subscribe failed:', e); }

    scanAdvisor(); scanTech(); // initial catch-up on login

    return () => {
      considerMentionRef.current = null;
      try {
        if (advCh) advCh.unbind(NEW_MSG_EVENT, onAdv);
        if (techCh) techCh.unbind(NEW_MSG_EVENT, onTech);
        if (pusher) pusher.connection.unbind('connected', onConnect);
      } catch {}
    };
  }, [isLoggedIn, currentUser]);

  // OK on the mention popup: acknowledge it (so it never returns) and show the
  // next queued mention, if any.
  const dismissMention = useCallback(() => {
    setMention(cur => {
      if (cur) {
        mentionAckRef.current.add(cur.id);
        mentionPersistRef.current();
        mentionQueueRef.current = mentionQueueRef.current.filter(x => x.id !== cur.id);
      }
      return mentionQueueRef.current[0] || null;
    });
  }, []);

  useEffect(() => {
    if (!isLoggedIn || !currentUser) return;
    const me = currentUser.toUpperCase();

    // Initialize lastSeen to now on first login so old messages don't trigger badge
    if (!localStorage.getItem('advisorChatLastSeen')) localStorage.setItem('advisorChatLastSeen', Date.now().toString());
    if (!localStorage.getItem('techChatLastSeen')) localStorage.setItem('techChatLastSeen', Date.now().toString());

    function getLastSeen(key) { return parseInt(localStorage.getItem(key) || '0', 10); }

    function playBell() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.4);
        gain.gain.setValueAtTime(0.4, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.8);
        osc.onended = () => ctx.close();
      } catch {}
    }

    let prevAdvisor = 0;
    let prevTech = 0;

    async function pollChats() {
      try {
        const curPage = pageRef.current;

        // If user is currently viewing the chat, keep lastSeen current so no stale badges on return
        if (curPage === 'advisor-calendar') localStorage.setItem('advisorChatLastSeen', Date.now().toString());
        if (curPage === 'work-in-progress') localStorage.setItem('techChatLastSeen', Date.now().toString());

        const [advisorMsgs, techMsgs] = await Promise.all([loadChatMessages(), loadTechChatMessages()]);

        // Safety net for @mention popups: if a Pusher event was missed (socket
        // asleep), this catches the mention within the poll window.
        const cm = considerMentionRef.current;
        if (cm) {
          (Array.isArray(advisorMsgs) ? advisorMsgs : []).forEach(m => cm(m, 'Advisor Chat'));
          (Array.isArray(techMsgs) ? techMsgs : []).forEach(m => cm(m, 'Tech Chat'));
        }

        const advisorSeen = getLastSeen('advisorChatLastSeen');
        const techSeen = getLastSeen('techChatLastSeen');

        const newAdvisor = curPage === 'advisor-calendar' ? 0 :
          advisorMsgs.filter(m => m.timestamp > advisorSeen && m.username.toUpperCase() !== me).length;
        const newTech = curPage === 'work-in-progress' ? 0 :
          techMsgs.filter(m => m.timestamp > techSeen && m.username.toUpperCase() !== me).length;

        if (newAdvisor > prevAdvisor || newTech > prevTech) playBell();
        prevAdvisor = newAdvisor;
        prevTech = newTech;

        setAdvisorUnread(newAdvisor);
        setTechUnread(newTech);
      } catch {}
    }

    pollChats();
    const id = setInterval(pollChats, 300000); // 5-min fallback; Pusher handles real-time
    return () => clearInterval(id);
  }, [isLoggedIn, currentUser]);

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
        // Re-sync the logged-in user's role from the latest users list so role
        // changes (e.g. promoted to lead advisor, or granted Management Access)
        // take effect on refresh — not only on next login (currentRole is
        // otherwise cached from login time). Compare against the *effective*
        // role so the manager marker survives refreshes.
        const meNow = (localStorage.getItem('currentUser') || '').toUpperCase();
        if (meNow) {
          const rec = githubUsers.find(u => (u.username || '').toUpperCase() === meNow);
          const effRole = effectiveRole(rec);
          if (rec && effRole !== (localStorage.getItem('currentRole') || '')) {
            localStorage.setItem('currentRole', effRole);
            setCurrentRole(effRole);
          }
        }
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
      const role = effectiveRole(match);
      const canEdit = role === 'admin' || role.includes('manager') || !!match.canEditDashboard;
      const pages = match.pages || null;
      localStorage.setItem(AUTH_KEY, 'true');
      localStorage.setItem('currentUser', match.username);
      localStorage.setItem('currentRole', role);
      localStorage.setItem('canEditDashboard', String(canEdit));
      localStorage.setItem('currentPages', JSON.stringify(pages));
      setIsLoggedIn(true);
      setCurrentUser(match.username);
      setCurrentRole(role);
      setCanEditDashboard(canEdit);
      setCurrentPages(pages);
      initActivityTracker(match.username, role);
      trackAction('login');
    } else {
      alert('Login failed.');
    }
  }

  function handleLogout() {
    trackAction('logout');
    shutdownActivityTracker();
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
    recalcTech(newData, schedulesRef.current);
    recalcAdvisorSummary(newData);
    newData.advisors.forEach(a => {
      const p = newData.advisorMonthlyWorkdays || 27;
      // daily_avg gets recalculated in the component
    });
    setData({ ...newData });
    setVacations([...newVacations]);
  }

  // Applying a SERVICE gross report on the Goal Forecast page writes its MTD
  // pacing figures straight into the dashboard Goal Gauges (grossActual /
  // cpActual) and persists them, so the gauges update daily off the same upload.
  async function handleGaugeActuals(patch) {
    if (!patch || typeof patch !== 'object') return;
    // Remember these so the 90s poll can't revert them mid-propagation.
    gaugeActualsRef.current = { ...patch, ts: Date.now() };
    const merged = { ...data, ...patch };
    setData(merged);
    try {
      await saveDashboardToGitHub({ data: merged, vacations });
      // Refresh the ts so the guard window covers the full save latency.
      gaugeActualsRef.current = { ...patch, ts: Date.now() };
    } catch (e) {
      console.warn('gauge actuals save failed', e);
    }
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

  // Lead advisors are advisors too — include them so they appear in advisor
  // pickers (WIP RO assignment, schedules, calendar, etc.). A user who manages
  // the department but is still an advisor keeps their advisor role here and is
  // granted manager access separately (see `managementAccess` / effectiveRole).
  const advisorList = users.filter(u => u.role === 'advisor' || u.role === 'lead advisor').map(u => u.username.toUpperCase());
  // The Advisor Schedule roster also includes the service manager, who works
  // advisor shifts but isn't an advisor for survey/performance purposes — so this
  // is kept separate from `advisorList` (which seeds advisor pickers/reports).
  const advisorScheduleList = users
    .filter(u => u.role === 'advisor' || u.role === 'lead advisor' || u.role === 'service manager')
    .map(u => u.username.toUpperCase());
  const techList = users.filter(u => u.role === 'technician').map(u => u.username.toUpperCase());
  const currentUserDisplay = userDisplayName(currentUser, users).toUpperCase();
  // Which Goal Forecast a user owns is decided by WHO they are, not which page
  // they open — so a parts manager always sees parts and a service manager always
  // sees service, even on different computers. Explicit per-user `goalDept` wins;
  // otherwise infer from the role (parts → parts, everyone else → service).
  const currentUserRecord = users.find(u => (u.username || '').toLowerCase() === (currentUser || '').toLowerCase()) || {};
  const goalDept = currentUserRecord.goalDept || ((currentRole || '').includes('parts') ? 'parts' : 'service');

  // `currentRole` answers "what may this person SEE" — Management Access folds a
  // "manager" marker into it so manager views unlock. `jobRole` answers "what IS
  // this person" — their actual job title, never touched by that grant. Pages
  // that decide *identity* (is this a tech? an advisor?) must use `jobRole`, or a
  // technician with Management Access reads as "technician manager" and stops
  // matching `=== 'technician'` — losing his own tech schedule, reviews, and
  // performance reports. Falls back to stripping the marker while `users` loads.
  const jobRole = (currentUserRecord.role || (currentRole || '').replace(/\s*manager$/i, '')).toLowerCase();
  const ownAdvisor = currentUser.toUpperCase();
  const activeAdvisor = viewingAdvisor || ownAdvisor;

  // Technician pages
  if (page === 'tech-resources') {
    return (
      <TechResources
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        currentRole={currentRole}
        jobRole={jobRole}
        userPages={currentPages}
        onWorkSchedule={() => setPage('tech-work-schedule')}
        onAdvisorSchedule={() => setPage('tech-view-advisor-schedule')}
        onDocumentLibrary={() => goTo('document-library', 'tech-resources')}
        onWorkInProgress={() => goTo('work-in-progress', 'tech-resources')}
        onATDiagWorksheet={() => { setPrevPage('tech-resources'); goTo('at-diag-worksheet', 'tech-resources'); }}
        onHotRepairs={() => goTo('hot-repairs', 'tech-resources')}
        onMyReview={() => navTo('tech-self-review')}
        onMyReports={() => goTo('performance-report', 'tech-resources')}
        onBack={() => setPage('dashboard')}
      />
    );
  }

  if (page === 'at-diag-worksheet') {
    const atBackDest  = prevPage === 'warranty-hub' ? 'warranty-hub' : 'tech-resources';
    const atBackLabel = prevPage === 'warranty-hub' ? '← Warranty Hub' : '← Technician Resources';
    return (
      <ATDiagWorksheet
        backLabel={atBackLabel}
        onBack={() => navTo(atBackDest)}
        onDCTMTM={() => goTo('dct-mtm-worksheet', 'at-diag-worksheet')}
        onIVT={() => goTo('ivt-worksheet', 'at-diag-worksheet')}
        onATM={() => goTo('atm-worksheet', 'at-diag-worksheet')}
      />
    );
  }

  if (page === 'atm-worksheet') {
    return (
      <ATMWorksheet
        currentUser={currentUser.toUpperCase()}
        currentRole={currentRole}
        onBack={() => navTo('at-diag-worksheet')}
      />
    );
  }

  if (page === 'ivt-worksheet') {
    return (
      <IVTWorksheet
        currentUser={currentUser.toUpperCase()}
        currentRole={currentRole}
        onBack={() => navTo('at-diag-worksheet')}
      />
    );
  }

  if (page === 'dct-mtm-worksheet') {
    return (
      <DCTMTMWorksheet
        currentUser={currentUser.toUpperCase()}
        currentRole={currentRole}
        onBack={() => navTo('at-diag-worksheet')}
      />
    );
  }

  if (page === 'ntt-att-worksheet') {
    return (
      <ATTNTTWorksheet
        currentUser={currentUser.toUpperCase()}
        currentRole={currentRole}
        onBack={() => navTo('warranty-hub')}
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
        currentUser={currentUser.toUpperCase()} currentRole={currentRole} title="Tech Schedule"
        onBack={() => setPage('tech-resources')} />
    );
  }

  if (page === 'tech-view-advisor-schedule') {
    if (window.innerWidth < 600) return (
      <MobileSchedule schedules={schedules} employeeNames={advisorScheduleList}
        currentUser={currentUser.toUpperCase()} title="Advisor Schedule"
        onBack={() => setPage('tech-resources')} />
    );
    return (
      <WorkSchedule schedules={schedules} employeeNames={advisorScheduleList}
        currentUser={currentUser.toUpperCase()} currentRole={currentRole} title="Advisor Schedule"
        onBack={() => setPage('tech-resources')} />
    );
  }

  if (page === 'work-in-progress') {
    if (!canAccess('workInProgress')) { setPage('tech-resources'); return null; }
    const wipBackLabel = prevPage === 'advisor-calendar' ? '← Advisor Calendar' : prevPage === 'parts-hub' ? '← Parts Hub' : '← Technician Resources';
    return (
      <WorkInProgress
        currentUser={currentUser.toUpperCase()}
        currentRole={currentRole}
        jobRole={jobRole}
        techList={techList}
        advisorList={advisorList}
        backLabel={wipBackLabel}
        onBack={() => { setWipInitialRO(null); navTo(prevPage || 'tech-resources'); }}
        chatUsers={users.filter(u => u.techChatAccess).map(u => u.username.toUpperCase())}
        initialJob={wipInitialRO}
        onInitialJobConsumed={() => setWipInitialRO(null)}
      />
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
        currentUser={currentUser.toUpperCase()} currentRole={currentRole}
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
        currentUserDisplay={currentUserDisplay}
        currentRole={currentRole}
        userPages={currentPages}
        onBack={() => setPage('dashboard')}
        onAftermarketWarranty={() => goTo('aftermarket-warranty', 'parts-hub')}
        onDocumentLibrary={() => goTo('document-library', 'parts-hub')}
        onAdvisorCalendar={() => goTo('advisor-calendar', 'parts-hub')}
        onAdvisorSchedule={() => goTo('work-schedule', 'parts-hub')}
        onTechSchedule={() => goTo('advisor-view-tech-schedule', 'parts-hub')}
        onAdvisorRankBoard={openRankBoard}
        onWorkInProgress={() => goTo('work-in-progress', 'parts-hub')}
        onHotRepairs={() => goTo('hot-repairs', 'parts-hub')}
        onGoalForecast={() => goTo('parts-goal-forecast', 'parts-hub')}
      />
    );
  }

  if (page === 'parts-goal-forecast') {
    return (
      <GoalForecast
        data={data}
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        title="Parts Goal Forecast"
        deptLabel="Parts Department"
        backLabel="← Parts Hub"
        storagePrefix="partsGoalForecast"
        onGaugeActuals={handleGaugeActuals}
        onBack={() => navTo(prevPage || 'parts-hub')}
      />
    );
  }

  // Warranty Hub
  if (page === 'used-car-hub') {
    if (!canAccess('usedCarHub')) { setPage('dashboard'); return null; }
    return (
      <UsedCarHub
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        currentRole={currentRole}
        jobRole={jobRole}
        techList={techList}
        advisorList={advisorList}
        onBack={() => setPage('dashboard')}
      />
    );
  }

  if (page === 'warranty-hub') {
    return (
      <WarrantyHub
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        currentRole={currentRole}
        userPages={currentPages}
        onBack={() => setPage('dashboard')}
        onAftermarketWarranty={() => goTo('aftermarket-warranty', 'warranty-hub')}
        onTireWarranty={() => goTo('tire-warranty', 'warranty-hub')}
        onOriginalOwner={() => goTo('original-owner', 'warranty-hub')}
        onDocumentLibrary={() => goTo('document-library', 'warranty-hub')}
        onATDiagWorksheet={() => { setPrevPage('warranty-hub'); goTo('at-diag-worksheet', 'warranty-hub'); }}
        onNttAttWorksheet={() => goTo('ntt-att-worksheet', 'warranty-hub')}
        onHotRepairs={() => goTo('hot-repairs', 'warranty-hub')}
      />
    );
  }

  // Manager Hub
  if (page === 'manager-hub') {
    const isManager = currentRole === 'admin' || currentRole === 'parts manager' || currentRole === 'service manager' || (currentRole || '').includes('manager');
    if (!isManager) { setPage('dashboard'); return null; }
    return (
      <ManagerHub
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        currentRole={currentRole}
        onBack={() => setPage('dashboard')}
        onSurveyReports={() => { setViewingAdvisor(ownAdvisor || advisorList[0] || ''); goTo('survey-reports', 'manager-hub'); }}
        onAdvisorCalendar={() => { setViewingAdvisor(ownAdvisor || advisorList[0] || ''); goTo('advisor-calendar', 'manager-hub'); }}
        onAftermarketWarranty={() => goTo('aftermarket-warranty', 'manager-hub')}
        onDocumentLibrary={() => goTo('document-library', 'manager-hub')}
        onAdvisorSchedule={() => goTo('work-schedule', 'manager-hub')}
        onTechSchedule={() => goTo('advisor-view-tech-schedule', 'manager-hub')}
        onAdvisorRankBoard={openRankBoard}
        onChargeAccountList={() => goTo('charge-account-list', 'manager-hub')}
        onEmployeeReview={() => goTo('employee-review', 'manager-hub')}
        onPerformanceReports={() => goTo('mgr-performance-reports', 'manager-hub')}
        onRepairOrderDatabase={() => goTo('repair-order-database', 'manager-hub')}
        onUserDataTracker={() => goTo('user-data-tracker', 'manager-hub')}
        onGoalForecast={() => goTo('goal-forecast', 'manager-hub')}
        onAdvisorForecast={() => goTo('advisor-goals', 'manager-hub')}
      />
    );
  }

  if (page === 'goal-forecast') {
    const isManager = currentRole === 'admin' || currentRole === 'parts manager' || currentRole === 'service manager' || (currentRole || '').includes('manager');
    if (!isManager) { setPage('dashboard'); return null; }
    const partsDept = goalDept === 'parts';
    return (
      <GoalForecast
        data={data}
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        title={partsDept ? 'Parts Goal Forecast' : 'Goal Forecast'}
        deptLabel={partsDept ? 'Parts Department' : 'Service Department'}
        storagePrefix={partsDept ? 'partsGoalForecast' : 'goalForecast'}
        onGaugeActuals={handleGaugeActuals}
        onBack={() => navTo(prevPage || 'manager-hub')}
      />
    );
  }

  if (page === 'advisor-goals') {
    const goalsRoster = users
      .filter(u => u.role === 'advisor' || u.role === 'lead advisor')
      .map(u => u.username.toUpperCase());
    return (
      <AdvisorGoals
        currentUser={currentUser.toUpperCase()}
        currentRole={currentRole}
        advisors={goalsRoster}
        schedules={schedules}
        vacations={vacations}
        onBack={() => navTo(prevPage === 'manager-hub' ? 'manager-hub' : 'advisor-calendar')}
        backLabel={prevPage === 'manager-hub' ? '← Manager Hub' : '← Appointment Prep Calendar'}
        onLivePay={(adv) => { setLivePayFocus(adv || ''); goTo('live-pay', 'advisor-goals'); }}
      />
    );
  }

  if (page === 'user-data-tracker') {
    const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
    if (!isManager) { setPage('dashboard'); return null; }
    return <UserDataTracker onBack={() => navTo(prevPage || 'manager-hub')} />;
  }

  if (page === 'ro-upload') {
    // Managers + lead advisors can bulk-upload ROs.
    const canUpload = currentRole === 'admin' || (currentRole || '').includes('manager') || currentRole === 'lead advisor';
    if (!canUpload) { setPage('dashboard'); return null; }
    return <RoUpload currentUser={currentUser.toUpperCase()} techList={techList} onBack={() => navTo(prevPage || 'advisor-calendar')} />;
  }

  if (page === 'repair-order-database') {
    const isManager = currentRole === 'admin' || (currentRole || '').includes('manager');
    if (!isManager) { setPage('dashboard'); return null; }
    return (
      <RepairOrderDatabase
        currentUser={currentUser.toUpperCase()}
        onBack={() => navTo(prevPage || 'manager-hub')}
      />
    );
  }

  if (page === 'charge-account-list') {
    if (!canAccess('chargeAccountList')) { setPage('dashboard'); return null; }
    return <ChargeAccountList onBack={() => setPage(prevPage || 'manager-hub')} />;
  }

  if (page === 'employee-review') {
    return (
      <EmployeeReviewHub
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        onBack={() => navTo('manager-hub')}
        onTechReview={() => goTo('tech-review', 'employee-review')}
        onAdvisorReview={() => goTo('advisor-review', 'employee-review')}
      />
    );
  }

  if (page === 'tech-self-review') {
    return (
      <TechSelfReview
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        onBack={() => navTo('tech-resources')}
      />
    );
  }

  if (page === 'performance-report') {
    return (
      <PerformanceReport
        currentUser={currentUser.toUpperCase()}
        role={jobRole}
        onBack={() => navTo(prevPage || (jobRole === 'technician' ? 'tech-resources' : 'advisor-calendar'))}
        canDelete={isAdminOrManager}
      />
    );
  }

  if (page === 'mgr-performance-reports') {
    return (
      <ManagerReports
        users={users}
        onBack={() => navTo('manager-hub')}
      />
    );
  }

  if (page === 'tech-review') {
    return (
      <TechReview
        currentUser={currentUser.toUpperCase()}
        techList={techList}
        onBack={() => navTo('employee-review')}
      />
    );
  }

  if (page === 'advisor-review') {
    return (
      <AdvisorReview
        currentUser={currentUser.toUpperCase()}
        onBack={() => navTo('employee-review')}
      />
    );
  }

  // Advisor pages render full-screen outside the scaled stage
  if (page === 'work-schedule') {
    const wsBackLabel = prevPage === 'parts-hub' ? '← Parts Hub' : '← Advisor Calendar';
    const backDest = prevPage || 'advisor-calendar';
    // Technicians routed here should see the tech schedule, not advisor schedule
    if (jobRole === 'technician') {
      if (window.innerWidth < 600) return (
        <MobileSchedule schedules={schedules} employeeNames={techList}
          currentUser={currentUser.toUpperCase()} title="Tech Schedule"
          onBack={() => setPage(backDest)} />
      );
      return (
        <WorkSchedule schedules={schedules} employeeNames={techList}
          currentUser={currentUser.toUpperCase()} currentRole={currentRole}
          onBack={() => setPage(backDest)}
          backLabel={wsBackLabel} />
      );
    }
    if (window.innerWidth < 600) return (
      <MobileSchedule schedules={schedules} employeeNames={advisorScheduleList}
        currentUser={currentUser.toUpperCase()} title="Advisor Schedule"
        onBack={() => setPage(backDest)} />
    );
    return (
      <WorkSchedule schedules={schedules} employeeNames={advisorScheduleList}
        currentUser={currentUser.toUpperCase()} currentRole={currentRole}
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
        onBack={() => { setViewingAdvisor(''); navTo('dashboard'); }}
        onDocumentLibrary={() => goTo('document-library', 'advisor-calendar')}
        onWorkSchedule={() => goTo('work-schedule', 'advisor-calendar')}
        onTechSchedule={() => goTo('advisor-view-tech-schedule', 'advisor-calendar')}
        onAftermarketWarranty={() => goTo('aftermarket-warranty', 'advisor-calendar')}
        onOriginalOwner={() => goTo('original-owner', 'advisor-calendar')}
        onSurveyReports={() => setPage('survey-reports')}
        onAfterCall={() => setPage('after-call')}
        onMyReports={() => goTo('performance-report', 'advisor-calendar')}
        onWorkInProgress={(arg) => { setWipInitialRO(arg && typeof arg === 'object' ? arg : (typeof arg === 'string' ? { ro: arg } : null)); goTo('work-in-progress', 'advisor-calendar'); }}
        onRoUpload={() => goTo('ro-upload', 'advisor-calendar')}
        onHotRepairs={() => goTo('hot-repairs', 'advisor-calendar')}
        onGoalsForecasting={() => goTo('advisor-goals', 'advisor-calendar')}
        onServicePricing={() => goTo('service-pricing', 'advisor-calendar')}
        onChargeList={() => goTo('charge-account-list', 'advisor-calendar')}
        techNames={(data.technicians || []).map(t => t.name).filter(Boolean)}
        refreshKey={calendarRefreshKey}
        userPages={currentPages}
        currentRole={currentRole}
        currentUser={currentUser.toUpperCase()}
        schedules={schedules}
        vacations={vacations}
        chatUsers={users.filter(u => u.chatAccess).map(u => u.username.toUpperCase())}
        techChatUsers={users.filter(u => u.techChatAccess).map(u => u.username.toUpperCase())}
      />
    );
  }

  if (page === 'survey-reports') {
    if (!canAccess('surveyReports')) { setPage(prevPage || 'advisor-calendar'); return null; }
    return (
      <SurveyReports
        advisorList={advisorList}
        canDelete={isAdminOrManager}
        initialAdvisor={surveyFocus}
        onBack={() => setPage(prevPage || 'advisor-calendar')}
      />
    );
  }
  if (page === 'advisor-day' && selectedDay) {
    return (
      <AdvisorDayForm
        advisorName={activeAdvisor}
        ownAdvisor={ownAdvisor}
        date={selectedDay}
        onBack={() => { setCalendarRefreshKey(k => k + 1); navTo('advisor-calendar'); }}
      />
    );
  }
  // After Call Reviews — always one advisor: your own, or whoever a manager has
  // selected on the calendar.
  if (page === 'after-call') {
    return (
      <AfterCallReport
        advisorName={activeAdvisor}
        ownAdvisor={ownAdvisor}
        currentRole={currentRole}
        canEditDashboard={canEditDashboard}
        onBack={() => navTo('advisor-calendar')}
      />
    );
  }
  if (page === 'document-library') {
    const dlBackLabels = {
      'parts-hub':      '← Parts Hub',
      'manager-hub':    '← Manager Hub',
      'tech-resources': '← Tech Resources',
      'advisor-calendar': '← Advisor Calendar',
    };
    const dlBackLabel = dlBackLabels[prevPage] || '← Back';
    return (
      <DocumentLibrary
        currentUser={currentUser}
        currentRole={currentRole}
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={dlBackLabel}
      />
    );
  }

  if (page === 'service-pricing') {
    const spBackLabels = {
      'parts-hub': '← Parts Hub',
      'manager-hub': '← Manager Hub',
      'tech-resources': '← Tech Resources',
      'advisor-calendar': '← Appointment Prep Calendar',
    };
    return (
      <ServicePricingMenu
        currentUser={currentUser}
        currentRole={currentRole}
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={spBackLabels[prevPage] || '← Back'}
      />
    );
  }

  if (page === 'live-pay') {
    return (
      <LivePay
        data={data}
        currentUser={currentUser.toUpperCase()}
        currentRole={currentRole}
        leadAdvisor={(users.find(u => (u.role || '').toLowerCase() === 'lead advisor') || {}).username || ''}
        initialAdvisor={livePayFocus}
        onFixCsi={(adv) => {
          // Jump to the advisor's After Call Report (pending surveys to work), not the
          // manager Survey Reports table. Preselect the advisor and use today's date.
          if (adv) setViewingAdvisor(adv);
          const t = new Date();
          const todayStr = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
          setSelectedDay(todayStr);
          goTo('advisor-day', 'live-pay');
        }}
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={prevPage === 'advisor-goals' ? '← Goals / Forecasting' : '← Appointment Prep Calendar'}
      />
    );
  }

  if (page === 'hot-repairs') {
    const hrBackLabels = {
      'tech-resources':  '← Tech Resources',
      'manager-hub':     '← Manager Hub',
      'advisor-calendar':'← Advisor Calendar',
      'warranty-hub':    '← Warranty Hub',
      'parts-hub':       '← Parts Hub',
    };
    return (
      <HotRepairs
        currentUser={currentUser.toUpperCase()}
        currentUserDisplay={currentUserDisplay}
        currentRole={currentRole}
        onBack={() => setPage(prevPage || 'tech-resources')}
        backLabel={hrBackLabels[prevPage] || '← Back'}
      />
    );
  }

  if (page === 'aftermarket-warranty') {
    if (!canAccess('aftermarketWarranty')) { setPage(prevPage || 'advisor-calendar'); return null; }
    const awBackLabel = prevPage === 'parts-hub' ? '← Parts Hub' : prevPage === 'warranty-hub' ? '← Warranty Hub' : '← Advisor Calendar';
    return (
      <AftermarketWarranty
        currentUser={currentUser}
        currentRole={currentRole}
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={awBackLabel}
      />
    );
  }

  if (page === 'tire-warranty') {
    const twBackLabel = prevPage === 'warranty-hub' ? '← Warranty Hub' : '← Advisor Calendar';
    return (
      <TireWarranty
        currentUser={currentUser}
        currentRole={currentRole}
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={twBackLabel}
      />
    );
  }

  if (page === 'original-owner') {
    if (!canAccess('originalOwner')) { setPage(prevPage || 'advisor-calendar'); return null; }
    const ooBackLabel = prevPage === 'warranty-hub' ? '← Warranty Hub' : '← Advisor Calendar';
    return (
      <OriginalOwnerAffidavit
        onBack={() => setPage(prevPage || 'advisor-calendar')}
        backLabel={ooBackLabel}
      />
    );
  }

  // Phone-only mobile view — tablet/desktop/TV use the existing scaled layout unchanged
  if (window.innerWidth < 600) {
    if (page === 'mobile-advisor-schedule') {
      return (
        <MobileSchedule
          schedules={schedules}
          employeeNames={advisorScheduleList}
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
          onEdit={() => setAdminOpen(true)}
          onAdvisor={() => { localStorage.setItem('advisorChatLastSeen', Date.now().toString()); setAdvisorUnread(0); setPage('advisor-calendar'); }}
          onTechnician={() => { localStorage.setItem('techChatLastSeen', Date.now().toString()); setTechUnread(0); setPage('tech-resources'); }}
          advisorUnread={advisorUnread} techUnread={techUnread}
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
      {/* @mention alert — a blocking popup when someone tags you in chat. */}
      {mention && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(2,6,23,.78)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
          <div style={{ width: '100%', maxWidth: 460, background: 'linear-gradient(180deg,#1e293b,#0f172a)', border: '2px solid rgba(96,165,250,.65)', borderRadius: 20, boxShadow: '0 30px 90px rgba(0,0,0,.85), 0 0 30px rgba(59,130,246,.4)', padding: '30px 28px', textAlign: 'center' }}>
            <div style={{ fontSize: 46, marginBottom: 6 }}>💬</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#f1f5f9', lineHeight: 1.25, marginBottom: 10 }}>
              {(currentUser || '').toUpperCase()}, YOU HAVE A NEW CHAT MESSAGE
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 800, color: '#93c5fd', letterSpacing: .4, textTransform: 'uppercase', marginBottom: 12 }}>
              {mention.channel} · from {String(mention.from).toUpperCase()}
            </div>
            <div style={{ fontSize: 15, color: '#e2e8f0', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(148,163,184,.22)', borderRadius: 12, padding: '13px 15px', marginBottom: 22, lineHeight: 1.45, textAlign: 'left' }}>
              {mention.text}
            </div>
            <button onClick={dismissMention} autoFocus
              style={{ background: 'linear-gradient(180deg,#3b82f6,#2563eb)', border: '1px solid rgba(96,165,250,.7)', color: '#fff', borderRadius: 12, padding: '12px 48px', fontWeight: 900, fontSize: 17, cursor: 'pointer', minWidth: 170, boxShadow: '0 8px 20px rgba(37,99,235,.5)' }}>
              OK
            </button>
          </div>
        </div>
      )}
      <div className="stage" ref={stageRef}>
        <div className="dashboard">
          <Header
            data={data}
            isLoggedIn={isLoggedIn}
            currentUser={currentUser}
            currentUserDisplay={userDisplayName(currentUser, users)}
            currentRole={currentRole}
            userPages={currentPages}
            canEditDashboard={canEditDashboard}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onEdit={() => setAdminOpen(true)}
            onAdvisor={() => { localStorage.setItem('advisorChatLastSeen', Date.now().toString()); setAdvisorUnread(0); navTo('advisor-calendar'); }}
            onTechnician={() => { localStorage.setItem('techChatLastSeen', Date.now().toString()); setTechUnread(0); navTo('tech-resources'); }}
            onParts={() => setPage('parts-hub')}
            onWarranty={() => setPage('warranty-hub')}
            onUsedCar={() => setPage('used-car-hub')}
            onManager={() => setPage('manager-hub')}
            advisorUnread={advisorUnread}
            techUnread={techUnread}
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

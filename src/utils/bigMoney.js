// Big-Money LOF — advisor contest on the two $50 add-on numbers from the
// dashboard ($50 Add'l Hrs/RO and $50 Add Rate %). Everything here is pure so
// the contest page, the Advisor Calendar tab badge and App.jsx all agree on
// who qualifies and who's leading.
//
// Stored in public/data/big-money-lof.json:
//   { contest: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', prize: 1000, updatedAt, by },
//     final:   { takenAt, standings: [...] }   // banked once the window closes
//     latest:  { takenAt, standings: [...] } } // rolling snapshot while live
import { safe } from './formatters';
import { roh50Goals } from './calculations';

export const BIG_MONEY_PATH = 'data/big-money-lof.json';
// Team-effort payout: the full prize needs the STORE AVERAGE over goal on both
// numbers; if the store misses, the winner still gets the reduced prize.
export const DEFAULT_PRIZE = 1000;
export const DEFAULT_REDUCED_PRIZE = 500;

export const prizeFor = (file) => {
  const c = (file && file.contest) || {};
  return { full: Number(c.prize) || DEFAULT_PRIZE, reduced: c.reducedPrize != null && c.reducedPrize !== '' ? Number(c.reducedPrize) || 0 : DEFAULT_REDUCED_PRIZE };
};

export const STATUS = { OFF: 'off', UPCOMING: 'upcoming', LIVE: 'live', ENDED: 'ended' };

const firstName = (s) => String(s || '').trim().split(/\s+/)[0].toUpperCase();

export const todayKey = (d = new Date()) => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// Where the contest stands today. No dates → off.
export function contestStatus(file, now = new Date()) {
  const c = file && file.contest;
  if (!c || !c.start || !c.end) return STATUS.OFF;
  const t = todayKey(now);
  if (t < c.start) return STATUS.UPCOMING;
  if (t > c.end) return STATUS.ENDED;
  return STATUS.LIVE;
}

export function fmtContestDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Days left in the window (inclusive of today). 0 on the last day.
export function daysLeft(file, now = new Date()) {
  const c = file && file.contest;
  if (!c || !c.end) return null;
  const [y, m, d] = c.end.split('-').map(Number);
  const end = new Date(y, m - 1, d);
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((end - t) / 86400000));
}

// Rank every visible advisor on the two contest numbers.
//   qualified = met BOTH goals. Leader = best $50 Add'l Hrs/RO among the
//   qualified; ties broken by the higher $50 Add Rate %.
// Returns rows sorted qualified-first, then by hrs/RO desc, then rate desc,
// plus the store average (team goal) — same rule as the dashboard's Avg tiles:
// advisors flagged "Don't apply to dashboard" are left out of the average.
export function computeStandings(advisors, dashboardData) {
  const goals = roh50Goals(dashboardData);
  const goalsSet = goals.hrs_ro > 0 && goals.add_rate > 0;
  const rows = (advisors || [])
    .filter(a => a && a.name && !a.hidden)
    .map(a => {
      const hrsRo = Math.round(safe(a.roh50_hrs_ro, 0) * 100) / 100;
      const rate  = Math.round(safe(a.roh50_add_rate, 0) * 1000) / 1000;
      const hitHrs  = goals.hrs_ro   > 0 && hrsRo >= goals.hrs_ro;
      const hitRate = goals.add_rate > 0 && rate  >= goals.add_rate;
      return { name: firstName(a.name), display: a.name, hrsRo, rate, hitHrs, hitRate, qualified: goalsSet && hitHrs && hitRate, inAvg: !a.exclude_from_avg };
    })
    .sort((x, y) => (y.qualified - x.qualified) || (y.hrsRo - x.hrsRo) || (y.rate - x.rate) || x.name.localeCompare(y.name));
  rows.forEach((r, i) => { r.rank = i + 1; r.leader = r.qualified && i === 0; });

  const counted = rows.filter(r => r.inAvg);
  const n = counted.length || 1;
  const avgHrs  = Math.round(counted.reduce((s, r) => s + r.hrsRo, 0) / n * 100) / 100;
  const avgRate = Math.round(counted.reduce((s, r) => s + r.rate, 0) / n * 1000) / 1000;
  const storeHitHrs  = goals.hrs_ro   > 0 && avgHrs  >= goals.hrs_ro;
  const storeHitRate = goals.add_rate > 0 && avgRate >= goals.add_rate;
  const store = { hrsRo: avgHrs, rate: avgRate, hitHrs: storeHitHrs, hitRate: storeHitRate, hit: goalsSet && storeHitHrs && storeHitRate, count: counted.length };
  return { goals, goalsSet, rows, store };
}

// The standings a viewer should see: banked final results once the window has
// closed, otherwise the live computation.
export function standingsFor(file, advisors, dashboardData, now = new Date()) {
  const status = contestStatus(file, now);
  if (status === STATUS.ENDED && file && file.final && Array.isArray(file.final.standings)) {
    const f = file.final;
    return { ...f, rows: f.standings, goals: f.goals || roh50Goals(dashboardData), goalsSet: true,
             store: f.store || computeStandings(f.standings.map(r => ({ name: r.name, roh50_hrs_ro: r.hrsRo, roh50_add_rate: r.rate, exclude_from_avg: r.inAvg === false })), dashboardData).store,
             banked: true };
  }
  return { ...computeStandings(advisors, dashboardData), banked: false };
}

// What the Advisor Calendar tab shows next to the label for this advisor.
//   '🏆' leading the contest (and qualified)   '✅' qualified   '' otherwise
export function tabBadgeFor(file, advisors, dashboardData, username, now = new Date()) {
  const status = contestStatus(file, now);
  if (status !== STATUS.LIVE) return '';
  const me = firstName(username);
  const row = computeStandings(advisors, dashboardData).rows.find(r => r.name === me);
  if (!row || !row.qualified) return '';
  return row.leader ? '🏆' : '✅';
}

// ── Which pages can a user actually get to? ───────────────────────────────────
// Used by Access Codes → Users so a person's list only shows locked pages that
// are part of their job: no point granting a tech the code for Payroll when the
// tech role can't reach Payroll anyway.
//
// Works like the app's own navigation: start at the role's home screen(s) and
// follow the links each page offers (mirrors the goTo(...) calls in App.jsx),
// skipping pages the role or the user's page-access boxes shut off. Admins and
// managers (incl. Management Access) reach everything. Keep LINKS in step when
// a page gets a new button to another page.

import { resolvePages, pageOn } from './roleAccess';

const LINKS = {
  dashboard: ['additional-time-menu', 'media-upload', 'registration-upload', 'tire-warranty', 'used-car-hub'],
  'advisor-calendar': ['advisor-day', 'advisor-goals', 'aftermarket-warranty', 'big-money-lof', 'cash-dash', 'charge-account-list',
    'daily-wrench', 'deferred-service', 'document-library', 'hot-repairs', 'live-pay-hub', 'original-owner', 'performance-report',
    'ro-upload', 'service-pricing', 'tire-quote', 'work-in-progress', 'survey-reports', 'shop-appointments', 'after-call'],
  'advisor-goals': ['live-pay'],
  'live-pay-hub': ['live-pay', 'tech-live-pay'],
  'tech-resources': ['additional-time-review', 'at-diag-worksheet', 'cash-dash', 'document-library', 'hot-repairs', 'live-pay-hub',
    'performance-report', 'shop-appointments', 'tire-quote', 'work-in-progress', 'tech-self-review', 'additional-time-menu'],
  'at-diag-worksheet': ['atm-worksheet', 'dct-mtm-worksheet', 'ivt-worksheet', 'ntt-att-worksheet'],
  'additional-time-menu': ['additional-diag-time', 'additional-time', 'additional-time-review'],
  'parts-hub': ['advisor-calendar', 'aftermarket-warranty', 'document-library', 'hot-repairs', 'parts-goal-forecast',
    'shop-appointments', 'tire-quote', 'work-in-progress'],
  'warranty-hub': ['aftermarket-warranty', 'at-diag-worksheet', 'document-library', 'hot-repairs', 'ntt-att-worksheet',
    'original-owner', 'registration-uploads', 'shop-appointments', 'tire-quote', 'media-upload', 'registration-upload', 'tire-warranty'],
};

// Pages behind a page-access box (Role Setup / User Management).
const ACCESS_KEY = {
  'charge-account-list': 'chargeAccountList', 'original-owner': 'originalOwner', 'aftermarket-warranty': 'aftermarketWarranty',
  'survey-reports': 'surveyReports', 'work-in-progress': 'workInProgress', 'shop-appointments': 'shopAppointments',
  'used-car-hub': 'usedCarHub', 'media-upload': 'mobileMediaUpload', 'registration-upload': 'mobileRegistrationUpload',
  'tire-warranty': 'mobileTireWarranty', 'additional-time-menu': 'mobileAdditionalTime',
};
const DEFAULT_OFF = new Set(['surveyReports']);

// Manager-only pages (App.jsx sends anyone else back to the dashboard).
const MANAGER_ONLY = new Set(['manager-hub', 'user-management', 'upload-reports', 'payroll', 'employee-applicants', 'employee-review',
  'tech-review', 'advisor-review', 'mgr-performance-reports', 'goal-forecast', 'user-data-tracker', 'repair-order-database', 'global-message']);

const isAdvisorRole = (r) => r === 'advisor' || r === 'lead advisor';

const HOMES = {
  advisor: ['dashboard', 'advisor-calendar'],
  'lead advisor': ['dashboard', 'advisor-calendar'],
  technician: ['dashboard', 'tech-resources'],
  parts: ['dashboard', 'parts-hub'],
  warranty: ['dashboard', 'warranty-hub'],
};

// Returns a Set of page names, or null = everything (admins / managers).
export function reachablePages(user, roleCfg) {
  if (!user) return null;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role.includes('manager') || user.managementAccess) return null;
  const pages = resolvePages(user, roleCfg);
  const allowed = (p) => {
    if (MANAGER_ONLY.has(p)) return false;
    if (p === 'ro-upload' && role !== 'lead advisor') return false;
    if (p === 'live-pay' && !isAdvisorRole(role)) return false;
    if (p === 'tech-live-pay' && role !== 'technician') return false;
    const key = ACCESS_KEY[p];
    if (key && pages && !pageOn(pages, key, DEFAULT_OFF)) return false;
    if (key && !pages && DEFAULT_OFF.has(key)) return false;
    return true;
  };
  const seen = new Set();
  const queue = [...(HOMES[role] || ['dashboard'])];
  while (queue.length) {
    const p = queue.shift();
    if (seen.has(p) || !allowed(p)) continue;
    seen.add(p);
    queue.push(...(LINKS[p] || []));
  }
  return seen;
}

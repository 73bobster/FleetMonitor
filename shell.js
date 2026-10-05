// The signed-in frame: sidebar on desktop, tab bar on mobile, brand colours, org switcher.
import { html, mount, on, icon, openModal, closeModal, logoImg, wireLogos, setDateFormat } from './ui.js';
import { state, can, ROLE_LABEL, screenOn } from './state.js';
import * as api from './api.js';
import { dispatch } from './router.js';
import { screenLabel, versionOf } from './versions.js';
import { feedbackModal } from './feedback.js';

const NAV = [
  { id: 'dashboard', label: 'Dashboard', href: '#/dashboard' },
  { id: 'tasks', label: 'Tasks', href: '#/tasks' },
  { id: 'planner', label: 'Planner', href: '#/planner' },
  { id: 'vehicles', label: 'Vehicles', href: '#/vehicles' },
  { id: 'drivers', label: 'Drivers', href: '#/drivers' },
  { id: 'incidents', label: 'Incidents', href: '#/incidents' },
  { id: 'garages', label: 'Garages', href: '#/garages' },
  { id: 'insurance', label: 'Insurance', href: '#/insurance' },
  { id: 'costs', label: 'Costs', href: '#/costs' },
  { id: 'reports', label: 'Reports', href: '#/reports' },
  { id: 'audit', label: 'Audit log', href: '#/audit', when: () => can.audit },
  { id: 'settings', label: 'Settings', href: '#/settings', when: () => can.configure },
];
const TABS = ['dashboard', 'tasks', 'vehicles', 'drivers'];
// A screen shows in the menu if this person's user type allows it and the superuser has not switched it off.
const visibleNav = () => NAV.filter((n) => (!n.when || n.when()) && screenOn(n.id));
const HELP = { id: 'help', label: 'Help', href: '#/help' };
let current = '';      // the screen being shown, for the version at the bottom and for feedback
let badgeCount = 0;

// ---- Brand ------------------------------------------------------------------
function luminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Colours come from organisations.brand.colours, e.g. {"primary": "#0E5A6B"}. Text on the brand colour is chosen for contrast.
export function applyBrand(org) {
  const root = document.documentElement;
  const primary = org?.brand?.colours?.primary;
  const lum = luminance(primary);
  if (lum === null) {
    root.style.removeProperty('--brand'); root.style.removeProperty('--brand-ink'); root.style.removeProperty('--accent');
  } else {
    root.style.setProperty('--brand', primary);
    root.style.setProperty('--brand-ink', lum > 0.4 ? '#111111' : '#FFFFFF');
  }
  const accent = org?.brand?.colours?.accent;
  if (luminance(accent) !== null) root.style.setProperty('--accent', accent);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', primary || '#FF0066');
  document.title = org ? `${org.name} fleet` : 'FleetMonitor';
  setDateFormat(org?.settings?.date_format);   // the organisation's date format, used by every screen and download
}

// ---- Frame --------------------------------------------------------------------
const navLink = (n, cls) => html`<a class="${cls}" href="${n.href}" data-nav="${n.id}">${icon(n.id)}<span>${n.label}</span>${n.id === 'tasks' ? html`<span class="badge" data-badge="tasks" hidden></span>` : ''}</a>`;

export function renderShell({ onSwitchOrg, onSignOut }) {
  const org = state.org;
  const logo = api.logoUrl(org.brand);
  applyBrand(org);
  mount(document.getElementById('app'), html`
    <div class="shell">
      <aside class="side">
        <div class="side-brand"><a class="brand-link" href="#/dashboard" aria-label="${org.name}: go to the dashboard">${logoImg(logo, org.name, 'side-name')}</a></div>
        <nav class="side-nav" aria-label="Main">${visibleNav().map((n) => navLink(n, 'side-link'))}</nav>
        <div class="side-foot">
          ${state.memberships.length > 1 ? html`<label class="side-switch"><span>Organisation</span><select id="org-switch">${state.memberships.map((m) => html`<option value="${m.organisation_id}" ${m.organisation_id === org.id ? 'selected' : ''}>${m.organisation.name}</option>`)}</select></label>` : ''}
          <a class="side-help" href="#/help" data-nav="help">${icon('help')}<span>Help</span></a>
          <p class="side-user"><span class="side-email">${state.user.email}</span><span class="side-role">${ROLE_LABEL[state.role]}</span></p>
          <button class="side-signout" type="button" data-action="signout">Sign out</button>
        </div>
      </aside>
      <div class="content"><header class="mobile-brand"><a class="brand-link" href="#/dashboard" aria-label="${org.name}: go to the dashboard">${logoImg(logo, org.name)}</a></header><main id="main" tabindex="-1"></main><footer class="screen-foot" id="screen-foot"></footer></div>
      <nav class="tabbar" aria-label="Main">
        ${NAV.filter((n) => TABS.includes(n.id)).map((n) => navLink(n, 'tab-link'))}
        <button type="button" class="tab-link" data-action="more">${icon('more')}<span>More</span></button>
      </nav>
    </div>`);
  const root = document.getElementById('app');
  wireLogos(root);
  on(root, {
    signout: () => onSignOut(),
    more: () => openMenu(onSignOut),
    // after sending from Help or Settings, redraw that screen so the new item shows in its list
    feedback: () => feedbackModal({ section: current, onSaved: () => { if (current === 'help' || current === 'settings') dispatch(); } }),
  });
  root.querySelector('#org-switch')?.addEventListener('change', (e) => onSwitchOrg(e.target.value));
}

function openMenu(onSignOut) {
  const rest = [...visibleNav().filter((n) => !TABS.includes(n.id)), HELP];
  const dlg = openModal({
    title: 'Menu',
    hideFooter: true,
    body: html`<nav class="menu-list" aria-label="More">${rest.map((n) => html`<a class="menu-link" href="${n.href}" data-action="go">${icon(n.id)}<span>${n.label}</span></a>`)}</nav>
      <p class="side-user"><span>${state.user.email}</span><span class="side-role">${ROLE_LABEL[state.role]}</span></p>
      <p><button class="btn" type="button" data-action="signout">Sign out</button></p>`,
  });
  dlg.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    if (el.dataset.action === 'go') { closeModal(); return; }
    if (el.dataset.action === 'signout') { closeModal(); onSignOut(); }
  };
}

export function setBadge(id, n) {
  if (id === 'tasks') badgeCount = n;
  document.querySelectorAll(`[data-badge="${id}"]`).forEach((el) => {
    el.textContent = n > 99 ? '99+' : String(n);
    el.hidden = !n;
    el.setAttribute('aria-label', `${n} overdue`);
  });
}

export function setActive(section) {
  current = section;
  document.querySelectorAll('[data-nav]').forEach((a) => {
    if (a.dataset.nav === section) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // The very bottom of every screen: that screen's own version, and the way to send feedback about it.
  const foot = document.getElementById('screen-foot');
  if (foot) mount(foot, html`<span class="screen-version">${screenLabel(section)} ${versionOf(section)}</span><button type="button" class="link" data-action="feedback">Send feedback</button>`);
}

// Redraws the menu after the superuser switches screens on or off, without disturbing the screen that is open.
export function refreshNav() {
  const nav = document.querySelector('.side-nav');
  if (nav) mount(nav, html`${visibleNav().map((n) => navLink(n, 'side-link'))}`);
  setBadge('tasks', badgeCount);
  setActive(current);
}

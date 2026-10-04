// UI toolkit: escaped-by-default templating, dates, forms, modals, toasts.
import { STATUS_LABEL, CATEGORY_LABEL } from './domain.js';

// ---- Templating ---------------------------------------------------------
// html`...` escapes every interpolated value unless it is itself html`...` or raw(...).
// Use raw() only for markup you wrote yourself, never for data from the database or the user.
const ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ENT[c]);
class Safe { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Safe(String(s ?? ''));
const part = (v) => (v instanceof Safe ? v.s : Array.isArray(v) ? v.map(part).join('') : v === null || v === undefined || v === false ? '' : esc(v));
export const html = (strings, ...vals) => {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Safe(out);
};
export const mount = (el, safe) => { el.innerHTML = safe instanceof Safe ? safe.s : esc(safe); keepDatesWhole(el); };

// A date written with hyphens (04-Oct-26) would otherwise be split across two lines at a hyphen. After each render,
// date text is wrapped in a span that stays on one line. Only visible text is touched: never attributes, form
// fields, drop-down options or charts.
const HYPHEN_DATE = /\b(?:\d{2}-[A-Z][a-z]{2}(?:-\d{2})?|\d{4}-\d{2}-\d{2})\b/g;
function keepDatesWhole(root) {
  if (!dateFormat.includes('-') || typeof document === 'undefined' || typeof NodeFilter === 'undefined' || !document.createTreeWalker) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const found = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = n.parentElement;
    if (!p || p.closest('textarea, select, script, style, svg, .nw')) continue;
    HYPHEN_DATE.lastIndex = 0;
    if (HYPHEN_DATE.test(n.nodeValue)) found.push(n);
  }
  for (const n of found) {
    // The whole piece of text goes into one span, so that where a cell lays its contents out side by side
    // (the stacked tables on a phone) the text still counts as a single item, as it did before.
    const text = n.nodeValue; const whole = document.createElement('span'); let last = 0;
    for (const m of text.matchAll(HYPHEN_DATE)) {
      whole.append(text.slice(last, m.index));
      const span = document.createElement('span'); span.className = 'nw'; span.textContent = m[0]; whole.append(span);
      last = m.index + m[0].length;
    }
    whole.append(text.slice(last));
    n.replaceWith(whole);
  }
}
export const isSafe = (v) => v instanceof Safe;

// Click delegation: <button data-action="save"> calls handlers.save(el, event).
export function on(root, handlers) {
  root.onclick = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  };
}

// ---- Dates and numbers --------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const todayStr = () => toISO(new Date());
export const parseISO = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDaysISO = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return toISO(d); };
// Every date on screen, in reports and in downloads goes through formatDate, so one setting changes them all.
// The format is chosen per organisation in Settings (organisations.settings.date_format). The first is the default.
export const DATE_FORMATS = [['dd-Mmm-yy', '04-Oct-26'], ['dd Mmm yyyy', '4 Oct 2026'], ['dd/mm/yyyy', '04/10/2026'], ['dd/mm/yy', '04/10/26'], ['mm/dd/yyyy', '10/04/2026'], ['yyyy-mm-dd', '2026-10-04']];
export const DEFAULT_DATE_FORMAT = 'dd-Mmm-yy';
let dateFormat = DEFAULT_DATE_FORMAT;
export const setDateFormat = (f) => { dateFormat = DATE_FORMATS.some(([k]) => k === f) ? f : DEFAULT_DATE_FORMAT; };
export const getDateFormat = () => dateFormat;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// year = false leaves the year off, for chart axes and other tight spaces.
export function formatDate(d, format = dateFormat, year = true) {
  const dd = pad(d.getDate()); const mm = pad(d.getMonth() + 1); const mon = MONTHS[d.getMonth()]; const yyyy = String(d.getFullYear()); const yy = yyyy.slice(2);
  switch (format) {
    case 'dd Mmm yyyy': return `${d.getDate()} ${mon}${year ? ` ${yyyy}` : ''}`;
    case 'dd/mm/yyyy': return `${dd}/${mm}${year ? `/${yyyy}` : ''}`;
    case 'dd/mm/yy': return `${dd}/${mm}${year ? `/${yy}` : ''}`;
    case 'mm/dd/yyyy': return `${mm}/${dd}${year ? `/${yyyy}` : ''}`;
    case 'yyyy-mm-dd': return year ? `${yyyy}-${mm}-${dd}` : `${mm}-${dd}`;
    default: return `${dd}-${mon}${year ? `-${yy}` : ''}`;
  }
}
const asDate = (s) => parseISO(String(s).slice(0, 10));
export const fmtDateShort = (s) => (s ? formatDate(asDate(s)) : '');                                       // 04-Oct-26
export const fmtDate = (s) => { if (!s) return ''; const d = asDate(s); return `${DAYS[d.getDay()]} ${formatDate(d)}`; };   // Sun 04-Oct-26
export const fmtDayMonth = (s, weekday = false) => { if (!s) return ''; const d = asDate(s); return `${weekday ? `${DAYS[d.getDay()]} ` : ''}${formatDate(d, dateFormat, false)}`; };   // 04-Oct
export const fmtMonth = (s, long = false) => { if (!s) return ''; const d = asDate(s); return long ? `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}` : `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; };
export const fmtDateTime = (s) => { if (!s) return ''; const d = new Date(s); return `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const fmtInt = (n) => (n === null || n === undefined ? '' : new Intl.NumberFormat('en-GB').format(n));
export const fmtMoney = (n, cur = 'GBP') => (n === null || n === undefined ? '' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur }).format(n));
export const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export function dueText(days) {
  if (days === null || days === undefined) return 'No date set';
  if (days < 0) return `${plural(-days, 'day')} overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${plural(days, 'day')}`;
}

// ---- Small components ---------------------------------------------------
const ICONS = {
  tasks: '<path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  vehicles: '<path d="M3 16V7h11v9M14 10h4l3 3v3h-3M3 16h2M9 16h6M19 16h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  drivers: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  insurance: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  reports: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  costs: '<path d="M17 20H7c1.6-1.4 2.2-3.1 2.2-5V8.6A3.6 3.6 0 0 1 12.8 5c1.6 0 2.9 1 3.4 2.4M6.5 13.2h7"/>',
  audit: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  incidents: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  planner: '<rect x="3" y="5" width="18" height="16" rx="1"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3M13 17h3"/>',
  garages: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  settings: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
};
export const icon = (name) => raw(`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] || ''}</svg>`);

// UK registration plate. Current-format plates get the conventional gap.
export function formatReg(reg) {
  const r = String(reg || '').toUpperCase().replace(/\s+/g, '');
  const m = /^([A-Z]{2}\d{2})([A-Z]{3})$/.exec(r);
  return m ? `${m[1]} ${m[2]}` : String(reg || '').toUpperCase().trim();
}
// A small solid shape of the kind of vehicle, shown beside the plate wherever the vehicle type is known.
// Each is drawn to read at a glance: a van is one low body with a sloping nose, a lorry is a tall square box with a
// separate cab (and is also a different colour), a car is low and rounded, a pick-up has an open back.
const WHEEL = (x) => `<circle cx="${x}" cy="16.9" r="2.1"/>`;
const ARCHES = 'H20.5A3 3 0 0 0 14.5 16.5H9.5A3 3 0 0 0 3.5 16.5H1.5Z';   // the underside, with two wheel arches
const VEH_ICONS = {
  car: `<path fill-rule="evenodd" d="M1.5 13.4c0-.8.5-1.4 1.3-1.6L6 11.2 8.3 8.1c.3-.4.8-.6 1.3-.6h5c.5 0 1 .2 1.3.6l2.5 3.1 2.7.6c.8.2 1.4.9 1.4 1.7v3${ARCHES}M8.2 11h3.3V8.9H9.9zM12.7 11h3.9l-1.7-2.1h-2.2z"/>${WHEEL(6.5)}${WHEEL(17.5)}`,
  van: `<path fill-rule="evenodd" d="M1.5 8.5C1.5 7.7 2.2 7 3 7h10.4c.4 0 .8.2 1.1.4L18.3 11l2.9.9c.8.2 1.3.9 1.3 1.7v2.9${ARCHES}M14 8.6V11h3.1z"/>${WHEEL(6.5)}${WHEEL(17.5)}`,
  light_goods: `<path fill-rule="evenodd" d="M1.5 11.6h9.3V8.3c0-.5.4-.8.8-.8h4c.5 0 .9.2 1.2.6l2.2 3 2.2.7c.8.2 1.3.9 1.3 1.7v3${ARCHES}M12.6 9v2.2h4.3L15.3 9z"/>${WHEEL(6.5)}${WHEEL(17.5)}`,
  hgv: `<path d="M1 4.2h13v12.3H8.5A3 3 0 0 0 2.5 16.5H1z"/><path fill-rule="evenodd" d="M15 7.8h3.3c.5 0 .9.2 1.2.6l3 3.7v4.4h-1A3 3 0 0 0 15.5 16.5H15zM16.6 9.4v2.6h4.3l-2.1-2.6z"/>${WHEEL(5.5)}${WHEEL(18.5)}`,
  bus: `<path fill-rule="evenodd" d="M1.5 7C1.5 6.2 2.2 5.5 3 5.5h18c.8 0 1.5.7 1.5 1.5v9.5${ARCHES}M3.6 7.6v3.2h3.3V7.6zM8.3 7.6v3.2h3.3V7.6zM13 7.6v3.2h3.3V7.6zM17.7 7.6v3.2h3.3V7.6z"/>${WHEEL(6.5)}${WHEEL(17.5)}`,
  trailer: `<path d="M5.5 5h17v11.5h-5a3 3 0 0 0-6 0h-6zM1 12.6h4.5v1.8H1z"/>${WHEEL(14.5)}`,
  plant: `<path fill-rule="evenodd" d="M4.5 4.5H11l1.3 5H19a2 2 0 0 1 2 2v3h-9.3a4.6 4.6 0 0 0-7.2-3.3zM6.2 6.2v3.3h4.4l-.9-3.3z"/><path fill-rule="evenodd" d="M7.5 11.5a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3z"/><circle cx="18.5" cy="17.2" r="2.3"/>`,
};
VEH_ICONS.other = VEH_ICONS.van;
export const vehIcon = (category) => (VEH_ICONS[category] ? raw(`<svg class="veh-ico veh-${category}" viewBox="0 0 24 24" role="img" aria-label="${esc(CATEGORY_LABEL[category])}"><title>${esc(CATEGORY_LABEL[category])}</title>${VEH_ICONS[category]}</svg>`) : '');
// plate(registration) draws the plate; plate(registration, category) adds the vehicle-type icon in front of it.
export const plate = (reg, category) => {
  const p = html`<span class="plate" role="img" aria-label="Registration ${formatReg(reg)}">${formatReg(reg)}</span>`;
  return VEH_ICONS[category] ? html`<span class="veh">${vehIcon(category)}${p}</span>` : p;
};

// A logo image that falls back to the organisation's name as text if the picture cannot load.
export const logoImg = (url, name, extraClass = '') => (url
  ? html`<img class="logo" src="${url}" alt="${name}" data-name="${name}" data-class="${extraClass}" referrerpolicy="no-referrer">`
  : html`<span class="logo-text ${extraClass}">${name}</span>`);
export function wireLogos(root) {
  root.querySelectorAll('img.logo').forEach((img) => {
    img.addEventListener('error', () => {
      const s = document.createElement('span');
      s.className = `logo-text ${img.dataset.class || ''}`.trim();
      s.textContent = img.dataset.name || '';
      img.replaceWith(s);
    }, { once: true });
  });
}

export const facts = (pairs) => html`<dl class="facts">${pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => html`<div><dt>${k}</dt><dd>${v}</dd></div>`)}</dl>`;

export const pill = (status) => html`<span class="pill pill-${status}">${STATUS_LABEL[status] || status}</span>`;
export const loadingHtml = (text = 'Loading') => html`<p class="loading" role="status">${text}</p>`;
export const emptyHtml = (title, text = '', actionHtml = '') => html`<div class="empty"><h2>${title}</h2>${text ? html`<p>${text}</p>` : ''}${actionHtml}</div>`;
export const errorHtml = (msg) => html`<div class="empty empty-error" role="alert"><h2>That didn't load</h2><p>${msg}</p><p><button class="btn" type="button" data-action="reload">Try again</button></p></div>`;

// ---- Toasts -------------------------------------------------------------
export function toast(msg, kind = 'ok') {
  const box = document.getElementById('toasts');
  if (!box) return;
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 7000 : 3500);
}

// ---- Forms --------------------------------------------------------------
const optPair = (o) => (Array.isArray(o) ? o : [o.value ?? o, o.label ?? o]);

export function field(f, values = {}) {
  const has = values[f.name] !== undefined && values[f.name] !== null;
  const cur = has ? values[f.name] : f.value ?? '';
  const id = `f-${f.name}`;
  const req = f.required ? raw(' required') : '';
  const attrs = html`id="${id}" name="${f.name}"${req}`;
  if (f.type === 'checkbox') {
    return html`<div class="field ${f.span === 2 ? 'span-2' : ''}"><label class="check"><input type="checkbox" id="${id}" name="${f.name}" ${cur ? raw('checked') : ''}> <span>${f.label}</span></label>${f.hint ? html`<p class="hint">${f.hint}</p>` : ''}</div>`;
  }
  let control;
  if (f.type === 'textarea') {
    control = html`<textarea ${attrs} rows="${f.rows || 3}">${cur}</textarea>`;
  } else if (f.type === 'select') {
    const opts = (f.options || []).map(optPair).map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur) ? raw('selected') : ''}>${l}</option>`);
    const blank = f.required && cur ? [] : [html`<option value="">${f.blank || (f.required ? 'Choose' : 'Not set')}</option>`];
    control = html`<select ${attrs}>${blank}${opts}</select>`;
  } else {
    const extra = ['min', 'max', 'step', 'placeholder', 'autocomplete', 'inputmode', 'maxlength', 'list']
      .filter((k) => f[k] !== undefined)
      .map((k) => html` ${k}="${f[k]}"`);
    control = html`<input type="${f.type || 'text'}" ${attrs} value="${cur}"${extra}>`;
  }
  return html`<div class="field ${f.span === 2 ? 'span-2' : ''}"><label for="${id}">${f.label}${f.required ? html`<span class="req" aria-hidden="true"> *</span>` : ''}</label>${control}${f.hint ? html`<p class="hint">${f.hint}</p>` : ''}</div>`;
}

export const datalist = (id, options) => html`<datalist id="${id}">${options.map(([v, l]) => html`<option value="${v}">${l}</option>`)}</datalist>`;

export const fieldsHtml = (specs, values = {}) => html`<div class="form-grid">${specs.map((f) => field(f, values))}</div>`;

// Reads a form into a plain object: blanks become null, numbers become numbers, checkboxes become booleans.
export function readForm(form, specs) {
  const out = {};
  for (const f of specs) {
    const el = form.elements[f.name];
    if (!el) continue;
    if (f.type === 'checkbox') { out[f.name] = !!el.checked; continue; }
    let v = String(el.value ?? '').trim();
    if (v === '') { out[f.name] = null; continue; }
    if (f.type === 'number') v = Number(v);
    out[f.name] = v;
  }
  return out;
}

// ---- Modal --------------------------------------------------------------
let lastFocus = null;
export function closeModal() {
  const dlg = document.getElementById('dialog');
  if (dlg?.open) dlg.close();
}

// openModal({ title, body, onSubmit, submitLabel, hideFooter, wide, danger })
// onSubmit(form) may throw: the message is shown inside the dialog and it stays open.
export function openModal({ title, body, onSubmit, submitLabel = 'Save', cancelLabel = 'Cancel', hideFooter = false, wide = false, danger = false }) {
  const dlg = document.getElementById('dialog');
  lastFocus = document.activeElement;
  dlg.onclick = null;
  dlg.className = `modal${wide ? ' modal-wide' : ''}`;
  mount(dlg, html`<form class="modal-form" method="dialog">
    <header class="modal-head"><h2 id="dlg-title">${title}</h2><button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button></header>
    <div class="modal-body">${body}<p class="form-error" role="alert" hidden></p></div>
    ${hideFooter ? '' : html`<footer class="modal-foot"><button type="button" class="btn" data-close>${cancelLabel}</button><button type="submit" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${submitLabel}</button></footer>`}
  </form>`);
  const form = dlg.querySelector('form');
  const errBox = dlg.querySelector('.form-error');
  dlg.querySelectorAll('[data-close]').forEach((b) => { b.onclick = () => closeModal(); });
  dlg.onclose = () => { mount(dlg, ''); try { lastFocus?.focus?.(); } catch { /* element gone */ } };
  if (onSubmit) {
    form.onsubmit = async (e) => {
      e.preventDefault();
      errBox.hidden = true;
      const btn = form.querySelector('button[type="submit"]');
      if (btn) btn.disabled = true;
      try {
        await onSubmit(form);
        closeModal();
      } catch (err) {
        errBox.textContent = err.message || 'Something went wrong.';
        errBox.hidden = false;
        if (btn) btn.disabled = false;
      }
    };
  } else {
    form.onsubmit = (e) => e.preventDefault();
  }
  if (!dlg.open) dlg.showModal();
  return dlg;
}

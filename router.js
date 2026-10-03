// Tiny hash router, so the app works on any static host without server rules.
const routes = [];
const hooks = [];

export function route(pattern, section, handler) {
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$');
  routes.push({ re, section, handler });
}
export function onRoute(fn) { hooks.push(fn); }

export function parseHash(hash = location.hash) {
  const raw = (hash || '').replace(/^#/, '') || '/tasks';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  return { path, query };
}

export function navigate(hash) {
  if (location.hash === hash) dispatch(); else location.hash = hash;
}

export function start() {
  // First load: always begin on a real route, whatever else is in the address (blank, #main, an email-link token).
  if (!location.hash.startsWith('#/')) history.replaceState(null, '', `${location.pathname}${location.search}#/tasks`);
  window.removeEventListener('hashchange', dispatch);
  window.addEventListener('hashchange', dispatch);
  return dispatch();
}

export async function dispatch() {
  // Ignore hashes that are not app routes, such as the skip link (#main) or sign-in tokens from an email link.
  if (location.hash && !location.hash.startsWith('#/')) return;
  const { path, query } = parseHash();
  const main = document.getElementById('main');
  if (!main) return;
  for (const r of routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    hooks.forEach((h) => h(r.section));
    try {
      await r.handler(main, { ...(m.groups || {}) }, query);
    } catch (err) {
      console.error(err);
      const { errorHtml, mount } = await import('./ui.js');
      mount(main, errorHtml(err.message || 'Something went wrong.'));
    }
    window.scrollTo?.(0, 0);
    return;
  }
  navigate('#/tasks');
}

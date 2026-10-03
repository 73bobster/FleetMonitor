// A small in-memory stand-in for the Supabase client, so screens can be exercised without a network or a browser.
// It supports the calls the app makes: from().select/insert/update/upsert/delete with eq/in/is/order/limit/single, rpc(), auth, storage.
export function makeFake(db, { session = null, password = 'correct-password' } = {}) {
  db._log = db._log || [];
  db._rpc = db._rpc || {};
  db._errors = db._errors || {};
  db._views = db._views || {};
  const listeners = [];
  const uuid = () => crypto.randomUUID();
  const tableRows = (name) => db[db._views[name] || name] || (db[db._views[name] || name] = []);

  class Query {
    constructor(table) { this.table = table; this.op = 'select'; this.filters = []; this.orders = []; this.lim = null; this.payload = null; this.opts = {}; this.mode = null; }
    select() { return this; }
    insert(p) { this.op = 'insert'; this.payload = p; return this; }
    update(p) { this.op = 'update'; this.payload = p; return this; }
    upsert(p, o) { this.op = 'upsert'; this.payload = p; this.opts = o || {}; return this; }
    delete() { this.op = 'delete'; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    in(c, a) { this.filters.push((r) => a.includes(r[c])); return this; }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    order(c, o) { this.orders.push([c, o?.ascending !== false]); return this; }
    limit(n) { this.lim = n; return this; }
    single() { this.mode = 'single'; return this; }
    maybeSingle() { this.mode = 'maybe'; return this; }
    then(res, rej) { return this.run().then(res, rej); }
    async run() {
      db._log.push({ kind: 'from', table: this.table, op: this.op, payload: this.payload, opts: this.opts });
      const injected = db._errors[`${this.table}:${this.op}`];
      if (injected) return { data: null, error: injected };
      const rows = tableRows(this.table);
      let out;
      if (this.op === 'insert') {
        out = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p) => ({ id: uuid(), created_at: new Date().toISOString(), ...p }));
        rows.push(...out);
      } else if (this.op === 'upsert') {
        const keys = (this.opts.onConflict || 'id').split(',');
        out = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((p) => {
          const hit = rows.find((r) => keys.every((k) => r[k] === p[k]));
          if (hit) { Object.assign(hit, p); return hit; }
          const row = { id: uuid(), created_at: new Date().toISOString(), ...p }; rows.push(row); return row;
        });
      } else if (this.op === 'update') {
        out = rows.filter((r) => this.filters.every((f) => f(r)));
        out.forEach((r) => Object.assign(r, this.payload));
      } else if (this.op === 'delete') {
        out = rows.filter((r) => this.filters.every((f) => f(r)));
        out.forEach((r) => rows.splice(rows.indexOf(r), 1));
      } else {
        out = rows.filter((r) => this.filters.every((f) => f(r)));
        for (const [c, asc] of [...this.orders].reverse()) {
          out = [...out].sort((a, b) => {
            const x = a[c] ?? null; const y = b[c] ?? null;
            if (x === y) return 0; if (x === null) return 1; if (y === null) return -1;
            return (x < y ? -1 : 1) * (asc ? 1 : -1);
          });
        }
        if (this.lim) out = out.slice(0, this.lim);
      }
      if (this.mode === 'single') return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: 'Expected one row', code: 'PGRST116' } };
      if (this.mode === 'maybe') return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }
  }

  const emit = (event, s) => listeners.forEach((cb) => cb(event, s));
  return {
    from: (t) => new Query(t),
    async rpc(name, args) {
      db._log.push({ kind: 'rpc', name, args });
      const fn = db._rpc[name];
      if (!fn) return { data: null, error: { message: `No fake rpc ${name}` } };
      try { return { data: await fn(args), error: null }; } catch (e) { return { data: null, error: { message: e.message, code: e.code } }; }
    },
    auth: {
      async getSession() { return { data: { session }, error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithPassword({ email, password: pw }) {
        if (pw !== password) return { data: {}, error: { message: 'Invalid login credentials' } };
        session = { user: { id: db._userId || 'user-1', email } };
        setTimeout(() => emit('SIGNED_IN', session), 0);
        return { data: { session, user: session.user }, error: null };
      },
      async signUp({ email, options }) { db._log.push({ kind: 'signUp', email, options }); return { data: { session: null, user: { email } }, error: null }; },
      async signOut() { session = null; setTimeout(() => emit('SIGNED_OUT', null), 0); return { error: null }; },
      async resetPasswordForEmail(email, o) { db._log.push({ kind: 'reset', email, o }); return { error: null }; },
      async updateUser() { return { error: null }; },
    },
    storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: `https://files.test/${p}` } }) }) },
  };
}

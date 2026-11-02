import { randomUUID } from "node:crypto";

// A small in-memory stand-in for the supabase-js builder surface the poll,
// announcement and species code uses (tables + the poll_results view + Storage). Each terminal call yields
// to the event loop first, so concurrent requests interleave like separate
// connections; each single statement is then atomic, like in Postgres.
const COLUMNS = {
  polls: ["id", "question", "status", "opens_at", "closes_at", "created_at", "repeat_daily", "repeat_paused"],
  poll_options: ["id", "poll_id", "label", "display_order"],
  votes: ["id", "poll_id", "option_id", "session_id", "created_at"],
  poll_results: ["poll_id", "option_id", "label", "display_order", "vote_count"],
  announcements: ["id", "stream_id", "title", "message", "image_path", "button_label", "button_kind", "button_target", "is_on", "starts_at", "ends_at", "created_at", "updated_at"],
  site_settings: ["key", "value", "updated_at"],
  species_cards: ["id", "stream_id", "species_name", "scientific_name", "conservation_status", "photo_path", "range_map_path", "info_blocks", "updated_at"],
  contact_form_attempts: ["id", "ip_address", "form", "created_at"],
  // supabase/push_notifications.sql
  push_categories: ["id", "stream_id", "name", "display_order", "is_active", "created_at"],
  push_subscriptions: ["id", "stream_id", "endpoint", "p256dh", "auth", "category_ids", "created_at", "last_success_at", "failure_count"],
  push_sends: ["id", "title", "message", "url", "category_id", "category_name", "source", "status", "recipients", "sent", "failed", "created_at"],
  push_scheduled: ["id", "stream_id", "title", "message", "url", "category_id", "send_at", "status", "claimed_at", "created_at"],
  push_repeating: ["id", "stream_id", "title", "message", "url", "category_id", "time_of_day", "days_of_week", "is_active", "skip_date", "last_sent_date", "next_send_at", "created_at", "updated_at"],
  push_settings: ["stream_id", "paused", "updated_at"],
  push_due: ["kind", "id", "stream_id", "due_at"],
};

// Defaults the real push tables fill in on insert.
const PUSH_DEFAULTS = {
  push_categories: () => ({ stream_id: "main", display_order: 0, is_active: true }),
  push_subscriptions: () => ({ stream_id: "main", category_ids: [], last_success_at: null, failure_count: 0 }),
  push_sends: () => ({ message: "", url: "/", category_id: null, category_name: null, status: "sent", recipients: 0, sent: 0, failed: 0 }),
  push_scheduled: () => ({ stream_id: "main", url: "/", status: "pending", claimed_at: null }),
  push_repeating: () => ({ stream_id: "main", url: "/", days_of_week: [0, 1, 2, 3, 4, 5, 6], is_active: true, skip_date: null, last_sent_date: null, next_send_at: null, updated_at: new Date().toISOString() }),
  push_settings: () => ({ paused: false, updated_at: new Date().toISOString() }),
};

const tick = () => new Promise((r) => setImmediate(r));

// announcementsTable: false = supabase/announcements.sql not run yet.
// namesColumns: false = supabase/species_names.sql not run yet.
// hideColumns: false = supabase/poll_hide.sql not run yet (no hidden_at /
// force_shown columns and no site_settings table).
// pushTables: false = supabase/push_notifications.sql not run yet.
export function createFake({ imageColumn = true, durationColumns = true, announcementsTable = true, namesColumns = true, hideColumns = true, pushTables = true } = {}) {
  const db = {
    polls: [], poll_options: [], votes: [], announcements: [], species_cards: [], site_settings: [], contact_form_attempts: [],
    push_categories: [], push_subscriptions: [], push_sends: [], push_scheduled: [], push_repeating: [], push_settings: [],
  };
  const queries = []; // every table/view touched, in order (for "one small query when idle")
  const files = new Map(); // `${bucket}/${path}` -> { created_at, size }
  const log = [];

  const cols = (table) =>
    table === "species_cards" ? [...COLUMNS.species_cards, ...(namesColumns ? ["names_heading", "names"] : [])] :
    table === "polls" ? [...COLUMNS.polls, ...(imageColumn ? ["image_path"] : []), ...(durationColumns ? ["ends_at", "open_ended", "duration_days"] : []), ...(hideColumns ? ["hidden_at", "force_shown"] : [])] : COLUMNS[table];

  const missing = (col) => ({ code: "42703", message: `column ${col} does not exist` });

  function rowsOf(table) {
    if (table === "push_due") {
      return [
        ...db.push_scheduled.filter((s) => s.status === "pending").map((s) => ({ kind: "scheduled", id: s.id, stream_id: s.stream_id, due_at: s.send_at })),
        ...db.push_repeating.filter((r) => r.is_active && r.next_send_at).map((r) => ({ kind: "repeating", id: r.id, stream_id: r.stream_id, due_at: r.next_send_at })),
      ];
    }
    if (table === "poll_results") {
      return db.poll_options.map((o) => ({
        poll_id: o.poll_id,
        option_id: o.id,
        label: o.label,
        display_order: o.display_order,
        vote_count: db.votes.filter((v) => v.option_id === o.id).length,
      }));
    }
    return db[table];
  }

  class Query {
    constructor(table) {
      this.table = table;
      this.op = "select";
      this.filters = [];
      this.orders = [];
      this.limitN = null;
      this.selectCols = "*";
      this.countExact = false;
      this.head = false;
      this.payload = null;
      this.wantRows = false;
      this.mode = "many";
    }
    select(c = "*", opts = {}) {
      if (this.op === "select") {
        this.selectCols = c;
        this.countExact = opts.count === "exact";
        this.head = !!opts.head;
      } else {
        this.wantRows = true;
        this.selectCols = c;
      }
      return this;
    }
    insert(p) { this.op = "insert"; this.payload = p; return this; }
    update(p) { this.op = "update"; this.payload = p; return this; }
    delete() { this.op = "delete"; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); this.filterCols = [...(this.filterCols ?? []), c]; return this; }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); this.filterCols = [...(this.filterCols ?? []), c]; return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    lt(c, v) { this.filters.push((r) => r[c] < v); return this; }
    lte(c, v) { this.filters.push((r) => r[c] <= v); return this; }
    gt(c, v) { this.filters.push((r) => r[c] > v); return this; }
    gte(c, v) { this.filters.push((r) => r[c] >= v); return this; }
    not(c, op, v) { if (op === "like") { const pre = v.replace(/%$/, ""); this.filters.push((r) => !String(r[c]).startsWith(pre)); } return this; }
    upsert(p, opts = {}) { this.op = "upsert"; this.payload = p; this.onConflict = opts.onConflict; return this; }
    in(c, vs) { this.filters.push((r) => vs.includes(r[c])); this.filterCols = [...(this.filterCols ?? []), c]; return this; }
    order(c, { ascending = true } = {}) { this.orders.push([c, ascending]); return this; }
    limit(n) { this.limitN = n; return this; }
    maybeSingle() { this.mode = "maybe"; return this; }
    single() { this.mode = "single"; return this; }

    project(row) {
      if (this.selectCols === "*" || !this.selectCols) return { ...row };
      const out = {};
      for (const c of this.selectCols.split(",").map((s) => s.trim())) out[c] = row[c];
      return out;
    }

    async run() {
      await tick();
      if (this.table === "site_settings" && !hideColumns) {
        return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.site_settings' in the schema cache" } };
      }
      if (this.table.startsWith("push_") && !pushTables) {
        return { data: null, error: { code: "PGRST205", message: `Could not find the table 'public.${this.table}' in the schema cache` } };
      }
      if (this.table === "announcements" && !announcementsTable) {
        return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.announcements' in the schema cache" } };
      }
      const known = cols(this.table);
      // Unknown columns behave like Postgres 42703.
      const requested = this.selectCols === "*" ? [] : this.selectCols.split(",").map((s) => s.trim());
      for (const c of [...requested, ...(this.filterCols ?? [])]) {
        if (!known.includes(c)) return { data: null, error: missing(`${this.table}.${c}`) };
      }
      if (this.payload) {
        const keys = Object.keys(Array.isArray(this.payload) ? this.payload[0] ?? {} : this.payload);
        for (const k of keys) if (!known.includes(k)) return { data: null, error: missing(`${this.table}.${k}`) };
      }

      let result;
      if (this.op === "upsert") {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        for (const p of list) {
          const row = db[this.table].find((r) => r[this.onConflict] === p[this.onConflict]);
          if (row) Object.assign(row, p);
          else if (this.table === "site_settings") db[this.table].push({ ...p });
          else if (PUSH_DEFAULTS[this.table]) db[this.table].push({ id: randomUUID(), created_at: new Date().toISOString(), ...PUSH_DEFAULTS[this.table](), ...p });
        }
        return { data: null, error: null };
      }
      if (this.op === "insert") {
        const list = Array.isArray(this.payload) ? this.payload : [this.payload];
        const created = list.map((p) => {
          const base = { id: randomUUID(), created_at: new Date().toISOString() };
          if (this.table === "polls") Object.assign(base, { status: "scheduled", repeat_daily: false, repeat_paused: false });
          if (this.table === "polls" && imageColumn) base.image_path = null;
          if (this.table === "polls" && durationColumns) Object.assign(base, { ends_at: null, open_ended: false, duration_days: null });
          if (this.table === "polls" && hideColumns) Object.assign(base, { hidden_at: null, force_shown: false });
          if (PUSH_DEFAULTS[this.table]) Object.assign(base, PUSH_DEFAULTS[this.table]());
          if (this.table === "announcements") Object.assign(base, { stream_id: "main", message: "", image_path: null, button_label: null, button_kind: null, button_target: null, is_on: false, starts_at: null, ends_at: null, updated_at: base.created_at });
          return { ...base, ...p };
        });
        if (this.table === "votes") {
          for (const c of created) if (db.votes.some((v) => v.poll_id === c.poll_id && v.session_id === c.session_id)) return { data: null, error: { code: "23505", message: "duplicate key value" } };
        }
        db[this.table].push(...created);
        result = created;
      } else if (this.op === "update") {
        const hit = rowsOf(this.table).filter((r) => this.filters.every((f) => f(r)));
        for (const r of hit) Object.assign(r, this.payload);
        result = hit;
      } else if (this.op === "delete") {
        const hit = db[this.table].filter((r) => this.filters.every((f) => f(r)));
        db[this.table] = db[this.table].filter((r) => !hit.includes(r));
        // cascade like the real foreign keys
        if (this.table === "polls") {
          const ids = hit.map((h) => h.id);
          db.poll_options = db.poll_options.filter((o) => !ids.includes(o.poll_id));
          db.votes = db.votes.filter((v) => !ids.includes(v.poll_id));
        }
        result = hit;
      } else {
        result = rowsOf(this.table).filter((r) => this.filters.every((f) => f(r)));
      }

      for (const [c, asc] of [...this.orders].reverse()) {
        result = [...result].sort((a, b) => (a[c] < b[c] ? -1 : a[c] > b[c] ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.limitN != null) result = result.slice(0, this.limitN);

      if (this.op !== "select" && !this.wantRows) return { data: null, error: null };
      if (this.countExact && this.head) return { data: null, count: result.length, error: null };
      const projected = result.map((r) => this.project(r));
      if (this.mode === "maybe") return { data: projected[0] ?? null, error: null };
      if (this.mode === "single") {
        return projected.length === 1
          ? { data: projected[0], error: null }
          : { data: null, error: { message: "single row expected" } };
      }
      return { data: projected, error: null, count: result.length };
    }
    then(resolve, reject) { return this.run().then(resolve, reject); }
  }

  const storage = {
    from(bucket) {
      const key = (p) => `${bucket}/${p}`;
      return {
        async upload(path, file) {
          await tick();
          if (files.has(key(path))) return { data: null, error: { message: "The resource already exists" } };
          files.set(key(path), { created_at: new Date().toISOString(), size: file?.size ?? 0 });
          log.push(["upload", path]);
          return { data: { path }, error: null };
        },
        async remove(paths) {
          await tick();
          for (const p of paths) { files.delete(key(p)); log.push(["remove", p]); }
          return { data: paths.map((p) => ({ name: p })), error: null };
        },
        async move(from, to) {
          await tick();
          if (!files.has(key(from))) return { data: null, error: { message: "Object not found" } };
          files.set(key(to), files.get(key(from)));
          files.delete(key(from));
          log.push(["move", from, to]);
          return { data: { message: "Successfully moved" }, error: null };
        },
        async list(prefix) {
          await tick();
          const start = key(prefix) + "/";
          const out = [];
          for (const [k, v] of files) if (k.startsWith(start) && !k.slice(start.length).includes("/")) {
            out.push({ name: k.slice(start.length), created_at: v.created_at });
          }
          return { data: out, error: null };
        },
      };
    },
  };

  return {
    db, files, log, storage, queries,
    from: (table) => { queries.push(table); return new Query(table); },
    fileExists: (bucket, path) => files.has(`${bucket}/${path}`),
    // helpers for the tests
    addPoll(p = {}) {
      const row = {
        id: randomUUID(), question: "TEST poll", status: "scheduled", repeat_daily: false, repeat_paused: false,
        opens_at: new Date().toISOString(), closes_at: new Date().toISOString(), created_at: new Date().toISOString(), ...(imageColumn ? { image_path: null } : {}), ...(durationColumns ? { ends_at: null, open_ended: false, duration_days: null } : {}), ...(hideColumns ? { hidden_at: null, force_shown: false } : {}), ...p,
      };
      if (row.image_path) files.set(`event-images/${row.image_path}`, { created_at: new Date().toISOString(), size: 1 });
      db.polls.push(row);
      return row;
    },
    addOption(pollId, label, order) {
      const row = { id: randomUUID(), poll_id: pollId, label, display_order: order };
      db.poll_options.push(row);
      return row;
    },
    addAnnouncement(a = {}) {
      const row = {
        id: randomUUID(), stream_id: "main", title: "TEST announcement", message: "", image_path: null,
        button_label: null, button_kind: null, button_target: null, is_on: true, starts_at: null, ends_at: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...a,
      };
      if (row.image_path) files.set(`event-images/${row.image_path}`, { created_at: new Date().toISOString(), size: 1 });
      db.announcements.push(row);
      return row;
    },
    addSpeciesCard(c = {}) {
      const row = {
        id: randomUUID(), stream_id: "main", species_name: "TEST frog", scientific_name: null, conservation_status: null,
        photo_path: null, range_map_path: null, info_blocks: [], updated_at: new Date().toISOString(),
        ...(namesColumns ? { names_heading: "Frog names", names: [] } : {}), ...c,
      };
      db.species_cards.push(row);
      return row;
    },
    addPushCategory(name, c = {}) {
      const row = { id: randomUUID(), stream_id: "main", name, display_order: db.push_categories.length + 1, is_active: true, created_at: new Date().toISOString(), ...c };
      db.push_categories.push(row);
      return row;
    },
    addPushSubscription(endpoint, categoryIds, s = {}) {
      const row = {
        id: randomUUID(), stream_id: "main", endpoint, p256dh: "B".repeat(87), auth: "A".repeat(22), category_ids: categoryIds,
        created_at: new Date().toISOString(), last_success_at: null, failure_count: 0, ...s,
      };
      db.push_subscriptions.push(row);
      return row;
    },
    addVote(pollId, optionId, session = randomUUID()) {
      db.votes.push({ id: randomUUID(), poll_id: pollId, option_id: optionId, session_id: session, created_at: new Date().toISOString() });
    },
  };
}

import test from "node:test";
import fs from "node:fs";
import { check } from "./support/helpers.mjs";

// Checks on the SQL files in supabase/migrations/ (read as text; nothing is
// run against any database). Part 2's rule: migrations are additive and
// backward compatible until the code no longer needs the old shape.

const dir = new URL("../supabase/migrations/", import.meta.url);
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const read = (f) => fs.readFileSync(new URL(f, dir), "utf8").replace(/--.*$/gm, "");

test("migrations are numbered in order with no gaps", () => {
  check("at least one migration", files.length > 0);
  files.forEach((f, i) => {
    check(`${f}: named NNNN_name.sql`, /^\d{4}_[a-z0-9_]+\.sql$/.test(f));
    check(`${f}: number ${i + 1}`, Number(f.slice(0, 4)) === i + 1);
  });
  const readme = fs.readFileSync(new URL("../supabase/README.md", import.meta.url), "utf8");
  for (const f of files) check(`${f}: listed in supabase/README.md`, readme.includes(f));
});

test("migrations only add (no drops of tables or columns, no deletes)", () => {
  for (const f of files) {
    const code = read(f);
    check(`${f}: no drop table`, !/\bdrop\s+table\b/i.test(code));
    check(`${f}: no drop column`, !/\bdrop\s+column\b/i.test(code));
    check(`${f}: no truncate / delete from`, !/\btruncate\b|\bdelete\s+from\b/i.test(code));
    check(`${f}: tables use if not exists`, !/create table (?!if not exists)/i.test(code));
    check(`${f}: columns use if not exists`, !/add column (?!if not exists)/i.test(code));
    check(`${f}: indexes use if not exists`, !/create (unique )?index (?!if not exists)/i.test(code));
  }
});

test("every new table has RLS on and is revoked from the public roles", () => {
  for (const f of files) {
    const code = read(f);
    for (const [, t] of code.matchAll(/create table if not exists (\w+)/g)) {
      check(`${t}: RLS on`, code.includes(`alter table ${t} enable row level security;`));
      check(`${t}: revoked from anon`, new RegExp(`revoke all on[^;]*\\b${t}\\b[^;]*from anon, authenticated;`).test(code));
    }
    check(`${f}: no policies`, !/create policy/i.test(code));
    check(`${f}: no grants`, !/\bgrant\b/i.test(code));
  }
});

test("new stream_id columns default to 'main' so current code keeps writing frog rows", () => {
  const code = read("0002_stream_ids.sql");
  for (const t of ["polls", "chat_messages"]) {
    check(`${t}.stream_id default 'main'`, new RegExp(`alter table ${t}\\s+add column if not exists stream_id text not null default 'main' references streams\\(id\\)`).test(code));
  }
  check("push_sends.stream_id is an optional tag", /alter table push_sends\s+add column if not exists stream_id text references streams\(id\) on delete set null/.test(code));
});

test("a stream slug can never shadow one of the site's own top-level paths", () => {
  const code = read("0001_streams_columns.sql");
  const list = code.match(/slug not in \(([^)]*)\)/)?.[1] ?? "";
  const reserved = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const appDir = new URL("../src/app/", import.meta.url);
  const topLevel = fs.readdirSync(appDir, { withFileTypes: true })
    .map((e) => (e.isDirectory() ? e.name : e.name.replace(/\.(tsx?|png|ico|css)$/, "")))
    .filter((n) => !/^[(_[]/.test(n) && !["page", "layout", "globals", "not-found", "error", "loading"].includes(n));
  for (const n of topLevel) check(`'${n}' is reserved`, reserved.includes(n), reserved.join());
  check("'streams' is reserved", reserved.includes("streams"));
  check("the frog stream gets slug 'frogs'", /slug = 'frogs'/.test(code));
});

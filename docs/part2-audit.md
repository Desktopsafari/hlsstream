# Part 2 prep — audit and plan (step 0)

Date: 2026-11-06. Status: **report only**. Nothing in code, database, config or on the VPS was changed.
VPS was inspected with read-only commands (`cat`/`grep`/`ls`/`systemctl list-*`/`crontab -l`); the RTMP
application name (the publish secret) and cron bearer tokens were redacted at the source and are not in this file.

Goal recap: multiple streams (fish tank = second), a landing page at `/`, `/[slug]` per stream, a multi-stream
admin, a codebase that is easy to restyle — with **nothing user-visible changing** until the final flip.

---

## Decisions (2026-11-06)

1. Frog stream: `slug = 'frogs'`, `id` stays `'main'`.
2. Fish publishes into the **same RTMP application** with stream name `fish` (`/hls/fish.m3u8`, no nginx reload).
3. Push: **global** categories and subscriptions, optional stream tag, **one global pause**, `push_sends.stream_id` tag.
4. Chat bans stay global.
5. One global poll schedule; polls on or off per stream (`streams.polls_enabled`).
6. Second cron slot via `-late` alias routes.
7. Gallery global, with a stream badge and filter.
8. Visitor capture limits global.
9. Admin stream selector via `?stream=`.
10. Site-wide announcements (`stream_id` null) show on the landing page and on every stream page.
11. **Swap is already enabled on the VPS** (set up 2026-11-05). The audit below was wrong to say "no swap"; no action needed.
12. Drop the dead columns (`poll_options.image_path`, `species_cards.residents`) and the column-probe code after
    stream scoping (old step 5) — first verify against production that every probed column exists, with the
    read-only query in `supabase/README.md` ("Checking the legacy scripts").
13. Delete `src/lib/supabase/client.ts`. **Keep** `public/logo.png`: moved to `design-assets/logo.png` (nothing linked to it).
14. The CLAUDE.md sections (§5c) go after `@AGENTS.md` later, in their own step.

Plan changes: (a) per feature, the pure move into its feature folder comes first, then stream scoping — two commits —
instead of one global "folders" step; (b) tokens and primitives come before the landing page and `/[slug]` are built;
(c) the landing page is built at a hidden path before the flip; (d) at the flip, `/` is the landing page only when
**two or more** streams are listed, otherwise it shows the single stream as today. `'streams'` is a reserved slug.

Deviations made while doing steps 1–4 (and why):
- **Legacy SQL stays in `supabase/*.sql`** (frozen), listed in order as L01–L15 in `supabase/README.md`, instead of being
  copied/moved into `migrations/`. 25 source and test files — including admin-visible "run supabase/xxx.sql" hints — point at
  those paths; moving them would mean runtime string changes in a SQL-only step, and copies could drift. New SQL starts at
  `supabase/migrations/0001`. Superseded scripts (L07, L11) stay too: they were run, so they're part of the record.
- **`features jsonb` replaced by typed columns**: `polls_enabled` (decision 5); `chat_room` null = no chat; `capture_key` null = no captures.
- **No copy of `poll_auto_hide_hours` into `stream_settings` yet**: the current code keeps writing `site_settings`, so a copy
  made now would go stale. The copy happens in the same change that switches the code (read `stream_settings`, fall back to `site_settings`).
- New foreign keys don't cascade: deleting a stream is refused while it has polls, chat or captures; optional tags (push, email) are set to null.
- Push columns' `not null` relaxed now (decision 3), defaults kept at `'main'` so current code is unaffected. `push_settings` untouched until the code switch.

### Revised step order

| New | Old | Step | Status |
|---|---|---|---|
| 1 | 1 | Migration hygiene: `supabase/migrations/`, `supabase/README.md`; delete `supabase/client.ts`; move logo | done |
| 2 | 2 | `0001_streams_columns.sql` | written, not run |
| 3 | 3 | `0002_stream_ids.sql` | written, not run |
| 4 | 4 | `0003_settings_cron_email.sql` | written, not run |
| 5 | 5 (part) | Shared infra: `streams` server helpers, `requireStream()`, branded `StreamId`, `lib/time/eastern.ts`, isolation-test scaffolding | |
| 6 | 5 + 10 | Per feature, two commits each (move, then scope): polls → announcements/events → species → captures → push (global switch) → chat UI | |
| 7 | — | Dead columns + probe code cleanup (decision 12, after the production check) | |
| 8 | 6 | Chat service rooms + per-stream viewer counts (VPS deploy, ask first) | |
| 9 | 7 | Stream-aware DST-proof crons with `-late` aliases | |
| 10 | 8 | Admin stream selector + global/per-stream tab split | |
| 11 | 9 | Design tokens + UI primitives | |
| 12 | 11 | `/[slug]` route (hidden alias, canonical on `/`) | |
| 13 | — | Landing page at a hidden path | |
| 14 | 12 | Fish stream, unlisted (VPS: capture buffer only; swap already on) | |
| 15 | — | CLAUDE.md sections after `@AGENTS.md` | |
| 16 | 13 | Flip: `/` = landing when ≥ 2 streams listed, else the single stream page | |

The step details in §4 keep their old numbers; use the table above for order.

---

## 1. Single-stream audit

### 1.1 Database

| Table / view | stream_id today? | Notes |
|---|---|---|
| `streams` | — (is the table) | Exists (`supabase/species.sql`): `id text pk, name, created_at`. One row `('main','Desktop Safari Live')`. Public read. Needs more columns (see §3.1). |
| `species_cards` | **yes**, `unique`, FK → streams | Already one card per stream. Image paths are prefixed `${STREAM_ID}/…`. Dead column `residents` (superseded by `names`). |
| `announcements` | **yes**, `not null default 'main'`, FK | Per-stream only. Site-wide announcements need `stream_id` to become nullable (§3). |
| `suggestion_events` | **yes**, `not null default 'main'`, FK | `suggestion_event_frogs` and `name_suggestions` inherit the stream via `event_id`. |
| `captures` | **yes**, `not null default 'main'`, **no FK** | Visitor rate limits (`captures_requester_idx`) are global, not per stream. |
| `push_categories` | **yes**, `unique (stream_id, name)` | ⚠ Per-stream in the schema — conflicts with your "push categories stay global" assumption (§3.9). |
| `push_subscriptions` | **yes** | ⚠ `endpoint` is globally `unique`, so one device can only belong to *one* stream. |
| `push_scheduled`, `push_repeating` | **yes** | Category FK keeps them consistent with the category's stream. |
| `push_settings` | **yes** (it's the PK) | "Pause all push" is per stream. |
| `push_due` (view) | **yes** | Already carries stream_id; `runDuePush` already groups pause checks by stream. |
| `push_sends` (log) | **no** | Needs a `stream_id` tag column (nullable). |
| `polls` | **no** | Core gap. `poll_options`, `votes`, `poll_results` inherit via `poll_id`, so only `polls` needs the column. Dead column `poll_options.image_path`. |
| `chat_messages` | **no** | Needed for per-stream history. |
| `chat_bans` | no | Recommend it **stays global** (a ban should apply site-wide). |
| `site_settings` | no (key/value) | Keys in use: `poll_auto_hide_hours` (`src/lib/pollVisibility.ts:72,218`), `captures_paused` (`src/lib/capture.ts:94-100`). |
| `notification_categories` (email/Resend segments) | no | Global, matches your assumption. |
| `suggestions`, `contact_form_attempts` | no | Global; correct as is. |
| Email broadcasts | no table at all | Sent straight to Resend (`api/admin/broadcasts`). Tagging a send with a stream needs a small `email_sends` log table. |

Schema-file hygiene: the SQL files are unordered "run once" scripts with hidden dependencies
(`announcements.sql` and `suggestion_events.sql` reference `streams`, created in `species.sql`;
`site_settings` is created in two files). There is no record of which ones were run.

### 1.2 API and cron routes

All public routes resolve the stream implicitly (no `stream` parameter anywhere):
`/api/poll`, `/api/vote`, `/api/species`, `/api/announcements`, `/api/suggestion-event(+/suggest)`,
`/api/capture`, `/api/push/subscription(+/status)`, `/api/notification-categories`.

Hard-coded `STREAM_ID` (from `src/config/constants.ts:51`) is imported in:
`api/admin/announcements/route.ts`, `api/admin/suggestion-events/route.ts`, `api/admin/species/route.ts`,
`api/admin/species/image/route.ts`, `api/admin/push/send|repeating|pause/route.ts`,
`api/push/subscription/route.ts`, `lib/announcements.ts`, `lib/events.ts`, `lib/species.ts`,
`lib/push.ts`, `lib/pushAdmin.ts`, `lib/capture.ts` (`:307` row insert, `:326` VPS request).
Library functions take `streamId: string = STREAM_ID` as a **default** parameter — easy to forget.

Polls have no stream at all: `api/admin/polls/*` (8 routes), `lib/pollOpen.ts`, `pollClose.ts`,
`pollRepeat.ts`, `pollVisibility.ts`, `pollImages.ts` all query `polls` globally.

Crons:

| Route | Trigger | Single-stream behaviour |
|---|---|---|
| `/api/cron/open-poll` | Vercel `0 17 * * *` | Opens the oldest `scheduled` poll **globally**; checks "any open poll" globally. |
| `/api/cron/close-poll` | Vercel `0 1 * * *` | Closes the **latest** open poll globally (`limit(1)`), one results email. |
| `/api/cron/cleanup-chat` | Vercel `0 8 * * *` | Global housekeeping — fine as is. |
| `/api/cron/send-due-push` | VPS root crontab, every minute | Already stream-aware via `push_due.stream_id`. |
| `/api/cron/cleanup-captures` | VPS root crontab, `17 * * * *` | Global by design — fine. |

### 1.3 Components, pages, constants, env vars

- `src/app/page.tsx` **is** the frog stream page: `HlsPlayer`, `ViewerCount`, `CaptureButtons`, `NotifyMe`,
  `Announcements`, `SuggestionEventCard`, `PollSection`, `ChatPanel`, `SpeciesCard`, `PollAnchorScroll`.
  None takes a stream prop; each fetches its own unscoped API.
- `HlsPlayer` reads `HLS_STREAM_URL`; `lib/playerRegistry.ts` is a module-level singleton (one player per page — OK).
- `ChatPanel` / `ViewerCount` connect to `CHAT_SERVER_URL` + `/chat` with no room.
- `Header` shows a static "Live" badge and `SITE_NAME`; `layout.tsx`/`manifest.ts` use the brand name (fine: brand is global).
- `lib/announcementLinks.ts:8-9`: `POLL_ANCHOR_HREF = "/#todays-vote"` — assumes the poll lives on `/`.
- `lib/email.ts`: results email has no stream name in the subject; `from` hard-codes "Desktop Safari Live" at `:36` instead of `SITE_NAME`.
- `lib/browserPhoto.ts:12` watermark and `broadcastTemplate.ts:11` mention the domain — global, fine.
- Constants: `HLS_STREAM_URL`, `CHAT_SERVER_URL`, `CHAT_SOCKET_PATH`, `STREAM_ID`, `POLL_TIMEZONE`, `POLL_CLOSE_HOUR`,
  `SPECIES_BUCKET`, `EVENT_BUCKET`, `POLL_RESULTS_EMAIL`.
- Env vars (names only): `NEXT_PUBLIC_HLS_STREAM_URL` and `NEXT_PUBLIC_CHAT_SERVER_URL` are single-stream;
  all others (`SUPABASE_*`, `RESEND_API_KEY`, `CRON_SECRET`, `PUSH_CRON_SECRET`, `CAPTURE_*`, `VAPID_*`,
  `ADMIN_PASSWORD`) are global. `.env.example` lists only a subset (no Supabase/Resend/cron/admin names).

### 1.4 Announcements, naming events, notifications

- Announcements: per stream only; the `'poll'` button kind always links to `/#todays-vote`.
- Naming events: per stream in the DB; admin and public code pinned to `STREAM_ID`. The `contact_form_attempts`
  budget (`form='event'`) is shared across streams — acceptable.
- Email categories: global (`notification_categories`); `SUPPORT_CATEGORY_NAME` is global. OK.
- Push: per stream in the schema (see table). `public/sw.js` defaults the click URL to `/`; stored rows default `url '/'`.
  After the landing-page flip, a "Feeding time" push would open the landing page, not the frog page.

### 1.5 Socket.IO chat service (`chat-service/server.js`)

- One global room: `io.emit("chat:message")` broadcasts to everyone; history is the last 50 rows of the whole table.
- Viewer count: one global counter on the `/viewers` namespace (`viewerCount++/--`).
- Rate limit and ban cache are global (fine). `ALLOWED_ORIGINS` default is hard-coded.
- No stream field on insert (table has none).

### 1.6 VPS (read-only findings)

- nginx `rtmp {}`: **one** application (name redacted), `hls_path /var/www/hls`, 4 s fragments, 30 s playlist.
  Live files are `stream-<n>.ts` → playlist `/hls/stream.m3u8`. A second stream *name* published into the same
  application would automatically produce `/hls/<name>.m3u8` with **no nginx change**.
- `stream.conf` (443): `/hls`, `/chat`, `/capture-api/`, `/captures/f/…`, `/captures/dl/…`, `location = /`.
- Services running: `chat-service`, `capture-service`, `capture-buffer@main`, `nginx`.
- Capture: `/etc/capture/streams/main.env` only; `CAPTURE_STREAMS=main`. The service already validates `stream`
  against `CAPTURE_STREAMS` and `capture-buffer@.service` is templated — adding `fish` is config only (README "Adding the fish tank later").
- Root crontab: `send-due-push` every minute, `cleanup-captures` hourly (tokens kept in header files).
- Capacity: **1 vCPU, 961 MB RAM, ~540 MB available**; swap is on (set up 2026-11-05 — my read-only check missed it; see Decision 11), disk 20% of 24 GB. A second buffer adds
  ~85–100 MB RAM (per the unit file comment) and doubles HLS egress when both are watched.

### 1.7 Admin tabs (`AdminDashboard.tsx:276-608`)

Polls · Events & Announcements · Stream (species card) · Chat (bans) · Email (compose + categories) · Push · Captures · Inbox (suggestions).
All implicitly the frog stream. No stream selector.

### 1.8 Test fixtures

- `tests/support/fake-supabase.mjs`: column lists per table (lines 12-25) and defaults/seeds hard-code `stream_id: "main"`;
  `polls` and `chat_messages` have no stream column there.
- `tests/push.test.mjs:413` and `tests/capture.test.mjs:459` **regex the SQL files** for
  `stream_id text not null default 'main'` — editing those `create table` statements (instead of adding new
  migration files) breaks these tests.
- No test asserts stream isolation (e.g. a fish row never shows on the frog page).

---

## 2. Code health audit

### 2.1 Dead / unused

| Item | Evidence | Suggestion |
|---|---|---|
| `public/logo.png` | Not referenced anywhere in `src/` or `public/sw.js` | Delete (confirm no external link uses it). |
| `src/lib/supabase/client.ts` (`supabaseBrowser`) | Imported nowhere; the browser never queries Supabase | Delete; `NEXT_PUBLIC_SUPABASE_ANON_KEY` then becomes unused too. |
| `poll_options.image_path`, `species_cards.residents` | Marked superseded in their SQL files | Drop in a late cleanup migration. |
| `supabase/poll_option_images.sql`, `species_residents.sql` | Superseded | Move to `supabase/archive/` when migrations are reorganised. |
| Runtime "is the column there yet?" probes | `timingSelect`, `durationSelect`, `imagesSupported`, `hideSupported`, `isMissingCaptureTable`, "run this SQL file" notices | All those SQL files are live now; the probes add an extra query per request. Remove once the migration log confirms they ran. |
| Many exports used only inside their own file | e.g. `lib/push.ts` constants/types, `lib/pollVisibility.ts` types | Harmless; un-export when touching the files. |

No `TODO`/`FIXME`/`HACK` comments found. All npm dependencies are used.

### 2.2 Duplication

- `formatEastern()` is defined four times: `AdminDashboard.tsx:63`, `CapturesAdmin.tsx:64`, `PollVisibilityControls.tsx:11`, `PushAdmin.tsx:65`.
- Eastern-time helpers spread across `pollSchedule.ts`, `push.ts:147-179` (`easternDate/Time/When`), `announcements.ts:120` (`easternWhen` again), `pollDuration.ts:86`. `"America/New_York"` appears as a literal in 7 files despite `POLL_TIMEZONE`. → one `src/lib/time/eastern.ts`.
- Four near-identical image upload routes (`admin/species/image`, `polls/image`, `suggestion-events/image`, `announcements/image`) around `lib/imageUpload.ts`.
- `lib/email.ts` builds `new Resend(...)` twice instead of using `lib/resend.ts`'s `getResendClient()`.
- Three hand-rolled modals (`CaptureModal`, `NotifyMe`, `SpeciesCard`) → one `Modal`.
- Profanity list is correctly shared (`src/lib/profanity.ts` re-exports `chat-service/profanity.js`) — good.

### 2.3 Files over ~400 lines

`AdminDashboard.tsx` 619 (poll form, history and bans inline) · `AnnouncementsAdmin.tsx` 585 · `SuggestionEventAdmin.tsx` 533 ·
`lib/push.ts` 522 · `PushAdmin.tsx` 521 · `lib/capture.ts` 465 · `lib/announcements.ts` 412 ·
`privacy/page.tsx` 409 (content, fine) · tests `capture.test.mjs` 462, `push.test.mjs` 441 (fine).

### 2.4 Inconsistent patterns

- Stream scoping: some lib functions take an optional `streamId`, some import the constant, polls have none.
- Admin components live inside the route folder (`src/app/ctrl-9k3x7m2q/`, 20 files) while public ones live in `src/components/<feature>/`; business logic is a flat `src/lib/` of ~45 files (10 `poll*.ts`).
- Data access: Supabase queries are written inline in route handlers (`api/admin/polls/route.ts` 327 lines) and in libs.
- Cron auth: `cronAuth.ts` for Vercel crons, inline secret checks in the two VPS-pinged routes (fine, but could share one helper).
- Stale comments: `constants.ts:73` and `proxy.ts` refer to `src/middleware.ts` (now `src/proxy.ts`); the cron comments in §5(b).

### 2.5 Folder structure (today)

```
src/app/              pages + api/ + ctrl-9k3x7m2q/ (admin page AND its 20 components)
src/components/<feature>/   public UI (announcement, capture, chat, poll, species, ...)
src/components/ui/Card.tsx  the only shared primitive
src/lib/              ~45 flat files: domain logic, data access, helpers mixed
src/config/constants.ts
supabase/*.sql        unordered run-once scripts
chat-service/, vps/capture/  VPS deployables
```

### 2.6 Styling

**Centralised (good):** `src/app/globals.css` has a Tailwind v4 `@theme` with 9 colors (`parchment, card, forest, forest-dark, amber, amber-light, ink, muted, moss`) and 2 font families (Fraunces heading, Inter sans). Almost every component uses these names, not raw Tailwind palette colors.

**Not centralised:**

- Raw hex outside the theme: `layout.tsx:29` and `manifest.ts:15-16` (`#2f4b3c`, `#f7f3ea` duplicated theme values);
  `SpeciesCard.tsx:16` conservation-status scale (`#5f8f6b #a3b45f #d9a441 #c97c3d #a8402f`);
  `browserPhoto.ts:36,39` watermark rgba (canvas, acceptable).
- No semantic tokens: errors and warnings use `text-amber` (65 uses) — the brand accent doubles as the error color; no success/danger/info tokens. `bg-black` (5) for video backdrops.
- No radius/shadow/spacing tokens: `rounded-md` ×129, `rounded-xl` ×32, `rounded-lg` ×25, `rounded-full` ×17; `shadow-sm` everywhere by hand.
- Ad-hoc type sizes: `text-[11px]` ×44, `text-[10px]` ×3, `text-[13px]` ×1.
- Layout magic numbers: `max-w-6xl` page container repeated in every page; chat height formula `page.tsx` `lg:min-h-[calc((min(100vw,72rem)_-_27rem)_*_0.5625_+_1.5rem)]` couples to the grid.

**Repeated class strings (candidates for primitives):**

| Pattern | Count | Files |
|---|---|---|
| Primary button `rounded-md bg-forest px-3 py-2 text-sm font-semibold text-parchment hover:bg-forest-dark disabled:opacity-50` (+ `py-1.5`, `px-4` variants) | ~22 | 20 files incl. ChatPanel, PollCard, PushNotify, SubscribeForm, SuggestionForm, CaptureModal, AnnouncementCard, LoginForm, most admin files |
| Text input `rounded-md border border-moss bg-parchment px-3 py-2 text-sm text-ink outline-none focus:border-forest` | ~13 | 13 files |
| Secondary button `rounded-md border border-moss px-3 py-1.5 text-sm text-muted hover:bg-card` | 6 | admin |
| Small ghost buttons `rounded-md border border-moss px-2 py-1 text-xs …` | ~14 | admin |
| Card shell `rounded-xl border border-moss bg-card p-5 shadow-sm` | `Card.tsx` + re-typed inline (e.g. `gallery/page.tsx`) | |
| Page header (`h1 font-heading text-2xl … text-forest sm:text-3xl` + muted subtitle) | every page | |
| Pills/badges (Header pills, Live badge, status chips in admin) | several | |

---

## 3. Target design

### 3.1 `streams` table

Keep `id` as the immutable key every `stream_id` FK points at (`'main'` stays forever); add a separate, changeable URL `slug`.

```sql
alter table streams
  add column if not exists slug text,                    -- URL: /frogs
  add column if not exists short_name text,              -- "Frogs" (tabs, selector, email subject)
  add column if not exists tagline text,                 -- landing card / page subtitle
  add column if not exists hls_url text,                 -- https://stream.desktopsafari.com/hls/stream.m3u8
  add column if not exists chat_room text,               -- Socket.IO room, default = id
  add column if not exists capture_key text,             -- capture-buffer@<key>, null = captures off
  add column if not exists poster_path text,             -- landing card image (event-images bucket)
  add column if not exists is_active boolean not null default true,   -- page works at /slug
  add column if not exists is_listed boolean not null default false,  -- shown on the landing page
  add column if not exists sort_order int not null default 0,
  add column if not exists polls_enabled boolean not null default true,   -- decision 5 (was: features jsonb)
  add column if not exists updated_at timestamptz not null default now();
-- slug: lowercase, unique, and never a reserved top-level path
create unique index if not exists streams_slug_key on streams (slug);
alter table streams add constraint streams_slug_check check (
  slug ~ '^[a-z0-9][a-z0-9-]{0,31}$'
  and slug not in ('api','admin','contact','privacy','terms','support','gallery','ctrl-9k3x7m2q',
                   'icon','apple-icon','manifest','robots','sw','favicon','streams')
) not valid;
```

The public RLS policy stays `select using (true)`; `hls_url` is already public. Poll timing (`POLL_TIMEZONE`/`POLL_CLOSE_HOUR`) stays global for now (open question 5).

### 3.2 Routes

```
/                      landing page (lists is_listed streams; per-stream viewer counts)
/[slug]                stream page (today's home page, parameterised)
/[slug]#todays-vote    poll anchor (per stream)
/gallery               global gallery, stream badge + filter (optional /[slug]/gallery later)
/contact /privacy /terms /support    unchanged (static routes win over [slug])
/ctrl-9k3x7m2q?stream=main#polls     admin (see 3.4)
```

- `src/app/(site)/[slug]/page.tsx` — `const { slug } = await params` (Next 16: `params` is a Promise), look up the stream,
  `notFound()` when missing/inactive. `generateMetadata` uses stream name.
- **Old links:** URL fragments never reach the server, so `/#todays-vote` **cannot** be handled by a `next.config` redirect.
  The landing page needs a tiny client component: if `location.hash === "#todays-vote"`, `router.replace("/frogs#todays-vote")`.
  Real server-side permanent (308) redirects in `next.config.mjs` `redirects()` are only for path-based legacy aliases
  (e.g. `/main → /frogs`, `/frog → /frogs`). Old push/email links to `/` keep working (they land on the landing page);
  optionally update stored `push_repeating.url` rows to `/frogs`.
- Announcement `'poll'` buttons compute their href at render time, so they become `/${slug}#todays-vote` automatically;
  `'internal'` targets stored literally as `/#todays-vote` need a one-off check (`select … where button_target like '/#%'`).
- Until the final flip, `/` keeps rendering the frog stream page (same component), so nothing changes for visitors.

### 3.3 Stream-scoped data layer

```ts
// src/server/streams.ts
getStreamBySlug(slug) / getStreamById(id) / listStreams({ listed })   // React cache()-wrapped

// src/server/db/scoped.ts
export function forStream(supabase, streamId: StreamId) {
  return {
    polls:         { list, scheduled, open, insert },  // every query adds .eq("stream_id", streamId)
    announcements: { ... },                            // insert always sets stream_id
    events:        { ... },
    species:       { ... },
    captures:      { ... },
    push:          { ... },
    settings:      { get(key), set(key, value) },      // stream_settings with global fallback
  };
}
```

Guard rails so a feature can't forget the stream:
1. `StreamId` is a branded type only produced by `getStream*()`; lib functions take it **required** (remove every `= STREAM_ID` default).
2. Admin API routes call `requireStream(request)` (reads `?stream=`, validates against `streams`, defaults to `'main'` during the transition).
3. A test that fails if any file outside `src/server/db/` calls `.from("polls" | "announcements" | "suggestion_events" | "species_cards" | "captures" | "chat_messages" | "push_*")`, and if `STREAM_ID` is imported anywhere except the legacy shim.
4. Isolation tests: seed a `fish` stream in the fake DB and assert nothing leaks into `main`.

### 3.4 Admin layout

```
┌ Header: Desktop Safari admin   [ Stream: Frogs ▾ ]  (selector hidden/disabled when 1 stream)
├ Per-stream tabs (follow the selector, ?stream=<id>)
│   Polls · Announcements & Events · Stream page (species card, stream settings) · Chat (history/room)
│   · Captures · Push schedule (scheduled/repeating tagged to the stream)
└ Global tabs (ignore the selector; visually separated under "Site-wide")
    Email (compose + categories) · Push (categories, subscribers, pause-all) · Support · Bans · Inbox · Streams (create/edit/sort)
```

Selector state lives in the URL query (`?stream=main`), tabs stay in the hash as today (`AdminTabs` keeps working).
Per-stream admin components get `streamId` as a prop and pass it to every fetch.

### 3.5 Design tokens and UI primitives

Tokens in `globals.css` `@theme` (Tailwind v4 generates utilities from them):

```css
@theme {
  /* palette (existing values, unchanged) */
  --color-parchment … --color-moss;
  /* semantic aliases — components use these */
  --color-surface: var(--color-card);   --color-page: var(--color-parchment);
  --color-primary: var(--color-forest); --color-primary-hover: var(--color-forest-dark);
  --color-accent: var(--color-amber);   --color-border: var(--color-moss);
  --color-text: var(--color-ink);       --color-text-muted: var(--color-muted);
  --color-danger: var(--color-amber);   /* same as today; can diverge later */
  --color-success: var(--color-forest);
  --color-status-lc … --color-status-cr;  /* SpeciesCard scale */
  --radius-control: 0.375rem; --radius-card: 0.75rem;   /* = rounded-md / rounded-xl */
  --text-2xs: 11px;                                      /* replaces text-[11px] */
  --container-page: 72rem;                               /* replaces max-w-6xl */
}
```

`layout.tsx`/`manifest.ts` read the two hex values from a `src/config/theme.ts` (they can't use CSS variables).

Primitives in `src/components/ui/`: `Button` (primary/secondary/ghost, sm/md), `Input`/`Textarea`/`Select`/`Field` (label + hint + error),
`Card` (existing), `Modal`, `Badge`/`Pill`, `Notice` (error/info/success), `PageHeader`, `PageContainer`, `Tabs` (from `AdminTabs`).
Rule: feature components don't write color/radius classes directly except through these. Refactors must be pixel-identical.

### 3.6 Feature-based folders

```
src/
  app/                      routing only (thin pages + route handlers)
    (site)/page.tsx         landing
    (site)/[slug]/page.tsx  stream page
    api/…                   handlers call features/*/server
    ctrl-9k3x7m2q/          admin shell only
  features/
    streams/   polls/   chat/   announcements/   events/   species/   captures/   push/   email/   contact/
      components/   (public UI)
      admin/        (admin UI)
      server/       (data + domain logic, server-only)
      shared.ts     (types/helpers safe for the browser)
  components/ui/            primitives
  lib/                      cross-cutting only: time/eastern.ts, supabase/, auth, rateLimit, ip, imageUpload
  config/                   constants.ts, theme.ts
supabase/migrations/NNNN_name.sql   ordered, + supabase/README.md "what has been run"
```

Move files feature by feature in their own commits (pure moves + import updates, no logic change).

### 3.7 `docs/ARCHITECTURE.md` outline

1. What runs where (diagram: Pi → VPS nginx-rtmp/HLS, chat-service, capture-service; Vercel Next.js; Supabase; Resend; Web Push).
2. Streams model: `streams` row, id vs slug, what is per stream vs global (table from §3.8).
3. Request flow for a stream page; data layer (`forStream`) and the guard-rail tests.
4. Polls lifecycle and crons (DST-proof schedule, idempotency table).
5. Chat service: rooms, viewer counts, bans.
6. Captures pipeline (link `vps/capture/README.md`).
7. Notifications: email categories, push categories, tagging.
8. Styling: tokens, primitives, rules.
9. Database: migrations, RLS conventions (service_role writes only).
10. Deploy: Vercel, VPS deploy scripts, order of operations.
11. Testing: fake Supabase, stubs, what never touches real data.

### 3.8 Your assumptions — checked

| Assumption | Verdict |
|---|---|
| Chat is per stream | ✅ Agree. But keep **bans global** and the display name/session global. |
| Polls and votes per stream | ✅ Only `polls` needs the column. Cron must loop streams; results email subject should name the stream. |
| Viewer count per stream | ✅ Plus a total for the landing page. |
| Species card per stream | ✅ Already (`unique stream_id`). |
| Naming events per stream | ✅ Already in the DB; only code is pinned. |
| Captures per stream | ✅ Column exists (add FK). Recommend visitor limits and `captures_paused` stay **global**; gallery global with a stream badge. |
| Announcements both site-wide and per stream | ⚠ Today `stream_id` is `not null`. Needs `stream_id` nullable (null = site-wide) and the public query `stream_id = X or stream_id is null`. |
| Email categories global, send can be tagged | ✅ Categories are global. ⚠ There's no send log to tag; add `email_sends`. |
| Push categories global, send can be tagged | ❌ **Wrong today**: `push_categories`, `push_subscriptions`, `push_settings`, `push_scheduled`, `push_repeating` are all per stream, and `endpoint` is globally unique. Making them global means: stop filtering categories/subscriptions by stream, keep `stream_id` as an optional tag (category "about" a stream for grouping), add `push_sends.stream_id`, make pause-all global. Since only `'main'` exists, this is a code change, not a data change. |
| site_settings splits into global and per stream | ✅ New `stream_settings (stream_id, key, value)`; `poll_auto_hide_hours` → per stream; `captures_paused` → global (optionally per stream too). |

---

## 4. Migration plan (small, independently deployable, backward compatible)

Ground rules for every step: additive SQL first, code second; `add column … default 'main'` is instant on Postgres 11+
(no table rewrite); new SQL goes in **new** migration files (don't edit the old `create table` scripts — two tests regex them);
deploy code between 13:00 and 19:00 ET or after 21:00 ET (away from the poll jobs); run `npm test && npm run lint` before each push.

### Step 1 — Migration hygiene (repo only)
- Create `supabase/migrations/`, copy existing scripts in dependency order as `0001…0015` (read-only history), add `supabase/README.md` listing what has been run. Move superseded scripts to `supabase/archive/`.
- SQL: none. VPS: none. Risk: none. Tests: update the two regex tests' file paths if files move (or leave originals in place).

### Step 2 — Extend `streams`
- SQL: §3.1 `alter table streams …`, then
  `update streams set slug='frogs', short_name='Frogs', hls_url='https://stream.desktopsafari.com/hls/stream.m3u8', chat_room='main', capture_key='main', is_listed=true, sort_order=1 where id='main';`
  then `alter table streams validate constraint streams_slug_check; alter table streams alter column slug set not null;`
- VPS: none. Risk: none (nothing reads the new columns). Tests: add the columns to `fake-supabase.mjs`.

### Step 3 — `stream_id` everywhere it's missing + FKs
```sql
alter table polls         add column if not exists stream_id text not null default 'main' references streams(id);
alter table chat_messages add column if not exists stream_id text not null default 'main' references streams(id);
alter table push_sends    add column if not exists stream_id text references streams(id);   -- nullable tag
create index if not exists polls_stream_status_idx on polls (stream_id, status, created_at);
create index if not exists chat_messages_stream_created_idx on chat_messages (stream_id, created_at desc);
alter table captures add constraint captures_stream_fk foreign key (stream_id) references streams(id) not valid;
alter table captures validate constraint captures_stream_fk;
-- same not valid / validate pattern for push_categories, push_subscriptions, push_scheduled, push_repeating
alter table announcements alter column stream_id drop not null;   -- null = site-wide (no rows change)
```
- Backfill: automatic via the default. VPS: none. Risk: low; the chat service's inserts keep working (default). Tests: fake DB columns + defaults.

### Step 4 — `stream_settings`, `cron_runs`, `email_sends`
```sql
create table if not exists stream_settings (
  stream_id text not null references streams(id) on delete cascade,
  key text not null, value jsonb, updated_at timestamptz not null default now(),
  primary key (stream_id, key));
alter table stream_settings enable row level security;
insert into stream_settings (stream_id, key, value)
  select 'main', key, value from site_settings where key = 'poll_auto_hide_hours'
  on conflict do nothing;

create table if not exists cron_runs (            -- idempotency for DST-proof crons
  stream_id text not null references streams(id) on delete cascade,
  job text not null check (job in ('open-poll','close-poll')),
  eastern_date date not null, ran_at timestamptz not null default now(), result text,
  primary key (stream_id, job, eastern_date));
alter table cron_runs enable row level security;

create table if not exists email_sends (
  id uuid primary key default gen_random_uuid(), category_id uuid, stream_id text references streams(id),
  subject text not null, resend_broadcast_id text, created_at timestamptz not null default now());
alter table email_sends enable row level security;
```
- All RLS on, no policies (service_role only). Code reads per-stream setting with fallback to `site_settings`. VPS: none.
- Privacy: `email_sends` stores no visitor data (subject/category only) — confirm; no privacy update needed unless it does.

### Step 5 — Data layer + stream context (no visible change)
- Add `src/server/streams.ts`, `forStream()`, `requireStream()`; make lib functions take `streamId` required; every
  query on polls/chat/etc. adds `.eq("stream_id", …)`; public API routes accept optional `?stream=` defaulting to `main`.
- Components get `stream` props from the page; `/` passes the `main` stream. HLS URL comes from `streams.hls_url` with
  the env var as fallback.
- Push: make categories/subscriptions global (stop filtering by stream), tag sends.
- SQL: none. VPS: none. Risk: medium (touches many files) — split into one PR per feature (polls, announcements/events,
  species, captures, push). Tests: fake DB gains a `fish` stream; add isolation tests and the "no unscoped `.from()`" test.

### Step 6 — Chat service rooms + per-stream viewer counts
- Server: read `stream` from `socket.handshake.auth`/`query` (validate against `streams` cached like bans; default `'main'`),
  `socket.join(room)`, history `.eq("stream_id", room)`, insert with `stream_id`, `io.to(room).emit(...)`. Viewers:
  `/viewers` sockets join a room, counts per room (`viewers.adapter.rooms.get(room)?.size`), plus `viewers:totals` for the landing page.
- Order: **deploy chat service first** (old clients without a stream → `'main'`, identical behaviour), then the site sends `stream`.
- VPS: copy files + `systemctl restart chat-service` via existing `deploy.sh` (ask first). Risk: a ~2 s disconnect; clients auto-reconnect. Tests: none exist for the chat service — add a small one or test manually on a second room.
- Privacy: no new data (stream id is not visitor data) — re-check wording about chat history.

### Step 7 — Stream-aware, DST-proof crons (see §5a)
- `vercel.json`: open-poll `0 16 * * *` + `0 17 * * *`, close-poll `0 0 * * *` + `0 1 * * *`, cleanup-chat unchanged (5 entries).
- Code: loop active streams with `polls_enabled`; gate on Eastern time; claim `cron_runs` row (`insert … on conflict do nothing`, act only if inserted).
- SQL: `cron_runs` from step 4. VPS: none. Risk: deploy on a weekday afternoon ET, watch the next 4 runs in Vercel logs.
  Tests: new `tests/cron-dst.test.mjs` covering EDT/EST × both slots × manual Open now/Close now in between.
- Delete or rewrite `vercel-cron-dst-notes.txt` (no more twice-yearly edits).

### Step 8 — Admin stream selector and tab split
- Selector (hidden while one stream), `?stream=` query, per-stream vs site-wide tab groups, Streams tab (edit name/slug/active/listed/order).
- SQL/VPS: none. Risk: low (admin only). Tests: admin route tests pass `?stream=main`.

### Step 9 — Design tokens + primitives (can run any time, in parallel with 5–8)
- Add semantic tokens, `Button`/`Input`/`Modal`/`Notice`/…; replace repeated class strings file by file; pixel-identical.
- SQL/VPS: none. Risk: visual regressions → screenshot before/after per page at 375 px and desktop.

### Step 10 — Feature folders (after 5, before 11)
- Pure moves, one feature per commit. Risk: import churn only; `npm run lint` catches it.

### Step 11 — `/[slug]` route (hidden alias)
- `src/app/(site)/[slug]/page.tsx` renders the same `StreamPage`; `/frogs` works, `/` unchanged. Add `rel=canonical` to `/` so search engines don't see duplicates. Reserved-slug constraint already in place.
- Risk: low. Tests: route resolves, unknown slug 404s, reserved slugs rejected.

### Step 12 — Fish tank stream (unlisted)
- SQL: `insert into streams (id, slug, name, short_name, hls_url, chat_room, capture_key, is_active, is_listed, sort_order) values ('fish','fish','…','Fish', 'https://stream.desktopsafari.com/hls/fish.m3u8','fish','fish', true, false, 2);` plus a `species_cards` row and `stream_settings` defaults.
- VPS (ask first): encoder publishes to the same RTMP application with stream name `fish` (no nginx change) *or* a new application (nginx reload); `/etc/capture/streams/fish.env`; `CAPTURE_STREAMS=main,fish`; restart `capture-service`; `systemctl enable --now capture-buffer@fish`. Swap is already on (Decision 11); still watch memory after enabling the second buffer.
- Risk: RAM/CPU on a 1 vCPU / 961 MB droplet; double egress. Test at `/fish` before listing.

### Step 13 — Flip (first user-visible change; separate approval)
- `/` → landing page; frog page lives at `/frogs`; client-side `#todays-vote` forward; Header "Live" per stream; push repeating URLs → `/frogs`; privacy/terms updates (per-stream chat, any new storage); `start_url` stays `/`.

---

## 5. Additional items

### 5(a) DST-proof open/close crons

Proposal: open-poll at `0 16` and `0 17` UTC, close-poll at `0 0` and `0 1` UTC; each run acts only when the Eastern-time check says it's due.

| Slot | During EDT (UTC-4) | During EST (UTC-5) |
|---|---|---|
| open `0 16` | 12:xx ET → **acts** | 11:xx ET → must skip |
| open `0 17` | 13:xx ET → must skip (already done) | 12:xx ET → **acts** |
| close `0 0` | 20:xx ET → **acts** | 19:xx ET → must skip |
| close `0 1` | 21:xx ET → must skip (already done) | 20:xx ET → **acts** |

Things that would break it, or need care:
1. **Today's close job closes a normal daily poll whenever it runs** (`isDueForJob(…, "evening")` → `!long || ended`, `pollClose.ts`). Under the new schedule the `0 0` run in winter fires at ~7 PM ET and would close the poll an hour early (and email results). The gate must be "ET hour ≥ 20 **or** the poll has ended", not just "it's the evening job". Likewise open-poll at `0 16` in winter would open at ~11 AM ET without a gate.
2. **Second run of the day must be a no-op.** Without a marker: if the admin uses Close now after the noon open, the 13:xx run opens the *next* queued poll; if the admin uses Open now at 20:30, the 21:xx run closes it. Use `cron_runs (stream_id, job, eastern_date)` and act only if the insert succeeds. Write the marker only after success, or use a `result` column so a failed first run lets the second retry (this also gives a free retry, which Vercel doesn't do).
3. **Vercel Hobby limits:** Hobby crons may run at most **once per day per entry**, so `0 16,17 * * *` in one entry is rejected at deploy — it must be two separate entries. Timing is only guaranteed within the hour (you've observed ~40–50 min late), which the table above tolerates because the gate is hour-based on the ET clock and the "acts" slot always lands in the right ET hour. Total entries go 3 → 5; the project already runs 3, so the old 2-cron Hobby cap clearly isn't in force, but **check the current per-project cron limit in the Vercel dashboard before deploying**.
4. **Duplicate paths:** I could not verify whether `vercel.json` accepts two entries with the identical `path`. Safest: give the second slot its own path (`/api/cron/open-poll-late`, `/api/cron/close-poll-late`) as one-line re-exports of the same handler — or test a duplicate-path config on a preview deploy first.
5. Crons only fire on the production deployment; a deploy in the middle of an hour doesn't move the slot.
6. The ET hour check should use `Intl` with `POLL_TIMEZONE` (one helper in `lib/time/eastern.ts`), never a fixed offset.
7. Multi-stream: loop streams inside one invocation (no extra cron entries per stream); each stream gets its own `cron_runs` row and its own results email.
8. Alternative worth considering later: the VPS crontab already pings every minute; moving poll jobs there gives minute-accurate timing (but ties polls to VPS uptime).

### 5(b) Wording issues to fix later

1. `vercel-cron-dst-notes.txt:37-41` says the poll "may open/close a few minutes (rarely more) later" — observed lateness is **~40–50 minutes** (Vercel only guarantees the hour). (Moot once step 7 retires the file.)
2. `src/app/api/cron/open-poll/route.ts:9-11` says "see vercel.json for the schedule and README-style comments there about the twice-yearly DST adjustment" — `vercel.json` is plain JSON with no comments; the notes live in **`vercel-cron-dst-notes.txt`**. The same mistake is in `src/app/api/cron/close-poll/route.ts:8-9` ("the DST note there").
   (Bonus, same kind: `src/config/constants.ts:73` points to `src/middleware.ts`, which is now `src/proxy.ts`.)

### 5(c) CLAUDE.md outline (not created)

Note: a root `CLAUDE.md` already exists and contains only `@AGENTS.md`; `next dev` re-writes the Next.js block in `AGENTS.md`.
Recommendation: keep the `@AGENTS.md` import line at the top of `CLAUDE.md` and add the sections below after it.

1. **Project in one paragraph** — Desktop Safari Live: multi-stream live wildlife site; Next.js 16 on Vercel, Supabase, VPS for RTMP/HLS/chat/capture.
2. **Architecture pointer** — read `docs/ARCHITECTURE.md`; per-stream vs global table.
3. **Conventions** — every stream-owned query goes through `forStream()`; never import `STREAM_ID`; Eastern time via `lib/time/eastern.ts`; styling only through tokens/`components/ui`; feature folders; files under ~400 lines.
4. **Database** — new SQL = new numbered file in `supabase/migrations/`; additive and backward compatible; RLS on, service_role writes only; the user runs SQL manually in the Supabase editor — give them the exact SQL, never run it.
5. **Testing** — `npm test`, `npm run lint`; tests use the fake DB only, never real services; add an isolation test for any new per-stream feature.
6. **VPS layout** — host alias `vps`; `/opt/chat-service`, `/opt/capture-service`, `/etc/capture/*`, `/etc/nginx/sites-enabled/stream.conf`, `/var/www/hls`, `/var/lib/capture/*`, root crontab entries; units `chat-service`, `capture-service`, `capture-buffer@<key>`.
7. **Ask before touching the VPS** — read-only commands only unless the user approves the exact change; never reload nginx while live without asking (RTMP publisher may drop); keep the `rtmp {}` block untouched.
8. **Secrets** — never print or commit `.env*`, `/etc/capture/*.env`, `/etc/capture/streams/*.env`, `/root/.*-cron-header`, `/opt/chat-service/.env`, or the RTMP application name; reference env vars by name only.
9. **Privacy notice rule** — (existing AGENTS.md rule) update `src/app/privacy/page.tsx` and its date with any data change.
10. **Deploy timing** — avoid deploying around 12:00 and 20:00 ET (poll jobs).
11. **Git** — branch off `main`, commit only when asked.

---

## 6. Open questions (with recommendations)

1. **Frog stream URL slug?** → Recommend `id='main'` forever, `slug='frogs'` (page at `/frogs`).
2. **Fish RTMP: same application with stream name `fish`, or a new application with its own publish key?** → Same application (zero nginx change, no reload while live) if it's the same encoder/owner; a new application only if a different device/person publishes.
3. **Push categories and subscriptions global?** → Yes: global categories with an optional stream tag (e.g. "Frog feeding time", "Fish feeding time"), global subscriptions, global pause, `push_sends.stream_id` tag.
4. **Chat bans global?** → Yes.
5. **Same poll schedule (noon–8 PM ET) for every stream, or per stream?** → Same global schedule now; per-stream `polls_enabled`. Move hours into `streams` only if needed.
6. **Second cron slot: duplicate path or `-late` alias routes?** → Alias routes (certain to deploy); move to the VPS crontab only if the ~45 min lateness becomes a problem.
7. **Gallery global or per stream?** → Global `/gallery` with stream badge + filter.
8. **Visitor capture limits per stream or global?** → Global per visitor.
9. **Admin stream switch: query param or path segment?** → `?stream=<id>` (proxy matcher and hash tabs keep working).
10. **Site-wide announcements: where do they show?** → On the landing page and on every stream page (`stream_id is null`), above stream ones.
11. ~~Swap / droplet size before the fish buffer?~~ → Settled: swap is already enabled (Decision 11).
12. **Drop dead columns (`poll_options.image_path`, `species_cards.residents`) and the column-probe code?** → Yes, in one cleanup step after step 5, once `supabase/README.md` confirms every script ran.
13. **Delete `public/logo.png` and `src/lib/supabase/client.ts`?** → Yes, in step 1 (confirm the logo isn't linked from outside the site).
14. **Where do CLAUDE.md contents go?** → Into the existing `CLAUDE.md` below `@AGENTS.md`, linking `docs/ARCHITECTURE.md`.

---

## Summary

- Half the schema is already stream-ready (`species_cards`, `announcements`, `suggestion_events`, `captures`, all push tables); the gaps are `polls`, `chat_messages`, `push_sends`, `site_settings` and the code, which pins everything to `STREAM_ID='main'` or has no stream at all (polls, chat, viewer count, crons).
- Two assumptions need correcting: push is **per stream** in the schema today (and a device can only subscribe to one stream), and announcements can't be site-wide until `stream_id` is nullable.
- The DST-proof crons work only with an Eastern-time gate **and** a per-day idempotency marker; today's close logic would close polls an hour early in winter on the `0 0` slot.
- VPS is close to ready for a second stream (templated capture buffer, no nginx change needed for a second stream name), RAM is tight (961 MB; swap already on).
- Styling is mostly tokenised colors already; missing are semantic tokens, radii/size tokens and ~50 repeated button/input class strings that should become `components/ui` primitives.
- 13 small steps; nothing visible changes until step 13 (the landing-page flip).

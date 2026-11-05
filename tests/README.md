# Tests

Run them with:

```bash
npm test
```

(`npm run typecheck` and `npm run lint` check the TypeScript; see "Scripts" below.)

## These tests never touch real data

Read this before changing anything here.

- Every test runs against a **fake, in-memory database** (`support/fake-supabase.mjs`)
  that lives only inside the test process, plus a fake file store and a fake email
  sender (`support/stub-email.mjs`, which just records what would have been sent).
- The loader (`support/hooks.mjs`) swaps `src/lib/supabase/server.ts` and
  `src/lib/email.ts` for those fakes **unconditionally**. There is no setting that
  switches the real Supabase, Supabase Storage or Resend back on, so a test cannot
  read or change real polls, votes, pictures or send a real email. The `web-push` package is
  swapped the same way (`support/stub-web-push.mjs` records notifications instead of sending
  them), so no test can reach a real push service. `fetch` itself is replaced (in `support/register.mjs`) with one that only answers the stub capture service at a made-up `capture.test` host, so no test can reach the real VPS or anything else on the network.
- `support/register.mjs` also overwrites the Supabase environment variables with
  obviously fake values and removes `RESEND_API_KEY`, as a second safety net.
- All polls, options, votes, announcements and species cards in the tests are made-up ("TEST ...") and live in memory
  for the length of one test.

If you ever want to test against a real database, do not add it here.

## How it works

- Node's built-in runner (`node --test`), no extra packages.
- The real source files in `src/` are loaded directly (Node strips the TypeScript types).
  The real route handlers (`/api/vote`, the cron routes, the admin routes ...) are called
  with ordinary `Request` objects.
- Time is controlled with `withNow(date, fn)` (in `support/helpers.mjs`), so "8:00 PM
  Eastern", "three days later" and the November clock change can be tested without waiting.
  `ET(year, month, day, hour, minute)` builds an Eastern-time moment.
- `support/helpers.mjs` has the shared helpers (`fresh()` for a clean database,
  `vote(...)`, `cronOpen(...)`, `cronClose(...)`, `queue(...)`, ...).

## What is covered

| File | Covers |
|---|---|
| `schedule.test.mjs` | the 8:00 PM ET cutoff, the Open now window, 2-30 day / specific-end / open-ended rules, daylight-saving-exact end times, summaries |
| `votes.test.mjs` | the cutoff enforced on every vote, one vote per browser per poll, refused votes |
| `lifecycle.test.mjs` | closing once + the results email exactly once, repeat-daily copy, a hand-queued poll beating a repeating poll, the queue, Open now rules (confirmation, replacing, stale polls, double clicks), Close now, the daily jobs |
| `long-polls.test.mjs` | 3-day and open-ended polls across simulated days, pause/resume of the daily poll, Change end time, email timing, validation, working without the duration columns |
| `pictures.test.mjs` | poll picture uploads (validation, replace, remove, shared files between a repeating poll's copies, pending uploads), working without the picture column |
| `unlink.test.mjs` | votes unlinked from browser ids about 7 days after the real close |
| `announcements.test.mjs` | announcement cards: start/end/switch visibility from the clock, Eastern times across the clock change, the 3-card cap (newest first), validation, button links (poll anchor, internal paths, https only; javascript: and other schemes refused), picture uploads (validation, replace, remove, shared files, pending uploads), working without the table |
| `species-names.test.mjs` | the species card names block: one name per line, blank lines and spaces dropped, heading default and limits, 12-name cap, working without the columns |
| `push.test.mjs` | push notifications: subscribe / change categories / unsubscribe (only endpoint, keys and categories stored), bad endpoints refused, the "push" rate limit, send now (category, 2-hour TTL, 410/404 deleted, 5 failures in a row deleted), title/message/link limits, test send, scheduled sends, repeating sends (Skip today + undo, Active, days of week, once a day, clock change), the 30-minute missed window, two overlapping pings sending once, the pause switch, the cron secret and the one-query idle check, admin routes refusing without login, RLS with no public access, working before the SQL is run or without keys |
| `capture.test.mjs` | clips and photos (Capture): visitor clip limits (1 per 3 min, 5 per hour, 15 per hour site-wide) and server-photo limits (1 per 20 s, 20 per hour, 300 per hour), 15/30 s visitor and 60 s admin caps, admin exempt, 24 h visitor / 48 h admin expiry, the pause switch, the 5 GB storage budget, latency shift (missing, invalid and oversized delays; the VPS buffer clamp and segment picking from `vps/capture/window.mjs`), external-link host validation, featuring and keeping clear the requester hash, the gallery, hourly expiry cleanup (VPS files first, linked items keep their thumbnail), the VPS being down or failing, admin and cron auth, RLS with no public access, staying hidden before the SQL or env vars. The VPS is a stub (`support/stub-capture-service.mjs`): `fetch` refuses every other host. |
| `poll-hide.test.mjs` | hiding closed polls: Hide/Show on site (double clicks, open/queued polls refused, nothing deleted), auto-hide at every threshold from the real close time (daily, multi-day, Close now, ended-but-not-flipped), Show overriding the timer, the next poll showing, the results email still sent once, the public API not leaking a hidden poll, working without the SQL |

## Scripts

- `npm test` - runs everything above.
- `npm run typecheck` - `tsc --noEmit`.
- `npm run lint` - the strict TypeScript check: `tsc --noEmit --noUnusedLocals --noUnusedParameters`
  (reports unused variables and imports; there is no ESLint in this project).

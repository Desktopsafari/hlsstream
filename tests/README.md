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
  read or change real polls, votes, pictures or send a real email.
- `support/register.mjs` also overwrites the Supabase environment variables with
  obviously fake values and removes `RESEND_API_KEY`, as a second safety net.
- All polls, options and votes in the tests are made-up ("TEST ...") and live in memory
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

## Scripts

- `npm test` - runs everything above.
- `npm run typecheck` - `tsc --noEmit`.
- `npm run lint` - the strict TypeScript check: `tsc --noEmit --noUnusedLocals --noUnusedParameters`
  (reports unused variables and imports; there is no ESLint in this project).

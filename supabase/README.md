# Database scripts

All SQL is run **by hand** in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
Nothing in this repo runs SQL against the live database.

## Rules for new SQL

- New changes go in `migrations/` as the next number: `NNNN_short_name.sql`. Never edit a file after it has been run.
- Additive and backward compatible: add columns with a default (usually `'main'`), add tables, add indexes,
  relax `not null`. Switch the code in a later deploy. Drops come last, in their own migration, once no code uses the thing.
- Safe to run twice (`if not exists`, `on conflict do nothing`, guarded `do $$` blocks).
- RLS on for every new table; writes go through the server (service_role). No policies unless the public must read it.
- After running one, add a row below (date run + who) in the same commit or the next one.

## Legacy scripts (`supabase/*.sql`)

Written before `migrations/` existed. They stay where they are, frozen, because the admin panel's
"run this file" hints and several tests point at these paths. In the order they were added:

| # | File | Status |
|---|---|---|
| L01 | `schema.sql` | Applied |
| L02 | `species.sql` (creates `streams`) | Applied |
| L03 | `polls_repeat.sql` | Applied |
| L04 | `notifications.sql` | Applied |
| L05 | `suggestion_events.sql` (needs L02, L04) | Applied |
| L06 | `chat_privacy.sql` | Applied |
| L07 | `poll_option_images.sql` | **Do not run.** Superseded by L08; its column `poll_options.image_path` was dropped by hand (before 2026-11-06). Running it would re-add it. |
| L08 | `poll_question_image.sql` | Applied |
| L09 | `poll_duration.sql` | Applied |
| L10 | `announcements.sql` (needs L02) | Applied |
| L11 | `species_residents.sql` | **Do not run.** Superseded by L12; its column `species_cards.residents` was dropped by hand (before 2026-11-06). Running it would re-add it. |
| L12 | `species_names.sql` | Applied |
| L13 | `poll_hide.sql` | Applied |
| L14 | `push_notifications.sql` | Applied |
| L15 | `captures.sql` | Applied |

Checked against production on 2026-11-06 with the query under "Checking the legacy scripts": every
column and table is present except the two dropped on purpose (L07, L11).

## Migrations (`supabase/migrations/`)

| # | File | What | Run on |
|---|---|---|---|
| 0001 | `0001_streams_columns.sql` | `streams`: slug, names, HLS URL, chat room, capture key, polls on/off, listed/active, order. Frog stream = slug `frogs`. | 2026-11-06 |
| 0002 | `0002_stream_ids.sql` | `stream_id` on `polls`, `chat_messages`, `push_sends`; foreign keys; announcements and push stream optional. Needs 0001. | 2026-11-06 |
| 0003 | `0003_settings_cron_email.sql` | New tables `stream_settings`, `cron_runs`, `email_sends`. Needs 0001. | 2026-11-06 |

## Checking the legacy scripts

Read-only. Every row should say `true`, **except** `poll_options.image_path` (L07) and
`species_cards.residents` (L11), which should say `false`: both columns were dropped on purpose. Any other
`false` means that script (or part of it) never ran.

```sql
select t.tbl, t.col,
  exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = t.tbl and (t.col is null or c.column_name = t.col)
  ) as present
from (values
  ('polls', 'repeat_daily'), ('polls', 'repeat_paused'),                          -- L03
  ('notification_categories', null), ('suggestions', null),                       -- L04
  ('contact_form_attempts', 'form'), ('suggestion_events', null),                 -- L05
  ('suggestion_event_frogs', null), ('name_suggestions', null),
  ('poll_options', 'image_path'),                                                 -- L07: expect false (dropped)
  ('polls', 'image_path'),                                                        -- L08
  ('polls', 'ends_at'), ('polls', 'open_ended'), ('polls', 'duration_days'),      -- L09
  ('announcements', null),                                                        -- L10
  ('species_cards', 'residents'),                                                 -- L11: expect false (dropped)
  ('species_cards', 'names_heading'), ('species_cards', 'names'),                 -- L12
  ('polls', 'hidden_at'), ('polls', 'force_shown'), ('site_settings', null),      -- L13
  ('push_categories', null), ('push_subscriptions', null), ('push_sends', null),  -- L14
  ('push_scheduled', null), ('push_repeating', null), ('push_settings', null),
  ('push_due', null),
  ('captures', null)                                                              -- L15
) as t(tbl, col)
order by present, tbl, col;
```

L06 removed a policy rather than adding something; this should return `true`:

```sql
select not exists (select 1 from pg_policies where tablename = 'chat_messages' and policyname = 'chat_messages_public_read') as l06_applied;
```

-- 0003: per-stream settings, cron run log, email send log (Part 2, step 4).
-- Run once in the Supabase SQL Editor, AFTER 0001. Safe to run more than once.
-- New, empty tables only: nothing in the site uses them yet.
--
-- None of these tables holds visitor data (settings, job runs, and what the
-- admin sent). Row Level Security is on and there are NO policies, and the
-- anon/authenticated roles get no grants: only the server (service_role) reads
-- and writes them, like site_settings and the push tables.

-- Per-stream admin settings, one row per (stream, setting). Settings that stay
-- site-wide keep living in site_settings.
--
-- Deliberately NOT copied from site_settings here: the current code keeps
-- writing site_settings, so a copy made today would go stale. When the code
-- switches, it reads stream_settings first and falls back to site_settings,
-- and the copy (poll_auto_hide_hours) happens in that same change.
create table if not exists stream_settings (
  stream_id text not null references streams(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (stream_id, key)
);

-- One row per stream, job and Eastern calendar day, so a cron that fires twice
-- a day (DST-proof schedule, the -late alias routes) acts only once. The first
-- run to insert the row does the work; a failed run marks it 'failed' so the
-- later slot can retry.
create table if not exists cron_runs (
  stream_id text not null references streams(id) on delete cascade,
  job text not null check (job in ('open-poll', 'close-poll')),
  eastern_date date not null,
  status text not null default 'claimed' check (status in ('claimed', 'done', 'failed')),
  detail text,
  ran_at timestamptz not null default now(),
  primary key (stream_id, job, eastern_date)
);

-- Every email broadcast the admin sends, optionally tagged with a stream.
-- Holds no recipient addresses: those stay in Resend.
create table if not exists email_sends (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references notification_categories(id) on delete set null,
  -- Copy of the category's name at send time, so the log reads right after a rename.
  category_name text,
  stream_id text references streams(id) on delete set null,
  subject text not null,
  resend_broadcast_id text,
  created_at timestamptz not null default now()
);
create index if not exists email_sends_created_idx on email_sends (created_at desc);

alter table stream_settings enable row level security;
alter table cron_runs enable row level security;
alter table email_sends enable row level security;
revoke all on stream_settings, cron_runs, email_sends from anon, authenticated;

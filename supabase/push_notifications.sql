-- Web Push notifications (phone and desktop) from the "Notify me" modal, plus
-- the admin panel's Push tab (send now, send at, repeating, log, pause).
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). The site works without it: the push option stays hidden
-- and nothing else changes.
--
-- Row Level Security is on for every table and there are NO policies, and
-- the anon/authenticated roles get no grants at all: the public (browser) key
-- can't read or write any of this. Everything goes through the site's server
-- routes, which use the service_role key.
--
-- stream_id (default 'main') is on the tables that belong to one stream, ready
-- for the planned second stream. All Eastern-time math (repeating times, days
-- of the week, "skip today") is done by the website, not here.

-- Categories a visitor can choose (one per checkbox in the modal).
create table if not exists push_categories (
  id uuid primary key default gen_random_uuid(),
  stream_id text not null default 'main',
  name text not null check (char_length(name) between 1 and 60),
  display_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (stream_id, name)
);

insert into push_categories (stream_id, name, display_order) values
  ('main', 'Announcements & events', 1),
  ('main', 'Feeding time', 2)
on conflict (stream_id, name) do nothing;

-- One row per browser/device that turned notifications on. Only what the push
-- service needs to deliver (endpoint + keys) and the chosen categories: no
-- name, email or browser ID. Deleted when the visitor turns it off, when the
-- push service says it's gone (404/410), or after 5 failed sends in a row.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  stream_id text not null default 'main',
  endpoint text not null unique check (char_length(endpoint) between 20 and 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  category_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count int not null default 0
);
create index if not exists push_subscriptions_stream_idx on push_subscriptions (stream_id);

-- Every send (and every missed one), newest shown first in the admin log.
-- source: 'now', 'test', 'scheduled', 'repeating'. status: 'sent' or 'missed'.
create table if not exists push_sends (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  message text not null default '',
  url text not null default '/',
  category_id uuid,
  category_name text,
  source text not null,
  status text not null default 'sent',
  recipients int not null default 0,
  sent int not null default 0,
  failed int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists push_sends_created_idx on push_sends (created_at desc);

-- One-time "Send at" notifications. status: pending -> sending -> sent, or
-- missed (its 30-minute window passed) or cancelled.
create table if not exists push_scheduled (
  id uuid primary key default gen_random_uuid(),
  stream_id text not null default 'main',
  title text not null check (char_length(title) between 1 and 60),
  message text not null check (char_length(message) between 1 and 140),
  url text not null default '/',
  category_id uuid not null references push_categories(id) on delete cascade,
  send_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'missed', 'cancelled')),
  claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists push_scheduled_due_idx on push_scheduled (send_at) where status = 'pending';

-- Repeating notifications ("Feeding time" every day at 6:00 PM ET ...).
-- time_of_day is Eastern wall-clock 'HH:MM'; days_of_week uses 0 = Sunday
-- ... 6 = Saturday; skip_date / last_sent_date are Eastern calendar dates.
-- next_send_at is worked out by the website whenever the row changes or is
-- sent, so the every-minute check is one small query.
create table if not exists push_repeating (
  id uuid primary key default gen_random_uuid(),
  stream_id text not null default 'main',
  title text not null check (char_length(title) between 1 and 60),
  message text not null check (char_length(message) between 1 and 140),
  url text not null default '/',
  category_id uuid not null references push_categories(id) on delete cascade,
  time_of_day text not null check (time_of_day ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  days_of_week int[] not null default '{0,1,2,3,4,5,6}',
  is_active boolean not null default true,
  skip_date date,
  last_sent_date date,
  next_send_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The "Pause all push sending" switch, per stream.
create table if not exists push_settings (
  stream_id text primary key default 'main',
  paused boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into push_settings (stream_id) values ('main') on conflict (stream_id) do nothing;

-- Everything that could be due, in one place, so the every-minute check is a
-- single query. Kept generic (kind + id + due_at) so other timed sends can be
-- added to it later.
create or replace view push_due with (security_invoker = true) as
  select 'scheduled'::text as kind, id, stream_id, send_at as due_at
    from push_scheduled where status = 'pending'
  union all
  select 'repeating'::text as kind, id, stream_id, next_send_at as due_at
    from push_repeating where is_active and next_send_at is not null;

alter table push_categories enable row level security;
alter table push_subscriptions enable row level security;
alter table push_sends enable row level security;
alter table push_scheduled enable row level security;
alter table push_repeating enable row level security;
alter table push_settings enable row level security;

revoke all on push_categories, push_subscriptions, push_sends, push_scheduled,
  push_repeating, push_settings, push_due from anon, authenticated;

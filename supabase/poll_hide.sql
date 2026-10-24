-- Hiding closed polls from the public page.
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). The site works without it: nothing is hidden and the
-- admin poll section says to run this file.
--
-- Hiding never deletes anything: votes, options, pictures and results stay,
-- and the results email is unaffected. RLS on polls is unchanged.

-- "Hide from site" on a closed poll stores when it was hidden. Null = not
-- hidden by hand.
alter table polls add column if not exists hidden_at timestamptz;

-- "Show on site" on a closed poll sets this, so the auto-hide timer is
-- ignored for that poll. Hiding it again clears it.
alter table polls add column if not exists force_shown boolean not null default false;

-- Site-wide admin settings, one row per setting. Only the server
-- (service_role) reads and writes it: RLS on, no public policies.
create table if not exists site_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;

-- "Hide closed polls after": hours as a number, or null for never (default).
insert into site_settings (key, value) values ('poll_auto_hide_hours', 'null'::jsonb)
  on conflict (key) do nothing;

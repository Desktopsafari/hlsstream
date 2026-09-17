-- Desktop Safari Live: chat + voting schema.
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).

-- ============================================================
-- CHAT
-- ============================================================

create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  display_name text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_created_at_idx on chat_messages (created_at desc);

alter table chat_messages enable row level security;
create policy "chat_messages_public_read" on chat_messages
  for select using (true);
-- No insert/update/delete policy for the public role: only the moderated
-- chat service (using the service_role key, which bypasses RLS) can write.

-- Bans/mutes by session id or IP address. Admin-only: no RLS policy at all
-- means the anon/public role has zero access (not even read); only
-- service_role can touch this table.
create table if not exists chat_bans (
  id uuid primary key default gen_random_uuid(),
  session_id text,
  ip_address text,
  reason text,
  created_at timestamptz not null default now(),
  constraint chat_bans_target_check check (session_id is not null or ip_address is not null)
);
alter table chat_bans enable row level security;

-- ============================================================
-- POLLS / VOTING
-- ============================================================

create table if not exists polls (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'open', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists polls_status_idx on polls (status);

alter table polls enable row level security;
create policy "polls_public_read" on polls
  for select using (true);
-- Writes (creating the next poll, flipping status) go through the admin
-- panel / cron jobs using the service_role key.

create table if not exists poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  label text not null,
  display_order int not null default 0
);
create index if not exists poll_options_poll_id_idx on poll_options (poll_id);

alter table poll_options enable row level security;
create policy "poll_options_public_read" on poll_options
  for select using (true);

-- One vote per browser session per poll. Raw votes are NOT publicly
-- readable (no anon policy at all) since session_id shouldn't be exposed;
-- the poll_results view below exposes only aggregated counts.
create table if not exists votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  option_id uuid not null references poll_options(id) on delete cascade,
  session_id text not null,
  created_at timestamptz not null default now(),
  unique (poll_id, session_id)
);
create index if not exists votes_poll_id_idx on votes (poll_id);

alter table votes enable row level security;
-- Intentionally no policies: all vote writes go through a server-side API
-- route (service_role), which enforces "poll is open" + one-vote-per-session
-- server-side, on top of the unique constraint above as a DB-level backstop.

-- Public, read-only tally. Created by the table owner (via the SQL editor),
-- so it runs with the owner's privileges and can read `votes` even though
-- the public role can't query that table directly -- only aggregated counts
-- are exposed here, never raw session_ids.
create or replace view poll_results as
  select
    po.poll_id,
    po.id as option_id,
    po.label,
    po.display_order,
    count(v.id) as vote_count
  from poll_options po
  left join votes v on v.option_id = po.id
  group by po.poll_id, po.id, po.label, po.display_order;

grant select on poll_results to anon, authenticated;

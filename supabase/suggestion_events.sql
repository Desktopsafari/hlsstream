-- Temporary "suggestion events" (e.g. name ideas for specific frogs).
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). Run this BEFORE the code that uses it is deployed.

-- One row per event. Keyed to a stream (like species_cards) so the future
-- multi-stream work can run a separate event per stream.
create table if not exists suggestion_events (
  id uuid primary key default gen_random_uuid(),
  stream_id text not null default 'main' references streams(id) on delete cascade,
  prompt text not null,
  description text,
  is_on boolean not null default false,
  -- Absolute instant. The admin enters Eastern Time; the server converts.
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists suggestion_events_stream_idx
  on suggestion_events (stream_id, created_at desc);

alter table suggestion_events enable row level security;
-- The public can read only an event that is switched on and not yet ended.
create policy "suggestion_events_public_read_active" on suggestion_events
  for select using (is_on and (ends_at is null or ends_at > now()));

-- The frogs shown on an event's card, in display order.
create table if not exists suggestion_event_frogs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references suggestion_events(id) on delete cascade,
  label text not null,
  -- Object path inside the public "event-images" storage bucket.
  image_path text,
  display_order int not null default 0
);
create index if not exists suggestion_event_frogs_event_idx
  on suggestion_event_frogs (event_id, display_order);

alter table suggestion_event_frogs enable row level security;
create policy "suggestion_event_frogs_public_read_active" on suggestion_event_frogs
  for select using (
    exists (
      select 1 from suggestion_events e
      where e.id = event_id
        and e.is_on
        and (e.ends_at is null or e.ends_at > now())
    )
  );

-- Visitors' name ideas. Never publicly readable (RLS on, no policies):
-- only the server (service_role) writes and reads these.
create table if not exists name_suggestions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references suggestion_events(id) on delete cascade,
  frog_id uuid not null references suggestion_event_frogs(id) on delete cascade,
  text text not null,
  -- Lowercased, punctuation/extra-space stripped; used to merge duplicates.
  normalized_text text not null,
  -- Matched the (substring-based) word list; kept but hidden in admin by default.
  is_flagged boolean not null default false,
  is_shortlisted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists name_suggestions_group_idx
  on name_suggestions (event_id, frog_id, normalized_text);

alter table name_suggestions enable row level security;

-- Rate limiting reuses contact_form_attempts, now tagged by which form the
-- attempt came from so the Contact box and this form have separate budgets.
alter table contact_form_attempts
  add column if not exists form text not null default 'contact';
create index if not exists contact_form_attempts_form_idx
  on contact_form_attempts (form, ip_address, created_at);

-- Announcement cards shown above the suggestion event card on the home page.
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). The site works without it: no announcements show and the
-- admin section says to run this file.

create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  stream_id text not null default 'main' references streams(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  -- Plain text; line breaks are kept, HTML is never rendered.
  message text not null default '' check (char_length(message) <= 600),
  -- Object path inside the public "event-images" storage bucket
  -- (announcements/<id>/picture-<timestamp>.<ext>).
  image_path text,
  -- Optional button. button_kind: 'poll' (scroll to the poll card),
  -- 'internal' (a path on this site) or 'external' (an https:// link).
  button_label text check (button_label is null or char_length(button_label) between 1 and 30),
  button_kind text check (button_kind is null or button_kind in ('poll', 'internal', 'external')),
  button_target text,
  is_on boolean not null default false,
  -- Absolute instants. The admin enters Eastern Time; the server converts.
  -- starts_at null = show as soon as it's on; ends_at null = until removed.
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists announcements_stream_idx
  on announcements (stream_id, created_at desc);

alter table announcements enable row level security;
-- The public can read only announcements that are switched on and inside
-- their window. There are no insert/update/delete policies, so only the
-- server (service_role) can write.
drop policy if exists "announcements_public_read_active" on announcements;
create policy "announcements_public_read_active" on announcements
  for select using (
    is_on
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

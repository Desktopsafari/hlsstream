-- Captures: clips saved from the stream's rewind buffer, photos taken on the
-- capture server (admin photos, and visitor photos when the browser can't
-- take one itself), the public /gallery, and the admin Captures tab.
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). The site works without it: the capture buttons stay
-- hidden and the admin tab says to run this file.
--
-- The files themselves live on the VPS (/var/lib/capture/files), not in
-- Supabase. This table holds only what the site needs to list, limit and
-- clean them up.
--
-- Row Level Security is on and there are NO policies, and the anon /
-- authenticated roles get no grants: the public (browser) key can't read or
-- write any of this. Everything goes through the site's server routes, which
-- use the service_role key.

create table if not exists captures (
  -- Also the file name on the VPS: 22 url-safe characters (128 random bits).
  id text primary key check (id ~ '^[A-Za-z0-9_-]{22}$'),
  stream_id text not null default 'main',
  kind text not null check (kind in ('photo', 'clip')),
  created_by text not null check (created_by in ('admin', 'visitor')),
  -- HMAC of the visitor's IP address (never the IP itself), used only for the
  -- rate limits. Null for admin captures, and cleared when an item is
  -- featured or kept.
  requester_hash text,
  seconds int not null default 0 check (seconds between 0 and 70),
  bytes bigint not null default 0,
  file_name text,
  thumb_name text,
  -- pending (being made) -> ready, or failed.
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed')),
  -- Null = never expires (featured without an external link, or kept).
  expires_at timestamptz,
  featured boolean not null default false,
  featured_at timestamptz,
  kept boolean not null default false,
  -- Featured items only: a YouTube / TikTok / Instagram link the gallery
  -- embeds instead of the VPS file (which then expires normally).
  external_url text check (external_url is null or char_length(external_url) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists captures_requester_idx on captures (requester_hash, kind, created_at desc);
create index if not exists captures_created_idx on captures (kind, created_by, created_at desc);
create index if not exists captures_expires_idx on captures (expires_at) where expires_at is not null;
create index if not exists captures_featured_idx on captures (featured_at desc) where featured;

alter table captures enable row level security;
revoke all on captures from anon, authenticated;

-- Site-wide admin settings (also created by poll_hide.sql; same definition).
create table if not exists site_settings (
  key text primary key,
  value jsonb,
  updated_at timestamptz not null default now()
);
alter table site_settings enable row level security;

-- "Pause visitor captures": while true, visitors can't save clips or server
-- photos (photos taken in the browser never reach the server anyway). The
-- admin tab still can.
insert into site_settings (key, value) values ('captures_paused', 'false'::jsonb)
  on conflict (key) do nothing;

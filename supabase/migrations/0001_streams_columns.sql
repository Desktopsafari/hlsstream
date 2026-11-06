-- 0001: give the streams table what the multi-stream site needs (Part 2, step 2).
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to run more than once. Additive only: nothing in the site reads these
-- columns yet, so the live site is unchanged.
--
-- id stays the permanent key every stream_id points at ('main' forever).
-- slug is the URL (/frogs) and may change later without touching any data.
--
-- streams keeps its public read policy (streams_public_read). Everything added
-- here is public by nature (names, the HLS address the player already loads).
-- Nothing secret goes in this table: the RTMP publish name stays on the VPS.

alter table streams
  add column if not exists slug text,
  -- Short label for tabs, the admin selector and email subjects ("Frogs").
  add column if not exists short_name text,
  -- One line under the stream's name (landing card, page subtitle).
  add column if not exists tagline text,
  -- The HLS playlist the player loads. Null = fall back to the site's default.
  add column if not exists hls_url text,
  -- Socket.IO room for chat and the viewer count. Null = no chat on this stream.
  add column if not exists chat_room text,
  -- capture-buffer@<key> on the VPS. Null = no clip/photo buttons on this stream.
  add column if not exists capture_key text,
  -- Landing-page card picture: object path in the public "event-images" bucket.
  add column if not exists poster_path text,
  -- Polls on or off for this stream (one global schedule for all streams).
  add column if not exists polls_enabled boolean not null default true,
  -- is_active: the page works at /<slug>. is_listed: shown on the landing page.
  add column if not exists is_active boolean not null default true,
  add column if not exists is_listed boolean not null default false,
  add column if not exists sort_order int not null default 0,
  add column if not exists updated_at timestamptz not null default now();

-- Fill in the frog stream the first time only (slug still empty), so running
-- this again never undoes later edits from the admin.
update streams set
  slug = 'frogs',
  short_name = 'Frogs',
  hls_url = 'https://stream.desktopsafari.com/hls/stream.m3u8',
  chat_room = 'main',
  capture_key = 'main',
  polls_enabled = true,
  is_active = true,
  is_listed = true,
  sort_order = 1,
  updated_at = now()
where id = 'main' and slug is null;

-- A slug is lowercase letters, digits and dashes, and never one of the site's
-- own top-level paths (those pages would win over /<slug> anyway, so a stream
-- with such a slug could never be reached). tests/migrations.test.mjs checks
-- that every top-level folder in src/app is in this list.
alter table streams drop constraint if exists streams_slug_format;
alter table streams add constraint streams_slug_format check (
  slug ~ '^[a-z0-9][a-z0-9-]{0,31}$'
  and slug not in (
    'api', 'admin', 'contact', 'privacy', 'terms', 'support', 'gallery',
    'ctrl-9k3x7m2q', 'streams', 'icon', 'apple-icon', 'manifest', 'robots',
    'sw', 'favicon'
  )
);
create unique index if not exists streams_slug_key on streams (slug);
alter table streams alter column slug set not null;

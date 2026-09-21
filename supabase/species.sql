-- "Meet the Resident" species card, modeled per-stream so the future
-- multi-stream map doesn't need a restructure. Run once in the Supabase
-- SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).

create table if not exists streams (
  id text primary key,
  name text not null,
  created_at timestamptz not null default now()
);

alter table streams enable row level security;
create policy "streams_public_read" on streams
  for select using (true);

insert into streams (id, name) values ('main', 'Desktop Safari Live')
  on conflict (id) do nothing;

create table if not exists species_cards (
  id uuid primary key default gen_random_uuid(),
  stream_id text not null unique references streams(id) on delete cascade,
  species_name text not null default '',
  scientific_name text,
  conservation_status text check (
    conservation_status is null or conservation_status in
      ('least_concern', 'near_threatened', 'vulnerable', 'endangered', 'critically_endangered')
  ),
  -- Storage object paths inside the public "species-images" bucket.
  photo_path text,
  range_map_path text,
  -- Ordered list: [{ "title": "LOCATION", "body": "..." }, ...]
  info_blocks jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table species_cards enable row level security;
create policy "species_cards_public_read" on species_cards
  for select using (true);
-- Writes happen only through the admin API routes (service_role key).

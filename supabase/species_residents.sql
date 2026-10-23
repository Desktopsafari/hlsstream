-- SUPERSEDED by supabase/species_names.sql: the code no longer reads the
-- residents column. Kept for the record because it was already run.

-- "Residents" list on the Meet the Resident species card: who lives in the
-- tank (frogs, fish, plants ...), each with an optional name.
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). The site works without it: the card simply shows no
-- residents and the admin section says to run this file.
--
-- Ordered list: [{ "label": "Frog 1", "name": "Basil" }, { "label": "Frog 2", "name": "" }]
-- The existing species_cards policies stay as they are: public read, and no
-- public writes (only the admin API, with the service_role key, writes).

alter table species_cards add column if not exists residents jsonb;

-- Start the main stream with two unnamed frogs. Only touches a card that has
-- never had a list, so re-running this never undoes the admin's edits.
update species_cards
  set residents = '[{"label": "Frog 1", "name": ""}, {"label": "Frog 2", "name": ""}]'::jsonb
  where stream_id = 'main' and residents is null;

alter table species_cards alter column residents set default '[]'::jsonb;

-- Names block on the Meet the Resident species card: a heading (e.g.
-- "Frog names") and a list of names, one per line in the admin.
-- Run once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query
-- -> paste -> Run). The site works without it: the card shows no names and
-- the admin section says to run this file.
--
-- This replaces the per-row "residents" list from supabase/species_residents.sql.
-- That file was already run, so its species_cards.residents column exists;
-- the code no longer uses it. It is left in place (not dropped) on purpose.
--
-- The species_cards policies stay as they are: public read, and no public
-- writes (only the admin API, with the service_role key, writes).

alter table species_cards add column if not exists names_heading text not null default 'Frog names';
-- Ordered list of names; empty = the section is hidden.
alter table species_cards add column if not exists names text[] not null default '{}';

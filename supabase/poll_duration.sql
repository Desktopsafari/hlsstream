-- Multi-day and open-ended polls.
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> select all -> Run).
-- Safe to run more than once. Until it is run the site keeps working exactly as
-- before: every poll is a normal daily poll (ends 8:00 PM ET) and the admin panel
-- says the duration choices are off.

alter table polls
  add column if not exists ends_at timestamptz,
  add column if not exists open_ended boolean not null default false,
  add column if not exists duration_days integer;

-- ends_at       the exact moment voting ends (stored as a UTC instant, converted from
--               Eastern Time when it is set, so it is right across daylight saving).
--               Null on a normal daily poll, whose end is the first 8:00 PM ET after it
--               opened. For an "N days" poll it is filled in when the poll opens.
-- open_ended    true = no end time; the poll stays open until the admin closes it.
-- duration_days N for a "Run for N days" poll while it waits in the queue; the last day's
--               8:00 PM ET end is worked out when the poll actually opens. Null otherwise.
--
-- A normal daily poll leaves all three at their defaults, so existing polls and the
-- daily jobs behave exactly as before. Row-level security is unchanged: polls already
-- has its public read-only policy, and writes still go through the admin panel with
-- the service_role key.

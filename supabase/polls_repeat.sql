-- Adds "repeat daily" support to polls.
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).

alter table polls
  add column if not exists repeat_daily boolean not null default false,
  add column if not exists repeat_paused boolean not null default false;

-- repeat_daily: when a poll with this on closes, the close-poll cron creates
-- a new scheduled poll with the same question/options and repeat_daily
-- carried forward, so it keeps running as its own series of daily rows.
--
-- repeat_paused: set on a closed poll instead of creating a continuation,
-- when a different poll was already manually queued for the next cycle by
-- the time this one closed. It's a historical marker so the admin panel can
-- explain what happened rather than silently dropping either poll.

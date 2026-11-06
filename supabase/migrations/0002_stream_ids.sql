-- 0002: a stream on every row that belongs to one (Part 2, step 3).
-- Run once in the Supabase SQL Editor, AFTER 0001. Safe to run more than once.
--
-- Backward compatible: every new column defaults to 'main', so the current
-- site and the chat service (which don't send a stream yet) keep writing
-- frog rows exactly as before. Adding a column with a constant default is
-- instant in Postgres (no table rewrite). Nothing is dropped or deleted.
--
-- Deleting a stream is refused while it still has polls, chat or captures
-- (plain foreign keys, no cascade): content is never removed by accident.
-- Optional stream tags (push, email) are cleared instead.

-- ---- New stream_id columns ---------------------------------------------------

-- Polls: poll_options, votes and poll_results follow through poll_id.
alter table polls
  add column if not exists stream_id text not null default 'main' references streams(id);
create index if not exists polls_stream_status_idx on polls (stream_id, status, created_at);

-- Chat history per stream. chat_bans stays site-wide on purpose.
alter table chat_messages
  add column if not exists stream_id text not null default 'main' references streams(id);
create index if not exists chat_messages_stream_created_idx on chat_messages (stream_id, created_at desc);

-- Push log: an optional tag saying which stream a send was about. Null = site-wide.
alter table push_sends
  add column if not exists stream_id text references streams(id) on delete set null;

-- ---- Foreign keys on stream_id columns that never had one ----------------------
-- Added NOT VALID first (no long lock), then validated. Every existing row is 'main'.

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'captures_stream_id_fkey') then
    alter table captures add constraint captures_stream_id_fkey
      foreign key (stream_id) references streams(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'push_categories_stream_id_fkey') then
    alter table push_categories add constraint push_categories_stream_id_fkey
      foreign key (stream_id) references streams(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'push_subscriptions_stream_id_fkey') then
    alter table push_subscriptions add constraint push_subscriptions_stream_id_fkey
      foreign key (stream_id) references streams(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'push_scheduled_stream_id_fkey') then
    alter table push_scheduled add constraint push_scheduled_stream_id_fkey
      foreign key (stream_id) references streams(id) on delete set null not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'push_repeating_stream_id_fkey') then
    alter table push_repeating add constraint push_repeating_stream_id_fkey
      foreign key (stream_id) references streams(id) on delete set null not valid;
  end if;
end $$;

alter table captures validate constraint captures_stream_id_fkey;
alter table push_categories validate constraint push_categories_stream_id_fkey;
alter table push_subscriptions validate constraint push_subscriptions_stream_id_fkey;
alter table push_scheduled validate constraint push_scheduled_stream_id_fkey;
alter table push_repeating validate constraint push_repeating_stream_id_fkey;

-- ---- Columns that become optional ----------------------------------------------

-- Announcements: null stream_id = site-wide (landing page and every stream
-- page). The current site only shows stream_id = 'main', so no existing row
-- changes and a site-wide row would simply not show until the code supports it.
alter table announcements alter column stream_id drop not null;

-- Push is going global: categories and subscriptions belong to the whole site,
-- with stream_id kept only as an optional tag. The 'main' defaults stay, so the
-- current code is unaffected; the code switch comes later. push_settings (the
-- pause switch) is left as it is until then.
alter table push_categories alter column stream_id drop not null;
alter table push_subscriptions alter column stream_id drop not null;
alter table push_scheduled alter column stream_id drop not null;
alter table push_repeating alter column stream_id drop not null;

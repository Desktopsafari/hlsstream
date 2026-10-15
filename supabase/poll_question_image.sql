-- Adds an optional picture to each poll (shown above its question).
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to run more than once. Until it is run the site keeps working exactly as
-- before: polls just have no picture, and the admin panel says so.

alter table polls
  add column if not exists image_path text;

-- image_path is the file's path inside the public "event-images" storage bucket
-- (the same bucket the naming events use), for example
-- polls/<poll id>/question-<timestamp>.jpg. Null means no picture.
--
-- A repeating poll's next copy points at the same file as the poll it was
-- copied from, so several polls can share one path. The app only deletes a
-- file once no poll references it any more.
--
-- Row-level security is unchanged: polls already has its public read-only
-- policy (the path is as public as the picture itself), and writes still go
-- through the admin panel with the service_role key.
--
-- Note: poll_options.image_path (from supabase/poll_option_images.sql) is no
-- longer used by the site. It is left in place and can be ignored.

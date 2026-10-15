-- Adds an optional picture to each poll option.
-- Run this once in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to run more than once. Until it is run the site keeps working exactly as
-- before: polls just have no pictures, and the admin panel says so.

alter table poll_options
  add column if not exists image_path text;

-- image_path is the file's path inside the public "event-images" storage bucket
-- (the same bucket the naming events use), for example
-- polls/<poll id>/<option id>-<timestamp>.jpg. Null means no picture.
--
-- A repeating poll's next copy points at the same file as the poll it was
-- copied from, so several options can share one path. The app only deletes a
-- file once no option references it any more.
--
-- Row-level security is unchanged: poll_options already has its public
-- read-only policy (the path is as public as the picture itself), and writes
-- still go through the admin panel with the service_role key. The poll_results
-- view is not changed; the site reads image_path from poll_options directly.

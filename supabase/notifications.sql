-- Email notification signup (Resend Audiences/Segments + Broadcasts) and
-- the contact-page suggestion box. Run once in the Supabase SQL Editor
-- (Dashboard -> SQL Editor -> New query -> paste -> Run).

-- Admin-managed categories. Each one maps 1:1 to a Resend audience
-- (Resend has renamed this concept to "Segments" internally, but the id
-- format/behavior is unchanged -- the column name here matches how this
-- app and its admin refer to it).
create table if not exists notification_categories (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  resend_audience_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table notification_categories enable row level security;
create policy "notification_categories_public_read_active" on notification_categories
  for select using (is_active = true);
-- Writes (create/rename/deactivate) go through the admin API only
-- (service_role key), same as species_cards and polls.

-- Suggestion-box submissions, stored for your own reference in addition to
-- the transactional email sent on submit. No public read/write policy --
-- only the admin panel (service_role) can read these, and the public
-- submit route (service_role) is the only writer.
create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  created_at timestamptz not null default now()
);

alter table suggestions enable row level security;

-- Per-IP submission timestamps for the suggestion box's rate limit. Kept
-- separate from `suggestions` because every attempt is recorded here
-- (including ones rejected by the honeypot) so a bot can't dodge the
-- limit just by tripping the honeypot every time. No public policy --
-- service_role only.
create table if not exists contact_form_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  created_at timestamptz not null default now()
);
create index if not exists contact_form_attempts_ip_idx on contact_form_attempts (ip_address, created_at);

alter table contact_form_attempts enable row level security;

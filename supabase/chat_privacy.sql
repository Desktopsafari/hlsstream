-- Stop exposing chat messages (and each chatter's session id) to the public
-- database key. Run once in the Supabase SQL Editor.
--
-- Nothing on the site reads chat_messages with that key: the browser never
-- queries Supabase directly, and chat history is sent by the chat service,
-- which uses the service_role key and bypasses row level security. So
-- removing the policy changes nothing for visitors.
drop policy if exists "chat_messages_public_read" on chat_messages;

-- With no policy left, the public role gets no rows at all (RLS stays on).
-- Writes were already service_role only.

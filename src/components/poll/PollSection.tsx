import { connection } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getPublicPoll } from "@/lib/pollVisibility";
import PollCard from "./PollCard";

// Don't let a slow database hold the page up: fall back to rendering the card
// (as before) and let its own first fetch decide.
const SERVER_WAIT_MS = 1500;

// Server part of the "Today's Vote" card: decides from the real clock whether
// there is a poll to show, so a hidden (or missing) poll's card is never in
// the HTML at all instead of appearing and then vanishing after load.
export default async function PollSection() {
  await connection();
  let initialVisible = true;
  try {
    initialVisible = await Promise.race([
      getPublicPoll(createServiceRoleClient()).then((r) => r.poll !== null),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(true), SERVER_WAIT_MS)),
    ]);
  } catch {
    // e.g. missing env vars in a local build: render the card as before.
  }
  return <PollCard initialVisible={initialVisible} />;
}

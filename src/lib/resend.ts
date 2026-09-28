import { Resend } from "resend";

// Shared across the notification-categories, subscribe, and broadcast
// routes -- they all need the same "is the key even configured" guard that
// sendPollResultsEmail (src/lib/email.ts) already does inline for its one
// call site.
export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("Missing RESEND_API_KEY");
    return null;
  }
  return new Resend(apiKey);
}

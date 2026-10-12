// Resend replaces this placeholder with each recipient's own unsubscribe
// link when it sends a broadcast, but it does not add one by itself -- the
// sender has to put it in the message. (Without it, recipients got no link.)
export const UNSUBSCRIBE_PLACEHOLDER = "{{{RESEND_UNSUBSCRIBE_URL}}}";

export function withUnsubscribeFooter(message: string): string {
  return [
    message.trimEnd(),
    "",
    "--",
    "You're getting this because you signed up for updates at desktopsafari.com.",
    `Unsubscribe any time: ${UNSUBSCRIBE_PLACEHOLDER}`,
    "",
  ].join("\n");
}

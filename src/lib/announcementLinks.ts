// Shared by the server and the browser (no server-only imports here).

// At most this many announcement cards show at once, newest first.
export const ANNOUNCEMENT_MAX_VISIBLE = 3;

// The id on the home page's poll card ("Today's Vote"), so an announcement
// button (or any link) can point at /#todays-vote.
export const POLL_ANCHOR_ID = "todays-vote";
export const POLL_ANCHOR_HREF = `/#${POLL_ANCHOR_ID}`;

export type AnnouncementButtonKind = "poll" | "internal" | "external";

// Shape sent to the browser.
export type PublicAnnouncement = {
  id: string;
  title: string;
  message: string;
  imageUrl: string | null;
  button: { label: string; href: string; external: boolean } | null;
  endsAt: string | null;
};

const INTERNAL_MAX = 200;
const EXTERNAL_MAX = 500;
const BASE = "https://same-site.invalid";

// Where a button goes, or null when the target isn't allowed. The only links
// allowed are: the poll card, a path on this site ("/contact"), or an https://
// address. javascript:, data:, http:, mailto: and every other scheme, and
// protocol-relative "//host" paths, are refused.
export function announcementHref(
  kind: AnnouncementButtonKind,
  target: string | null | undefined,
): { href: string; external: boolean } | null {
  if (kind === "poll") return { href: POLL_ANCHOR_HREF, external: false };

  const value = (target ?? "").trim();
  if (!value || /[\s\u0000-\u001F\u007F\\]/.test(value)) return null;

  if (kind === "internal") {
    if (value.length > INTERNAL_MAX || !value.startsWith("/") || value.startsWith("//")) return null;
    let url: URL;
    try {
      url = new URL(value, BASE);
    } catch {
      return null;
    }
    if (url.origin !== BASE) return null;
    return { href: `${url.pathname}${url.search}${url.hash}`, external: false };
  }

  if (kind === "external") {
    if (value.length > EXTERNAL_MAX || !/^https:\/\//i.test(value)) return null;
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return { href: url.href, external: true };
  }

  return null;
}

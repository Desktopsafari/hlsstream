// A per-browser identity, persisted in localStorage. Used to gate "one
// vote per session" on polls and to identify chat messages/bans -- not
// tied to any account, just a stable random id for this browser.

const SESSION_KEY = "dsl_session_id";
const NAME_KEY = "dsl_display_name";

export function getSessionId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_KEY, id);
  }
  return id;
}

export function getDisplayName(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(NAME_KEY);
}

export function setDisplayName(name: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(NAME_KEY, name.trim().slice(0, 24));
}

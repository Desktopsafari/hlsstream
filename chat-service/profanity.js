// Deliberately small, basic wordlist filter -- a day-one moderation
// backstop, not a complete solution. Matches as a substring (not just
// whole words) after lowercasing and stripping non-letters/spaces, so
// conjugations ("fucking"), punctuation evasions ("f.u.c.k"), and
// concatenations ("bullshit") are all still caught.
const BLOCKED_WORDS = [
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "cunt",
  "nigger",
  "faggot",
  "retard",
  "whore",
  "slut",
];

export function containsProfanity(message) {
  const normalized = message.toLowerCase().replace(/[^a-z0-9]/g, "");
  return BLOCKED_WORDS.some((word) => normalized.includes(word));
}

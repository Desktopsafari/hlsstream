// Key used to merge duplicate name ideas: case-insensitive, with extra
// spaces and punctuation ignored ("Mr. Hops", "mr  hops!" and "MR HOPS"
// all become "mr hops").
export function normalizeName(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['’.`"]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

// What gets stored and shown: trimmed, control characters removed, runs of
// whitespace collapsed to one space.
export function cleanNameInput(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stands in for src/lib/email.ts during tests: records the results emails
// instead of sending them, so tests can assert "exactly once".
globalThis.__emails ??= [];

export async function sendPollResultsEmail(question, options) {
  globalThis.__emails.push({ question, options: JSON.parse(JSON.stringify(options)) });
}

export async function sendSuggestionEmail() {}

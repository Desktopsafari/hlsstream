<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Keep the privacy notice accurate

Any change that collects, stores, shares, or keeps visitor data differently must update the privacy notice (`src/app/privacy/page.tsx`, including its "Last updated" date) in the same change. That includes: a new form field or input, a new database table or column holding visitor data, a new browser-storage key or cookie, a new log or anything written to logs, an analytics or tracking tool, a new third-party service, embed, script or font, and any change to how long something is kept. The notice only states what has been verified, so check the code before changing a claim, and say what you could not verify rather than guessing. If the change touches chat conduct or moderation, check `src/app/terms/page.tsx` too.

import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../../src/", import.meta.url));
const SUPPORT = fileURLToPath(new URL("./", import.meta.url));

// Module resolution for the tests:
//  - "@/..." imports resolve to the real source files in src/.
//  - The Supabase client and the results-email sender are ALWAYS swapped for
//    in-memory test doubles. There is no switch that turns the real ones on, so
//    a test cannot reach the real database, storage or email service.
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/server") return nextResolve("next/server.js", context);
  if (specifier.startsWith("@/")) {
    const rel = specifier.slice(2);
    if (rel === "lib/supabase/server") {
      return { url: pathToFileURL(SUPPORT + "stub-server.mjs").href, shortCircuit: true };
    }
    if (rel === "lib/email") {
      return { url: pathToFileURL(SUPPORT + "stub-email.mjs").href, shortCircuit: true };
    }
    for (const ext of [".ts", ".tsx", "/index.ts"]) {
      const p = SRC + rel + ext;
      if (fs.existsSync(p)) return { url: pathToFileURL(p).href, shortCircuit: true };
    }
  }
  return nextResolve(specifier, context);
}

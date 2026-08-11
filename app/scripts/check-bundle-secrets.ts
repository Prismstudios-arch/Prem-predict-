/**
 * CLAUDE.md §12 submission checklist:
 *   "JS bundle grepped — no keys beyond the Supabase anon key, no internal URLs"
 *
 * A React Native bundle is easier to read than a compiled binary. Every
 * EXPO_PUBLIC_* value is inlined verbatim. This fails the build if anything
 * that should be server-side has leaked into it.
 *
 *   npx expo export --platform ios
 *   npm run check-bundle-secrets
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE_DIR = 'dist';

/** Patterns that must never appear in a shipped bundle. */
const FORBIDDEN: { label: string; pattern: RegExp }[] = [
  { label: 'Supabase service_role key', pattern: /service_role/ },
  { label: 'Postgres connection string', pattern: /postgres(ql)?:\/\/[^\s"']+/ },
  { label: 'football-data.org token', pattern: /X-Auth-Token/i },
  { label: 'RevenueCat secret key', pattern: /sk_[A-Za-z0-9]{20,}/ },
  { label: 'Apple auth key (.p8)', pattern: /BEGIN PRIVATE KEY/ },
  { label: 'AWS access key', pattern: /AKIA[0-9A-Z]{16}/ },
  { label: 'Generic bearer secret', pattern: /(secret|password)["']?\s*[:=]\s*["'][^"']{8,}/i },
  // §2 [HARD]: odds are server-side only. No odds vocabulary should reach the client.
  { label: 'Odds/betting vocabulary (§2 HARD)', pattern: /\b(bookmaker|overround|de-?vig|accumulator)\b/i },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|hbc|json|map)$/.test(entry)) yield full;
  }
}

let failures = 0;

try {
  statSync(BUNDLE_DIR);
} catch {
  console.error(`${BUNDLE_DIR}/ not found. Run \`npx expo export --platform ios\` first.`);
  process.exit(2);
}

for (const file of walk(BUNDLE_DIR)) {
  const contents = readFileSync(file, 'utf8');
  for (const { label, pattern } of FORBIDDEN) {
    const match = contents.match(pattern);
    if (match) {
      console.error(`✗ ${label}\n    in ${file}\n    matched: ${match[0].slice(0, 60)}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} secret-leak finding(s). Do not submit.\n`);
  process.exit(1);
}
console.log('✓ bundle clean — no forbidden patterns\n');

/**
 * CLAUDE.md §12 submission checklist:
 *   "JS bundle grepped — no keys beyond the Supabase anon key, no internal URLs"
 *
 * A React Native bundle is easier to read than a compiled binary, and every
 * EXPO_PUBLIC_* value is inlined verbatim. This fails the build if anything
 * that should be server-side has leaked into it.
 *
 * WHY THIS IS NOT JUST A GREP
 *
 * The first version matched /sk_[A-Za-z0-9]{20,}/ and immediately flagged
 * `sk_taskQueueTs2FactorypushNotificationIOS` — concatenated symbol names from
 * minified Hermes bytecode, not a RevenueCat key. That matters more than a
 * moment's confusion: a checker that cries wolf gets ignored, and an ignored
 * checker is worse than no checker, because it is a real key that slips past
 * the next time.
 *
 * So candidates are matched loosely and then judged. Real credentials are
 * random: they carry digits throughout and have no long lowercase word runs.
 * Minified identifiers are the opposite. `looksRandom` encodes that difference.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE_DIR = 'dist';

/**
 * Distinguishes a random credential from a minified identifier.
 *
 * Deliberately conservative: it is better to ask a human about a borderline
 * string than to auto-dismiss a real key.
 */
function looksRandom(token: string): boolean {
  const body = token.replace(/^[a-z]+_/, '');
  if (body.length < 16) return false;

  const digits = (body.match(/\d/g) ?? []).length;
  const digitRatio = digits / body.length;

  // A run of 8+ lowercase letters is a word, and words mean an identifier
  // ("taskQueue", "pushNotification"). Random keys do not produce them.
  const hasLongWordRun = /[a-z]{8,}/.test(body);

  return digitRatio >= 0.12 && !hasLongWordRun;
}

type Finding = { label: string; sample: string; file: string };

/** Patterns whose mere presence is a problem, no judgement needed. */
const ABSOLUTE: { label: string; pattern: RegExp }[] = [
  { label: 'Supabase service_role key', pattern: /"[^"]*service_role[^"]*"/ },
  { label: 'Postgres connection string', pattern: /postgres(ql)?:\/\/[^\s"']{10,}/ },
  { label: 'Private key block', pattern: /BEGIN (RSA |EC )?PRIVATE KEY/ },
  { label: 'AWS access key id', pattern: /AKIA[0-9A-Z]{16}/ },
  {
    label: 'football-data.org token header',
    pattern: /["']X-Auth-Token["']\s*:\s*["'][A-Za-z0-9]{16,}["']/i,
  },
];

/** Patterns that need the randomness test before they mean anything. */
const HEURISTIC: { label: string; pattern: RegExp }[] = [
  { label: 'RevenueCat secret key', pattern: /\bsk_[A-Za-z0-9]{20,}/g },
  { label: 'Supabase secret key', pattern: /\bsb_secret_[A-Za-z0-9_-]{16,}/g },
  { label: 'JWT (service_role tokens are JWTs)', pattern: /\beyJ[A-Za-z0-9_-]{40,}/g },
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|hbc|json|map)$/.test(entry)) yield full;
  }
}

try {
  statSync(BUNDLE_DIR);
} catch {
  console.error(`${BUNDLE_DIR}/ not found. Run \`npx expo export --platform ios\` first.`);
  process.exit(2);
}

/**
 * Refuse to scan a bundle older than the source it claims to cover.
 *
 * `dist/` is a build artefact that nothing cleans up, so a run of this script
 * a day after the last export happily scans yesterday's bundle and prints a
 * green tick. That is worse than not running it: this is a §9/§12 [HARD]
 * pre-submission gate, and a false pass is exactly the state in which a key
 * ships.
 *
 * It happened. The check reported "no forbidden secrets" against a bundle
 * built before the day's work existed.
 */
function newestMtime(dir: string, skip: RegExp): number {
  let newest = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current)) {
      if (skip.test(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) stack.push(full);
      else newest = Math.max(newest, stat.mtimeMs);
    }
  }
  return newest;
}

const bundleMtime = newestMtime(BUNDLE_DIR, /^$/);
const sourceMtime = Math.max(
  newestMtime('src', /^(node_modules)$/),
  statSync('app.json').mtimeMs,
  statSync('package.json').mtimeMs,
);

if (sourceMtime > bundleMtime) {
  const age = Math.round((sourceMtime - bundleMtime) / 60_000);
  console.error(
    `${BUNDLE_DIR}/ is stale — source has changed in the ${age} minute(s) since it was built.\n` +
      `Scanning it would pass against code that is not the code you are shipping.\n` +
      `Run:  npx expo export --platform ios`,
  );
  process.exit(2);
}

const findings: Finding[] = [];
let scanned = 0;

for (const file of walk(BUNDLE_DIR)) {
  scanned++;
  const contents = readFileSync(file, 'utf8');

  for (const { label, pattern } of ABSOLUTE) {
    const match = contents.match(pattern);
    if (match) findings.push({ label, sample: match[0].slice(0, 50), file });
  }

  for (const { label, pattern } of HEURISTIC) {
    for (const match of contents.matchAll(pattern)) {
      const token = match[0];
      if (looksRandom(token)) {
        findings.push({ label, sample: `${token.slice(0, 24)}…`, file });
      }
    }
  }
}

/**
 * The anon / publishable key is EXPECTED in the bundle. §2 [HARD] permits
 * exactly it and the Supabase URL: it is designed to be public, and Row Level
 * Security is what protects the data. Flagging it would train you to ignore
 * this tool.
 */
const anonKeyPresent = [...walk(BUNDLE_DIR)].some((f) =>
  /sb_publishable_|supabase\.co/.test(readFileSync(f, 'utf8')),
);

console.log(`scanned ${scanned} bundle file(s)`);
console.log(
  anonKeyPresent
    ? '  Supabase anon/publishable key present — expected and permitted (§2)'
    : '  no Supabase key found — check app/.env is set before shipping',
);

if (findings.length > 0) {
  console.error('');
  for (const f of findings) {
    console.error(`✗ ${f.label}\n    ${f.sample}\n    in ${f.file}`);
  }
  console.error(`\n${findings.length} finding(s). Do not submit.\n`);
  process.exit(1);
}

console.log('✓ no forbidden secrets in the bundle\n');

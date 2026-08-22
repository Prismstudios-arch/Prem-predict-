import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards against the one bug this project keeps producing: a feature that is
 * fully built, exported, and called from nowhere.
 *
 * It has happened three times.
 *   - crowd vs model: migration, views, privacy floor, formatting module and
 *     three UI states, imported by no screen.
 *   - the paywall: reachable only by tapping a locked probability, so anyone
 *     who had already decided to subscribe had no route to it.
 *   - Sign in with Apple: linkAppleIdentity() written and exported, Settings
 *     showing a sentence about it with nothing to tap, the privacy policy and
 *     terms both naming it. Apple rejected 1.0 (5) under Guideline 2.1 —
 *     "we are unable to locate the Sign in with Apple feature."
 *
 * Nothing about any of those looked unfinished in review, which is exactly why
 * a test is the right instrument rather than care.
 */

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory()
      ? walk(full)
      : /\.tsx?$/.test(entry)
        ? [full]
        : [];
  });
}

const FILES = walk(SRC);
const SCREENS = FILES.filter((f) => f.includes(`${join('src', 'app')}`));

/** Every file that is not the one declaring the symbol. */
function usedOutside(symbol: string, declaredIn: string): boolean {
  return FILES.some(
    // String.raw, because in an ordinary template literal \b is the
    // backspace escape (U+0008), not a regex word boundary - so the first
    // version of this searched every file for a control character and
    // cheerfully reported all seven features as dead code.
    (f) =>
      !f.endsWith(declaredIn) &&
      new RegExp(String.raw`\b${symbol}\b`).test(readFileSync(f, 'utf8')),
  );
}

describe('features are reachable from the UI', () => {
  it.each([
    ['linkAppleIdentity', join('core', 'auth.ts')],
    ['isAppleSignInAvailable', join('core', 'auth.ts')],
    ['fetchCrowdForFixture', join('core', 'crowd.ts')],
    ['chooseCallOfTheWeek', join('core', 'predictionStore.ts')],
    ['restorePurchases', join('core', 'entitlements.ts')],
    ['deleteAccount', join('core', 'auth.ts')],
    ['syncEntitlementWithServer', join('core', 'entitlements.ts')],
  ])('%s is called somewhere outside its own module', (symbol, declaredIn) => {
    expect(
      usedOutside(symbol, declaredIn),
      `${symbol} is exported from ${declaredIn} and called nowhere else — ` +
        'it is dead code, and users cannot reach the feature.',
    ).toBe(true);
  });

  it('Sign in with Apple is presented by an actual screen', () => {
    // Not merely imported by another component: a screen has to render it, or
    // there is no path a user or a reviewer can take to reach it.
    const mounting = SCREENS.filter((f) =>
      /<AppleSignInButton\b/.test(readFileSync(f, 'utf8')),
    );
    expect(
      mounting.length,
      'No screen renders <AppleSignInButton>. This is the exact rejection ' +
        'reason for 1.0 (5) under Guideline 2.1.',
    ).toBeGreaterThan(0);
  });

  it('the paywall has a route that is not the soft paywall', () => {
    const settings = readFileSync(join(SRC, 'app', '(tabs)', 'settings.tsx'), 'utf8');
    expect(settings, 'Settings offers no way to subscribe').toContain('/paywall');
  });

  it('does not promise Sign in with Apple without shipping the entitlement', () => {
    // ios.usesAppleSignIn was absent while three places in the app described
    // the feature. Without it the entitlement is not in the binary and
    // signInAsync throws at runtime, so the button would have failed even once
    // it existed.
    const appJson = JSON.parse(
      readFileSync(join(__dirname, '..', 'app.json'), 'utf8'),
    ) as { expo: { ios?: { usesAppleSignIn?: boolean }; plugins?: unknown[] } };

    expect(appJson.expo.ios?.usesAppleSignIn).toBe(true);
    expect(JSON.stringify(appJson.expo.plugins)).toContain('expo-apple-authentication');
  });
});

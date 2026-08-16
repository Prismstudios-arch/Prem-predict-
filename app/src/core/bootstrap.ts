/**
 * Application bootstrap.
 *
 * Four native services were installed, declared in the dependency list, and
 * never initialised: RevenueCat, Sentry, PostHog and push notifications. Each
 * one silently did nothing — the paywall would have rendered "subscriptions
 * aren't available", crashes would never have been reported, and §8.4's
 * retention notifications had no token to send to.
 *
 * Everything here is best-effort and individually guarded. A missing analytics
 * key must never stop the app opening, and an unavailable push service must
 * never block someone predicting. §10: no blank screens, no infinite spinners.
 */

import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { hasBackend, supabase } from '@/api/client';
import { ensureSession } from '@/core/auth';
import { configurePurchases } from '@/core/entitlements';

/*
 * ⚠️ SETTING EITHER OF THESE CHANGES THE APP STORE PRIVACY LABELS.
 *
 * Both are currently unset, so initCrashReporting() and initAnalytics() return
 * immediately and the app transmits no analytics and no crash reports. The
 * submitted privacy labels declare only User ID and Purchase History, which is
 * accurate for that state (docs/APP_STORE.md).
 *
 * Adding either key needs no code change - an EAS secret is enough - so it is
 * possible to begin collecting data without anything in this repo looking
 * different. Apple treats collecting data the labels do not declare as a
 * misrepresentation. If you set one of these, amend the labels in the same
 * release.
 */
const SENTRY_DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const POSTHOG_KEY = process.env.EXPO_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com';

export type BootstrapResult = {
  userId: string | null;
  isAnonymous: boolean;
};

let started = false;

/**
 * Runs once on launch. Safe to call again — subsequent calls no-op.
 */
export async function bootstrap(): Promise<BootstrapResult> {
  if (started) return { userId: null, isAnonymous: true };
  started = true;

  initCrashReporting();
  initAnalytics();

  if (!hasBackend()) return { userId: null, isAnonymous: true };

  // Session first: RevenueCat needs the user id to attribute a purchase, and
  // without it a restore on a new device cannot find the account.
  let userId: string | null = null;
  let isAnonymous = true;
  try {
    const account = await ensureSession();
    userId = account.userId;
    isAnonymous = account.isAnonymous;
  } catch (error) {
    console.warn(
      'no session: predictions cannot be submitted. Anonymous sign-in may be ' +
        'disabled in the Supabase dashboard.',
      error,
    );
  }

  if (userId) {
    await configurePurchases(userId).catch((e) =>
      console.warn('purchases unavailable', e),
    );
    void registerPushToken(userId);
  }

  return { userId, isAnonymous };
}

/**
 * §3.1 lists Sentry for crash reporting. Imported lazily so a project without
 * a DSN configured does not pay the startup cost of the native module.
 */
function initCrashReporting(): void {
  if (!SENTRY_DSN) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Sentry = require('@sentry/react-native');
    Sentry.init({
      dsn: SENTRY_DSN,
      // §9.3: minimum data collection. No PII, and no IDFA — which is what
      // keeps the app clear of the ATT prompt entirely.
      sendDefaultPii: false,
      tracesSampleRate: 0.2,
    });
  } catch (error) {
    console.warn('Sentry init failed', error);
  }
}

/**
 * §3.1 / §9.3: PostHog specifically because it is GDPR-clean and needs no
 * advertising identifier, so the app never shows an ATT prompt.
 */
function initAnalytics(): void {
  if (!POSTHOG_KEY) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PostHog } = require('posthog-react-native');
    analytics = new PostHog(POSTHOG_KEY, { host: POSTHOG_HOST });
  } catch (error) {
    console.warn('PostHog init failed', error);
  }
}

let analytics: { capture: (event: string, props?: object) => void } | null = null;

export function track(event: string, props?: object): void {
  analytics?.capture(event, props);
}

/**
 * §8.4: the three retention notifications need a token stored against the user.
 *
 * Deliberately does not ask for permission here — §6.1 soft-asks during
 * onboarding with a reason, and iOS grants exactly one system prompt per
 * install. This only registers a token if permission was already granted.
 */
async function registerPushToken(userId: string): Promise<void> {
  try {
    if (!Device.isDevice) return; // simulators cannot receive push

    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return;

    const token = (await Notifications.getExpoPushTokenAsync()).data;

    await supabase()
      .from('push_tokens')
      .upsert(
        { user_id: userId, token, platform: 'ios' },
        { onConflict: 'user_id,token' },
      );
  } catch (error) {
    console.warn('push registration failed', error);
  }
}

/**
 * Called from onboarding, where §6.1 requires the ask to carry a reason.
 * Returns whether permission was granted so the caller can register a token.
 */
export async function requestPushPermission(userId: string | null): Promise<boolean> {
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status === 'granted' && userId) await registerPushToken(userId);
    return status === 'granted';
  } catch (error) {
    console.warn('push permission request failed', error);
    return false;
  }
}

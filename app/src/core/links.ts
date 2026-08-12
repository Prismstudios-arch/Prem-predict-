/**
 * Outbound URLs, in one place.
 *
 * §9.3 [HARD] requires the Privacy Policy and Terms to live at stable URLs, and
 * §8.3 requires the paywall to link to both before purchase. They were
 * hardcoded in two separate files, which meant changing host or domain involved
 * finding every copy — and a missed one is a dead link on the exact screen
 * Apple checks.
 *
 * Overridable by env so the domain can change without a code change. The values
 * are public by definition (they are printed in the App Store listing), so
 * EXPO_PUBLIC_ is the correct prefix here.
 */

const SITE = process.env.EXPO_PUBLIC_SITE_URL ?? 'https://reckonfootball.app';

export const PRIVACY_URL = `${SITE}/privacy`;
export const TERMS_URL = `${SITE}/terms`;

/** Apple's own subscription management screen. Not ours to change. */
export const MANAGE_SUBSCRIPTION_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * Both URLs must be reachable before submission. App Store Connect asks for the
 * privacy URL directly, and a reviewer following the paywall links to a 404 is
 * a rejection.
 */
export const site = SITE;

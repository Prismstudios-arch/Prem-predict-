/**
 * Pull entitlement state from RevenueCat on demand.
 *
 * WHY THIS EXISTS
 *
 * revenuecat-webhook is the primary writer of users.entitlement, and it is the
 * right design: RevenueCat pushes, we record. But a push-only design has one
 * failure mode that looks exactly like a bug to the person paying you —
 *
 *   purchase succeeds → StoreKit is happy → RevenueCat is happy → the webhook
 *   is late, undelivered, or not yet configured → public.users.entitlement is
 *   still 'free' → public.is_entitled() returns false → predictions_premium
 *   returns ZERO ROWS → the user has paid and the app still shows a paywall.
 *
 * That is not hypothetical. It is the state of any project before the webhook
 * URL and shared secret have been set in the RevenueCat dashboard, which is
 * exactly when a developer is trying to sandbox-test their own paywall. It is
 * also what happens on any webhook outage, and RevenueCat's retries can take
 * minutes.
 *
 * So the client gets a way to say "check for me". Crucially this does NOT
 * weaken §9.2 [HARD]: the client cannot assert anything. It provides a JWT, we
 * derive the user id from that JWT rather than from the request body, and the
 * answer comes from RevenueCat's own API over a secret key the client has never
 * seen. The client is asking a question, not supplying an answer.
 *
 * WHAT WOULD BE WRONG
 *
 *   - Trusting an app_user_id from the body. Then anyone can sync anyone, and
 *     with a shared sandbox account, grant themselves premium.
 *   - Writing the entitlement from the RevenueCat *public* SDK key state
 *     reported by the client. That is a client assertion wearing a costume.
 *   - Skipping the expiry. A subscription that lapsed yesterday is not access
 *     today, and is_entitled() compares expires_at to now() for that reason.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
/** RevenueCat *secret* key (sk_...). Never reaches the client. */
const RC_SECRET_KEY = Deno.env.get('REVENUECAT_SECRET_KEY');

/** Must match PREMIUM_ENTITLEMENT in app/src/core/entitlements.ts. */
const ENTITLEMENT_ID = 'premium';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY || !RC_SECRET_KEY) {
    console.error('sync-entitlement is missing required environment configuration');
    return json({ error: 'Server misconfigured' }, 500);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // The user id comes from the verified JWT, never from the body. This single
  // line is what stops the endpoint from being "grant premium to any id".
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await asUser.auth.getUser();
  const userId = userData?.user?.id;
  if (userError || !userId) {
    return json({ error: 'Unauthorized' }, 401);
  }

  // RevenueCat REST v1. 404 means "no such subscriber", which is the normal
  // answer for someone who has never purchased — not an error.
  let subscriber: RevenueCatSubscriber | null = null;
  try {
    const response = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      { headers: { Authorization: `Bearer ${RC_SECRET_KEY}` } },
    );
    if (response.status === 404) {
      subscriber = null;
    } else if (!response.ok) {
      console.error('revenuecat lookup failed', response.status, await response.text());
      return json({ error: 'Upstream error' }, 502);
    } else {
      const body = (await response.json()) as { subscriber?: RevenueCatSubscriber };
      subscriber = body.subscriber ?? null;
    }
  } catch (error) {
    console.error('revenuecat lookup threw', error);
    return json({ error: 'Upstream error' }, 502);
  }

  const active = subscriber?.entitlements?.[ENTITLEMENT_ID] ?? null;

  // A null expires_at on a real entitlement means a lifetime/non-renewing
  // purchase, which never lapses. A *missing* entitlement is not that, and the
  // two must not collapse into the same null.
  const expiresAt = active?.expires_date ?? null;
  const stillValid =
    active !== null && (expiresAt === null || new Date(expiresAt).getTime() > Date.now());

  const entitlement = stillValid ? 'premium' : 'free';

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { error: updateError } = await admin
    .from('users')
    .update({ entitlement, entitlement_expires_at: stillValid ? expiresAt : null })
    .eq('id', userId);

  if (updateError) {
    console.error('entitlement update failed', updateError);
    return json({ error: 'Storage error' }, 500);
  }

  // Audited like the webhook's writes are. An entitlement that changed without
  // a corresponding RevenueCat event is exactly the thing worth being able to
  // reconstruct later.
  await admin.from('entitlement_events').insert({
    user_id: userId,
    rc_event_id: `sync:${userId}:${Date.now()}`,
    event_type: 'MANUAL_SYNC',
    entitlement,
    expires_at: stillValid ? expiresAt : null,
    raw: { source: 'sync-entitlement', found: subscriber !== null },
  });

  return json({ entitlement, expiresAt: stillValid ? expiresAt : null });
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

type RevenueCatSubscriber = {
  entitlements?: Record<string, { expires_date: string | null }>;
};

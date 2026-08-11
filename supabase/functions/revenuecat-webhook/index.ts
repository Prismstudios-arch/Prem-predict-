/**
 * RevenueCat webhook -> server-side entitlement state.
 *
 * CLAUDE.md §9.2 [HARD]: "Entitlement verified server-side against RevenueCat
 * webhook state before returning any premium field."
 *
 * This function is the ONLY writer of public.users.entitlement. The client
 * cannot write it — 0002_rls.sql grants UPDATE on exactly three columns, and
 * entitlement is not one of them. So a user cannot grant themselves premium
 * even with a fully compromised app binary.
 *
 * Three things this handler must get right:
 *
 *   Authenticate. RevenueCat sends a shared secret in the Authorization
 *   header. Without checking it, anyone who learns the URL can grant
 *   themselves premium with a curl command.
 *
 *   Be idempotent. RevenueCat retries on any non-2xx, and duplicate delivery
 *   is normal. `rc_event_id` is UNIQUE in entitlement_events, so a replayed
 *   event is recorded once and applied once.
 *
 *   Never trust the event to say what the state *is* — only what changed.
 *   Expiry is what determines access, so the row stores expires_at and
 *   `is_entitled()` compares it to now(). An EXPIRATION event that arrives
 *   late cannot resurrect access that has already lapsed.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

/** Event types that grant or extend access. */
const GRANTING = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'PRODUCT_CHANGE',
  'SUBSCRIPTION_EXTENDED',
]);

/** Event types that revoke access immediately. */
const REVOKING = new Set(['EXPIRATION', 'REFUND', 'SUBSCRIPTION_PAUSED']);

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  if (!WEBHOOK_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error('webhook is missing required environment configuration');
    return new Response('Server misconfigured', { status: 500 });
  }

  // Constant-time-ish comparison is overkill for a bearer token of this length,
  // but rejecting before any parsing keeps unauthenticated bodies out entirely.
  const auth = req.headers.get('Authorization');
  if (auth !== `Bearer ${WEBHOOK_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: RevenueCatPayload;
  try {
    payload = (await req.json()) as RevenueCatPayload;
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const event = payload.event;
  if (!event?.id || !event.type) {
    return new Response('Bad request', { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // app_user_id is the Supabase user id, set by configurePurchases().
  const userId = event.app_user_id ?? null;

  const grants = GRANTING.has(event.type);
  const revokes = REVOKING.has(event.type);
  const expiresAt = event.expiration_at_ms
    ? new Date(event.expiration_at_ms).toISOString()
    : null;

  const entitlement = grants ? 'premium' : revokes ? 'free' : null;

  // Audit first (§9.2 structured audit logging). The UNIQUE constraint on
  // rc_event_id makes replay a no-op rather than a double-apply.
  const { error: auditError } = await supabase.from('entitlement_events').insert({
    user_id: userId,
    rc_event_id: event.id,
    event_type: event.type,
    entitlement,
    expires_at: expiresAt,
    raw: payload,
  });

  // 23505 = unique violation = this event was audited on an earlier attempt.
  // Crucially we do NOT return here. If a previous attempt audited the event
  // and then failed to apply it, returning early on the retry would strand a
  // paying user without access forever. The update below is idempotent, so
  // re-applying a duplicate costs nothing and repairs that case.
  const alreadySeen = auditError?.code === '23505';

  if (auditError && !alreadySeen) {
    console.error('audit insert failed', auditError);
    return new Response('Storage error', { status: 500 });
  }

  if (userId && entitlement) {
    const { error } = await supabase
      .from('users')
      .update({ entitlement, entitlement_expires_at: expiresAt })
      .eq('id', userId);

    if (error) {
      // Non-2xx makes RevenueCat retry, which is exactly what we want.
      console.error('entitlement update failed', error);
      return new Response('Storage error', { status: 500 });
    }
  }

  return new Response(
    JSON.stringify({
      status: alreadySeen ? 'duplicate-reapplied' : 'ok',
      applied: entitlement,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

type RevenueCatPayload = {
  event?: {
    id?: string;
    type?: string;
    app_user_id?: string;
    expiration_at_ms?: number;
  };
};

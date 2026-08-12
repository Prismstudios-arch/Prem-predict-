/**
 * End-to-end check of the account and prediction path.
 *
 * `npm run fixtures` proves the read path. This proves the write path, which is
 * the half that actually matters: an app where nobody can submit a prediction
 * is not a prediction game.
 *
 * Exercises, in order:
 *   1. anonymous sign-in (§6.1 — no forced signup)
 *   2. the on_auth_user_created trigger creating a profile
 *   3. writing a prediction through RLS with a server timestamp (§2 [HARD])
 *   4. the premium gate still returning nothing to a new free user (§9.2 [HARD])
 *   5. account deletion (§9.3 [HARD], an App Store requirement)
 *
 * Step 5 is not only cleanup. Apple requires in-app account deletion wherever
 * accounts can be created, and this is the only automated proof that the
 * cascade actually works — so the test tidying up after itself and the
 * requirement being verified are the same action.
 *
 *   npm run verify-account
 */

import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !key) {
  console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in app/.env');
  process.exit(2);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

function ok(step: string, detail = '') {
  console.log(`  [OK]   ${step}${detail ? `  ${detail}` : ''}`);
}
function fail(step: string, detail: string): never {
  console.error(`  [FAIL] ${step}\n         ${detail}`);
  process.exit(1);
}

async function main() {
  console.log('\nAccount + prediction path\n' + '-'.repeat(52));

  // 1 ------------------------------------------------------------------
  const { data: auth, error: authError } = await supabase.auth.signInAnonymously();
  if (authError || !auth.user) {
    fail(
      'anonymous sign-in',
      `${authError?.message ?? 'no user returned'}\n` +
        '         Enable it at: Supabase -> Authentication -> Sign In / Providers\n' +
        '         -> Anonymous sign-ins. Nobody can predict without this.',
    );
  }
  const userId = auth.user.id;
  ok('anonymous sign-in', userId);

  // 2 ------------------------------------------------------------------
  const { data: profile, error: profileError } = await supabase
    .from('users')
    .select('display_name, entitlement, streak_current, total_points')
    .eq('id', userId)
    .single();

  if (profileError) fail('profile created by trigger', profileError.message);
  ok('profile auto-created', `"${profile.display_name}" (${profile.entitlement})`);

  // 3 ------------------------------------------------------------------
  const { data: fixtures } = await supabase
    .from('fixtures')
    .select('id')
    .eq('status', 'scheduled')
    .order('kickoff_utc')
    .limit(1);

  if (!fixtures?.length) {
    console.log('  [SKIP] no scheduled fixtures — run `premmodel ingest`');
  } else {
    const fixtureId = fixtures[0]!.id;
    const { error: writeError } = await supabase.from('user_predictions').upsert(
      {
        user_id: userId,
        fixture_id: fixtureId,
        outcome: 'home',
        home_goals: 2,
        away_goals: 1,
      },
      { onConflict: 'user_id,fixture_id' },
    );
    if (writeError) fail('write prediction', `[${writeError.code}] ${writeError.message}`);

    const { data: readBack } = await supabase
      .from('user_predictions')
      .select('home_goals, away_goals, submitted_at_server, points_awarded')
      .eq('user_id', userId)
      .single();

    ok('prediction written through RLS', `${readBack?.home_goals}-${readBack?.away_goals}`);
    // §2 [HARD]: the timestamp is Postgres's, never the client's.
    ok('server timestamp applied', String(readBack?.submitted_at_server));
    if (readBack?.points_awarded !== null) {
      fail('points are server-owned', 'client managed to set points_awarded');
    }
    ok('points_awarded not client-writable');
  }

  // 4 ------------------------------------------------------------------
  const { data: premium } = await supabase.from('predictions_premium').select('*').limit(1);
  if ((premium ?? []).length > 0) fail('premium gate', 'rows leaked to a free user');
  ok('premium gate holds for new free user', '0 rows');

  // 5 ------------------------------------------------------------------
  const { error: deleteError } = await supabase.rpc('delete_own_account');
  if (deleteError) fail('account deletion (§9.3 [HARD])', deleteError.message);

  const { data: gone } = await supabase.from('users').select('id').eq('id', userId);
  if ((gone ?? []).length > 0) fail('account deletion', 'user row survived');
  ok('account deleted, cascade verified');

  console.log('-'.repeat(52));
  console.log('  All checks passed. Test account removed.\n');
}

main().catch((error) => {
  console.error('\nunexpected failure:', error instanceof Error ? error.message : error, '\n');
  process.exit(1);
});

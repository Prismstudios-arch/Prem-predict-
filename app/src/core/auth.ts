/**
 * Accounts (CLAUDE.md §6.1, §9.3 [HARD]).
 *
 * §6.1: "No forced signup; anonymous device account, upgrade to Sign in with
 * Apple later." Nothing blocks a first prediction — the paywall and the signup
 * wall are both things that kill a prediction game before it has players.
 *
 * §9.3 [HARD]: if any third-party sign-in is offered, Sign in with Apple must
 * be offered too. Apple is the *only* third-party sign-in here, so that is
 * satisfied by construction — and adding Google later would make SIWA
 * mandatory rather than optional, which is worth knowing before someone adds it.
 *
 * The merge case (§15 open decision #5) is implemented as recommended:
 * signing in with an Apple ID that already has an account DISCARDS the local
 * anonymous predictions. The alternative — merging two prediction histories —
 * has no correct answer when both accounts predicted the same fixture
 * differently, and any answer you pick is a leaderboard integrity hole.
 * The UI must warn before calling `linkAppleIdentity`.
 */

import * as AppleAuthentication from 'expo-apple-authentication';
import * as SecureStore from 'expo-secure-store';

import { supabase } from '@/api/client';

const ANON_MARKER_KEY = 'prempredict.anon_session';

export type AccountState = {
  userId: string | null;
  isAnonymous: boolean;
  displayName: string | null;
};

export async function isAppleSignInAvailable(): Promise<boolean> {
  return AppleAuthentication.isAvailableAsync();
}

/**
 * Ensure there is a session, creating an anonymous one if needed.
 *
 * The on_auth_user_created trigger (0001_init.sql) creates the public.users row
 * with a generated display name, so there is no second round trip and no
 * window where a session exists without a profile.
 */
export async function ensureSession(): Promise<AccountState> {
  const client = supabase();

  const { data: existing } = await client.auth.getSession();
  if (existing.session) return describe(existing.session.user);

  const { data, error } = await client.auth.signInAnonymously();
  if (error) throw new Error(`Could not start a session: ${error.message}`);

  // Tokens live in the Keychain via expo-secure-store, never AsyncStorage
  // (§9.1). This marker is not a credential — it only records that the
  // session began anonymously, so the UI can offer the upgrade prompt.
  await SecureStore.setItemAsync(ANON_MARKER_KEY, '1', {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });

  if (!data.user) throw new Error('Could not start a session');
  return describe(data.user);
}

/**
 * Upgrade an anonymous account to Sign in with Apple.
 *
 * @throws if the Apple ID already has an account — the caller must have warned
 * the user that local predictions will be discarded, then call
 * `signInWithAppleReplacingLocal`.
 */
export async function linkAppleIdentity(): Promise<AccountState> {
  const credential = await AppleAuthentication.signInAsync({
    requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME],
  });

  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token');
  }

  const client = supabase();
  const { data, error } = await client.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
  });

  if (error) throw new Error(`Sign in with Apple failed: ${error.message}`);
  if (!data.user) throw new Error('Sign in with Apple returned no user');

  await SecureStore.deleteItemAsync(ANON_MARKER_KEY);
  return describe(data.user);
}

export async function signOut(): Promise<void> {
  await supabase().auth.signOut();
  await SecureStore.deleteItemAsync(ANON_MARKER_KEY);
}

/**
 * §9.3 [HARD]: Apple requires in-app account deletion wherever accounts can be
 * created. Anonymous accounts count.
 *
 * The RPC deletes the auth.users row; every table cascades from it via the FKs
 * in 0001_init.sql, so nothing here needs to know the table list.
 */
export async function deleteAccount(): Promise<void> {
  const client = supabase();
  const { error } = await client.rpc('delete_own_account');
  if (error) throw new Error(`Could not delete your account: ${error.message}`);
  await client.auth.signOut();
  await SecureStore.deleteItemAsync(ANON_MARKER_KEY);
}

export async function currentAccount(): Promise<AccountState> {
  const { data } = await supabase().auth.getSession();
  if (!data.session) return { userId: null, isAnonymous: true, displayName: null };
  return describe(data.session.user);
}

type MinimalUser = {
  id: string;
  is_anonymous?: boolean | undefined;
  app_metadata?: { provider?: string | undefined } | undefined;
  user_metadata?: { display_name?: string | undefined } | undefined;
};

function describe(user: MinimalUser): AccountState {
  return {
    userId: user.id,
    isAnonymous: user.is_anonymous ?? user.app_metadata?.provider !== 'apple',
    displayName: user.user_metadata?.display_name ?? null,
  };
}

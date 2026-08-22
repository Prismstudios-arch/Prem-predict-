/**
 * Sign in with Apple — the button.
 *
 * WHY THIS FILE EXISTS
 *
 * Apple rejected 1.0 (5) under Guideline 2.1: "we are unable to locate the
 * Sign in with Apple feature." They were right, and the cause was not that it
 * was hard to find — it was that `linkAppleIdentity()` in core/auth.ts had been
 * fully written, exported, and never called from anywhere. Settings showed a
 * sentence telling the user to sign in with Apple, with nothing to tap. The
 * privacy policy and terms named it too. So the app described a feature it did
 * not have, and a reviewer went looking for it.
 *
 * Two other things had to be true for the button to work at all, and neither
 * was: `ios.usesAppleSignIn` was absent from app.json, so the entitlement was
 * not in the binary and signInAsync would have thrown at runtime; and Supabase
 * needs the Apple provider enabled with the bundle id as a client id.
 *
 * DESIGN
 *
 * Apple's own AppleAuthenticationButton, not a custom one. Their Human
 * Interface Guidelines require their mark and wording, and a hand-rolled
 * lookalike is its own rejection.
 *
 * §15 #5 decided what happens on a collision: if the Apple ID already has a
 * Reckon account, that account wins and the anonymous predictions on this
 * device are discarded. That is destructive and irreversible, so it is behind
 * an explicit confirmation that says so in plain words before anything happens.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

import {
  isAppleSignInAvailable,
  linkAppleIdentity,
  type AccountState,
} from '@/core/auth';
import { radius, space, useTheme } from '@/theme';

type Props = {
  /** Anonymous predictions may be discarded, so the caller can refresh. */
  onSignedIn: (account: AccountState) => void;
};

export function AppleSignInButton({ onSignedIn }: Props) {
  const { colors } = useTheme();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void isAppleSignInAvailable()
      .then((ok) => {
        if (!cancelled) setAvailable(ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const account = await linkAppleIdentity();
      onSignedIn(account);
      Alert.alert(
        'Signed in',
        'Your record is now tied to your Apple ID, so it follows you to a new phone.',
      );
    } catch (error) {
      // A user backing out of Apple's own sheet is not an error and must never
      // be reported as one. Apple raises ERR_REQUEST_CANCELED for it.
      const code = (error as { code?: string }).code;
      if (code === 'ERR_REQUEST_CANCELED' || code === 'ERR_CANCELED') return;
      console.error('Sign in with Apple failed', error);
      Alert.alert(
        "Couldn't sign in",
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }, [onSignedIn]);

  const confirmThenRun = useCallback(() => {
    // §15 #5. Said before Apple's sheet opens, because afterwards it is too late.
    Alert.alert(
      'Sign in with Apple',
      'This ties your record to your Apple ID so it follows you to a new phone.\n\n' +
        'If that Apple ID already has a Reckon account, that account takes over and ' +
        'the predictions made on this device are discarded. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => void run() },
      ],
    );
  }, [run]);

  // Hidden while we do not yet know, and on any device without Apple auth —
  // rendering a button that cannot work is worse than rendering none.
  if (available !== true) return null;

  if (busy) {
    return (
      <View style={{ height: 48, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <AppleAuthentication.AppleAuthenticationButton
      buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
      // The app is dark-first, so the white mark on black is the correct
      // variant from Apple's guidelines rather than a stylistic choice.
      buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
      cornerRadius={radius.pill}
      style={{ height: 48, marginHorizontal: space.lg }}
      onPress={confirmThenRun}
    />
  );
}

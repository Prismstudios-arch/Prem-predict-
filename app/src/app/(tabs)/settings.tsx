/**
 * Settings (CLAUDE.md §6.1).
 *
 * Three items here are App Store rejection criteria, not preferences:
 *   §8.3 [HARD] Restore Purchases must be visible in Settings as well as on
 *               the paywall.
 *   §9.3 [HARD] Account deletion must be available in-app wherever accounts
 *               can be created — anonymous accounts count.
 *   §2   [HARD] The "not affiliated" disclaimer must appear in About.
 *
 * All three are present and none is behind a disclosure toggle.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChevronIcon } from '@/components/Icons';
import { hasBackend } from '@/api/client';
import { currentAccount, deleteAccount, type AccountState } from '@/core/auth';
import { restorePurchases } from '@/core/entitlements';
import {
  MIN_TOUCH_TARGET,
  radius,
  space,
  tabularNumbers,
  useTheme,
  useType,
} from '@/theme';
import { MANAGE_SUBSCRIPTION_URL, PRIVACY_URL, TERMS_URL } from '@/core/links';

export default function SettingsScreen() {
  const { colors } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();

  const [account, setAccount] = useState<AccountState | null>(null);
  const [prefs, setPrefs] = useState({ gwOpen: true, lockSoon: true, weeklyWrap: true });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!hasBackend()) return;
    void currentAccount()
      .then(setAccount)
      .catch(() => setAccount(null));
  }, []);

  const onRestore = useCallback(async () => {
    setBusy(true);
    const outcome = await restorePurchases();
    setBusy(false);
    Alert.alert(
      outcome.status === 'purchased' ? 'Purchases restored' : 'Nothing to restore',
      outcome.status === 'purchased'
        ? 'Your subscription is active on this device.'
        : "We couldn't find a previous purchase on this Apple ID.",
    );
  }, []);

  const onDelete = useCallback(() => {
    // §9.3 [HARD]. Two-step and explicit about permanence — this cascades
    // through every table via the foreign keys in 0001_init.sql.
    Alert.alert(
      'Delete your account?',
      'Your predictions, points and streak are permanently deleted. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteAccount()
              .then(() => Alert.alert('Account deleted'))
              .catch((e) =>
                Alert.alert('Could not delete', e instanceof Error ? e.message : 'Try again.'),
              );
          },
        },
      ],
    );
  }, []);

  return (
    <ScrollView
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xxxl,
        gap: space.xl,
      }}
    >
      <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
        Settings
      </Text>

      {/* ---- account ------------------------------------------------------ */}
      <Section title="Account">
        <Row
          label="Signed in as"
          value={account?.displayName ?? (account ? 'Anonymous' : 'Not signed in')}
        />
        {account?.isAnonymous && (
          <Text style={[type.caption, { color: colors.textTertiary, paddingHorizontal: space.lg }]}>
            You're playing anonymously. Sign in with Apple to keep your record if
            you change phone.
          </Text>
        )}
      </Section>

      {/* ---- notifications (§8.4, all opt-out) ---------------------------- */}
      <Section title="Notifications">
        <Toggle
          label="Gameweek opens"
          hint="Thursday evening"
          value={prefs.gwOpen}
          onChange={(v) => setPrefs((p) => ({ ...p, gwOpen: v }))}
        />
        <Toggle
          label="Predictions lock soon"
          hint="Two hours before the first kick-off"
          value={prefs.lockSoon}
          onChange={(v) => setPrefs((p) => ({ ...p, lockSoon: v }))}
        />
        <Toggle
          label="Monday results"
          hint="How you did against the model"
          value={prefs.weeklyWrap}
          onChange={(v) => setPrefs((p) => ({ ...p, weeklyWrap: v }))}
        />
      </Section>

      {/* ---- subscription -------------------------------------------------- */}
      <Section title="Subscription">
        {/* §8.3 [HARD]: its absence is a guaranteed rejection. */}
        <Action label="Restore purchases" onPress={onRestore} disabled={busy} />
        <Action
          label="Manage subscription"
          onPress={() => void Linking.openURL(MANAGE_SUBSCRIPTION_URL)}
        />
      </Section>

      {/* ---- legal --------------------------------------------------------- */}
      <Section title="Legal">
        <Action label="Privacy policy" onPress={() => void Linking.openURL(PRIVACY_URL)} />
        <Action label="Terms of use" onPress={() => void Linking.openURL(TERMS_URL)} />
      </Section>

      {/* ---- about (§2 [HARD] disclaimer) ---------------------------------- */}
      <View
        style={{
          padding: space.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          gap: space.sm,
        }}
      >
        <Text style={[type.micro, { color: colors.textTertiary }]}>ABOUT</Text>
        <Text style={[type.caption, { color: colors.textSecondary, lineHeight: 19 }]}>
          Reckon is not affiliated with, endorsed by, or connected to the Premier
          League, the Football Association, or any football club. Predictions are
          statistical estimates, not advice, and should not be used for betting
          purposes.
        </Text>
        <Text style={[type.micro, tabularNumbers, { color: colors.textTertiary }]}>
          VERSION 0.1.0
        </Text>
      </View>

      {/* ---- destructive --------------------------------------------------- */}
      <Pressable
        onPress={onDelete}
        accessibilityRole="button"
        accessibilityLabel="Delete your account permanently"
        style={{
          minHeight: MIN_TOUCH_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={[type.callout, { color: colors.negative }]}>Delete account</Text>
      </Pressable>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[type.micro, { color: colors.textTertiary }]} accessibilityRole="header">
        {title.toUpperCase()}
      </Text>
      <View
        style={{
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          overflow: 'hidden',
        }}
      >
        {children}
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        minHeight: MIN_TOUCH_TARGET,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}
    >
      <Text style={[type.body, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[type.body, { color: colors.textPrimary, fontWeight: '600' }]}>{value}</Text>
    </View>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      style={{
        minHeight: MIN_TOUCH_TARGET,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
      }}
    >
      <View style={{ flex: 1, gap: space.xxs }}>
        <Text style={[type.body, { color: colors.textPrimary }]}>{label}</Text>
        <Text style={[type.caption, { color: colors.textTertiary }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={label}
        trackColor={{ true: colors.accent, false: colors.surfaceRaised }}
        thumbColor={colors.textPrimary}
      />
    </View>
  );
}

function Action({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled) }}
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        paddingHorizontal: space.lg,
        paddingVertical: space.md,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: pressed ? colors.surfaceRaised : 'transparent',
        opacity: disabled ? 0.5 : 1,
      })}
    >
      <Text style={[type.body, { color: colors.textPrimary }]}>{label}</Text>
      <ChevronIcon size={18} color={colors.textTertiary} />
    </Pressable>
  );
}

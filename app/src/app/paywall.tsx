/**
 * Paywall (CLAUDE.md §8.3).
 *
 * The [HARD] rules on this screen are App Store rejection criteria, not
 * preferences:
 *   - Restore Purchases must be visible here AND in Settings.
 *   - Subscription length, price and auto-renewal terms must appear BEFORE
 *     purchase, with links to Terms and Privacy Policy.
 *
 * Both are above the fold and neither is behind a disclosure toggle, because
 * "present but hidden in a collapsed section" is a rejection reason too.
 *
 * §8.3 also says: never show on first launch, show after the user completes
 * their first gameweek prediction. That is the caller's job — this screen does
 * not decide when it appears.
 *
 * NOTE (§15 open decision #3): the Season Pass from §8.2 is deliberately not
 * offered. At £24.99 for ~10 months it is strictly worse than the £14.99
 * annual, so it cannot convert anyone who can see both — it only adds a third
 * option to a decision that converts best with two.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import type { PurchasesPackage } from 'react-native-purchases';

import {
  getOffering,
  purchase,
  restorePurchases,
} from '@/core/entitlements';
import {
  MIN_TOUCH_TARGET,
  radius,
  space,
  tabularNumbers,
  useTheme,
  useType,
} from '@/theme';

// §9.3 [HARD]: both must be live at stable URLs before submission, and
// linked from the paywall before purchase (§8.3). Register the domain.
const TERMS_URL = 'https://reckonfootball.app/terms';
const PRIVACY_URL = 'https://reckonfootball.app/privacy';

const PREMIUM_FEATURES = [
  'Full probability breakdown, not just the pick',
  'Score matrix and the five most likely scorelines',
  'Expected goals, both teams to score, clean sheets',
  'Complete model accuracy history and reliability charts',
  'Season simulator: title, top four and relegation odds',
  'Unlimited private leagues',
];

export default function PaywallScreen() {
  const { colors } = useTheme();
  const type = useType();
  const router = useRouter();

  const [packages, setPackages] = useState<PurchasesPackage[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const offering = await getOffering();
      const available = offering?.availablePackages ?? [];
      setPackages(available);
      // §8.2: "Push annual hard." Annual is preselected (§8.3).
      const annual = available.find((p) => p.packageType === 'ANNUAL');
      setSelected((annual ?? available[0])?.identifier ?? null);
    })();
  }, []);

  const onPurchase = useCallback(async () => {
    const pkg = packages?.find((p) => p.identifier === selected);
    if (!pkg) return;
    setBusy(true);
    setNotice(null);
    const outcome = await purchase(pkg);
    setBusy(false);
    if (outcome.status === 'purchased') router.back();
    else if (outcome.status === 'failed') setNotice(outcome.message);
  }, [packages, selected, router]);

  const onRestore = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    const outcome = await restorePurchases();
    setBusy(false);
    if (outcome.status === 'purchased') router.back();
    else setNotice("We couldn't find a previous purchase on this Apple ID.");
  }, [router]);

  return (
    <ScrollView
      contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxxl }}
    >
      <View style={{ gap: space.sm }}>
        <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
          See the model's full working
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>
          You already play every gameweek for free. Premium shows you the
          numbers behind every pick.
        </Text>
      </View>

      <View style={{ gap: space.md }}>
        {PREMIUM_FEATURES.map((feature) => (
          <View key={feature} style={{ flexDirection: 'row', gap: space.sm }}>
            <Text style={[type.body, { color: colors.accent }]}>—</Text>
            <Text style={[type.body, { color: colors.textPrimary, flex: 1 }]}>
              {feature}
            </Text>
          </View>
        ))}
      </View>

      {packages === null ? (
        <ActivityIndicator color={colors.accent} />
      ) : packages.length === 0 ? (
        <View
          style={{
            padding: space.lg,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={[type.callout, { color: colors.textSecondary }]}>
            Subscriptions aren't available right now. Please try again later.
          </Text>
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          {packages.map((pkg) => (
            <PackageOption
              key={pkg.identifier}
              pkg={pkg}
              selected={pkg.identifier === selected}
              onSelect={() => setSelected(pkg.identifier)}
            />
          ))}
        </View>
      )}

      {notice && (
        <Text style={[type.callout, { color: colors.negative }]} accessibilityLiveRegion="polite">
          {notice}
        </Text>
      )}

      <Pressable
        onPress={onPurchase}
        disabled={busy || !selected}
        accessibilityRole="button"
        accessibilityLabel="Start free trial"
        accessibilityState={{ disabled: busy || !selected }}
        style={{
          minHeight: MIN_TOUCH_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          backgroundColor: busy || !selected ? colors.surfaceRaised : colors.accent,
        }}
      >
        {busy ? (
          <ActivityIndicator color={colors.textPrimary} />
        ) : (
          <Text style={[type.body, { fontWeight: '700', color: colors.accentInk }]}>
            Start 7-day free trial
          </Text>
        )}
      </Pressable>

      {/* §8.3 [HARD]: terms before purchase, above the fold, not collapsed. */}
      <Text style={[type.caption, { color: colors.textSecondary, lineHeight: 18 }]}>
        Your 7-day free trial converts to a paid subscription unless cancelled
        at least 24 hours before it ends. Payment is charged to your Apple ID at
        confirmation. The subscription renews automatically at the same price
        and period unless you turn off auto-renew at least 24 hours before the
        current period ends. Manage or cancel in your Apple ID settings.
      </Text>

      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: space.lg }}>
        <LinkButton label="Terms" onPress={() => void Linking.openURL(TERMS_URL)} />
        <LinkButton label="Privacy Policy" onPress={() => void Linking.openURL(PRIVACY_URL)} />
        {/* §8.3 [HARD]: missing this is a guaranteed rejection. */}
        <LinkButton label="Restore Purchases" onPress={onRestore} />
      </View>
    </ScrollView>
  );
}

function PackageOption({
  pkg,
  selected,
  onSelect,
}: {
  pkg: PurchasesPackage;
  selected: boolean;
  onSelect: () => void;
}) {
  const { colors } = useTheme();
  const type = useType();

  const isAnnual = pkg.packageType === 'ANNUAL';
  const price = pkg.product.priceString;
  const period = isAnnual ? 'per year' : 'per month';

  return (
    <Pressable
      onPress={onSelect}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${pkg.product.title}, ${price} ${period}`}
      style={{
        minHeight: MIN_TOUCH_TARGET,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ gap: space.xxs }}>
        <Text style={[type.heading, { color: colors.textPrimary }]}>
          {isAnnual ? 'Annual' : 'Monthly'}
        </Text>
        {isAnnual && (
          <Text style={[type.caption, { color: colors.accent }]}>
            Best value — the whole season
          </Text>
        )}
      </View>
      <Text style={[type.heading, tabularNumbers, { color: colors.textPrimary }]}>
        {price}
      </Text>
    </Pressable>
  );
}

function LinkButton({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      style={{ minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' }}
    >
      <Text style={[type.caption, { color: colors.textSecondary, textDecorationLine: 'underline' }]}>
        {label}
      </Text>
    </Pressable>
  );
}

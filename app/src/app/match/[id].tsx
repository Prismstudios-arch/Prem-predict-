/**
 * Match detail — the §7.3 signature screen.
 *
 * "Get this one screen perfect and it does your marketing." The order is
 * deliberate: the split first (the headline), then the heatmap (the depth),
 * then the derived markets, then the user's own prediction. Someone who
 * screenshots the top third has already shared the thing worth sharing.
 *
 * §5.6 governs every string here. No "will win", no "nailed on", no certainty
 * language anywhere — and the confidence band is shown with its reason, not as
 * a bare percentage that reads as "16% sure Brighton win".
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LockIcon } from '@/components/Icons';
import { ProbabilityBar } from '@/components/ProbabilityBar';
import { PredictionInput, type UserPrediction } from '@/components/PredictionInput';
import { usePredictionStore } from '@/core/predictionStore';
import { ScoreMatrix, TopScorelines } from '@/components/ScoreMatrix';
import { TeamMark } from '@/components/TeamMark';
import { formatKickoff, loadFixture, type Fixture } from '@/data/repository';
import {
  MIN_TOUCH_TARGET,
  radius,
  space,
  tabularNumbers,
  useTheme,
  useType,
} from '@/theme';

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();

  const [fixture, setFixture] = useState<Fixture | null | undefined>(undefined);

  useEffect(() => {
    void loadFixture(String(id)).then((f) => setFixture(f ?? null));
  }, [id]);

  const submit = usePredictionStore((s) => s.submit);

  /**
   * Writes through the server-locked path. The database rejects anything at or
   * after kickoff (§2 [HARD]) regardless of what this device believes the time
   * is, so a refusal here is authoritative and is surfaced rather than swallowed.
   */
  const onSubmit = useCallback(
    (prediction: UserPrediction) => {
      void submit(String(id), prediction.homeGoals, prediction.awayGoals).then((result) => {
        if (!result.ok && result.message) Alert.alert('Not saved', result.message);
      });
    },
    [id, submit],
  );

  if (fixture === undefined) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (fixture === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={[type.heading, { color: colors.textPrimary }]}>Match not found</Text>
      </View>
    );
  }

  const { home_team: home, away_team: away, prediction } = fixture;
  const locked = fixture.status !== 'scheduled';

  return (
    <>
      <Stack.Screen options={{ title: `${home.short_name} v ${away.short_name}` }} />
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.xl,
        }}
      >
        {/* ---- teams -------------------------------------------------- */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <TeamColumn team={home} />
          <View style={{ alignItems: 'center', gap: space.xxs }}>
            <Text style={[type.micro, { color: colors.textTertiary }]}>
              {formatKickoff(fixture.kickoff_utc).toUpperCase()}
            </Text>
            <Text style={[type.title, { color: colors.textTertiary }]}>v</Text>
          </View>
          <TeamColumn team={away} />
        </View>

        {!prediction && fixture.free_pick ? (
          /* §8.3: a blurred preview of the real data, not an empty box. This
             branch previously did not exist, so a free user saw "Model
             prediction pending" on a match the model had already predicted. */
          <LockedPreview fixture={fixture} />
        ) : !prediction ? (
          <EmptyPrediction />
        ) : (
          <>
            {/* ---- the signature split -------------------------------- */}
            <View style={{ gap: space.md }}>
              <SectionLabel>Model</SectionLabel>
              <ProbabilityBar
                pHome={prediction.p_home}
                pDraw={prediction.p_draw}
                pAway={prediction.p_away}
                homeLabel={home.short_name}
                awayLabel={away.short_name}
                height={14}
                showInlineLabels
              />
              <ConfidenceRow
                band={prediction.confidence_band}
                reason={prediction.confidence_reason}
              />
            </View>

            {/* ---- the heatmap ---------------------------------------- */}
            <View style={{ gap: space.md }}>
              <SectionLabel>Scoreline distribution</SectionLabel>
              <ScoreMatrix
                matrix={prediction.scoreline_matrix}
                homeLabel={home.short_name}
                awayLabel={away.short_name}
              />
            </View>

            <View style={{ gap: space.md }}>
              <SectionLabel>Most likely scorelines</SectionLabel>
              <TopScorelines scorelines={prediction.top_scorelines} />
            </View>

            {/* ---- derived markets ------------------------------------ */}
            <View style={{ gap: space.md }}>
              <SectionLabel>Projections</SectionLabel>
              <View style={{ gap: space.sm }}>
                <StatRow
                  label="Expected goals"
                  value={`${prediction.exp_home_goals.toFixed(2)} – ${prediction.exp_away_goals.toFixed(2)}`}
                />
                <StatRow
                  label="Both teams score"
                  value={`${Math.round(prediction.p_btts * 100)}%`}
                />
                <StatRow
                  label="Over 2.5 goals"
                  value={`${Math.round(prediction.p_over_25 * 100)}%`}
                />
                <StatRow
                  label={`${home.short_name} clean sheet`}
                  value={`${Math.round(prediction.p_home_cs * 100)}%`}
                />
                <StatRow
                  label={`${away.short_name} clean sheet`}
                  value={`${Math.round(prediction.p_away_cs * 100)}%`}
                />
              </View>
            </View>
          </>
        )}

        <View style={{ height: 1, backgroundColor: colors.border }} />

        <PredictionInput home={home} away={away} locked={locked} onSubmit={onSubmit} />
      </ScrollView>
    </>
  );
}

function TeamColumn({ team }: { team: Fixture['home_team'] }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ alignItems: 'center', gap: space.sm, flex: 1 }}>
      <TeamMark team={team} size={56} />
      <Text
        numberOfLines={2}
        style={[type.callout, { color: colors.textPrimary, textAlign: 'center' }]}
      >
        {team.name}
      </Text>
    </View>
  );
}

function SectionLabel({ children }: { children: string }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <Text
      accessibilityRole="header"
      style={[type.micro, { color: colors.textTertiary, textTransform: 'uppercase' }]}
    >
      {children}
    </Text>
  );
}

/** §5.6: band + reason, never a bare number. */
function ConfidenceRow({ band, reason }: { band: string; reason: string }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      accessible
      accessibilityLabel={`${band} confidence. ${reason}.`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        paddingVertical: space.sm,
      }}
    >
      <View
        style={{
          paddingHorizontal: space.sm,
          paddingVertical: space.xxs,
          borderRadius: radius.sm,
          borderWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={[type.micro, { color: colors.textPrimary }]}>
          {band.toUpperCase()} CONFIDENCE
        </Text>
      </View>
      <Text style={[type.caption, { color: colors.textSecondary, flexShrink: 1 }]}>
        {reason}
      </Text>
    </View>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
    >
      <Text style={[type.body, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[type.body, tabularNumbers, { color: colors.textPrimary, fontWeight: '600' }]}>
        {value}
      </Text>
    </View>
  );
}

/**
 * The §8.3 contextual soft paywall.
 *
 * "Tapping a locked probability breakdown shows a blurred preview of the real
 * data behind it." The point is to show that something real exists — a padlock
 * over an empty rectangle sells nothing, because the user cannot tell whether
 * there is anything worth paying for.
 *
 * §9.2 [HARD] is not weakened by this: the actual probabilities were never in
 * the response. The bar below is drawn from the confidence band alone, and the
 * scoreline grid is decorative noise, not data. There is nothing here to
 * reverse-engineer.
 */
function LockedPreview({ fixture }: { fixture: Fixture }) {
  const { colors } = useTheme();
  const type = useType();
  const router = useRouter();
  const free = fixture.free_pick;
  if (!free) return null;

  const pickLabel =
    free.headline_pick === 'home'
      ? fixture.home_team.name
      : free.headline_pick === 'away'
        ? fixture.away_team.name
        : 'Draw';

  return (
    <View style={{ gap: space.xl }}>
      <View style={{ gap: space.sm }}>
        <SectionLabel>Model</SectionLabel>
        <Text style={[type.display, { color: colors.textPrimary }]}>{pickLabel}</Text>
        <ConfidenceRow band={free.confidence_band} reason={free.confidence_reason} />
      </View>

      <View
        style={{
          padding: space.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          gap: space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <LockIcon size={16} color={colors.accent} />
          <Text style={[type.heading, { color: colors.textPrimary }]}>
            The full breakdown
          </Text>
        </View>

        <Text style={[type.callout, { color: colors.textSecondary }]}>
          Exact probabilities for every outcome, the scoreline heatmap, expected
          goals, and the model's complete accuracy record.
        </Text>

        {/* Deliberately indistinct: this is a shape, not a dataset. */}
        <View style={{ gap: space.xs, opacity: 0.28 }} pointerEvents="none">
          {[0.62, 0.24, 0.14].map((w, i) => (
            <View
              key={i}
              style={{
                height: 10,
                width: `${w * 100}%`,
                borderRadius: radius.pill,
                backgroundColor: i === 0 ? colors.accent : colors.textTertiary,
              }}
            />
          ))}
        </View>

        <Pressable
          onPress={() => router.push('/paywall')}
          accessibilityRole="button"
          accessibilityLabel="See the full model breakdown. Opens subscription options."
          style={{
            minHeight: MIN_TOUCH_TARGET,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
          }}
        >
          <Text style={[type.body, { fontWeight: '700', color: colors.accentInk }]}>
            See the numbers
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function EmptyPrediction() {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      style={{
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        gap: space.xs,
      }}
    >
      <Text style={[type.heading, { color: colors.textPrimary }]}>
        Model prediction pending
      </Text>
      <Text style={[type.callout, { color: colors.textSecondary }]}>
        Predictions publish the Tuesday before each gameweek. You can still
        enter yours now.
      </Text>
    </View>
  );
}

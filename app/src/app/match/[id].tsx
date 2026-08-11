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
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProbabilityBar } from '@/components/ProbabilityBar';
import { PredictionInput, type UserPrediction } from '@/components/PredictionInput';
import { ScoreMatrix, TopScorelines } from '@/components/ScoreMatrix';
import { TeamMark } from '@/components/TeamMark';
import { formatKickoff, loadFixture, type Fixture } from '@/data/repository';
import { radius, space, tabularNumbers, useTheme, useType } from '@/theme';

export default function MatchDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();

  const [fixture, setFixture] = useState<Fixture | null | undefined>(undefined);

  useEffect(() => {
    void loadFixture(String(id)).then((f) => setFixture(f ?? null));
  }, [id]);

  const onSubmit = useCallback((prediction: UserPrediction) => {
    // Phase 3 writes this through the server-locked endpoint. The database
    // rejects anything at or after kickoff (§2 [HARD]) regardless of what the
    // client believes the time is.
    console.log('prediction submitted', prediction);
  }, []);

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

        {!prediction ? (
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

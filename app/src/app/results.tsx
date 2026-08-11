/**
 * Results — "You 6 — Model 4" (CLAUDE.md §1.4, §6.1).
 *
 * This is the payoff screen of the whole loop, and the one that has to be
 * emotionally legible in half a second: did I beat it, or didn't I.
 *
 * §5.6 still applies even in defeat. The model does not gloat and the copy
 * never implies the model "knew" — it scored more points on one gameweek,
 * which is a fact, not a claim about foresight.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';

import { fetchMyResults, type GameweekResult } from '@/core/predictions';
import { radius, space, tabularNumbers, useTheme, useType } from '@/theme';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; results: GameweekResult[] };

export default function ResultsScreen() {
  const { colors } = useTheme();
  const type = useType();
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', results: await fetchMyResults() });
    } catch (error) {
      console.error('fetchMyResults failed', error);
      setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl }}>
        <Text style={[type.heading, { color: colors.textPrimary, textAlign: 'center' }]}>
          Couldn't load your results.
        </Text>
      </View>
    );
  }

  const wins = state.results.filter((r) => r.beat_model).length;

  return (
    <FlatList
      data={state.results}
      keyExtractor={(r) => `${r.season}-${r.gameweek}`}
      contentContainerStyle={{ padding: space.lg, gap: space.md }}
      ListHeaderComponent={
        state.results.length > 0 ? (
          <View style={{ gap: space.xs, marginBottom: space.sm }}>
            <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
              Results
            </Text>
            <Text style={[type.callout, tabularNumbers, { color: colors.textSecondary }]}>
              You've beaten the model in {wins} of {state.results.length} gameweeks
            </Text>
          </View>
        ) : null
      }
      renderItem={({ item }) => <ResultCard result={item} />}
      ListEmptyComponent={
        <View style={{ alignItems: 'center', padding: space.xxl, gap: space.sm }}>
          <Text style={[type.heading, { color: colors.textPrimary }]}>
            Nothing settled yet
          </Text>
          <Text style={[type.callout, { color: colors.textSecondary, textAlign: 'center' }]}>
            Make your predictions this week. Results land on Monday morning.
          </Text>
        </View>
      }
    />
  );
}

function ResultCard({ result }: { result: GameweekResult }) {
  const { colors } = useTheme();
  const type = useType();

  const drew = result.user_points === result.model_points;
  const headline = drew
    ? 'Dead heat'
    : result.beat_model
      ? 'You beat the model'
      : 'The model edged it';

  return (
    <View
      accessible
      accessibilityLabel={
        `Gameweek ${result.gameweek}. ${headline}. ` +
        `You ${result.user_points} points, model ${result.model_points} points. ` +
        `${result.exact_scores} exact scorelines from ${result.predictions_made} predictions.`
      }
      style={{
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: result.beat_model ? colors.accent : colors.border,
        backgroundColor: colors.surface,
        gap: space.md,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[type.micro, { color: colors.textTertiary }]}>
          GAMEWEEK {result.gameweek}
        </Text>
        <Text
          style={[
            type.micro,
            { color: result.beat_model ? colors.accent : colors.textTertiary },
          ]}
        >
          {headline.toUpperCase()}
        </Text>
      </View>

      <View
        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xl }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <ScoreBlock label="You" value={result.user_points} emphasised={result.beat_model} />
        <Text style={[type.title, { color: colors.textTertiary }]}>—</Text>
        <ScoreBlock
          label="Model"
          value={result.model_points}
          emphasised={!result.beat_model && !drew}
        />
      </View>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Stat label="Predictions" value={result.predictions_made} />
        <Stat label="Right result" value={result.correct_outcomes} />
        <Stat label="Exact score" value={result.exact_scores} />
      </View>
    </View>
  );
}

function ScoreBlock({
  label,
  value,
  emphasised,
}: {
  label: string;
  value: number;
  emphasised: boolean;
}) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ alignItems: 'center', gap: space.xxs }}>
      <Text style={[type.micro, { color: colors.textTertiary, textTransform: 'uppercase' }]}>
        {label}
      </Text>
      <Text
        style={[
          type.display,
          tabularNumbers,
          { color: emphasised ? colors.accent : colors.textPrimary },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ alignItems: 'center', gap: space.xxs }}>
      <Text style={[type.micro, { color: colors.textTertiary }]}>{label.toUpperCase()}</Text>
      <Text style={[type.callout, tabularNumbers, { color: colors.textPrimary }]}>
        {value}
      </Text>
    </View>
  );
}

/**
 * Results — "You 6 — Model 4" (CLAUDE.md §1.4, §6.1).
 *
 * This is the payoff screen of the whole loop, and the one that has to be
 * emotionally legible in half a second: did I beat it, or didn't I.
 *
 * §5.6 still applies even in defeat. The model does not gloat and the copy
 * never implies the model "knew" — it scored more points on one gameweek,
 * which is a fact, not a claim about foresight.
 *
 * THE PRE-SEASON PROBLEM
 *
 * Nothing settles until the first Monday of the season, so for the entire
 * period when people are actually installing the app this tab rendered a
 * single line of grey text. An empty tab does not read as "not yet" — it reads
 * as broken, and it is the second tab in the bar, so it is the first thing a
 * new user taps after the gameweek screen.
 *
 * The fix is that the card you have already submitted *is* content. It is the
 * thing you are most invested in, it is the only screen where your call of the
 * week is visible as a commitment, and a countdown to kick-off is the exact
 * feeling the product is selling. So this screen shows the open card above any
 * settled history, and only falls back to an empty state when there is
 * genuinely nothing — at which point it says what to do about it.
 */

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, SectionList, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TeamMark } from '@/components/TeamMark';
import { usePredictionStore } from '@/core/predictionStore';
import { fetchMyResults, type GameweekResult } from '@/core/predictions';
import { loadGameweek, type Fixture } from '@/data/repository';
import {
  MIN_TOUCH_TARGET,
  radius,
  space,
  tabularNumbers,
  useTheme,
  useType,
} from '@/theme';

type Open = { fixture: Fixture; homeGoals: number; awayGoals: number; isCall: boolean };

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; results: GameweekResult[]; open: Open[]; gameweek: number };

export default function ResultsScreen() {
  const { colors } = useTheme();
  const type = useType();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const loadPicks = usePredictionStore((s) => s.load);

  const load = useCallback(async () => {
    try {
      // Settled history and the open card are independent — a failure to read
      // one should not blank the other, but both failing is a real error.
      const [results, week] = await Promise.all([fetchMyResults(), loadGameweek(1)]);
      await loadPicks(week.fixtures.map((f) => f.id));

      const picks = usePredictionStore.getState().picks;
      const open: Open[] = week.fixtures
        .filter((f) => picks[f.id] && f.home_goals === null)
        .map((f) => ({
          fixture: f,
          homeGoals: picks[f.id]!.homeGoals,
          awayGoals: picks[f.id]!.awayGoals,
          isCall: picks[f.id]!.isCallOfTheWeek,
        }))
        .sort((a, b) => a.fixture.kickoff_utc.localeCompare(b.fixture.kickoff_utc));

      setState({ status: 'ready', results, open, gameweek: week.gameweek });
    } catch (error) {
      console.error('results load failed', error);
      setState({ status: 'error' });
    }
  }, [loadPicks]);

  /**
   * Reload every time the tab is focused, not once on mount.
   *
   * Expo Router keeps tab screens mounted after their first visit, so a plain
   * useEffect runs exactly once for the life of the app. Open Results before
   * predicting anything, and it caches "you haven't called it yet" — then you
   * make ten predictions, switch back, and it is still showing the answer from
   * before you started. Nothing looks broken enough to try pull-to-refresh,
   * because the screen is rendering a legitimate state; just not the current one.
   *
   * This is the payoff screen. It is the one place where showing stale state
   * costs the most, because the whole point is finding out what happened.
   */
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
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
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md }}>
        <Text style={[type.heading, { color: colors.textPrimary, textAlign: 'center' }]}>
          Couldn't load your results.
        </Text>
        <Pressable
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={{
            minHeight: MIN_TOUCH_TARGET,
            justifyContent: 'center',
            paddingHorizontal: space.xl,
            borderRadius: radius.pill,
            backgroundColor: colors.accent,
          }}
        >
          <Text style={[type.callout, { color: colors.accentInk, fontWeight: '700' }]}>
            Try again
          </Text>
        </Pressable>
      </View>
    );
  }

  const { results, open, gameweek } = state;
  const wins = results.filter((r) => r.beat_model).length;

  // Two sections rather than one list with a conditional header: the open card
  // and the settled history are different kinds of thing and should not scroll
  // as though they were the same table.
  const sections = [
    ...(open.length > 0
      ? [{ key: 'open', title: `GAMEWEEK ${gameweek} · AWAITING KICK-OFF`, data: open }]
      : []),
    ...(results.length > 0
      ? [{ key: 'settled', title: 'SETTLED', data: results as unknown as Open[] }]
      : []),
  ];

  return (
    <SectionList
      sections={sections}
      keyExtractor={(item, i) =>
        'fixture' in item ? item.fixture.id : `settled-${i}`
      }
      stickySectionHeadersEnabled={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.md,
      }}
      ListHeaderComponent={
        <View style={{ gap: space.xs, marginBottom: space.sm }}>
          <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
            Results
          </Text>
          <Text style={[type.callout, tabularNumbers, { color: colors.textSecondary }]}>
            {results.length > 0
              ? `You've beaten the model in ${wins} of ${results.length} gameweeks`
              : "Nothing settled yet — the first results land after the opening weekend"}
          </Text>
          {open.length > 0 && <NextKickoff at={open[0]!.fixture.kickoff_utc} />}
        </View>
      }
      renderSectionHeader={({ section }) => (
        <Text
          accessibilityRole="header"
          style={[type.micro, { color: colors.textTertiary, letterSpacing: 1, paddingTop: space.md }]}
        >
          {section.title}
        </Text>
      )}
      renderItem={({ item, section }) =>
        section.key === 'open' ? (
          <OpenPickRow pick={item} />
        ) : (
          <ResultCard result={item as unknown as GameweekResult} />
        )
      }
      ListEmptyComponent={
        <View style={{ alignItems: 'center', padding: space.xxl, gap: space.md }}>
          <Text style={[type.heading, { color: colors.textPrimary, textAlign: 'center' }]}>
            You haven't called it yet
          </Text>
          <Text style={[type.callout, { color: colors.textSecondary, textAlign: 'center' }]}>
            Make your ten predictions and they'll appear here, locked, until
            kick-off. Results land on Monday morning.
          </Text>
          <Pressable
            onPress={() => router.push('/predict')}
            accessibilityRole="button"
            accessibilityLabel="Make your predictions"
            style={{
              minHeight: MIN_TOUCH_TARGET,
              justifyContent: 'center',
              paddingHorizontal: space.xl,
              borderRadius: radius.pill,
              backgroundColor: colors.accent,
            }}
          >
            <Text style={[type.callout, { color: colors.accentInk, fontWeight: '700' }]}>
              What do you reckon?
            </Text>
          </Pressable>
        </View>
      }
    />
  );
}

/**
 * Time to the first kick-off still to come.
 *
 * §2 [HARD] is about the *lock*, which is server-enforced and unaffected by
 * this: a user who winds their clock back sees a wrong countdown and still
 * cannot submit after kickoff, because the RLS policy compares Postgres's
 * now(). This is decoration, and it is isolated in its own component so a
 * per-second tick re-renders one line of text rather than the whole list.
 */
function NextKickoff({ at }: { at: string }) {
  const { colors } = useTheme();
  const type = useType();
  const [now, setNow] = useState(() => Date.now());

  const target = new Date(at).getTime();
  const remaining = target - now;

  // Seconds matter in the last hour and are noise before that. Ticking once a
  // minute the rest of the time keeps a backgrounded tab from waking the JS
  // thread 3,600 times an hour to redraw a string that did not change.
  //
  // The period, not the remaining time, is the dependency. Depending on
  // `remaining` would tear down and recreate the interval on every single
  // tick — the effect's own setNow is what changes it — and the timer would
  // drift a little further each time it was rebuilt.
  const tickMs = remaining > 0 && remaining < 3_600_000 ? 1_000 : 60_000;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), tickMs);
    return () => clearInterval(id);
  }, [tickMs]);

  if (remaining <= 0) {
    return (
      <Text style={[type.callout, { color: colors.accent, fontWeight: '700' }]}>
        Under way. Scores land as matches finish.
      </Text>
    );
  }

  const totalMinutes = Math.floor(remaining / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const seconds = Math.floor((remaining % 60_000) / 1000);

  const text =
    days > 0
      ? `${days}d ${hours}h`
      : hours > 0
        ? `${hours}h ${minutes}m`
        : `${minutes}m ${String(seconds).padStart(2, '0')}s`;

  return (
    <Text
      accessibilityLabel={`Predictions lock in ${text}`}
      style={[type.callout, tabularNumbers, { color: colors.accent, fontWeight: '700' }]}
    >
      Locks in {text}
    </Text>
  );
}

/** One submitted, unsettled prediction. */
function OpenPickRow({ pick }: { pick: Open }) {
  const { colors } = useTheme();
  const type = useType();
  const { fixture, homeGoals, awayGoals, isCall } = pick;
  const kickedOff = Date.now() >= new Date(fixture.kickoff_utc).getTime();

  return (
    <View
      accessible
      accessibilityLabel={
        `${fixture.home_team.name} versus ${fixture.away_team.name}. ` +
        `You called ${homeGoals} ${awayGoals}. ` +
        (isCall ? 'Your call of the week, scores double. ' : '') +
        (kickedOff ? 'Locked, awaiting the result.' : 'Awaiting kick-off.')
      }
      style={{
        padding: space.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: isCall ? colors.accent : colors.border,
        backgroundColor: colors.surface,
        gap: space.md,
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[type.micro, { color: colors.textTertiary }]}>
          {kickedOff ? 'LOCKED' : 'AWAITING KICK-OFF'}
        </Text>
        {isCall && (
          <Text style={[type.micro, { color: colors.accent, fontWeight: '700' }]}>
            CALL OF THE WEEK · ×2
          </Text>
        )}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <TeamMark team={fixture.home_team} size={26} />
        <TeamMark team={fixture.away_team} size={26} />
        <Text
          numberOfLines={1}
          style={[type.body, { color: colors.textSecondary, flex: 1 }]}
        >
          {fixture.home_team.short_name} v {fixture.away_team.short_name}
        </Text>
        <Text style={[type.title, tabularNumbers, { color: colors.textPrimary }]}>
          {homeGoals}–{awayGoals}
        </Text>
      </View>
    </View>
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

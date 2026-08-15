/**
 * The prediction flow — all ten matches, one screen at a time.
 *
 * §6.1 asks for "satisfying tactile input". The first implementation put the
 * stepper on the match detail screen, which meant ten round trips in and out of
 * a list to complete a gameweek. Tedium at the core loop is what actually kills
 * retention: the model, the heatmap and the paywall are all irrelevant if
 * playing the game is a chore.
 *
 * So this is a horizontal pager. Swipe or tap through, one match per card,
 * progress visible the whole way, and a single "done" at the end. Each
 * prediction saves as you leave the card rather than waiting for a submit at
 * the end, so closing the app halfway loses nothing.
 *
 * §7.2 haptics: selection on each stepper tap, rigid on lock-in. §7.5 [HARD]:
 * the pager is navigable without gestures — the buttons work on their own, and
 * every control is labelled.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Pressable,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ProbabilityBar } from '@/components/ProbabilityBar';
import { TeamMark } from '@/components/TeamMark';
import { formatKickoff, loadGameweek, type Fixture } from '@/data/repository';
import { usePredictionStore } from '@/core/predictionStore';
import {
  MIN_TOUCH_TARGET,
  radius,
  space,
  tabularNumbers,
  useTheme,
  useType,
} from '@/theme';

const MAX_GOALS = 9;

export default function PredictFlowScreen() {
  const { colors } = useTheme();
  const type = useType();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = Dimensions.get('window');
  const listRef = useRef<FlatList<Fixture>>(null);
  /** Set by the visible card so the pager can commit it before navigating. */
  const commitRef = useRef<((fixtureId: string) => void) | null>(null);

  const [fixtures, setFixtures] = useState<Fixture[] | null>(null);
  const [index, setIndex] = useState(0);

  const { picks, load, submit, countSubmitted } = usePredictionStore();

  useEffect(() => {
    void (async () => {
      const week = await loadGameweek(1);
      const open = week.fixtures.filter((f) => f.status === 'scheduled');
      setFixtures(open);
      await load(open.map((f) => f.id));
    })();
  }, [load]);

  const ids = useMemo(() => (fixtures ?? []).map((f) => f.id), [fixtures]);
  const done = countSubmitted(ids);

  /**
   * Commits the card you are leaving, then moves.
   *
   * Previously a prediction only saved when a stepper was tapped, so anyone who
   * agreed with the default 1-0 swiped past and saved nothing — the card said
   * "Not saved yet" and they had no reason to think that was a problem. Moving
   * on is the intent to commit.
   */
  const goTo = useCallback(
    (next: number) => {
      if (!fixtures || next < 0 || next >= fixtures.length) return;
      const leaving = fixtures[index];
      if (leaving) commitRef.current?.(leaving.id);
      listRef.current?.scrollToOffset({ offset: next * width, animated: true });
      setIndex(next);
    },
    [fixtures, index, width],
  );

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
    },
    [width],
  );

  if (!fixtures) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (fixtures.length === 0) {
    return (
      <View
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.sm }}
      >
        <Text style={[type.heading, { color: colors.textPrimary, textAlign: 'center' }]}>
          Everything has kicked off
        </Text>
        <Text style={[type.callout, { color: colors.textSecondary, textAlign: 'center' }]}>
          Predictions for this gameweek are closed. The next one opens Tuesday.
        </Text>
      </View>
    );
  }

  const allDone = done === fixtures.length;

  return (
    <>
      <Stack.Screen options={{ title: `${done} of ${fixtures.length}` }} />
      <View style={{ flex: 1, paddingBottom: insets.bottom }}>
        {/* Progress. §7.5: also stated as text in the header title above. */}
        <View
          accessible
          accessibilityLabel={`${done} of ${fixtures.length} predictions made`}
          style={{ flexDirection: 'row', gap: 3, paddingHorizontal: space.lg, paddingVertical: space.md }}
        >
          {fixtures.map((f, i) => (
            <View
              key={f.id}
              style={{
                flex: 1,
                height: 3,
                borderRadius: radius.pill,
                backgroundColor: picks[f.id]
                  ? colors.accent
                  : i === index
                    ? colors.textTertiary
                    : colors.border,
              }}
            />
          ))}
        </View>

        <FlatList
          ref={listRef}
          data={fixtures}
          keyExtractor={(f) => f.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onMomentumEnd}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          renderItem={({ item }) => (
            <PredictCard
              fixture={item}
              width={width}
              onSubmit={submit}
              registerCommit={(fn) => {
                commitRef.current = fn;
              }}
            />
          )}
        />

        {/* Explicit navigation, so the flow does not depend on gestures. */}
        <View style={{ flexDirection: 'row', gap: space.md, padding: space.lg }}>
          <NavButton
            label="Back"
            disabled={index === 0}
            onPress={() => goTo(index - 1)}
          />
          {index < fixtures.length - 1 ? (
            <NavButton label="Next" primary onPress={() => goTo(index + 1)} />
          ) : (
            <NavButton
              label={allDone ? 'Done' : `Finish (${done}/${fixtures.length})`}
              primary
              onPress={() => {
                const last = fixtures[index];
                if (last) commitRef.current?.(last.id);
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                router.back();
              }}
            />
          )}
        </View>
      </View>
    </>
  );
}

function PredictCard({
  fixture,
  width,
  onSubmit,
  registerCommit,
}: {
  fixture: Fixture;
  width: number;
  onSubmit: (id: string, h: number, a: number) => Promise<{ ok: boolean; message?: string }>;
  registerCommit: (fn: (fixtureId: string) => void) => void;
}) {
  const { colors } = useTheme();
  const type = useType();
  const existing = usePredictionStore((s) => s.picks[fixture.id]);

  const [home, setHome] = useState(existing?.homeGoals ?? 1);
  const [away, setAway] = useState(existing?.awayGoals ?? 0);
  const [error, setError] = useState<string | null>(null);

  // Keep in step if the server load lands after first render.
  useEffect(() => {
    if (existing) {
      setHome(existing.homeGoals);
      setAway(existing.awayGoals);
    }
  }, [existing?.homeGoals, existing?.awayGoals]);

  const save = useCallback(
    async (h: number, a: number) => {
      const result = await onSubmit(fixture.id, h, a);
      setError(result.ok ? null : (result.message ?? null));
    },
    [fixture.id, onSubmit],
  );

  // Hand the pager a way to commit this card's current values as it leaves.
  useEffect(() => {
    registerCommit((fixtureId) => {
      if (fixtureId === fixture.id) void save(home, away);
    });
  }, [registerCommit, fixture.id, home, away, save]);

  const adjust = useCallback(
    (side: 'home' | 'away', delta: number) => {
      void Haptics.selectionAsync();
      const h = side === 'home' ? Math.min(MAX_GOALS, Math.max(0, home + delta)) : home;
      const a = side === 'away' ? Math.min(MAX_GOALS, Math.max(0, away + delta)) : away;
      setHome(h);
      setAway(a);
      // Saved on every change rather than behind a submit button: closing the
      // app halfway through a gameweek should not lose the first five picks.
      void save(h, a);
    },
    [home, away, save],
  );

  const outcome = home > away ? fixture.home_team.name : home < away ? fixture.away_team.name : 'Draw';
  const saved = Boolean(existing) && !existing?.pending;

  return (
    <View style={{ width, padding: space.lg, gap: space.xl }}>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Text style={[type.micro, { color: colors.textTertiary }]}>
          {formatKickoff(fixture.kickoff_utc).toUpperCase()}
        </Text>
      </View>

      <View style={{ gap: space.lg }}>
        <SideStepper
          team={fixture.home_team}
          value={home}
          onIncrement={() => adjust('home', 1)}
          onDecrement={() => adjust('home', -1)}
        />
        <SideStepper
          team={fixture.away_team}
          value={away}
          onIncrement={() => adjust('away', 1)}
          onDecrement={() => adjust('away', -1)}
        />
      </View>

      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Text
          accessibilityLiveRegion="polite"
          style={[type.heading, tabularNumbers, { color: colors.textPrimary }]}
        >
          {home}–{away}
        </Text>
        <Text style={[type.callout, { color: colors.textSecondary }]}>{outcome}</Text>
        {error ? (
          <Text style={[type.caption, { color: colors.negative, textAlign: 'center' }]}>
            {error}
          </Text>
        ) : (
          <Text style={[type.caption, { color: saved ? colors.accent : colors.textTertiary }]}>
            {existing?.pending
              ? 'Saving…'
              : saved
                ? 'Saved'
                : 'Saves when you continue'}
          </Text>
        )}
      </View>

      {/* The model's view, for context. Free tier sees only the shape. */}
      {fixture.prediction && (
        <View style={{ gap: space.sm }}>
          <Text style={[type.micro, { color: colors.textTertiary }]}>THE MODEL SAYS</Text>
          <ProbabilityBar
            pHome={fixture.prediction.p_home}
            pDraw={fixture.prediction.p_draw}
            pAway={fixture.prediction.p_away}
            homeLabel={fixture.home_team.short_name}
            awayLabel={fixture.away_team.short_name}
            height={8}
          />
        </View>
      )}
    </View>
  );
}

function SideStepper({
  team,
  value,
  onIncrement,
  onDecrement,
}: {
  team: Fixture['home_team'];
  value: number;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <TeamMark team={team} size={40} />
      <Text
        numberOfLines={2}
        style={[type.body, { color: colors.textPrimary, flex: 1, fontWeight: '600' }]}
      >
        {team.name}
      </Text>
      <StepperButton symbol="−" label={`One fewer for ${team.name}`} onPress={onDecrement} />
      <Text
        accessibilityLabel={`${team.name} ${value}`}
        style={[type.display, tabularNumbers, { color: colors.textPrimary, minWidth: 44, textAlign: 'center' }]}
      >
        {value}
      </Text>
      <StepperButton symbol="+" label={`One more for ${team.name}`} onPress={onIncrement} />
    </View>
  );
}

function StepperButton({
  symbol,
  label,
  onPress,
}: {
  symbol: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: MIN_TOUCH_TARGET,
        height: MIN_TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
      }}
    >
      <Text style={{ fontSize: 24, lineHeight: 28, color: colors.textPrimary }}>{symbol}</Text>
    </Pressable>
  );
}

function NavButton({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
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
      style={{
        flex: primary ? 2 : 1,
        minHeight: MIN_TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        backgroundColor: primary ? colors.accent : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text
        style={[
          type.body,
          { fontWeight: '700', color: primary ? colors.accentInk : colors.textPrimary },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Prediction input (CLAUDE.md §6.1).
 *
 * "Satisfying tactile input. Haptics on lock-in."
 *
 * The scoreline is the input; the outcome is derived from it. Letting a user
 * pick "home win" and then enter 1-2 creates a contradiction someone has to
 * resolve, and the database rejects it outright — `outcome_matches_scoreline`
 * is a CHECK constraint in 0001_init.sql. Deriving it here means the two can
 * never disagree.
 *
 * §7.5 [HARD]: steppers are 44pt minimum, every control is labelled, and the
 * current scoreline is announced as text rather than inferred from position.
 */

import { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';

import type { Team } from '@/data/repository';
import {
  MIN_TOUCH_TARGET,
  radius,
  space,
  tabularNumbers,
  useTheme,
  useType,
} from '@/theme';

const MAX_GOALS = 9;

export type UserPrediction = {
  outcome: 'home' | 'draw' | 'away';
  homeGoals: number;
  awayGoals: number;
};

function deriveOutcome(home: number, away: number): UserPrediction['outcome'] {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

type Props = {
  home: Team;
  away: Team;
  initial?: { homeGoals: number; awayGoals: number };
  locked?: boolean;
  onSubmit: (prediction: UserPrediction) => void;
};

export function PredictionInput({ home, away, initial, locked = false, onSubmit }: Props) {
  const { colors } = useTheme();
  const type = useType();

  const [homeGoals, setHomeGoals] = useState(initial?.homeGoals ?? 0);
  const [awayGoals, setAwayGoals] = useState(initial?.awayGoals ?? 0);
  const [submitted, setSubmitted] = useState(false);

  const adjust = useCallback(
    (side: 'home' | 'away', delta: number) => {
      if (locked) return;
      void Haptics.selectionAsync();
      const setter = side === 'home' ? setHomeGoals : setAwayGoals;
      setter((current) => Math.min(MAX_GOALS, Math.max(0, current + delta)));
      setSubmitted(false);
    },
    [locked],
  );

  const submit = useCallback(() => {
    if (locked) return;
    // §7.2: .impact(.rigid) on lock-in. This is the one moment in the app that
    // earns a heavy haptic.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    setSubmitted(true);
    onSubmit({ outcome: deriveOutcome(homeGoals, awayGoals), homeGoals, awayGoals });
  }, [homeGoals, awayGoals, locked, onSubmit]);

  const outcomeText =
    homeGoals > awayGoals
      ? `${home.name} win`
      : homeGoals < awayGoals
        ? `${away.name} win`
        : 'Draw';

  return (
    <View style={{ gap: space.lg }}>
      <Text style={[type.heading, { color: colors.textPrimary }]} accessibilityRole="header">
        Your prediction
      </Text>

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
        }}
      >
        <Stepper
          label={home.name}
          value={homeGoals}
          disabled={locked}
          onIncrement={() => adjust('home', 1)}
          onDecrement={() => adjust('home', -1)}
        />
        <Text style={[type.title, { color: colors.textTertiary }]}>–</Text>
        <Stepper
          label={away.name}
          value={awayGoals}
          disabled={locked}
          onIncrement={() => adjust('away', 1)}
          onDecrement={() => adjust('away', -1)}
        />
      </View>

      <Text
        accessibilityLiveRegion="polite"
        style={[type.callout, { color: colors.textSecondary, textAlign: 'center' }]}
      >
        {`${homeGoals}–${awayGoals} · ${outcomeText}`}
      </Text>

      <Pressable
        onPress={submit}
        disabled={locked}
        accessibilityRole="button"
        accessibilityLabel={
          locked
            ? 'Predictions are locked for this match'
            : `Lock in ${home.name} ${homeGoals}, ${away.name} ${awayGoals}`
        }
        accessibilityState={{ disabled: locked }}
        style={({ pressed }) => ({
          minHeight: MIN_TOUCH_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          backgroundColor: locked
            ? colors.surfaceRaised
            : pressed
              ? colors.textPrimary
              : colors.accent,
        })}
      >
        <Text
          style={[
            type.body,
            {
              fontWeight: '700',
              color: locked ? colors.textTertiary : colors.accentInk,
            },
          ]}
        >
          {locked ? 'Locked' : submitted ? 'Saved' : 'Lock it in'}
        </Text>
      </Pressable>

      {locked && (
        <Text style={[type.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
          This match has kicked off. Predictions closed.
        </Text>
      )}
    </View>
  );
}

function Stepper({
  label,
  value,
  disabled,
  onIncrement,
  onDecrement,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
}) {
  const { colors } = useTheme();
  const type = useType();

  return (
    <View style={{ flex: 1, alignItems: 'center', gap: space.sm }}>
      <Text
        numberOfLines={1}
        style={[type.micro, { color: colors.textTertiary, textTransform: 'uppercase' }]}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <StepperButton
          symbol="−"
          label={`Decrease ${label} goals`}
          disabled={disabled || value === 0}
          onPress={onDecrement}
        />
        <Text
          accessibilityLabel={`${label} ${value}`}
          style={[
            type.display,
            tabularNumbers,
            { color: colors.textPrimary, minWidth: 44, textAlign: 'center' },
          ]}
        >
          {value}
        </Text>
        <StepperButton
          symbol="+"
          label={`Increase ${label} goals`}
          disabled={disabled || value === MAX_GOALS}
          onPress={onIncrement}
        />
      </View>
    </View>
  );
}

function StepperButton({
  symbol,
  label,
  disabled,
  onPress,
}: {
  symbol: string;
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      // §7.5 [HARD]: 44x44 minimum, non-negotiable.
      style={{
        width: MIN_TOUCH_TARGET,
        height: MIN_TOUCH_TARGET,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Text style={{ fontSize: 22, color: colors.textPrimary, lineHeight: 26 }}>
        {symbol}
      </Text>
    </Pressable>
  );
}

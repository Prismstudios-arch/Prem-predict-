/**
 * One fixture in the gameweek list (CLAUDE.md §6.1).
 *
 * The first version put both full club names on one line either side of a "v",
 * which truncated to "Arse… v Cov…" on a real phone — the two pieces of
 * information a football fan needs most, destroyed to fit a layout. Names now
 * get a full-width line each, stacked, which is also what makes the row read as
 * a fixture rather than a table cell.
 *
 * §8.1 gives free users the pick and confidence but not the percentages. Shown
 * literally that is three words on a card, which is why the app felt empty: the
 * one thing worth looking at was invisible to everyone. §8.3 resolves it —
 * "contextual soft paywalls: tapping a locked probability breakdown shows a
 * blurred preview of the real data behind it". So free users see the *shape* of
 * the model's split with the numbers withheld. The bar is the hook; the numbers
 * are the product.
 *
 * §7.5 [HARD] still governs the layout: past STACK_LAYOUT_THRESHOLD the row
 * grows rather than truncating, and every probability is available as text.
 */

import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ProbabilityBar } from './ProbabilityBar';
import { TeamMark } from './TeamMark';
import type { Fixture } from '@/data/repository';
import { formatKickoff } from '@/data/repository';
import {
  MIN_TOUCH_TARGET,
  radius,
  space,
  tabularNumbers,
  useScaled,
  useTheme,
  useType,
} from '@/theme';

type Props = {
  fixture: Fixture;
  onPress: (id: string) => void;
};

function FixtureRowImpl({ fixture, onPress }: Props) {
  const { colors } = useTheme();
  const type = useType();
  const scaled = useScaled();

  const { home_team: home, away_team: away, prediction, free_pick: free } = fixture;
  const markSize = scaled(26);
  const finished = fixture.home_goals !== null && fixture.away_goals !== null;

  // Free tier sees the shape; premium sees the numbers.
  const split = prediction
    ? { h: prediction.p_home, d: prediction.p_draw, a: prediction.p_away }
    : null;

  const accessibilityLabel = [
    `${home.name} versus ${away.name}`,
    finished
      ? `Final score ${fixture.home_goals} ${fixture.away_goals}`
      : formatKickoff(fixture.kickoff_utc),
    prediction
      ? `Model: ${home.name} ${Math.round(prediction.p_home * 100)} percent, ` +
        `draw ${Math.round(prediction.p_draw * 100)} percent, ` +
        `${away.name} ${Math.round(prediction.p_away * 100)} percent. ` +
        `${prediction.confidence_band} confidence, ${prediction.confidence_reason}`
      : free
        ? `Model leans ${pickName(free.headline_pick, home.name, away.name)}. ` +
          `${free.confidence_band} confidence, ${free.confidence_reason}. ` +
          'Full percentages are a premium feature.'
        : 'No model prediction yet',
  ].join('. ');

  return (
    <Pressable
      onPress={() => onPress(fixture.id)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the full model breakdown"
      style={({ pressed }) => ({
        minHeight: MIN_TOUCH_TARGET,
        padding: space.lg,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        gap: space.md,
      })}
    >
      {/* ---- kickoff / status ------------------------------------------ */}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[type.micro, tabularNumbers, { color: colors.textTertiary }]}>
          {finished ? 'FULL TIME' : formatKickoff(fixture.kickoff_utc).toUpperCase()}
        </Text>
        {free?.data_regime === 'prior_heavy' && !finished && (
          <Text style={[type.micro, { color: colors.textTertiary }]}>EARLY SEASON</Text>
        )}
      </View>

      {/* ---- the two clubs, one line each -------------------------------- */}
      <View style={{ gap: space.sm }}>
        <TeamLine
          team={home}
          markSize={markSize}
          goals={fixture.home_goals}
          emphasised={finished && (fixture.home_goals ?? 0) > (fixture.away_goals ?? 0)}
        />
        <TeamLine
          team={away}
          markSize={markSize}
          goals={fixture.away_goals}
          emphasised={finished && (fixture.away_goals ?? 0) > (fixture.home_goals ?? 0)}
        />
      </View>

      {/* ---- the model -------------------------------------------------- */}
      {split ? (
        <View style={{ gap: space.sm }}>
          <ProbabilityBar
            pHome={split.h}
            pDraw={split.d}
            pAway={split.a}
            homeLabel={home.short_name}
            awayLabel={away.short_name}
            height={scaled(8)}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={[type.caption, tabularNumbers, { color: colors.textSecondary }]}>
              {Math.round(split.h * 100)} · {Math.round(split.d * 100)} · {Math.round(split.a * 100)}
            </Text>
            <Text style={[type.caption, { color: colors.textTertiary }]}>
              {prediction?.confidence_band.toLowerCase()} confidence
            </Text>
          </View>
        </View>
      ) : free ? (
        <LockedSplit fixture={fixture} />
      ) : null}
    </Pressable>
  );
}

function TeamLine({
  team,
  markSize,
  goals,
  emphasised,
}: {
  team: Fixture['home_team'];
  markSize: number;
  goals: number | null;
  emphasised: boolean;
}) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
      <TeamMark team={team} size={markSize} />
      <Text
        // Two lines rather than an ellipsis: "Wolverhampton Wanderers" is a
        // real club and should not become "Wolverha…".
        numberOfLines={2}
        style={[
          type.body,
          {
            color: emphasised ? colors.textPrimary : colors.textSecondary,
            fontWeight: emphasised ? '700' : '500',
            flex: 1,
          },
        ]}
      >
        {team.name}
      </Text>
      {goals !== null && (
        <Text
          style={[
            type.title,
            tabularNumbers,
            { color: emphasised ? colors.textPrimary : colors.textSecondary },
          ]}
        >
          {goals}
        </Text>
      )}
    </View>
  );
}

/**
 * The §8.3 soft paywall, in its list form.
 *
 * Shows the model's lean and the shape of its confidence without the numbers.
 * Not a padlock over an empty box — a padlock over nothing sells nothing.
 */
function LockedSplit({ fixture }: { fixture: Fixture }) {
  const { colors } = useTheme();
  const type = useType();
  const free = fixture.free_pick;
  if (!free) return null;

  const name = pickName(free.headline_pick, fixture.home_team.name, fixture.away_team.name);

  // A visual lean derived only from the band, never from real probabilities —
  // those are not in this payload at all (§9.2 [HARD]).
  const lean =
    free.confidence_band === 'High' ? 0.68 : free.confidence_band === 'Medium' ? 0.55 : 0.44;
  const rest = (1 - lean) / 2;
  const isHome = free.headline_pick === 'home';
  const isDraw = free.headline_pick === 'draw';

  return (
    <View style={{ gap: space.sm }}>
      <ProbabilityBar
        pHome={isHome ? lean : isDraw ? rest : rest}
        pDraw={isDraw ? lean : rest}
        pAway={!isHome && !isDraw ? lean : rest}
        homeLabel={fixture.home_team.short_name}
        awayLabel={fixture.away_team.short_name}
        height={6}
      />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Text style={[type.micro, { color: colors.accent }]}>MODEL</Text>
        <Text style={[type.callout, { color: colors.textPrimary, flexShrink: 1 }]} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[type.caption, { color: colors.textTertiary }]}>
          · {free.confidence_band.toLowerCase()} confidence
        </Text>
      </View>
    </View>
  );
}

function pickName(pick: 'home' | 'draw' | 'away', home: string, away: string): string {
  if (pick === 'home') return home;
  if (pick === 'away') return away;
  return 'Draw';
}

export const FixtureRow = memo(FixtureRowImpl);

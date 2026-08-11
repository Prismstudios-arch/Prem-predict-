/**
 * One fixture in the gameweek list (CLAUDE.md §6.1).
 *
 * §7.5 [HARD] drives the layout more than aesthetics do. At default type this
 * is a dense single row — team marks, names, a probability bar. Past
 * STACK_LAYOUT_THRESHOLD (roughly AX2) that arrangement stops fitting, so the
 * row restacks vertically rather than truncating club names to "Wolverhampt…".
 * Scaling glyphs without reflowing the container is the standard React Native
 * accessibility failure, and it is the one AX5 testing always catches.
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
  const { colors, shouldStack } = useTheme();
  const type = useType();
  const scaled = useScaled();

  const { home_team: home, away_team: away, prediction } = fixture;
  const markSize = scaled(28);

  const accessibilityLabel = [
    `${home.name} versus ${away.name}`,
    formatKickoff(fixture.kickoff_utc),
    prediction
      ? `Model: ${home.name} ${Math.round(prediction.p_home * 100)} percent, ` +
        `draw ${Math.round(prediction.p_draw * 100)} percent, ` +
        `${away.name} ${Math.round(prediction.p_away * 100)} percent. ` +
        `${prediction.confidence_band} confidence, ${prediction.confidence_reason}`
      : 'No model prediction yet',
  ].join('. ');

  return (
    <Pressable
      onPress={() => onPress(fixture.id)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Opens the full model breakdown"
      style={({ pressed }) => ({
        minHeight: Math.max(MIN_TOUCH_TARGET, scaled(64)),
        paddingVertical: space.md,
        paddingHorizontal: space.lg,
        backgroundColor: pressed ? colors.surfaceRaised : colors.surface,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        gap: space.md,
      })}
    >
      <View
        style={{
          flexDirection: shouldStack ? 'column' : 'row',
          alignItems: shouldStack ? 'flex-start' : 'center',
          gap: shouldStack ? space.sm : space.md,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
          <TeamMark team={home} size={markSize} />
          <Text
            allowFontScaling={false}
            numberOfLines={shouldStack ? 2 : 1}
            style={[type.callout, { color: colors.textPrimary, flexShrink: 1 }]}
          >
            {home.name}
          </Text>
        </View>

        <Text
          allowFontScaling={false}
          style={[type.micro, { color: colors.textTertiary }]}
        >
          {shouldStack ? 'v' : 'v'}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 }}>
          <TeamMark team={away} size={markSize} />
          <Text
            allowFontScaling={false}
            numberOfLines={shouldStack ? 2 : 1}
            style={[type.callout, { color: colors.textPrimary, flexShrink: 1 }]}
          >
            {away.name}
          </Text>
        </View>

        <Text
          allowFontScaling={false}
          style={[type.micro, tabularNumbers, { color: colors.textTertiary }]}
        >
          {formatKickoff(fixture.kickoff_utc)}
        </Text>
      </View>

      {prediction ? (
        <ProbabilityBar
          pHome={prediction.p_home}
          pDraw={prediction.p_draw}
          pAway={prediction.p_away}
          homeLabel={home.short_name}
          awayLabel={away.short_name}
          height={scaled(8)}
        />
      ) : (
        fixture.free_pick && <FreePickRow fixture={fixture} />
      )}
    </Pressable>
  );
}

/**
 * The free tier (§8.1): the model's pick and how sure it is, with no
 * probabilities behind it.
 *
 * This is not a degraded state to apologise for — §8.1 is explicit that free
 * users get enough to play every week. So it states the pick plainly and notes
 * that the split is available, rather than showing a locked padlock where the
 * content should be. §8.3 calls for a *contextual* soft paywall: the nudge
 * belongs on the match detail screen where the real data would appear, not
 * nagging from every row of the list.
 */
function FreePickRow({ fixture }: { fixture: Fixture }) {
  const { colors } = useTheme();
  const type = useType();
  const pick = fixture.free_pick;
  if (!pick) return null;

  const label =
    pick.headline_pick === 'home'
      ? fixture.home_team.name
      : pick.headline_pick === 'away'
        ? fixture.away_team.name
        : 'Draw';

  return (
    <View
      accessible
      accessibilityLabel={
        `Model leans ${label}. ${pick.confidence_band} confidence, ${pick.confidence_reason}.`
      }
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
    >
      <Text style={[type.micro, { color: colors.accent }]}>MODEL</Text>
      <Text style={[type.callout, { color: colors.textPrimary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[type.caption, { color: colors.textTertiary, flexShrink: 1 }]}>
        · {pick.confidence_band.toLowerCase()} confidence
      </Text>
    </View>
  );
}

export const FixtureRow = memo(FixtureRowImpl);

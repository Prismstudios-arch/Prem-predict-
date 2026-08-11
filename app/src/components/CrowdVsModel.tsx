/**
 * Crowd vs model — the weekly talking point.
 *
 * Two stacked bars, same scale, one above the other. That comparison is the
 * entire point, so they share an axis and sit adjacent; anything fancier makes
 * the gap harder to read, not easier.
 *
 * §5.6 applies to every string here. The model "said 43%", it never "knew".
 * Nothing claims a winner before the match has finished.
 *
 * §7.5 [HARD]: the whole card carries one VoiceOver label reading the
 * comparison as a sentence, because hearing six percentages in sequence
 * conveys nothing about which is bigger.
 */

import {
  crowdShare,
  crowdConviction,
  modelShare,
  outcomeLabel,
  talkingPointHeadline,
  talkingPointOutcome,
  type CrowdVsModel as CrowdRow,
} from '@/core/crowd';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';

import { ProbabilityBar } from './ProbabilityBar';
import { radius, space, tabularNumbers, useTheme, useType } from '@/theme';

type Props = {
  row: CrowdRow;
  /** Compact form for the gameweek list; full form on match detail. */
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function CrowdVsModelCard({ row, compact = false, style }: Props) {
  const { colors } = useTheme();
  const type = useType();

  const headline = talkingPointHeadline(row);
  const resolution = talkingPointOutcome(row);
  const conviction = crowdConviction(row);

  const accessibilityLabel = [
    `${row.home_name} versus ${row.away_name}.`,
    headline,
    resolution ?? 'Not finished yet.',
    `Based on ${row.n_predictions} predictions.`,
  ].join(' ');

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      style={[
        {
          padding: space.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          gap: space.md,
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[type.micro, { color: colors.accent }]}>CROWD v MODEL</Text>
        <Text style={[type.micro, tabularNumbers, { color: colors.textTertiary }]}>
          {row.n_predictions} PREDICTIONS
        </Text>
      </View>

      <Text style={[type.heading, { color: colors.textPrimary }]}>
        {row.home_short} v {row.away_short}
      </Text>

      <Text style={[type.body, { color: colors.textPrimary }]}>{headline}</Text>

      {!compact && (
        <View
          style={{ gap: space.md }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <LabelledBar
            label="Players"
            pHome={row.crowd_home}
            pDraw={row.crowd_draw}
            pAway={row.crowd_away}
            homeShort={row.home_short}
            awayShort={row.away_short}
          />
          <LabelledBar
            label="Model"
            pHome={row.model_home}
            pDraw={row.model_draw}
            pAway={row.model_away}
            homeShort={row.home_short}
            awayShort={row.away_short}
          />
        </View>
      )}

      {resolution && (
        <Text style={[type.callout, { color: colors.textSecondary }]}>{resolution}</Text>
      )}

      {!compact && (
        <Text style={[type.caption, { color: colors.textTertiary }]}>
          {conviction === 'convinced'
            ? 'The players were near-unanimous.'
            : conviction === 'leaning'
              ? 'The players leaned one way.'
              : 'The players were split.'}
          {'  ·  '}
          {Math.round(row.disagreement * 100)}% apart
        </Text>
      )}
    </View>
  );
}

function LabelledBar({
  label,
  pHome,
  pDraw,
  pAway,
  homeShort,
  awayShort,
}: {
  label: string;
  pHome: number;
  pDraw: number;
  pAway: number;
  homeShort: string;
  awayShort: string;
}) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ gap: space.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[type.micro, { color: colors.textTertiary }]}>
          {label.toUpperCase()}
        </Text>
        <Text style={[type.micro, tabularNumbers, { color: colors.textSecondary }]}>
          {Math.round(pHome * 100)} · {Math.round(pDraw * 100)} · {Math.round(pAway * 100)}
        </Text>
      </View>
      <ProbabilityBar
        pHome={pHome}
        pDraw={pDraw}
        pAway={pAway}
        homeLabel={homeShort}
        awayLabel={awayShort}
        height={10}
      />
    </View>
  );
}

/**
 * Shown before kickoff. The absence of crowd data is deliberate and worth
 * explaining — otherwise it reads as a bug or a slow load.
 */
export function CrowdLockedNotice() {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      style={{
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.border,
        gap: space.xxs,
      }}
    >
      <Text style={[type.micro, { color: colors.textTertiary }]}>CROWD v MODEL</Text>
      <Text style={[type.caption, { color: colors.textSecondary }]}>
        Unlocks at kick-off. Everyone predicts blind — no following the crowd.
      </Text>
    </View>
  );
}

/** Used where the sample is below the privacy floor. */
export function CrowdTooSmallNotice({ needed }: { needed: number }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      style={{
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.border,
        gap: space.xxs,
      }}
    >
      <Text style={[type.micro, { color: colors.textTertiary }]}>CROWD v MODEL</Text>
      <Text style={[type.caption, { color: colors.textSecondary }]}>
        Needs at least {needed} predictions before we show a split.
      </Text>
    </View>
  );
}

export function outcomeSummary(row: CrowdRow): string {
  return `${outcomeLabel(row.crowd_pick, row.home_short, row.away_short)} (${Math.round(
    crowdShare(row, row.crowd_pick) * 100,
  )}%) vs model ${Math.round(modelShare(row, row.crowd_pick) * 100)}%`;
}

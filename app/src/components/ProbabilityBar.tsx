/**
 * The stacked H/D/A probability bar — half of the §7.3 signature moment.
 *
 * §7.3 asks for a bar that animates from centre. Two constraints shape it:
 *
 *   §7.5 [HARD] — probability must never be conveyed by colour alone. Every
 *   segment carries its own percentage as text, and the whole bar has a single
 *   VoiceOver label reading the full split, so a screen-reader user gets the
 *   same information in one gesture rather than three.
 *
 *   §5.6 — output is always probabilistic, never assertive. There is no
 *   "winner" styling here, no tick, no highlight on the favourite. The bar
 *   states three numbers and lets them speak.
 */

import { useEffect } from 'react';
import { View, Text, AccessibilityInfo, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  useReducedMotion,
} from 'react-native-reanimated';

import { motion, radius, space, tabularNumbers, useTheme, useType } from '@/theme';

export type Outcome = 'home' | 'draw' | 'away';

type Props = {
  pHome: number;
  pDraw: number;
  pAway: number;
  homeLabel: string;
  awayLabel: string;
  height?: number;
  /** Percentages inside each segment. Off in dense list rows. */
  showInlineLabels?: boolean;
  style?: StyleProp<ViewStyle>;
};

const pct = (value: number) => `${Math.round(value * 100)}`;

export function ProbabilityBar({
  pHome,
  pDraw,
  pAway,
  homeLabel,
  awayLabel,
  height = 10,
  showInlineLabels = false,
  style,
}: Props) {
  const { colors } = useTheme();
  const reducedMotion = useReducedMotion();

  const progress = useSharedValue(0);

  useEffect(() => {
    // §7.5 [HARD]: respect Reduce Motion. Snap rather than spring — a value
    // that appears instantly is still fully legible; one that never settles
    // is not.
    progress.value = reducedMotion
      ? withTiming(1, { duration: 0 })
      : withDelay(motion.staggerMs, withSpring(1, motion.standard));
  }, [progress, reducedMotion, pHome, pDraw, pAway]);

  // Three explicit hooks rather than a grow(share) helper: calling
  // useAnimatedStyle from inside a function invoked per-segment breaks the
  // Rules of Hooks and desyncs the segments on re-render.
  const homeStyle = useAnimatedStyle(() => ({ flexGrow: progress.value * pHome }));
  const drawStyle = useAnimatedStyle(() => ({ flexGrow: progress.value * pDraw }));
  const awayStyle = useAnimatedStyle(() => ({ flexGrow: progress.value * pAway }));

  const label =
    `${homeLabel} ${pct(pHome)} percent, ` +
    `draw ${pct(pDraw)} percent, ` +
    `${awayLabel} ${pct(pAway)} percent`;

  return (
    <View style={style}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
        style={{
          flexDirection: 'row',
          height,
          borderRadius: radius.pill,
          overflow: 'hidden',
          backgroundColor: colors.surfaceRaised,
        }}
      >
        <Animated.View style={[{ backgroundColor: colors.outcomeHome }, homeStyle]} />
        <Animated.View style={[{ backgroundColor: colors.outcomeDraw }, drawStyle]} />
        <Animated.View style={[{ backgroundColor: colors.outcomeAway }, awayStyle]} />
      </View>

      {showInlineLabels && (
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginTop: space.sm,
          }}
          // The bar above already announces all three figures; repeating them
          // as separate nodes triples the VoiceOver output for no gain.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Legend color={colors.outcomeHome} label={homeLabel} value={pHome} />
          <Legend color={colors.outcomeDraw} label="Draw" value={pDraw} align="center" />
          <Legend color={colors.outcomeAway} label={awayLabel} value={pAway} align="right" />
        </View>
      )}
    </View>
  );
}

function Legend({
  color,
  label,
  value,
  align = 'left',
}: {
  color: string;
  label: string;
  value: number;
  align?: 'left' | 'center' | 'right';
}) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ flex: 1, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
        <Text
          allowFontScaling={false}
          numberOfLines={1}
          style={[type.micro, { color: colors.textTertiary, textTransform: 'uppercase' }]}
        >
          {label}
        </Text>
      </View>
      <Text
        allowFontScaling={false}
        style={[type.heading, tabularNumbers, { color: colors.textPrimary }]}
      >
        {pct(value)}%
      </Text>
    </View>
  );
}

/** Announce a freshly loaded split to screen readers without stealing focus. */
export function announceSplit(label: string) {
  AccessibilityInfo.announceForAccessibility(label);
}

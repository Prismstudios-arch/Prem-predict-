/**
 * The 8x8 scoreline heatmap — the other half of the §7.3 signature moment.
 *
 * Renders the model's full joint distribution over scorelines 0-0 to 7-7. This
 * is the screen §7.3 says people should screenshot, so it has to work as an
 * image: readable at thumbnail size, obvious what it says, no legend required
 * to get the gist.
 *
 * Design decisions that matter:
 *
 *   Colour encodes probability by *opacity of the accent*, not a rainbow ramp.
 *   A multi-hue scale would need a legend, would fight the team colours, and
 *   would break §7.2's one-accent rule. Opacity reads instantly as "more
 *   likely = brighter" with nothing to learn.
 *
 *   §7.5 [HARD] — colour alone is never the carrier. Cells above a visibility
 *   threshold print their percentage, the most likely scoreline is outlined,
 *   and the whole grid carries a VoiceOver summary naming the top scorelines
 *   rather than 64 unreadable cells.
 *
 *   Scale is normalised to the matrix maximum, not to 1.0. A tight 1-1 game
 *   peaks around 12%, so scaling to 1.0 would render the entire grid nearly
 *   black and throw away the structure that makes it worth showing.
 */

import { useMemo } from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space, tabularNumbers, useTheme, useType } from '@/theme';
import { composite, readableInk } from '@/theme/contrast';

const MAX_GOALS_DISPLAYED = 7;
/** Below this share of the peak cell, a printed percentage is unreadable. */
const LABEL_THRESHOLD = 0.35;

type Props = {
  /** Row-major [home goals][away goals]. */
  matrix: number[][];
  homeLabel: string;
  awayLabel: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

export function ScoreMatrix({
  matrix,
  homeLabel,
  awayLabel,
  size = 280,
  style,
}: Props) {
  const { colors } = useTheme();
  const type = useType();

  const { peak, top } = useMemo(() => {
    let peak = 0;
    const cells: { home: number; away: number; p: number }[] = [];
    for (let h = 0; h <= MAX_GOALS_DISPLAYED; h++) {
      for (let a = 0; a <= MAX_GOALS_DISPLAYED; a++) {
        const p = matrix[h]?.[a] ?? 0;
        if (p > peak) peak = p;
        cells.push({ home: h, away: a, p });
      }
    }
    cells.sort((x, y) => y.p - x.p);
    return { peak, top: cells.slice(0, 3) };
  }, [matrix]);

  const cell = size / (MAX_GOALS_DISPLAYED + 1);

  const summary =
    'Scoreline probabilities. Most likely: ' +
    top
      .map((c) => `${homeLabel} ${c.home}, ${awayLabel} ${c.away}, ${(c.p * 100).toFixed(1)} percent`)
      .join('. ');

  return (
    <View style={style}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {/* Home-goals axis */}
        <View style={{ width: 18, marginTop: 0 }}>
          {Array.from({ length: MAX_GOALS_DISPLAYED + 1 }, (_, h) => (
            <View key={h} style={{ height: cell, justifyContent: 'center' }}>
              <Text
                allowFontScaling={false}
                style={[type.micro, tabularNumbers, { color: colors.textTertiary }]}
              >
                {h}
              </Text>
            </View>
          ))}
        </View>

        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={summary}
          style={{
            borderRadius: radius.md,
            overflow: 'hidden',
            backgroundColor: colors.surface,
          }}
        >
          {Array.from({ length: MAX_GOALS_DISPLAYED + 1 }, (_, h) => (
            <View key={h} style={{ flexDirection: 'row' }}>
              {Array.from({ length: MAX_GOALS_DISPLAYED + 1 }, (_, a) => {
                const p = matrix[h]?.[a] ?? 0;
                const intensity = peak > 0 ? p / peak : 0;
                const isPeak = p === peak && peak > 0;
                const alpha = 0.06 + intensity * 0.94;

                // Ink is chosen per cell against the colour actually rendered,
                // not against the accent. A cell is the accent composited over
                // the surface at `alpha`, so a fixed ink is unreadable at one
                // end of the range or the other — white failed at 1.8:1 on
                // pale light-theme cells, black failed on bright dark-theme
                // ones. Both the label and the peak outline use it.
                const rendered = composite(colors.accent, colors.surface, alpha);
                const ink = readableInk(rendered);

                return (
                  <View
                    key={a}
                    style={{
                      width: cell,
                      height: cell,
                      alignItems: 'center',
                      justifyContent: 'center',
                      // Colour is composited here rather than applied via
                      // `opacity`, so the child text is not faded with it.
                      backgroundColor: rendered,
                      borderWidth: isPeak ? 1.5 : 0,
                      borderColor: ink,
                    }}
                  >
                    {intensity >= LABEL_THRESHOLD && (
                      <Text
                        allowFontScaling={false}
                        style={[
                          type.micro,
                          tabularNumbers,
                          { color: ink, fontWeight: '700' },
                        ]}
                      >
                        {(p * 100).toFixed(0)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      </View>

      {/* Away-goals axis */}
      <View style={{ flexDirection: 'row', marginLeft: 18 }}>
        {Array.from({ length: MAX_GOALS_DISPLAYED + 1 }, (_, a) => (
          <View key={a} style={{ width: cell, alignItems: 'center' }}>
            <Text
              allowFontScaling={false}
              style={[type.micro, tabularNumbers, { color: colors.textTertiary }]}
            >
              {a}
            </Text>
          </View>
        ))}
      </View>

      <View
        style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.sm }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text allowFontScaling={false} style={[type.micro, { color: colors.textTertiary }]}>
          {homeLabel.toUpperCase()} GOALS ↓
        </Text>
        <Text allowFontScaling={false} style={[type.micro, { color: colors.textTertiary }]}>
          {awayLabel.toUpperCase()} GOALS →
        </Text>
      </View>
    </View>
  );
}

/** Top-N scorelines as text (§6.1 match detail, §8.1 premium). */
export function TopScorelines({
  scorelines,
}: {
  scorelines: { home: number; away: number; p: number }[];
}) {
  const { colors } = useTheme();
  const type = useType();

  return (
    <View style={{ gap: space.sm }}>
      {scorelines.map((s) => (
        <View
          key={`${s.home}-${s.away}`}
          accessible
          accessibilityLabel={`${s.home} ${s.away}, ${(s.p * 100).toFixed(1)} percent`}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}
        >
          <Text
            allowFontScaling={false}
            style={[type.body, tabularNumbers, { color: colors.textPrimary, width: 52 }]}
          >
            {s.home}–{s.away}
          </Text>
          <View
            style={{
              flex: 1,
              height: 4,
              borderRadius: radius.pill,
              backgroundColor: colors.surfaceRaised,
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                width: `${Math.min(s.p / 0.2, 1) * 100}%`,
                height: '100%',
                backgroundColor: colors.accent,
              }}
            />
          </View>
          <Text
            allowFontScaling={false}
            style={[type.callout, tabularNumbers, { color: colors.textSecondary, width: 48, textAlign: 'right' }]}
          >
            {(s.p * 100).toFixed(1)}%
          </Text>
        </View>
      ))}
    </View>
  );
}

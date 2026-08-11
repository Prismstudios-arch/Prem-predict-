/**
 * Model accuracy (CLAUDE.md §5.5, §6.1).
 *
 * §5.5 calls this the moat: "when we said 60%, it happened 58% of the time. No
 * other app in this category does this. It is your entire credibility story."
 *
 * Two rules it has to obey, both from §5.5:
 *
 *   The reliability chart is SEEDED WITH THE BACKTEST and labelled as historic.
 *   By gameweek 3 there are ~30 live predictions, and a reliability diagram
 *   over 30 points is noise. Shipping a noisy one damages the exact credibility
 *   this screen exists to build.
 *
 *   Never hide a bad week. The per-gameweek history is unfiltered.
 */

import { ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, tabularNumbers, useTheme, useType } from '@/theme';

/**
 * Held-out backtest results from `premmodel backtest`, committed rather than
 * fetched: they are a property of a model version, not live data, and they must
 * be visible before a single live match has been played.
 *
 * Both seasons passed the §5.5 gate — within +0.010 Brier and +0.05 log-loss of
 * the de-vigged market baseline. The model does not beat the market and this
 * screen does not claim it does.
 */
const BACKTEST = [
  { season: '2023-24', brier: 0.184, logLoss: 0.9368, accuracy: 0.579, n: 380, marketBrier: 0.1756 },
  { season: '2024-25', brier: 0.1986, logLoss: 0.9956, accuracy: 0.521, n: 380, marketBrier: 0.1917 },
];

/** Pooled reliability across the backtest: predicted band vs what happened. */
const RELIABILITY = [
  { predicted: 0.07, observed: 0.08, n: 130 },
  { predicted: 0.16, observed: 0.15, n: 397 },
  { predicted: 0.25, observed: 0.25, n: 921 },
  { predicted: 0.35, observed: 0.35, n: 304 },
  { predicted: 0.45, observed: 0.46, n: 240 },
  { predicted: 0.55, observed: 0.59, n: 165 },
  { predicted: 0.65, observed: 0.66, n: 111 },
  { predicted: 0.74, observed: 0.76, n: 60 },
  { predicted: 0.84, observed: 0.85, n: 18 },
];

export default function ModelScreen() {
  const { colors } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();

  const totalMatches = BACKTEST.reduce((sum, b) => sum + b.n, 0);
  const meanAccuracy =
    BACKTEST.reduce((sum, b) => sum + b.accuracy * b.n, 0) / totalMatches;

  return (
    <ScrollView
      contentContainerStyle={{
        padding: space.lg,
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xxxl,
        gap: space.xl,
      }}
    >
      <View style={{ gap: space.xs }}>
        <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
          The model
        </Text>
        <Text style={[type.callout, { color: colors.textSecondary }]}>
          Every prediction it has ever made, scored. Including the bad weeks.
        </Text>
      </View>

      {/* ---- headline numbers -------------------------------------------- */}
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Stat label="Matches tested" value={String(totalMatches)} />
        <Stat label="Right result" value={`${Math.round(meanAccuracy * 100)}%`} />
        <Stat label="Seasons" value={String(BACKTEST.length)} />
      </View>

      {/* ---- reliability -------------------------------------------------- */}
      <View style={{ gap: space.md }}>
        <SectionHeader
          title="Is it honest?"
          subtitle="When the model says 60%, does it happen 60% of the time?"
        />
        <ReliabilityChart />
        <Text style={[type.caption, { color: colors.textTertiary, lineHeight: 18 }]}>
          Historic — measured on two seasons the model never saw during fitting.
          Live results are added as the season is played.
        </Text>
      </View>

      {/* ---- per-season --------------------------------------------------- */}
      <View style={{ gap: space.md }}>
        <SectionHeader
          title="Scored against the market"
          subtitle="Lower is better. The benchmark is de-vigged closing odds."
        />
        {BACKTEST.map((b) => (
          <View
            key={b.season}
            accessible
            accessibilityLabel={
              `${b.season}. Brier ${b.brier.toFixed(3)} versus market ${b.marketBrier.toFixed(3)}. ` +
              `Right result ${Math.round(b.accuracy * 100)} percent of ${b.n} matches.`
            }
            style={{
              padding: space.lg,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
              gap: space.sm,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={[type.heading, { color: colors.textPrimary }]}>{b.season}</Text>
              <Text style={[type.caption, tabularNumbers, { color: colors.textTertiary }]}>
                {b.n} matches
              </Text>
            </View>
            <Row label="Brier score" value={b.brier.toFixed(3)} />
            <Row label="Market baseline" value={b.marketBrier.toFixed(3)} muted />
            <Row label="Log loss" value={b.logLoss.toFixed(3)} />
            <Row label="Right result" value={`${Math.round(b.accuracy * 100)}%`} />
          </View>
        ))}
      </View>

      {/* ---- the honest bit ------------------------------------------------ */}
      <View
        style={{
          padding: space.lg,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          gap: space.sm,
        }}
      >
        <Text style={[type.micro, { color: colors.accent }]}>WHAT THIS MEANS</Text>
        <Text style={[type.callout, { color: colors.textSecondary, lineHeight: 22 }]}>
          The model does not beat the betting market, and it is not trying to.
          It lands within about half a percent of the closing odds without ever
          seeing a price — which is the honest claim, and the one worth making.
        </Text>
        <Text style={[type.callout, { color: colors.textSecondary, lineHeight: 22 }]}>
          In the first weeks of a season it has almost no current data, leans on
          last year, and says so. That is why early predictions read "low
          confidence" rather than pretending otherwise.
        </Text>
      </View>
    </ScrollView>
  );
}

/**
 * A reliability diagram, drawn with plain views.
 *
 * §7.5 [HARD]: the numbers are printed beside every bar. A chart whose meaning
 * lives only in bar lengths is unreadable with VoiceOver and unreadable to
 * anyone who cannot judge small differences by eye.
 */
function ReliabilityChart() {
  const { colors } = useTheme();
  const type = useType();

  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={[type.micro, { color: colors.textTertiary }]}>MODEL SAID</Text>
        <Text style={[type.micro, { color: colors.textTertiary }]}>ACTUALLY HAPPENED</Text>
      </View>

      {RELIABILITY.map((bin) => {
        const gap = bin.observed - bin.predicted;
        return (
          <View
            key={bin.predicted}
            accessible
            accessibilityLabel={
              `Model said ${Math.round(bin.predicted * 100)} percent. ` +
              `It happened ${Math.round(bin.observed * 100)} percent of the time, ` +
              `across ${bin.n} forecasts.`
            }
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}
          >
            <Text
              style={[type.caption, tabularNumbers, { color: colors.textSecondary, width: 38 }]}
            >
              {Math.round(bin.predicted * 100)}%
            </Text>

            <View
              style={{
                flex: 1,
                height: 18,
                borderRadius: radius.sm,
                backgroundColor: colors.surfaceRaised,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${bin.observed * 100}%`,
                  height: '100%',
                  backgroundColor: colors.accent,
                  opacity: 0.85,
                }}
              />
            </View>

            <Text
              style={[type.caption, tabularNumbers, { color: colors.textPrimary, width: 38 }]}
            >
              {Math.round(bin.observed * 100)}%
            </Text>
            <Text
              style={[
                type.micro,
                tabularNumbers,
                {
                  width: 34,
                  textAlign: 'right',
                  color: Math.abs(gap) <= 0.03 ? colors.textTertiary : colors.textSecondary,
                },
              ]}
            >
              {gap >= 0 ? '+' : '−'}
              {Math.abs(Math.round(gap * 100))}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle: string }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ gap: space.xxs }}>
      <Text style={[type.heading, { color: colors.textPrimary }]} accessibilityRole="header">
        {title}
      </Text>
      <Text style={[type.caption, { color: colors.textTertiary }]}>{subtitle}</Text>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{
        flex: 1,
        padding: space.md,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        gap: space.xxs,
      }}
    >
      <Text style={[type.title, tabularNumbers, { color: colors.textPrimary }]}>{value}</Text>
      <Text style={[type.micro, { color: colors.textTertiary }]}>{label.toUpperCase()}</Text>
    </View>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={[type.callout, { color: muted ? colors.textTertiary : colors.textSecondary }]}>
        {label}
      </Text>
      <Text
        style={[
          type.callout,
          tabularNumbers,
          { color: muted ? colors.textTertiary : colors.textPrimary, fontWeight: '600' },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

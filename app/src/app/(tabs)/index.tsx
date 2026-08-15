/**
 * The gameweek screen — the home screen (CLAUDE.md §6.1).
 *
 * §10 requires designed loading, error and empty states, never a blank screen
 * or a raw error string. All three are here rather than deferred to Phase 4,
 * because retrofitting states onto a screen built happy-path-first means
 * rewriting its layout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  SectionList,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FixtureRow } from '@/components/FixtureRow';
import { usePredictionStore } from '@/core/predictionStore';
import {
  isMisconfigured,
  isUsingSampleData,
  loadGameweek,
  type Fixture,
  type Gameweek,
} from '@/data/repository';
import { groupByDay } from '@/data/schedule';
import { radius, space, tabularNumbers, useTheme, useType } from '@/theme';

/** Stable identity, so the sections memo does not recompute on every render. */
const EMPTY: Fixture[] = [];

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: Gameweek };

export default function GameweekScreen() {
  const { colors } = useTheme();
  const type = useType();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [state, setState] = useState<State>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const loadPicks = usePredictionStore((s) => s.load);
  const picks = usePredictionStore((s) => s.picks);

  const submitted =
    state.status === 'ready'
      ? state.data.fixtures.filter((f) => picks[f.id]).length
      : 0;

  // Above the early returns: hooks cannot be called conditionally, and the
  // loading and error branches below both return before this point in the JSX.
  const fixtures = state.status === 'ready' ? state.data.fixtures : EMPTY;
  const sections = useMemo(() => groupByDay(fixtures), [fixtures]);

  const load = useCallback(async () => {
    try {
      const data = await loadGameweek(1);
      setState({ status: 'ready', data });
      // Load the user's existing picks so the header count and the pager both
      // reflect what has actually been submitted, not a fresh start each launch.
      await loadPicks(data.fixtures.map((f) => f.id));
    } catch (error) {
      // §10: never surface a raw error string. Log the detail, show a human one.
      console.error('loadGameweek failed', error);
      setState({
        status: 'error',
        message: "Couldn't load this gameweek.",
      });
    }
    // loadPicks is a Zustand action, so its identity is stable for the life of
    // the store — listing it satisfies the linter without re-creating `load`.
  }, [loadPicks]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openMatch = useCallback(
    (id: string) => router.push(`/match/${id}`),
    [router],
  );

  if (state.status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          padding: space.xl,
          gap: space.lg,
        }}
      >
        <Text style={[type.heading, { color: colors.textPrimary, textAlign: 'center' }]}>
          {state.message}
        </Text>
        <Text style={[type.callout, { color: colors.textSecondary, textAlign: 'center' }]}>
          Check your connection and try again.
        </Text>
        <Pressable
          onPress={() => void load()}
          accessibilityRole="button"
          accessibilityLabel="Try again"
          style={{
            minHeight: 44,
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

  const { data } = state;

  return (
    <SectionList
      sections={sections}
      keyExtractor={(f) => f.id}
      renderItem={({ item }) => <FixtureRow fixture={item} onPress={openMatch} />}
      renderSectionHeader={({ section }) => <DayHeader title={section.title} />}
      // Days are a grouping, not a sticky navigation aid; pinning them steals
      // vertical space on a screen that is already dense.
      stickySectionHeadersEnabled={false}
      contentContainerStyle={{
        padding: space.lg,
        // The tab group hides the native header, so the screen owns its own
        // top inset rather than sliding under the status bar.
        paddingTop: insets.top + space.lg,
        paddingBottom: insets.bottom + space.xxl,
        gap: space.md,
      }}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.md }}>
          <View style={{ gap: space.xs }}>
            <Text
              style={[type.display, { color: colors.textPrimary }]}
              accessibilityRole="header"
            >
              Gameweek {data.gameweek}
            </Text>
            <Text style={[type.callout, tabularNumbers, { color: colors.textSecondary }]}>
              {data.fixtures.length} matches · {submitted} predicted
            </Text>
          </View>

          <WhatDoYouReckon predicted={submitted} total={data.fixtures.length} />

          {/* The entry point to the §6.1 prediction flow. Without this the
              pager existed as a route nothing could reach, and predicting
              meant visiting ten separate detail screens. */}
          <Pressable
            onPress={() => router.push('/predict')}
            accessibilityRole="button"
            accessibilityLabel={
              submitted === 0
                ? `Make your predictions for all ${data.fixtures.length} matches`
                : `Continue your predictions. ${submitted} of ${data.fixtures.length} done`
            }
            style={({ pressed }) => ({
              minHeight: 48,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: pressed ? colors.textPrimary : colors.accent,
            })}
          >
            <Text style={[type.body, { fontWeight: '700', color: colors.accentInk }]}>
              {submitted === 0
                ? 'Make your predictions'
                : submitted === data.fixtures.length
                  ? 'Review your predictions'
                  : `Continue — ${submitted}/${data.fixtures.length}`}
            </Text>
          </Pressable>

          {isMisconfigured() ? (
            <MisconfiguredNotice />
          ) : (
            isUsingSampleData() && <SampleDataNotice />
          )}
          {(data.fixtures[0]?.prediction?.data_regime === 'prior_heavy' ||
            data.fixtures[0]?.free_pick?.data_regime === 'prior_heavy') && (
            <EarlySeasonNotice />
          )}
        </View>
      }
      ListEmptyComponent={
        <View style={{ alignItems: 'center', padding: space.xxl, gap: space.sm }}>
          <Text style={[type.heading, { color: colors.textPrimary }]}>
            No fixtures yet
          </Text>
          <Text style={[type.callout, { color: colors.textSecondary, textAlign: 'center' }]}>
            The next gameweek opens on Tuesday.
          </Text>
        </View>
      }
    />
  );
}

function DayHeader({ title }: { title: string }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingTop: space.lg,
        paddingBottom: space.xs,
      }}
      accessibilityRole="header"
    >
      <Text style={[type.micro, { color: colors.textTertiary, letterSpacing: 1 }]}>{title}</Text>
      <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
    </View>
  );
}

/**
 * The line the whole product is named after.
 *
 * "Reckon" only means anything to someone who has heard the question, and
 * "what do you reckon?" is the exact sentence this app replaces — the one
 * shouted across a pub before kick-off. It earns its place at the top of the
 * home screen because it explains the app faster than any feature list, and it
 * changes as the week progresses so it never becomes furniture people stop
 * seeing.
 */
function WhatDoYouReckon({ predicted, total }: { predicted: number; total: number }) {
  const { colors } = useTheme();
  const type = useType();

  const line =
    predicted === 0
      ? 'The model has called all ten. What do you reckon?'
      : predicted < total
        ? `${total - predicted} to go. What do you reckon?`
        : "All ten in. Now we find out who's right.";

  return (
    <Text
      accessibilityRole="text"
      style={[type.body, { color: colors.accent, fontWeight: '700' }]}
    >
      {line}
    </Text>
  );
}

/**
 * §5.4 / §5.6: state the uncertainty prominently rather than letting the
 * probabilities imply a precision the model does not have in August.
 */
function EarlySeasonNotice() {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      accessible
      accessibilityLabel="Early season. Limited current-season data, so confidence is low and the model leans on last season."
      style={{
        marginTop: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        gap: space.xxs,
      }}
    >
      <Text style={[type.micro, { color: colors.accent }]}>EARLY SEASON</Text>
      <Text style={[type.caption, { color: colors.textSecondary }]}>
        Limited current-season data. These probabilities lean on last season and
        carry wide uncertainty.
      </Text>
    </View>
  );
}

/**
 * A shipped build with no backend. Loud on purpose: the failure mode it
 * replaces was silent, and a tester would have reported "looks fine" while
 * every fixture on screen was bundled sample data.
 */
function MisconfiguredNotice() {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      accessible
      accessibilityLabel="This build is misconfigured and is not connected to live data."
      style={{
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.negative,
        gap: space.xxs,
      }}
    >
      <Text style={[type.micro, { color: colors.negative }]}>NOT CONNECTED</Text>
      <Text style={[type.caption, { color: colors.textSecondary }]}>
        This build has no backend configured, so these fixtures are sample data.
        Set EXPO_PUBLIC_SUPABASE_URL in eas.json and rebuild.
      </Text>
    </View>
  );
}

function SampleDataNotice() {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      style={{
        marginTop: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: colors.border,
        gap: space.xxs,
      }}
    >
      <Text style={[type.micro, { color: colors.textTertiary }]}>DEV BUILD</Text>
      <Text style={[type.caption, { color: colors.textTertiary }]}>
        Real model output from a local export. Set EXPO_PUBLIC_SUPABASE_URL to
        read live data.
      </Text>
    </View>
  );
}

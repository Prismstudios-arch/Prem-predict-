/**
 * The gameweek screen — the home screen (CLAUDE.md §6.1).
 *
 * §10 requires designed loading, error and empty states, never a blank screen
 * or a raw error string. All three are here rather than deferred to Phase 4,
 * because retrofitting states onto a screen built happy-path-first means
 * rewriting its layout.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
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
  type Gameweek,
} from '@/data/repository';
import { radius, space, tabularNumbers, useTheme, useType } from '@/theme';

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
  }, []);

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
    <FlatList
      data={data.fixtures}
      keyExtractor={(f) => f.id}
      renderItem={({ item }) => <FixtureRow fixture={item} onPress={openMatch} />}
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

import { Component, useEffect, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { bootstrap } from '@/core/bootstrap';
import { radius, space, ThemeProvider, useTheme, useType } from '@/theme';

/**
 * Set once onboarding has been completed. In SecureStore rather than
 * AsyncStorage only because §9.1 already routes everything through it — this
 * flag is not a credential.
 */
const ONBOARDED_KEY = 'reckon.onboarded';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ErrorBoundary>
          <AppShell />
        </ErrorBoundary>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      // Native services: RevenueCat, Sentry, PostHog, push, session.
      // Individually guarded — none of them can stop the app opening.
      await bootstrap();

      /**
       * §6.1 onboarding, shown once. It existed as a route but nothing ever
       * navigated to it, so no user had seen it: no club pick, and no soft ask
       * for notifications with a reason attached.
       *
       * A failed read falls through to "already onboarded" rather than showing
       * onboarding again — repeating it is the more annoying failure.
       */
      try {
        const seen = await SecureStore.getItemAsync(ONBOARDED_KEY);
        if (!seen) router.replace('/onboarding');
      } catch {
        // ignore
      }
      setReady(true);
    })();
  }, [router]);

  return <ThemedStack ready={ready} />;
}

export async function markOnboarded(): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDED_KEY, '1').catch(() => undefined);
}

function ThemedStack({ ready }: { ready: boolean }) {
  const { colors, isDark } = useTheme();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.base },
          headerTintColor: colors.textPrimary,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.base },
          // Until bootstrap resolves, suppress the transition so the first
          // frame is not the gameweek screen sliding away to onboarding.
          animation: ready ? 'default' : 'none',
        }}
      >
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="match/[id]" options={{ title: 'Match' }} />
        <Stack.Screen
          name="predict"
          options={{ title: 'Your predictions', presentation: 'modal' }}
        />
        <Stack.Screen
          name="paywall"
          options={{
            title: 'Premium',
            // §8.3: dismissible. A paywall you cannot back out of is hostile
            // and a rejection risk.
            presentation: 'modal',
          }}
        />
      </Stack>
    </>
  );
}

/**
 * §10: "every screen has a designed failure state. Never a raw error string."
 *
 * Without this, an unexpected render error shows the red screen in development
 * and a silent white screen in production — the single worst outcome for a
 * TestFlight tester, because there is nothing to report.
 */
type BoundaryProps = { children: ReactNode };
type BoundaryState = { error: Error | null };

class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('unhandled render error', error);
  }

  override render() {
    if (this.state.error) {
      return <CrashScreen error={this.state.error} onReset={() => this.setState({ error: null })} />;
    }
    return this.props.children;
  }
}

function CrashScreen({ error, onReset }: { error: Error; onReset: () => void }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.base,
        alignItems: 'center',
        justifyContent: 'center',
        padding: space.xl,
        gap: space.lg,
      }}
    >
      <Text style={[type.title, { color: colors.textPrimary, textAlign: 'center' }]}>
        Something broke
      </Text>
      <Text style={[type.callout, { color: colors.textSecondary, textAlign: 'center' }]}>
        That is our fault, not yours. Try again — your predictions are saved on
        the server.
      </Text>
      <Pressable
        onPress={onReset}
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
        <Text style={[type.body, { fontWeight: '700', color: colors.accentInk }]}>
          Try again
        </Text>
      </Pressable>
      {__DEV__ && (
        <Text style={[type.caption, { color: colors.textTertiary, textAlign: 'center' }]}>
          {error.message}
        </Text>
      )}
    </View>
  );
}

export const unstable_settings = { initialRouteName: '(tabs)' };

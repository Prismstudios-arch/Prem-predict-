import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { hasBackend } from '@/api/client';
import { ensureSession } from '@/core/auth';
import { ThemeProvider, useTheme } from '@/theme';

export default function RootLayout() {
  /**
   * §6.1: "No forced signup; anonymous device account." The session is created
   * on first launch so a user can predict immediately — a signup wall is one of
   * the two things that kills a prediction game before it has any players.
   *
   * Deliberately non-fatal. If anonymous sign-in is disabled in the Supabase
   * dashboard, or the device is offline, the app must still render the gameweek
   * from cache rather than showing a blank screen (§10). Only the features that
   * genuinely need an account degrade.
   */
  useEffect(() => {
    if (!hasBackend()) return;
    void ensureSession().catch((error) => {
      console.warn(
        'anonymous session unavailable; predictions can be viewed but not submitted.',
        error,
      );
    });
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <ThemedStack />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function ThemedStack() {
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
        }}
      >
        <Stack.Screen
          name="onboarding"
          options={{ headerShown: false, gestureEnabled: false }}
        />
        {/* The tab group owns its own headers. */}
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="match/[id]"
          options={{ title: 'Match', presentation: 'card' }}
        />
        <Stack.Screen
          name="paywall"
          options={{
            title: 'Premium',
            // §8.3: contextual, dismissible. A paywall the user cannot back
            // out of is both hostile and a rejection risk.
            presentation: 'modal',
          }}
        />
      </Stack>
    </>
  );
}

export const unstable_settings = { initialRouteName: '(tabs)' };

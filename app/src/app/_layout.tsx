import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, palette, useTheme } from '@/theme';

export default function RootLayout() {
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
        <Stack.Screen name="index" options={{ title: 'Gameweek' }} />
        <Stack.Screen
          name="match/[id]"
          options={{ title: 'Match', presentation: 'card' }}
        />
        <Stack.Screen name="results" options={{ title: 'Results' }} />
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

export const unstable_settings = { initialRouteName: 'index' };

export { palette };

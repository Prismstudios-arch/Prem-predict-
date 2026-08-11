/**
 * Tab navigation.
 *
 * §6.1 lists six things the MVP must contain — gameweek, prediction, match
 * detail, results, model accuracy, settings — and until now four of them had
 * nowhere to live. A single-screen app has no sense of depth: someone opens it,
 * sees one list, and has no reason to believe there is anything else.
 *
 * Four tabs, no more. Everything else is reachable from within them.
 */

import { Tabs } from 'expo-router';

import {
  GameweekIcon,
  ModelIcon,
  ResultsIcon,
  SettingsIcon,
} from '@/components/Icons';
import { useTheme, useType } from '@/theme';

export default function TabLayout() {
  const { colors } = useTheme();
  const type = useType();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
        },
        tabBarLabelStyle: {
          fontSize: Math.max(10, type.micro.fontSize ?? 11),
          fontWeight: '600',
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Gameweek',
          tabBarIcon: ({ color, focused }) => (
            <GameweekIcon color={color} active={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="results"
        options={{
          title: 'Results',
          tabBarIcon: ({ color, focused }) => (
            <ResultsIcon color={color} active={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="model"
        options={{
          title: 'Model',
          tabBarIcon: ({ color, focused }) => (
            <ModelIcon color={color} active={focused} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <SettingsIcon color={color} active={focused} />
          ),
        }}
      />
    </Tabs>
  );
}

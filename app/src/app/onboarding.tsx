/**
 * Onboarding (CLAUDE.md §6.1: four screens maximum).
 *
 *   1. Pick your club
 *   2. How it works
 *   3. Notifications — soft-asked, with a reason
 *   4. Done
 *
 * Two things it deliberately does not do:
 *
 *   No signup. §6.1: "No forced signup; anonymous device account, upgrade to
 *   Sign in with Apple later." A prediction game with a signup wall has no
 *   players, and with no players there is no leaderboard to sign up for.
 *
 *   No paywall. §8.3: never on first launch. It appears after the first
 *   completed gameweek, at peak investment.
 *
 * The notification step is a *soft* ask: a screen explaining why, with the real
 * iOS prompt only fired if the user opts in. iOS grants exactly one system
 * prompt per install — spending it cold, before the user knows what the app
 * does, converts far worse and cannot be undone.
 */

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';

import { TeamMark } from '@/components/TeamMark';
import { TEAM_COLOURS } from '@/data/teamColours';
import {
  MIN_TOUCH_TARGET,
  radius,
  space,
  useTheme,
  useType,
} from '@/theme';

/** Clubs offered at onboarding. Colours come from the shared seed file. */
const SELECTABLE = Object.keys(TEAM_COLOURS).slice(0, 20).sort();

type Step = 'club' | 'how' | 'notifications' | 'done';
const ORDER: Step[] = ['club', 'how', 'notifications', 'done'];

export default function OnboardingScreen() {
  const { colors } = useTheme();
  const type = useType();
  const router = useRouter();

  const [step, setStep] = useState<Step>('club');
  const [club, setClub] = useState<string | null>(null);

  const advance = useCallback(() => {
    const next = ORDER[ORDER.indexOf(step) + 1];
    if (next) setStep(next);
    else router.replace('/');
  }, [step, router]);

  const requestNotifications = useCallback(async () => {
    void Haptics.selectionAsync();
    try {
      await Notifications.requestPermissionsAsync();
    } catch (error) {
      // A declined or failed permission is not an error state — the app works
      // without it and every notification is opt-out in Settings anyway (§8.4).
      console.warn('notification permission request failed', error);
    }
    advance();
  }, [advance]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.base }}>
      <ProgressDots current={ORDER.indexOf(step)} total={ORDER.length} />

      {step === 'club' && (
        <ClubStep selected={club} onSelect={setClub} onContinue={advance} />
      )}
      {step === 'how' && <HowStep onContinue={advance} />}
      {step === 'notifications' && (
        <NotificationsStep onAllow={requestNotifications} onSkip={advance} />
      )}
      {step === 'done' && <DoneStep club={club} onContinue={advance} />}
    </View>
  );
}

function ProgressDots({ current, total }: { current: number; total: number }) {
  const { colors } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`Step ${current + 1} of ${total}`}
      style={{
        flexDirection: 'row',
        gap: space.sm,
        justifyContent: 'center',
        paddingTop: space.xxl,
        paddingBottom: space.lg,
      }}
    >
      {Array.from({ length: total }, (_, i) => (
        <View
          key={i}
          style={{
            width: i === current ? 20 : 6,
            height: 6,
            borderRadius: radius.pill,
            backgroundColor: i <= current ? colors.accent : colors.border,
          }}
        />
      ))}
    </View>
  );
}

function ClubStep({
  selected,
  onSelect,
  onContinue,
}: {
  selected: string | null;
  onSelect: (slug: string) => void;
  onContinue: () => void;
}) {
  const { colors } = useTheme();
  const type = useType();

  return (
    <>
      <View style={{ paddingHorizontal: space.lg, gap: space.xs }}>
        <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
          Who do you follow?
        </Text>
        <Text style={[type.callout, { color: colors.textSecondary }]}>
          We'll put their matches first. You can change this later.
        </Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.sm }}>
        {SELECTABLE.map((slug) => {
          const pair = TEAM_COLOURS[slug]!;
          const isSelected = selected === slug;
          const name = slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
          return (
            <Pressable
              key={slug}
              onPress={() => {
                void Haptics.selectionAsync();
                onSelect(slug);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={name}
              style={{
                minHeight: MIN_TOUCH_TARGET,
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingHorizontal: space.md,
                paddingVertical: space.sm,
                borderRadius: radius.lg,
                borderWidth: isSelected ? 2 : 1,
                borderColor: isSelected ? colors.accent : colors.border,
                backgroundColor: colors.surface,
              }}
            >
              <TeamMark
                team={{
                  slug,
                  name,
                  short_name: name.slice(0, 3).toUpperCase(),
                  primary_color: pair[0],
                  secondary_color: pair[1],
                }}
                size={28}
              />
              <Text style={[type.body, { color: colors.textPrimary }]}>{name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Footer
        label="Continue"
        disabled={!selected}
        onPress={onContinue}
        // Skippable: forcing a club choice to see any fixtures is a wall for
        // neutrals, and §1.3's target user argues about every match, not one.
        secondaryLabel="Skip"
        onSecondary={onContinue}
      />
    </>
  );
}

function HowStep({ onContinue }: { onContinue: () => void }) {
  const { colors } = useTheme();
  const type = useType();

  const points = [
    ['Tuesday', 'The model posts its predictions for all ten matches.'],
    ['Before kick-off', 'You make yours. Scoreline for every match.'],
    ['Weekend', 'Results land. Points are scored as they finish.'],
    ['Monday', 'You find out who was smarter.'],
  ];

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
        <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
          You against the model
        </Text>
        <View style={{ gap: space.lg }}>
          {points.map(([when, what]) => (
            <View key={when} style={{ gap: space.xxs }}>
              <Text style={[type.micro, { color: colors.accent }]}>
                {when!.toUpperCase()}
              </Text>
              <Text style={[type.body, { color: colors.textPrimary }]}>{what}</Text>
            </View>
          ))}
        </View>
        {/* §5.6: probabilistic, never assertive — set that expectation early. */}
        <Text style={[type.caption, { color: colors.textTertiary, lineHeight: 18 }]}>
          The model gives probabilities, not certainties. It publishes its
          accuracy every week, including the bad ones.
        </Text>
      </ScrollView>
      <Footer label="Continue" onPress={onContinue} />
    </>
  );
}

function NotificationsStep({
  onAllow,
  onSkip,
}: {
  onAllow: () => void;
  onSkip: () => void;
}) {
  const { colors } = useTheme();
  const type = useType();

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
          Two a week. That's it.
        </Text>
        <View style={{ gap: space.md }}>
          <Reminder title="Thursday" body="The new gameweek is open." />
          <Reminder title="Friday" body="Two hours until predictions lock." />
          <Reminder title="Monday" body="How you did against the model." />
        </View>
        <Text style={[type.caption, { color: colors.textTertiary }]}>
          You can turn any of these off in Settings.
        </Text>
      </ScrollView>
      <Footer
        label="Turn on reminders"
        onPress={onAllow}
        secondaryLabel="Not now"
        onSecondary={onSkip}
      />
    </>
  );
}

function Reminder({ title, body }: { title: string; body: string }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View
      style={{
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface,
        gap: space.xxs,
      }}
    >
      <Text style={[type.micro, { color: colors.textTertiary }]}>
        {title.toUpperCase()}
      </Text>
      <Text style={[type.callout, { color: colors.textPrimary }]}>{body}</Text>
    </View>
  );
}

function DoneStep({ club, onContinue }: { club: string | null; onContinue: () => void }) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <>
      <View style={{ flex: 1, justifyContent: 'center', padding: space.lg, gap: space.md }}>
        <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
          Gameweek 1 is open
        </Text>
        <Text style={[type.body, { color: colors.textSecondary }]}>
          {club
            ? 'Ten matches waiting. Make your calls.'
            : 'Ten matches waiting. Pick a club any time in Settings.'}
        </Text>
      </View>
      <Footer label="Make my predictions" onPress={onContinue} />
    </>
  );
}

function Footer({
  label,
  onPress,
  disabled = false,
  secondaryLabel,
  onSecondary,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const { colors } = useTheme();
  const type = useType();
  return (
    <View style={{ padding: space.lg, gap: space.sm }}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled }}
        style={{
          minHeight: MIN_TOUCH_TARGET,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          backgroundColor: disabled ? colors.surfaceRaised : colors.accent,
        }}
      >
        <Text
          style={[
            type.body,
            { fontWeight: '700', color: disabled ? colors.textTertiary : colors.accentInk },
          ]}
        >
          {label}
        </Text>
      </Pressable>

      {secondaryLabel && onSecondary && (
        <Pressable
          onPress={onSecondary}
          accessibilityRole="button"
          accessibilityLabel={secondaryLabel}
          style={{
            minHeight: MIN_TOUCH_TARGET,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={[type.callout, { color: colors.textSecondary }]}>
            {secondaryLabel}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

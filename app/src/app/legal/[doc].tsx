/**
 * Terms and Privacy, rendered in the app.
 *
 * These used to be Linking.openURL calls. Sending someone to Safari to read the
 * terms of the subscription they are halfway through buying is a bad moment to
 * leave the app, and it fails completely with no signal on a train — a legal
 * document that needs a network is one you have not really given the user.
 *
 * The text comes from src/content/legal.ts, which also generates the hosted
 * pages, so what is on screen here and what App Store Connect fetches cannot
 * disagree. §9.3 [HARD] still needs the public URLs to exist; this is in
 * addition to them, not instead.
 *
 * §7.5 [HARD]: no fixed heights anywhere, every size goes through useType(), so
 * the whole document reflows at AX5 instead of clipping.
 */

import { ScrollView, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { LEGAL_DOCS, type Block } from '@/content/legal';
import { radius, space, useTheme, useType } from '@/theme';

export default function LegalScreen() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const { colors } = useTheme();
  const type = useType();
  const insets = useSafeAreaInsets();

  const legal = doc === 'privacy' ? LEGAL_DOCS.privacy : LEGAL_DOCS.terms;

  return (
    <>
      <Stack.Screen options={{ title: legal.title, presentation: 'modal' }} />
      <ScrollView
        contentContainerStyle={{
          padding: space.lg,
          paddingBottom: insets.bottom + space.xxxl,
          gap: space.lg,
        }}
      >
        <View style={{ gap: space.xxs }}>
          <Text style={[type.display, { color: colors.textPrimary }]} accessibilityRole="header">
            {legal.title}
          </Text>
          <Text style={[type.caption, { color: colors.textTertiary }]}>
            Reckon · Last updated {legal.updated}
          </Text>
        </View>

        {legal.intro.map((block, i) => (
          <BlockView key={`intro-${i}`} block={block} />
        ))}

        {legal.sections.map((section) => (
          <View key={section.heading} style={{ gap: space.sm }}>
            <Text
              accessibilityRole="header"
              style={[type.heading, { color: colors.textPrimary, marginTop: space.md }]}
            >
              {section.heading}
            </Text>
            {section.blocks.map((block, i) => (
              <BlockView key={`${section.heading}-${i}`} block={block} />
            ))}
          </View>
        ))}
      </ScrollView>
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  const { colors } = useTheme();
  const type = useType();

  if (block.kind === 'p') {
    return (
      <Text style={[type.body, { color: colors.textSecondary, lineHeight: 24 }]}>
        {block.text}
      </Text>
    );
  }

  if (block.kind === 'list') {
    return (
      <View style={{ gap: space.sm }}>
        {block.items.map((item) => (
          // A bullet plus a flexed Text rather than a "• " prefix inside one
          // string: the prefix version hangs the wrapped lines under the bullet.
          <View key={item} style={{ flexDirection: 'row', gap: space.sm }}>
            <Text style={[type.body, { color: colors.accent }]}>—</Text>
            <Text style={[type.body, { color: colors.textSecondary, flex: 1, lineHeight: 24 }]}>
              {item}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  if (block.kind === 'note') {
    return (
      <View
        style={{
          borderLeftWidth: 2,
          borderLeftColor: colors.accent,
          paddingLeft: space.md,
          paddingVertical: space.xs,
        }}
      >
        <Text style={[type.body, { color: colors.textPrimary, lineHeight: 24 }]}>
          {block.text}
        </Text>
      </View>
    );
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.lg,
        overflow: 'hidden',
      }}
    >
      {block.rows.map((row, i) => (
        <View
          key={row.label}
          style={{
            padding: space.md,
            gap: space.xxs,
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: colors.border,
          }}
        >
          <Text style={[type.callout, { color: colors.textPrimary, fontWeight: '600' }]}>
            {row.label}
          </Text>
          <Text style={[type.caption, { color: colors.textTertiary }]}>{row.value}</Text>
        </View>
      ))}
      <View style={{ padding: space.md, borderTopWidth: 1, borderTopColor: colors.border }}>
        <Text style={[type.caption, { color: colors.textTertiary }]}>{block.caption}</Text>
      </View>
    </View>
  );
}

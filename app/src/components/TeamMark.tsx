/**
 * Generated team marks (CLAUDE.md §7.4, enforcing §2 [HARD]).
 *
 * No crests, badges or kit imagery — those are trademarked and their absence
 * is a legal requirement, not a style choice. Instead each club gets a
 * geometric mark chosen deterministically from a hash of its slug and filled
 * in its own colours.
 *
 * Deterministic matters more than it sounds: the same club must produce the
 * same mark on every device, every launch, forever. A random choice at render
 * time would make the app feel broken, and a stored choice would need a
 * migration every time a club is added.
 *
 * The result is more visually coherent than twenty real badges would be —
 * one geometric language, one weight, one scale.
 */

import { memo, useMemo } from 'react';
import { View, Text, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, ClipPath, Path, Rect, G } from 'react-native-svg';

import { useTheme, radius, tabularNumbers } from '@/theme';

export type TeamIdentity = {
  slug: string;
  name: string;
  short_name: string;
  primary_color: string;
  secondary_color: string;
};

const SHAPES = ['solid', 'halves', 'diagonal', 'chevron', 'hoops', 'stripes'] as const;
type Shape = (typeof SHAPES)[number];

/** FNV-1a. Small, stable, and — unlike JS string hashing idioms that rely on
 *  bit shifts overflowing — gives the same answer on every engine. */
function hashSlug(slug: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    hash ^= slug.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function shapeFor(slug: string): Shape {
  const shape = SHAPES[hashSlug(slug) % SHAPES.length];
  // Index is always in range, but TS cannot prove it under
  // noUncheckedIndexedAccess and a silent undefined would render nothing.
  return shape ?? 'solid';
}

/** Relative luminance (WCAG). Decides whether initials sit light or dark. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const toLinear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(parseInt(value.slice(0, 2), 16));
  const g = toLinear(parseInt(value.slice(2, 4), 16));
  const b = toLinear(parseInt(value.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

type Props = {
  team: TeamIdentity;
  size?: number;
  /** Initials are redundant with an adjacent club name; hide them there. */
  showInitials?: boolean;
  style?: StyleProp<ViewStyle>;
};

function TeamMarkImpl({ team, size = 32, showInitials = true, style }: Props) {
  const { colors } = useTheme();
  const shape = useMemo(() => shapeFor(team.slug), [team.slug]);

  const primary = team.primary_color;
  const secondary = team.secondary_color;
  const clipId = `clip-${team.slug}`;

  // Fulham are white on white; Newcastle are near-black on dark. Either way
  // the mark needs a hairline or it dissolves into the surface.
  const needsOutline = luminance(primary) > 0.75 || luminance(primary) < 0.06;

  return (
    <View
      style={[{ width: size, height: size }, style]}
      accessible
      // §7.5: the mark is decorative once the club name is read out. Naming it
      // here stops VoiceOver announcing every club twice per row.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <ClipPath id={clipId}>
            <Circle cx={50} cy={50} r={50} />
          </ClipPath>
        </Defs>
        <G clipPath={`url(#${clipId})`}>
          <Rect x={0} y={0} width={100} height={100} fill={primary} />
          {shape === 'halves' && (
            <Rect x={50} y={0} width={50} height={100} fill={secondary} />
          )}
          {shape === 'diagonal' && (
            <Path d="M100 0 L100 100 L0 100 Z" fill={secondary} />
          )}
          {shape === 'chevron' && (
            <Path d="M50 18 L100 68 L100 100 L50 50 L0 100 L0 68 Z" fill={secondary} />
          )}
          {shape === 'hoops' && (
            <>
              <Rect x={0} y={18} width={100} height={16} fill={secondary} />
              <Rect x={0} y={50} width={100} height={16} fill={secondary} />
              <Rect x={0} y={82} width={100} height={16} fill={secondary} />
            </>
          )}
          {shape === 'stripes' && (
            <>
              <Rect x={18} y={0} width={16} height={100} fill={secondary} />
              <Rect x={50} y={0} width={16} height={100} fill={secondary} />
              <Rect x={82} y={0} width={16} height={100} fill={secondary} />
            </>
          )}
        </G>
        {needsOutline && (
          <Circle
            cx={50}
            cy={50}
            r={49}
            fill="none"
            stroke={colors.border}
            strokeWidth={2}
          />
        )}
      </Svg>

      {showInitials && (
        <View
          style={{
            position: 'absolute',
            inset: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          pointerEvents="none"
        >
          {/*
            A solid plate behind the initials.

            Without it the letters sat directly on the stripes and hoops, and a
            vertical stripe passing through a glyph reads as part of the letter
            — Arsenal's "ARS" looked like "APS", and Newcastle's white text on
            black-and-white stripes vanished entirely. The plate is the same
            near-black as the app surface, so the mark still reads as one object
            rather than a badge with a sticker on it.
          */}
          <View
            style={{
              paddingHorizontal: size * 0.1,
              paddingVertical: size * 0.03,
              borderRadius: size * 0.12,
              backgroundColor: 'rgba(10,11,13,0.82)',
            }}
          >
            <Text
              allowFontScaling={false}
              style={{
                color: '#FFFFFF',
                fontSize: size * 0.32,
                fontWeight: '800',
                letterSpacing: -0.3,
                ...tabularNumbers,
              }}
            >
              {team.short_name}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

export const TeamMark = memo(TeamMarkImpl);

/** Thin colour strip used as a row accent (§7.2). */
export function TeamAccentStrip({ team, height }: { team: TeamIdentity; height: number }) {
  return (
    <View
      style={{
        width: 3,
        height,
        borderRadius: radius.pill,
        backgroundColor: team.primary_color,
      }}
    />
  );
}

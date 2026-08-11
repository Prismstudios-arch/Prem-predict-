/**
 * Design tokens (CLAUDE.md §7.2).
 *
 * Direction is "editorial sports data terminal" — a broadsheet data desk
 * crossed with a trading terminal. Restrained, dense where density earns it.
 *
 * The rules that are easy to break later, stated once here:
 *   - ONE accent. It marks the model's voice and primary actions. Never
 *     decorative. If you are reaching for accent to make something look nicer,
 *     the layout is wrong.
 *   - Team colours are the only other saturation in the app.
 *   - All numerals use tabular figures so they cannot jitter when they update.
 */

export const palette = {
  // Dark first (§7.2). Light mode ships but is designed second.
  base: '#0A0B0D',
  surface: '#141619',
  surfaceRaised: '#1C1F24',
  border: '#25292F',

  textPrimary: '#F2F4F7',
  textSecondary: '#9BA3AE',
  // Lightened from #5F6873, which measured 2.92:1 on surfaceRaised and failed
  // AA large. Tertiary carries the score-matrix axis labels, so it is meaning,
  // not decoration.
  textTertiary: '#767F8B',

  accent: '#C4F000',
  accentInk: '#0A0B0D',

  /**
   * Outcome colours. Deliberately NOT red/green: this is a prediction game,
   * not a P&L screen, and red/green is the visual grammar of betting apps
   * (§2 [HARD] keeps us clear of that category in tone as well as function).
   * It is also the most common confusion pair for colour-blind users.
   *
   * Chosen for LUMINANCE separation, not just hue. The first attempt used a
   * light blue and a pink of near-identical lightness (1.04:1) — distinct in
   * colour, identical in greyscale, so the stacked bar collapsed into one
   * block for anyone with monochromacy or looking at a screenshot. These three
   * step down in lightness so the segments are separable without colour at all.
   */
  outcomeHome: '#C9E8FF',
  outcomeDraw: '#8A94A1',
  outcomeAway: '#B84A75',

  positive: '#7BE8A3',
  negative: '#FF8A7A',
} as const;

export const lightPalette = {
  ...palette,
  base: '#FBFBFC',
  surface: '#FFFFFF',
  surfaceRaised: '#F3F4F6',
  border: '#DFE2E7',
  textPrimary: '#101215',
  textSecondary: '#565E68',
  textTertiary: '#6E7681',
  accent: '#5B7000',
  accentInk: '#FFFFFF',
  // Same luminance-step reasoning as dark. On a pale track all three must sit
  // below a lightness ceiling to stay visible, which compresses the available
  // range — see the note in tests/accessibility.test.ts on why a 3:1 step
  // between all three segments is geometrically impossible here.
  outcomeHome: '#103F6B',
  outcomeDraw: '#69717B',
  outcomeAway: '#C77E9C',
} as const;

/** 4pt base grid (§7.2). */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  pill: 999,
} as const;

/**
 * Type scale. Sizes are the *unscaled* base — everything is multiplied by the
 * user's Dynamic Type factor at render time (see useScaledType). §7.5 is
 * [HARD] and React Native gives none of this for free.
 */
export const type = {
  display: { fontSize: 34, lineHeight: 38, letterSpacing: -0.7, fontWeight: '700' },
  title: { fontSize: 24, lineHeight: 28, letterSpacing: -0.4, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 22, letterSpacing: -0.2, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, letterSpacing: 0, fontWeight: '400' },
  callout: { fontSize: 14, lineHeight: 19, letterSpacing: 0, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, letterSpacing: 0.1, fontWeight: '500' },
  micro: { fontSize: 11, lineHeight: 14, letterSpacing: 0.4, fontWeight: '600' },
} as const;

/** §7.2 [HARD]-adjacent: numbers must not jitter when they update. */
export const tabularNumbers = { fontVariant: ['tabular-nums' as const] };

/**
 * Motion (§7.2): spring physics only. These two configs are the entire
 * vocabulary — reach for a third and the app starts feeling arbitrary.
 */
export const motion = {
  standard: { damping: 18, stiffness: 180, mass: 1 },
  gentle: { damping: 22, stiffness: 120, mass: 1 },
  /** §7.2: probability bars animate in with a staggered 40ms delay. */
  staggerMs: 40,
} as const;

/** §7.5 [HARD]: minimum 44x44pt touch targets. */
export const MIN_TOUCH_TARGET = 44;

/**
 * Widened to `string` deliberately. `typeof palette` infers literal types
 * ("#0A0B0D"), which makes the light palette structurally incompatible with
 * the dark one and blocks swapping them at runtime.
 */
export type Palette = { readonly [K in keyof typeof palette]: string };

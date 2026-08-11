/**
 * WCAG contrast maths (CLAUDE.md §7.5 [HARD]).
 *
 * Pure functions with no React Native imports, so the accessibility test suite
 * can run them in plain Node. That matters: an accessibility rule that can only
 * be checked by a human squinting at a simulator is a rule that silently rots.
 *
 * §7.5 requires that probability information never be carried by colour alone.
 * The components satisfy that with text. What text cannot fix is text that is
 * itself unreadable — so these functions exist to prove, in CI, that every
 * foreground/background pair the app can actually produce clears WCAG AA.
 */

export type Rgb = { r: number; g: number; b: number };

export function hexToRgb(hex: string): Rgb {
  const value = hex.replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(value)) {
    throw new Error(`Not a 6-digit hex colour: ${hex}`);
  }
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** WCAG 2.1 relative luminance. */
export function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const toLinear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Contrast ratio between two colours, 1:1 (identical) to 21:1 (black/white). */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG AA thresholds. Large = 18pt+, or 14pt+ bold. */
export const AA_NORMAL = 4.5;
export const AA_LARGE = 3.0;
/** Non-text UI elements: borders, indicators, chart marks. */
export const AA_NON_TEXT = 3.0;

export function meetsAA(
  foreground: string,
  background: string,
  size: 'normal' | 'large' | 'non-text' = 'normal',
): boolean {
  const threshold =
    size === 'normal' ? AA_NORMAL : size === 'large' ? AA_LARGE : AA_NON_TEXT;
  return contrastRatio(foreground, background) >= threshold;
}

/**
 * Pick whichever of black/white reads better on a given fill.
 *
 * Used for team-mark initials (§7.4). Club colours span Fulham's white and
 * Newcastle's near-black, so a fixed ink colour is unreadable at one end or
 * the other — this is chosen per club rather than guessed once.
 */
export function readableInk(background: string): '#0A0B0D' | '#FFFFFF' {
  return contrastRatio('#0A0B0D', background) >= contrastRatio('#FFFFFF', background)
    ? '#0A0B0D'
    : '#FFFFFF';
}

/**
 * Blend a translucent foreground over an opaque background.
 *
 * The score-matrix heatmap (§7.3) renders cells as the accent at varying
 * opacity, so the colour a user actually sees is a composite. Testing the
 * accent against the surface would measure a colour that never appears on
 * screen; this produces the one that does.
 */
export function composite(foreground: string, background: string, alpha: number): string {
  const fg = hexToRgb(foreground);
  const bg = hexToRgb(background);
  const mix = (f: number, b: number) => Math.round(f * alpha + b * (1 - alpha));
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(fg.r, bg.r))}${toHex(mix(fg.g, bg.g))}${toHex(mix(fg.b, bg.b))}`;
}

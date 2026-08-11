/**
 * Theme access + Dynamic Type (CLAUDE.md §7.5 [HARD]).
 *
 * SwiftUI gives Dynamic Type for free. React Native does not: `fontScale`
 * exists but nothing consumes it automatically, and `allowFontScaling` only
 * scales the glyphs — it does not reflow the layout around them, so a naive
 * implementation clips text at AX5 rather than growing.
 *
 * The approach here:
 *   - `useType()` returns type styles already multiplied by the user's scale.
 *   - `useScale()` exposes the raw factor so components can grow *containers*
 *     alongside the text (a 44pt row at AX5 needs to be taller, not just have
 *     bigger letters overflowing it).
 *   - Scale is capped. iOS AX5 reaches ~3.1x, which turns a fixture row into
 *     a full screen. Capping at 2.2x for dense data views and letting the
 *     layout switch to a stacked arrangement past 1.6x is what actually stays
 *     usable — see FixtureRow.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import {
  useColorScheme,
  useWindowDimensions,
  type TextStyle,
} from 'react-native';

import { lightPalette, palette, type as baseType, type Palette } from './tokens';

export * from './tokens';

const MAX_FONT_SCALE = 2.2;

/** Past this, dense horizontal layouts must restack vertically. */
export const STACK_LAYOUT_THRESHOLD = 1.6;

type ThemeValue = {
  colors: Palette;
  isDark: boolean;
  fontScale: number;
  shouldStack: boolean;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const { fontScale } = useWindowDimensions();

  const value = useMemo<ThemeValue>(() => {
    const capped = Math.min(fontScale, MAX_FONT_SCALE);
    return {
      colors: scheme === 'light' ? lightPalette : palette,
      isDark: scheme !== 'light',
      fontScale: capped,
      shouldStack: capped >= STACK_LAYOUT_THRESHOLD,
    };
  }, [scheme, fontScale]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}

type TypeKey = keyof typeof baseType;

/**
 * Type styles with the user's Dynamic Type factor already applied.
 *
 * Returned styles set `allowFontScaling={false}` at the call site because the
 * scaling is already baked in here — letting RN scale again would compound it.
 */
export function useType(): Record<TypeKey, TextStyle> {
  const { fontScale } = useTheme();
  return useMemo(() => {
    const out = {} as Record<TypeKey, TextStyle>;
    for (const key of Object.keys(baseType) as TypeKey[]) {
      const t = baseType[key];
      out[key] = {
        fontSize: Math.round(t.fontSize * fontScale),
        lineHeight: Math.round(t.lineHeight * fontScale),
        letterSpacing: t.letterSpacing,
        fontWeight: t.fontWeight,
      };
    }
    return out;
  }, [fontScale]);
}

/** Scale a fixed dimension (row heights, mark sizes) with the type factor. */
export function useScaled(): (value: number) => number {
  const { fontScale } = useTheme();
  return (value: number) => Math.round(value * fontScale);
}

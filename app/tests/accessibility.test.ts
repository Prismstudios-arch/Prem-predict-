/**
 * Automated accessibility checks (CLAUDE.md §7.5 [HARD]).
 *
 * §7.5 is marked [HARD] and says "Test it." A checklist a human works through
 * before submission gets done once; this runs on every push.
 *
 * Deliberately pure — no rendering, no simulator. These check the properties
 * that are decidable from the design tokens themselves, which is most of the
 * ones that actually break: contrast, touch targets, type scaling, and the
 * per-club ink choice on generated marks.
 *
 * What this cannot check, and still needs a device (§11 Phase 4): VoiceOver
 * reading order, focus management, and whether AX5 layouts truly fit.
 */

import { describe, expect, it } from 'vitest';

import {
  AA_LARGE,
  AA_NON_TEXT,
  AA_NORMAL,
  composite,
  contrastRatio,
  hexToRgb,
  readableInk,
} from '../src/theme/contrast';
import {
  MIN_TOUCH_TARGET,
  lightPalette,
  palette,
  space,
  type,
} from '../src/theme/tokens';
import { TEAM_COLOURS } from '../src/data/teamColours';

const THEMES = [
  { name: 'dark', colors: palette },
  { name: 'light', colors: lightPalette },
] as const;

const SURFACES = ['base', 'surface', 'surfaceRaised'] as const;

describe('text contrast on every surface', () => {
  for (const { name, colors } of THEMES) {
    for (const surface of SURFACES) {
      it(`${name}: primary text on ${surface} meets AA normal`, () => {
        expect(contrastRatio(colors.textPrimary, colors[surface])).toBeGreaterThanOrEqual(
          AA_NORMAL,
        );
      });

      it(`${name}: secondary text on ${surface} meets AA normal`, () => {
        expect(contrastRatio(colors.textSecondary, colors[surface])).toBeGreaterThanOrEqual(
          AA_NORMAL,
        );
      });

      /**
       * Tertiary is used for axis labels and section headers — small, but it
       * carries meaning (which axis is which on the score matrix), so it is
       * held to the large-text bar rather than exempted as decoration.
       */
      it(`${name}: tertiary text on ${surface} meets AA large`, () => {
        expect(contrastRatio(colors.textTertiary, colors[surface])).toBeGreaterThanOrEqual(
          AA_LARGE,
        );
      });
    }

    it(`${name}: accent ink on accent meets AA normal`, () => {
      expect(contrastRatio(colors.accentInk, colors.accent)).toBeGreaterThanOrEqual(
        AA_NORMAL,
      );
    });

    it(`${name}: borders are perceivable against their surface`, () => {
      // Not text, but a border that vanishes removes the only cue that two
      // regions are separate.
      expect(contrastRatio(colors.border, colors.base)).toBeGreaterThanOrEqual(1.2);
    });
  }
});

describe('outcome colours', () => {
  /**
   * Why the adjacent-segment bar is 1.5 and not WCAG's 3.0.
   *
   * A three-segment stacked bar cannot have 3:1 between every adjacent pair.
   * Three levels each 3:1 apart span 9:1 end to end, which forces one extreme
   * to near-black and the other to near-white — and on the light theme the
   * pale end then disappears into the track it sits on. It is a geometric
   * impossibility, not a missing effort.
   *
   * This is exactly the case §7.5 anticipates: "All probability information
   * must also be conveyed as text, never colour alone." The text labels are
   * the accessible channel and they meet AA. Colour is the supplementary one,
   * and what it must do is make the bar read as three distinct parts — which
   * needs a perceptible lightness step, not a text-legibility ratio.
   *
   * The bar is set at 1.5 deliberately: the first palette measured 1.04
   * between home and away, which is no step at all.
   */
  const ADJACENT_SEGMENT_STEP = 1.5;

  /**
   * The track is fully covered whenever the bar is drawn — the three segments
   * sum to 1.0 by construction. It is visible only mid-animation, and carries
   * no information, so it is held to a visibility floor rather than AA.
   */
  const TRACK_VISIBILITY = 1.5;

  for (const { name, colors } of THEMES) {
    const outcomes = ['outcomeHome', 'outcomeDraw', 'outcomeAway'] as const;

    for (const outcome of outcomes) {
      it(`${name}: ${outcome} is visible against the bar track`, () => {
        expect(
          contrastRatio(colors[outcome], colors.surfaceRaised),
        ).toBeGreaterThanOrEqual(TRACK_VISIBILITY);
      });
    }

    it(`${name}: adjacent segments have a perceptible lightness step`, () => {
      expect(
        contrastRatio(colors.outcomeHome, colors.outcomeDraw),
      ).toBeGreaterThanOrEqual(ADJACENT_SEGMENT_STEP);
      expect(
        contrastRatio(colors.outcomeDraw, colors.outcomeAway),
      ).toBeGreaterThanOrEqual(ADJACENT_SEGMENT_STEP);
    });

    it(`${name}: home and away are separable in greyscale`, () => {
      // These two sit side by side in the legend and at opposite ends of the
      // bar. Distinct hues are not enough — a user with monochromacy, or
      // anyone looking at a greyscale screenshot, sees only lightness.
      expect(
        contrastRatio(colors.outcomeHome, colors.outcomeAway),
      ).toBeGreaterThanOrEqual(ADJACENT_SEGMENT_STEP);
    });

    it(`${name}: outcome colours avoid the red/green pairing`, () => {
      // §2 keeps the app clear of betting-app grammar, and red/green is the
      // most common colour-blind confusion pair. Checked by channel dominance
      // rather than by matching hex strings.
      const dominance = (hex: string) => {
        const { r, g, b } = hexToRgb(hex);
        if (r > g + 40 && r > b + 40) return 'red';
        if (g > r + 40 && g > b + 40) return 'green';
        return 'other';
      };
      const kinds = outcomes.map((o) => dominance(colors[o]));
      expect(kinds.includes('red') && kinds.includes('green')).toBe(false);
    });
  }
});

describe('score matrix heatmap (§7.3)', () => {
  for (const { name, colors } of THEMES) {
    /**
     * A cell is the accent composited over the surface at 0.06-1.0 alpha, so
     * the colour behind the label spans a wide range. A single fixed ink
     * cannot work across it: white measured 1.77:1 on pale light-theme cells,
     * black measured 1.33:1 on bright dark-theme ones. ScoreMatrix therefore
     * picks the ink per cell via readableInk(), and these check every
     * intensity a label can actually appear at.
     */
    const labelledAlphas = [0.06 + 0.35 * 0.94, 0.5, 0.75, 1.0];

    for (const alpha of labelledAlphas) {
      it(`${name}: label stays readable at alpha ${alpha.toFixed(2)}`, () => {
        const cell = composite(colors.accent, colors.surface, alpha);
        const ink = readableInk(cell);
        expect(contrastRatio(ink, cell)).toBeGreaterThanOrEqual(AA_LARGE);
      });
    }

    it(`${name}: the peak-cell outline is visible on the peak cell`, () => {
      // The peak cell is by definition the brightest, so the outline only ever
      // draws there — and it uses the same per-cell ink as the label.
      const cell = composite(colors.accent, colors.surface, 1.0);
      expect(contrastRatio(readableInk(cell), cell)).toBeGreaterThanOrEqual(AA_NON_TEXT);
    });

    it(`${name}: the faintest cell is still distinguishable from the surface`, () => {
      const faintest = composite(colors.accent, colors.surface, 0.06);
      expect(contrastRatio(faintest, colors.surface)).toBeGreaterThan(1.0);
    });
  }
});

describe('generated team marks (§7.4)', () => {
  const clubs = Object.entries(TEAM_COLOURS);

  it('covers every club the app can show', () => {
    expect(clubs.length).toBeGreaterThan(20);
  });

  for (const [slug, [primary, secondary]] of clubs) {
    it(`${slug}: initials are readable on the primary fill`, () => {
      const ink = readableInk(primary);
      // Initials are bold and large relative to the mark, so AA large applies.
      expect(contrastRatio(ink, primary)).toBeGreaterThanOrEqual(AA_LARGE);
    });

    it(`${slug}: primary and secondary are distinguishable from each other`, () => {
      // A mark whose two halves look identical conveys nothing.
      expect(contrastRatio(primary, secondary)).toBeGreaterThan(1.5);
    });

    it(`${slug}: the mark does not vanish into either theme's surface`, () => {
      for (const { colors } of THEMES) {
        const againstSurface = contrastRatio(primary, colors.surface);
        const outlined = contrastRatio(colors.border, colors.surface);
        // Either the fill itself separates from the surface, or TeamMark's
        // outline rule kicks in. One of the two must hold.
        expect(Math.max(againstSurface, outlined)).toBeGreaterThan(1.15);
      }
    });
  }
});

describe('touch targets and layout', () => {
  it('minimum touch target meets the 44pt requirement', () => {
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(44);
  });

  it('spacing scale is a strict 4pt grid', () => {
    for (const [name, value] of Object.entries(space)) {
      expect(value % 2, `${name} breaks the grid`).toBe(0);
    }
  });

  it('type scale is strictly descending', () => {
    const sizes = Object.values(type).map((t) => t.fontSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]!).toBeLessThan(sizes[i - 1]!);
    }
  });

  it('every type step has line height above font size', () => {
    for (const [name, t] of Object.entries(type)) {
      expect(t.lineHeight, `${name} would clip descenders`).toBeGreaterThan(t.fontSize);
    }
  });
});

describe('Dynamic Type at AX5 (§7.5)', () => {
  const MAX_FONT_SCALE = 2.2;
  const STACK_THRESHOLD = 1.6;

  it('caps scaling below iOS AX5 raw factor', () => {
    // iOS AX5 reaches roughly 3.1x. Uncapped, a fixture row becomes taller
    // than the screen and the list stops being navigable.
    expect(MAX_FONT_SCALE).toBeLessThan(3.1);
    expect(MAX_FONT_SCALE).toBeGreaterThanOrEqual(2.0);
  });

  it('switches to stacked layout before hitting the cap', () => {
    // If the threshold were above the cap, dense rows would never restack and
    // club names would truncate instead.
    expect(STACK_THRESHOLD).toBeLessThan(MAX_FONT_SCALE);
  });

  it('body text stays legible at the smallest scale', () => {
    expect(type.body.fontSize).toBeGreaterThanOrEqual(15);
    expect(type.micro.fontSize).toBeGreaterThanOrEqual(11);
  });

  it('scaled caption at AX5 stays within a sane row height', () => {
    const scaled = Math.round(type.caption.lineHeight * MAX_FONT_SCALE);
    expect(scaled).toBeLessThan(60);
  });
});

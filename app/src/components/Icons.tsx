/**
 * Tab and UI icons, drawn rather than imported.
 *
 * §3.1 rules out UI component libraries, and an icon set from a third party
 * would fight §7.1's "editorial data terminal" register anyway — most of them
 * are rounded and friendly, which is the opposite of what this app is.
 *
 * These are built from the same geometry as the app icon: flat strokes, no
 * gradients, one accent. The Gameweek tab is literally the app mark, so the
 * home screen icon and the first tab reinforce each other.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

type IconProps = {
  size?: number;
  color: string;
  /** Filled when the tab is active, outlined when not. */
  active?: boolean;
};

export function GameweekIcon({ size = 24, color, active = false }: IconProps) {
  const o = active ? 1 : 0.9;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={3} y={7} width={4.5} height={13} rx={1} fill={color} opacity={o} />
      <Rect x={9.75} y={14} width={4.5} height={6} rx={1} fill={color} opacity={active ? 0.75 : 0.45} />
      <Rect x={16.5} y={11} width={4.5} height={9} rx={1} fill={color} opacity={active ? 0.9 : 0.6} />
    </Svg>
  );
}

export function ResultsIcon({ size = 24, color, active = false }: IconProps) {
  // Two opposed brackets: you against the model.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M9 5 L4 12 L9 19"
        stroke={color}
        strokeWidth={active ? 2.6 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M15 5 L20 12 L15 19"
        stroke={color}
        strokeWidth={active ? 2.6 : 2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity={0.55}
      />
    </Svg>
  );
}

export function ModelIcon({ size = 24, color, active = false }: IconProps) {
  // A calibration curve — the reliability chart in one stroke.
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M3 20 C 8 20, 9 5, 21 4"
        stroke={color}
        strokeWidth={active ? 2.6 : 2}
        strokeLinecap="round"
        fill="none"
      />
      <Circle cx={3} cy={20} r={1.8} fill={color} />
      <Circle cx={21} cy={4} r={1.8} fill={color} opacity={0.55} />
    </Svg>
  );
}

export function SettingsIcon({ size = 24, color, active = false }: IconProps) {
  // Sliders, not a cog: this app is a control surface, not a machine.
  const w = active ? 2.6 : 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d="M4 7 H20" stroke={color} strokeWidth={w} strokeLinecap="round" />
      <Path d="M4 17 H20" stroke={color} strokeWidth={w} strokeLinecap="round" />
      <Circle cx={9} cy={7} r={3} fill={color} />
      <Circle cx={16} cy={17} r={3} fill={color} opacity={0.6} />
    </Svg>
  );
}

export function LockIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Rect x={4} y={10} width={16} height={11} rx={2.5} fill={color} />
      <Path
        d="M8 10 V7 a4 4 0 0 1 8 0 v3"
        stroke={color}
        strokeWidth={2.2}
        fill="none"
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function ChevronIcon({ size = 18, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        d="M9 5 L16 12 L9 19"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

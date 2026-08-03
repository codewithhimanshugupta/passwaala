import Svg, { Path } from 'react-native-svg';
import { theme } from './theme';

/**
 * ChevronDown — a clean down-chevron icon (thin, round-capped strokes), used as
 * the "tap to change" affordance on the delivery-location row and similar
 * dropdowns. Replaces the old ▾ triangle glyph for a crisper look.
 */
export function ChevronDown({
  size = 18,
  color = theme.color.textMuted,
  strokeWidth = 2.5,
}: {
  size?: number;
  color?: string;
  strokeWidth?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 9l7 7 7-7"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

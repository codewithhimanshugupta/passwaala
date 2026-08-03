import Svg, { Path, Circle } from 'react-native-svg';

/**
 * TabIcon — clean vector icons for the rider bottom tab bar (Home / Jobs /
 * Deliveries / Earnings / Dues / Alerts), replacing the old glyph/emoji chars.
 * Stroke-based, inherits the tab's active/inactive colour via the `color` prop.
 * 24×24 viewbox, round caps.
 */
export type TabName = 'home' | 'jobs' | 'deliveries' | 'earnings' | 'dues' | 'alerts';

export function TabIcon({
  name,
  color,
  size = 24,
  strokeWidth = 2,
}: {
  name: TabName;
  color: string;
  size?: number;
  strokeWidth?: number;
}) {
  const common = {
    stroke: color,
    strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none' as const,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {name === 'home' && (
        <>
          <Path d="M3 10.5 12 3l9 7.5" {...common} />
          <Path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" {...common} />
          <Path d="M9.5 21v-6h5v6" {...common} />
        </>
      )}
      {name === 'jobs' && (
        <>
          <Path d="M8 4h8a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" {...common} />
          <Path d="M9.5 4V3.2a.8.8 0 0 1 .8-.8h3.4a.8.8 0 0 1 .8.8V4" {...common} />
          <Path d="M10 10h4M10 14h4" {...common} />
        </>
      )}
      {name === 'deliveries' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="m8 12 2.8 2.8L16 9.5" {...common} />
        </>
      )}
      {name === 'earnings' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="M9.5 8h5M9.5 11h5M13 8c1.2 0 2 .8 2 2s-.8 2-2 2h-3.5l4 4" {...common} />
        </>
      )}
      {name === 'dues' && (
        <>
          <Path d="M3 8.5C3 6.6 5 5.5 8.5 5.5S14 6.6 14 8.5 12 11.5 8.5 11.5 3 10.4 3 8.5Z" {...common} />
          <Path d="M3 8.5v4c0 1.9 2 3 5.5 3s5.5-1.1 5.5-3v-4" {...common} />
          <Path d="M14 12.5c3.2.1 5 1.2 5 3s-2 3-5.5 3c-1.4 0-2.6-.2-3.6-.5" {...common} />
          <Path d="M10 18.9v.6" {...common} />
        </>
      )}
      {name === 'alerts' && (
        <>
          <Path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" {...common} />
          <Path d="M10 19a2 2 0 0 0 4 0" {...common} />
        </>
      )}
    </Svg>
  );
}

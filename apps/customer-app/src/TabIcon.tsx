import Svg, { Path, Circle } from 'react-native-svg';

/**
 * TabIcon — clean vector icons for the bottom tab bar (Home / Cart / Orders /
 * Profile), replacing the old emoji glyphs. Stroke-based, inherits the tab's
 * active/inactive colour via the `color` prop. 24×24 viewbox, round caps.
 */
export type TabName = 'home' | 'cart' | 'orders' | 'profile';

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
      {name === 'cart' && (
        <>
          <Path d="M3 4h2l2.4 11.4a1 1 0 0 0 1 .8h8.2a1 1 0 0 0 1-.8L20 7H6" {...common} />
          <Circle cx="9" cy="20" r="1.4" {...common} />
          <Circle cx="18" cy="20" r="1.4" {...common} />
        </>
      )}
      {name === 'orders' && (
        <>
          <Path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" {...common} />
          <Path d="M13 3v5h5" {...common} />
          <Path d="M9 13h6M9 17h6" {...common} />
        </>
      )}
      {name === 'profile' && (
        <>
          <Circle cx="12" cy="8" r="4" {...common} />
          <Path d="M4 21c0-4 3.6-6.5 8-6.5S20 17 20 21" {...common} />
        </>
      )}
    </Svg>
  );
}

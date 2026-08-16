import Svg, { Path, Circle, Rect } from 'react-native-svg';

/**
 * TabIcon — clean vector icons for the shopkeeper bottom tab bar (Home / Orders
 * / Products / Settings / Ledger), replacing the old glyph characters. Stroke-
 * based, inherits the tab's active/inactive colour via the `color` prop. 24×24
 * viewbox, round caps.
 */
export type TabName = 'home' | 'orders' | 'products' | 'prescriptions' | 'ads' | 'pos' | 'settings' | 'ledger';

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
      {name === 'orders' && (
        <>
          <Path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" {...common} />
          <Path d="M13 3v5h5" {...common} />
          <Path d="M9 13h6M9 17h6" {...common} />
        </>
      )}
      {name === 'products' && (
        <>
          <Path d="M12 3 3 7.5v9L12 21l9-4.5v-9L12 3Z" {...common} />
          <Path d="M3 7.5 12 12l9-4.5" {...common} />
          <Path d="M12 12v9" {...common} />
        </>
      )}
      {name === 'settings' && (
        <>
          <Circle cx="12" cy="12" r="3" {...common} />
          <Path
            d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1"
            {...common}
          />
        </>
      )}
      {name === 'ledger' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="M9 8h6M9 11h6M14 8c0 2.2-1.8 3-4 3l4 5" {...common} />
        </>
      )}
      {name === 'prescriptions' && (
        <>
          <Rect x="4" y="3" width="16" height="18" rx="2" {...common} />
          <Path d="M8 8h4a2 2 0 0 1 0 4H8V8Zm0 4 4 5" {...common} />
          <Path d="M14 15l4 4M18 15l-4 4" {...common} />
        </>
      )}
      {name === 'ads' && (
        <>
          <Path d="M4 9v6h3l6 4V5L7 9H4Z" {...common} />
          <Path d="M17 9a4 4 0 0 1 0 6" {...common} />
        </>
      )}
      {name === 'pos' && (
        <>
          <Path d="M6 8h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 8Z" {...common} />
          <Path d="M9 8V6a3 3 0 0 1 6 0v2" {...common} />
        </>
      )}
    </Svg>
  );
}

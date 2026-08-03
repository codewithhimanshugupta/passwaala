import Svg, { Path, Circle, Rect } from 'react-native-svg';

/**
 * NavIcon — clean stroke-based vector icons for the admin sidebar, replacing
 * the previous text-only nav rows. Each icon inherits the row's active/inactive
 * colour via the `color` prop. 24×24 viewbox, round caps, fill none.
 *
 * The `name` union covers every admin nav key (see the `Nav` type in App.tsx).
 */
export type NavIconName =
  | 'dashboard'
  | 'approvals'
  | 'shops'
  | 'riders'
  | 'customers'
  | 'orders'
  | 'settlements'
  | 'disputes'
  | 'coupons'
  | 'cities'
  | 'taskboard'
  | 'gst'
  | 'admins';

export function NavIcon({
  name,
  color,
  size = 20,
  strokeWidth = 2,
}: {
  name: NavIconName;
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
      {name === 'dashboard' && (
        <>
          <Rect x="3" y="3" width="7" height="7" rx="1.5" {...common} />
          <Rect x="14" y="3" width="7" height="7" rx="1.5" {...common} />
          <Rect x="3" y="14" width="7" height="7" rx="1.5" {...common} />
          <Rect x="14" y="14" width="7" height="7" rx="1.5" {...common} />
        </>
      )}
      {name === 'approvals' && (
        <>
          <Path
            d="M9 3h6a1 1 0 0 1 1 1v1h1a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h1V4a1 1 0 0 1 1-1Z"
            {...common}
          />
          <Path d="M9 5h6" {...common} />
          <Path d="M8.5 14l2 2 4-4.5" {...common} />
        </>
      )}
      {name === 'shops' && (
        <>
          <Path d="M4 9l1.2-4.2a1 1 0 0 1 1-.8h11.6a1 1 0 0 1 1 .8L20 9" {...common} />
          <Path d="M4 9a2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0 2.4 2.4 0 0 0 4 0" {...common} />
          <Path d="M5 11v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8" {...common} />
          <Path d="M9.5 20v-4.5h5V20" {...common} />
        </>
      )}
      {name === 'riders' && (
        <>
          <Circle cx="6" cy="18" r="2.5" {...common} />
          <Circle cx="18" cy="18" r="2.5" {...common} />
          <Path d="M6 18h6l3-6h4" {...common} />
          <Path d="M9 12l2 4" {...common} />
          <Path d="M14 7h2l1 3" {...common} />
        </>
      )}
      {name === 'customers' && (
        <>
          <Circle cx="9" cy="8" r="3" {...common} />
          <Path d="M3.5 19a5.5 5.5 0 0 1 11 0" {...common} />
          <Path d="M16 5.5a3 3 0 0 1 0 5.5" {...common} />
          <Path d="M17 14c2.2.5 3.8 2.3 4 5" {...common} />
        </>
      )}
      {name === 'orders' && (
        <>
          <Path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" {...common} />
          <Path d="M13 3v5h5" {...common} />
          <Path d="M9 13h6M9 17h6" {...common} />
        </>
      )}
      {name === 'settlements' && (
        <>
          <Circle cx="12" cy="12" r="9" {...common} />
          <Path d="M9.5 8h5M9.5 11h5" {...common} />
          <Path d="M9.5 8c2.2 0 3.5 1 3.5 2.6S11.7 13 9.5 13l4 4" {...common} />
        </>
      )}
      {name === 'disputes' && (
        <>
          <Path d="M4 5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4V5Z" {...common} />
          <Path d="M12 7v4" {...common} />
          <Path d="M12 13.5v.01" {...common} />
        </>
      )}
      {name === 'coupons' && (
        <>
          <Path d="M3 8a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2a2 2 0 0 0 0 4v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2a2 2 0 0 0 0-4V8Z" {...common} />
          <Path d="M14 8l-4 8" {...common} />
        </>
      )}
      {name === 'cities' && (
        <>
          <Path d="M3 21h18" {...common} />
          <Path d="M5 21V8l6-4v17" {...common} />
          <Path d="M11 21V9l8 3v9" {...common} />
          <Path d="M8 9v.01M8 12v.01M8 15v.01M15 14v.01M15 17v.01" {...common} />
        </>
      )}
      {name === 'taskboard' && (
        <>
          <Rect x="3" y="4" width="18" height="16" rx="2" {...common} />
          <Path d="M8 4v16M16 4v16" {...common} />
          <Path d="M5.5 8h1M5.5 12h1M11.5 8h1M11.5 12h1M18 8h.5M18 12h.5" {...common} />
        </>
      )}
      {name === 'gst' && (
        <>
          <Path d="M7 3h7l4 4v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" {...common} />
          <Path d="M13 3v5h5" {...common} />
          <Path d="M9 13l6 6M15 13l-6 6" {...common} />
        </>
      )}
      {name === 'admins' && (
        <>
          <Path d="M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6l7-3Z" {...common} />
          <Path d="M9 12l2 2 4-4" {...common} />
        </>
      )}
    </Svg>
  );
}

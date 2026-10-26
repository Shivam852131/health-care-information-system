'use client';

/* ------------------------------ icon set --------------------------------
   Hand-drawn 24×24 stroke icons (currentColor) used by the app chrome —
   sidebar, topbar, command palette and pagination. Keeps the UI crisp at
   any density, unlike emoji which render differently per platform.
   ------------------------------------------------------------------------ */

const PATHS = {
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.6" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.6" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.6" />
    </>
  ),
  users: (
    <>
      <path d="M15.5 19.5v-1.6a3.4 3.4 0 0 0-3.4-3.4H7.4A3.4 3.4 0 0 0 4 17.9v1.6" />
      <circle cx="9.75" cy="8" r="3.3" />
      <path d="M20 19.5v-1.6a3.4 3.4 0 0 0-2.6-3.3" />
      <path d="M15.2 5a3.3 3.3 0 0 1 0 6" />
    </>
  ),
  steth: (
    <>
      <path d="M5.5 3v4.5a4 4 0 0 0 8 0V3" />
      <path d="M3.8 3h3.4M9.5 3h3.4" />
      <path d="M9.5 11.5v2a4.5 4.5 0 0 0 9 0v-1.3" />
      <circle cx="18.5" cy="10" r="2.1" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3.2v3.4M16 3.2v3.4" />
    </>
  ),
  clipboard: (
    <>
      <path d="M9 4.8H7.2a2 2 0 0 0-2 2v11.5a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V6.8a2 2 0 0 0-2-2H15" />
      <rect x="9" y="3" width="6" height="3.6" rx="1.3" />
      <path d="M8.6 12.2h6.8M8.6 15.6h4.4" />
    </>
  ),
  flask: (
    <>
      <path d="M9.6 3.5h4.8M10.7 3.5v5.4L6.1 17a2.4 2.4 0 0 0 2 3.6h7.8a2.4 2.4 0 0 0 2-3.6l-4.6-8.1V3.5" />
      <path d="M8.2 14h7.6" />
    </>
  ),
  pill: (
    <>
      <rect x="2.8" y="8.6" width="18.4" height="6.8" rx="3.4" transform="rotate(-45 12 12)" />
      <path d="M8.9 8.9l6.2 6.2" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.6h12v16.8l-2.4-1.6-2.4 1.6-2.4-1.6L8.4 20.4 6 18.8Z" />
      <path d="M9 8.6h6M9 12.2h6" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20.4h16" />
      <rect x="5" y="12" width="3.4" height="6" rx="1.1" />
      <rect x="10.3" y="8" width="3.4" height="10" rx="1.1" />
      <rect x="15.6" y="4.4" width="3.4" height="13.6" rx="1.1" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="2.9" />
      <path d="M18.9 14.6a1.5 1.5 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.5 1.5 0 0 0-1.7-.3 1.5 1.5 0 0 0-.9 1.4v.2a2 2 0 1 1-4 0v-.1a1.5 1.5 0 0 0-1-1.4 1.5 1.5 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.5 1.5 0 0 0 .3-1.7 1.5 1.5 0 0 0-1.4-.9h-.2a2 2 0 1 1 0-4h.1a1.5 1.5 0 0 0 1.4-1 1.5 1.5 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.5 1.5 0 0 0 1.7.3h.1a1.5 1.5 0 0 0 .9-1.4v-.2a2 2 0 1 1 4 0v.1a1.5 1.5 0 0 0 .9 1.4 1.5 1.5 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.5 1.5 0 0 0-.3 1.7v.1a1.5 1.5 0 0 0 1.4.9h.2a2 2 0 1 1 0 4h-.1a1.5 1.5 0 0 0-1.4.9Z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m15.8 15.8 4.2 4.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.8v1.6M12 19.6v1.6M2.8 12h1.6M19.6 12h1.6M5.4 5.4l1.1 1.1M17.5 17.5l1.1 1.1M18.6 5.4l-1.1 1.1M6.5 17.5l-1.1 1.1" />
    </>
  ),
  moon: <path d="M20.5 14.2A8.3 8.3 0 0 1 9.8 3.5a8.3 8.3 0 1 0 10.7 10.7Z" />,
  panel: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.5H18a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-3.5" />
      <path d="M10 8.5 13.5 12 10 15.5M13.5 12H4.5" />
    </>
  ),
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  sortArrows: (
    <>
      <path d="m8 10 4-4 4 4" />
      <path d="m8 14 4 4 4-4" />
    </>
  ),
  arrowUp: <path d="M12 19V5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v14M18 13l-6 6-6-6" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  user: (
    <>
      <circle cx="12" cy="8" r="3.9" />
      <path d="M4.6 20a7.4 7.4 0 0 1 14.8 0" />
    </>
  ),
  command: <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 0 0 0-6Z" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.9" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.9 5.2A9.9 9.9 0 0 1 12 5c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-2.7 3.6M6.6 7.5A16.6 16.6 0 0 0 2.5 11.2S6 17.4 12 17.4a9.7 9.7 0 0 0 3.4-.6" />
      <path d="M10 10.1a2.9 2.9 0 0 0 4 4" />
    </>
  ),
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </>
  ),
  file: (
    <>
      <path d="M13.5 3.5H7.2a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2V8.8Z" />
      <path d="M13.5 3.5v5.3h4.8" />
    </>
  ),
  check: <path d="m5.5 12.6 4.3 4.2 8.7-9.4" />,
};

/** Inline SVG icon — sized by `size`, coloured by currentColor. */
export function Icon({ name, size = 18, className = '', strokeWidth = 1.7, style }) {
  const paths = PATHS[name];
  if (!paths) return null;
  return (
    <svg
      className={`ico ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={style}
    >
      {paths}
    </svg>
  );
}

/** Map of nav keys → icon names (kept here so NAV config stays declarative). */
export const NAV_ICONS = {
  dashboard: 'grid',
  patients: 'users',
  doctors: 'steth',
  appointments: 'calendar',
  records: 'clipboard',
  labs: 'flask',
  prescriptions: 'pill',
  billing: 'receipt',
  reports: 'chart',
  admin: 'gear',
};

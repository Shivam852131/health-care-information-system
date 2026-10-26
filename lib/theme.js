'use client';

import React from 'react';

/* ------------------------------ theme store ------------------------------
   Three-state theme: 'light' | 'dark' | 'system' (default).
   Persisted in localStorage and mirrored onto <html data-theme> so the CSS
   token overrides apply. A no-flash inline script in app/layout.js performs
   the same application before first paint.
   -------------------------------------------------------------------------- */

const KEY = 'his_theme';

export function systemPrefersDark() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readTheme() {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function applyTheme(theme) {
  if (typeof document === 'undefined') return;
  const dark = theme === 'dark' || (theme !== 'light' && systemPrefersDark());
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = React.useState('system');
  const [effective, setEffective] = React.useState('light');

  React.useEffect(() => {
    const sync = () => {
      const t = readTheme();
      applyTheme(t);
      setThemeState(t);
      setEffective(t === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : t);
    };
    sync();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const setTheme = React.useCallback((t) => {
    try {
      if (t === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, t);
    } catch {
      /* private mode — theme still applies for this session */
    }
    applyTheme(t);
    setThemeState(t);
    setEffective(t === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : t);
  }, []);

  const toggle = React.useCallback(() => {
    const current = readTheme() === 'dark' || (readTheme() === 'system' && systemPrefersDark());
    setTheme(current ? 'light' : 'dark');
  }, [setTheme]);

  return { theme, effective, setTheme, toggle };
}

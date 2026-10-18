/**
 * Light and dark theme. public/theme-init.js resolves the theme before
 * the first paint and keeps following the system setting while nothing
 * is stored; this module reads the current theme and owns the toggle.
 *
 * The theme choice is the one thing the console keeps in browser
 * storage (handoff: "A theme choice may be stored; nothing else may
 * be"). It is not a token or a value, and a refused or cleared storage
 * only means the console falls back to the system setting.
 */

import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'sb-theme';

function currentTheme(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observer.disconnect();
}

/** The theme on screen now, re-rendering when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, currentTheme, () => 'light');
}

/** Switch to `theme` and remember the choice. */
export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Storage refused: the switch still applies for this page.
  }
  document.documentElement.setAttribute('data-theme', theme);
}

export function toggleTheme(): void {
  setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
}

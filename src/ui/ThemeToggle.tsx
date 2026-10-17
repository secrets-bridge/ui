import { toggleTheme, useTheme } from '../theme/theme';

/**
 * Header button that switches between the light and dark theme. The
 * label names the theme it switches to, and the icon shows that theme
 * (moon in light, sun in dark).
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useTheme();
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className={
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-transparent text-ink hover:bg-sunken ' +
        className
      }
    >
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="miter"
        strokeLinecap="butt"
      >
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2.5V5M12 19V21.5M2.5 12H5M19 12H21.5M5.3 5.3L7 7M17 17L18.7 18.7M5.3 18.7L7 17M17 7L18.7 5.3" />
          </>
        ) : (
          <path d="M19.5 14.5A8 8 0 0 1 9.5 4.5A8 8 0 1 0 19.5 14.5Z" />
        )}
      </svg>
    </button>
  );
}

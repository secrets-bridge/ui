/**
 * The Checkpoint mark: two squares joined by a route that turns once at
 * a ring. Drawn inline so it follows the theme (ultramarine on light,
 * periwinkle on dark, both from the `accent` token). Geometry is copied
 * from the brand files; never redraw or retype it.
 *
 * - `variant="lockup"` (default): mark plus "Secrets Bridge", for headers.
 * - `variant="mark"`: the mark alone, for square spaces.
 * - `size` is the mark height in px (20 in the console sidebar).
 */

interface MarkProps {
  size?: number;
  className?: string;
}

export function LogoMark({ size = 20, className = '' }: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={'shrink-0 overflow-visible text-accent ' + className}
    >
      <rect width="9" height="9" fill="currentColor" />
      <rect x="15" y="15" width="9" height="9" fill="currentColor" />
      <path d="M9 4.5H16.6M19.5 7.4V15" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="19.5" cy="4.5" r="2.4" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

interface LogoProps {
  variant?: 'lockup' | 'mark';
  size?: number;
  /** Small mono tag after the name, such as "Console". */
  product?: string;
  /** Name size in px; defaults to the lockup ratio (0.888 x size). */
  textSize?: number;
  className?: string;
}

export function Logo({ variant = 'lockup', size = 20, product, textSize, className = '' }: LogoProps) {
  if (variant === 'mark') {
    return (
      <span role="img" aria-label="Secrets Bridge" className={'inline-flex ' + className}>
        <LogoMark size={size} />
      </span>
    );
  }
  return (
    <span
      className={
        'inline-flex items-center whitespace-nowrap font-semibold tracking-[-0.01em] text-ink ' +
        className
      }
      style={{
        fontSize: `${textSize ?? Math.round(size * 0.888 * 10) / 10}px`,
        gap: `${Math.round(size * 0.375)}px`,
      }}
    >
      <LogoMark size={size} />
      <span>Secrets Bridge</span>
      {product && (
        <small className="ml-1 border border-border px-[5px] font-mono text-[11px] font-normal text-muted">
          {product}
        </small>
      )}
    </span>
  );
}

/**
 * The Checkpoint mark: two squares joined by a route that turns once at
 * a ring. Drawn inline so it follows the theme: lime on dark, and ink
 * with a lime ring on light, where lime alone would disappear. Geometry
 * is copied from the design; never redraw or retype it.
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
      viewBox="0 0 28 28"
      aria-hidden="true"
      focusable="false"
      className={'logo-mark shrink-0 overflow-visible ' + className}
    >
      <rect className="logo-square" width="10" height="10" />
      <rect className="logo-square" x="18" y="18" width="10" height="10" />
      <path className="logo-route" d="M10 5H19.5M23 8.5V18" />
      <circle className="logo-ring" cx="23" cy="5" r="3.2" />
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
        'inline-flex items-center whitespace-nowrap font-display font-bold tracking-[-0.025em] text-ink ' +
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

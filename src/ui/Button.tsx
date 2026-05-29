/**
 * Brand button — pill-shaped, four variants. Matches the Figma frames
 * (page 06 confirm modal + roles list) where every primary CTA is a
 * rounded pill with the cyan→blue brand gradient, secondary actions
 * are outlined pills, and destructive actions are solid red.
 *
 * - primary  : brand gradient pill, dark text
 * - secondary: transparent + border-muted pill
 * - danger   : solid red pill
 * - ghost    : inline text-only (used for "Edit" / "Delete" actions in tables)
 */

import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'md' | 'sm';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-brand-gradient text-bg shadow-[0_1px_0_rgba(255,255,255,0.12)_inset] hover:opacity-95',
  secondary:
    'bg-transparent text-text border border-border hover:bg-surface/80',
  danger:
    'bg-red-500 text-white hover:bg-red-500/90',
  ghost:
    'bg-transparent text-accent hover:text-accent-bright',
};

const SIZES: Record<Size, string> = {
  md: 'rounded-full px-5 py-2 text-sm font-semibold',
  sm: 'rounded-full px-3.5 py-1.5 text-xs font-medium',
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', className = '', ...rest }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          'inline-flex items-center justify-center transition-colors',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          'focus:outline-none focus:ring-2 focus:ring-accent/40 focus:ring-offset-2 focus:ring-offset-bg',
          SIZES[size],
          variant === 'ghost' ? '' : SIZES[size],
          VARIANTS[variant],
          className,
        ].join(' ')}
        {...rest}
      />
    );
  },
);

Button.displayName = 'Button';

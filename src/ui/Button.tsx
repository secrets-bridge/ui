/**
 * Button. One primary per view; labels are verbs in sentence case, with
 * an ellipsis when the button opens a confirmation ("Approve…").
 *
 * - primary  : accent fill. New request, Review oldest, Reveal.
 * - secondary: surface with an `edge` border (the default look).
 * - danger   : outlined in `bad`. Reject, Cancel request, Revoke.
 * - quiet    : text-only accent action, such as Reset filters.
 *   `ghost` is the older name for it and renders the same.
 *
 * Sizes follow the control tokens: md is 32px, sm is 28px (inside
 * tables). Both grow to the 44px touch target on phones.
 */

import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'quiet' | 'ghost';
type Size = 'md' | 'sm';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'border border-accent bg-accent text-on-accent font-semibold hover:brightness-110',
  secondary: 'border border-edge bg-surface text-ink font-medium hover:bg-sunken',
  danger: 'border border-bad-line bg-surface text-bad font-medium hover:bg-bad-bg',
  quiet: 'border border-transparent bg-transparent text-accent font-medium hover:bg-accent-soft',
  ghost: 'border border-transparent bg-transparent text-accent font-medium hover:bg-accent-soft',
};

const SIZES: Record<Size, string> = {
  md: 'h-(--control-md) px-3 text-ui',
  sm: 'h-(--control-sm) px-2.5 text-caption',
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', className = '', ...rest }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md',
          'max-md:min-h-(--control-touch)',
          'disabled:cursor-not-allowed disabled:opacity-50',
          SIZES[size],
          VARIANTS[variant],
          className,
        ].join(' ')}
        {...rest}
      />
    );
  },
);

Button.displayName = 'Button';

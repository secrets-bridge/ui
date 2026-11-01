/**
 * Button. One primary per view; labels are verbs in sentence case, with
 * an ellipsis when the button opens a confirmation ("Approve…").
 *
 * - primary  : graphite on lime. New request, Review oldest, Reveal.
 * - secondary: transparent with an `edge` border (the default look).
 * - danger   : outlined in `bad`. Reject, Cancel request, Revoke.
 * - quiet    : text-only accent action, such as Reset filters.
 *   `ghost` is the older name for it and renders the same.
 *
 * Sizes follow the control tokens: md is 38px, sm is 32px (inside
 * tables). Both grow to the 44px touch target on phones. Disabled is
 * dashed, not faded, so it stays readable.
 */

import { type ButtonHTMLAttributes, forwardRef } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'quiet' | 'ghost';
type Size = 'md' | 'sm';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  primary: 'border border-accent-edge bg-accent text-on-accent enabled:hover:bg-accent-hover enabled:active:shadow-[inset_0_0_0_2px_var(--on-accent)]',
  secondary: 'border border-edge bg-transparent text-ink enabled:hover:bg-hover enabled:active:bg-press',
  danger: 'border border-bad bg-transparent text-bad enabled:hover:bg-bad-bg',
  quiet: 'border border-transparent bg-transparent text-accent-ink enabled:hover:bg-hover enabled:active:bg-press',
  ghost: 'border border-transparent bg-transparent text-accent-ink enabled:hover:bg-hover enabled:active:bg-press',
};

const SIZES: Record<Size, string> = {
  md: 'h-(--control-md) px-3.5 text-ui',
  sm: 'h-(--control-sm) px-[11px] text-[13px] leading-5',
};

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', className = '', ...rest }, ref) => {
    return (
      <button
        ref={ref}
        className={[
          'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold',
          'max-[900px]:min-h-(--control-touch)',
          'disabled:cursor-not-allowed disabled:border-dashed disabled:border-edge disabled:bg-transparent disabled:text-muted',
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

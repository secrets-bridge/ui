/**
 * Small tag for labels next to a record: row type (System / Custom),
 * operation (read / patch), health, a permission key. Square-cornered
 * and bordered, never a coloured pill.
 *
 * A request's status is not a tag: use `<Status>` (square glyph plus
 * the exact status word) for that.
 *
 * - `tone='filled'`  — tinted ground with a matching line
 * - `tone='outline'` — border and text only
 *
 * The coloured variants use the status tokens, and the word inside
 * always carries the meaning, so colour never stands alone.
 */

import type { HTMLAttributes } from 'react';

type Variant =
  | 'neutral'
  | 'system'
  | 'custom'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'executed'
  | 'cancelled'
  | 'success'
  | 'warning'
  | 'error'
  | 'accent';

type Tone = 'filled' | 'outline';

interface Props extends HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
  tone?: Tone;
}

const NEUTRAL = { filled: 'bg-sunken text-muted border-border', outline: 'text-muted border-border' };
const INK = { filled: 'bg-sunken text-ink border-border', outline: 'text-ink border-border' };
const ACCENT = { filled: 'bg-accent-soft text-accent border-accent-line', outline: 'text-accent border-accent-line' };
const OK = { filled: 'bg-ok-bg text-ok border-ok-line', outline: 'text-ok border-ok-line' };
const WARN = { filled: 'bg-warn-bg text-warn border-warn-line', outline: 'text-warn border-warn-line' };
const BAD = { filled: 'bg-bad-bg text-bad border-bad-line', outline: 'text-bad border-bad-line' };

const VARIANTS: Record<Variant, { filled: string; outline: string }> = {
  neutral: NEUTRAL,
  cancelled: NEUTRAL,
  custom: INK,
  system: ACCENT,
  accent: ACCENT,
  approved: OK,
  executed: OK,
  success: OK,
  pending: WARN,
  warning: WARN,
  rejected: BAD,
  error: BAD,
};

export function StatusPill({
  variant = 'neutral',
  tone = 'filled',
  className = '',
  ...rest
}: Props) {
  const cls = VARIANTS[variant][tone];
  return (
    <span
      className={[
        'inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-sm border px-[5px]',
        'text-[11px] font-medium leading-none',
        cls,
        className,
      ].join(' ')}
      {...rest}
    />
  );
}

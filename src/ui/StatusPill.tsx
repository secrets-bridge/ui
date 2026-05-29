/**
 * Status pill — rounded pill with semantic color variants. Used
 * throughout the Figma frames for request status (Pending / Approved
 * / Rejected / Executed / Cancelled), row type (System / Custom),
 * resource type (patch / read), and health indicators.
 *
 * Two style flavors:
 *   - `tone='filled'`  — solid background, matches the Figma "Pending /
 *     Approved / Rejected" pills on the requests list
 *   - `tone='outline'` — bordered transparent, matches the Figma
 *     permission chips (cyan accent on dark bg)
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

const VARIANTS: Record<Variant, { filled: string; outline: string }> = {
  neutral: {
    filled: 'bg-border/40 text-muted',
    outline: 'border border-border text-muted',
  },
  system: {
    filled: 'bg-accent/20 text-accent border border-accent/30',
    outline: 'border border-accent/50 text-accent',
  },
  custom: {
    filled: 'bg-border/40 text-text',
    outline: 'border border-border text-text',
  },
  pending: {
    filled: 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/30',
    outline: 'border border-yellow-400/50 text-yellow-300',
  },
  approved: {
    filled: 'bg-success/20 text-green-300 border border-success/40',
    outline: 'border border-success/50 text-green-300',
  },
  executed: {
    filled: 'bg-success/20 text-green-300 border border-success/40',
    outline: 'border border-success/50 text-green-300',
  },
  success: {
    filled: 'bg-success/20 text-green-300 border border-success/40',
    outline: 'border border-success/50 text-green-300',
  },
  rejected: {
    filled: 'bg-red-400/20 text-red-300 border border-red-400/40',
    outline: 'border border-red-400/50 text-red-300',
  },
  error: {
    filled: 'bg-red-400/20 text-red-300 border border-red-400/40',
    outline: 'border border-red-400/50 text-red-300',
  },
  cancelled: {
    filled: 'bg-border/40 text-muted',
    outline: 'border border-border text-muted',
  },
  warning: {
    filled: 'bg-yellow-400/20 text-yellow-300 border border-yellow-400/30',
    outline: 'border border-yellow-400/50 text-yellow-300',
  },
  accent: {
    filled: 'bg-accent/20 text-accent-bright border border-accent/30',
    outline: 'border border-accent/50 text-accent-bright',
  },
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
        'inline-flex items-center gap-1 rounded-full',
        'px-2.5 py-0.5 text-[11px] font-medium leading-none',
        cls,
        className,
      ].join(' ')}
      {...rest}
    />
  );
}

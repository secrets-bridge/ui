/**
 * A request status: a shape for its group and the exact API status as a
 * word, in sentence case. Shape and word carry the meaning, never colour
 * alone.
 *
 *   pending, pending_values, pending_verification   half, warn
 *   approved (the agent is working)                 split, ok
 *   executed                                        solid, ok
 *   rejected, refused, failed                       diamond, bad
 *   cancelled, expired                              hollow, edge
 *
 * Pass children only to add context, never to rename a status. A reveal
 * condition (ready, consumed, expired) is a separate line next to it,
 * not a status.
 */

import type { ReactNode } from 'react';

import type { AccessRequest } from '../api/types';
import { statusLabel } from '../lib/requestStatus';

export type RequestStatus = AccessRequest['status'];
export type Tone = 'warn' | 'run' | 'ok' | 'bad' | 'neutral';

const TONE: Record<RequestStatus, Tone> = {
  pending: 'warn',
  pending_values: 'warn',
  pending_verification: 'warn',
  approved: 'run',
  executed: 'ok',
  rejected: 'bad',
  refused: 'bad',
  failed: 'bad',
  cancelled: 'neutral',
  expired: 'neutral',
};

const GLYPH: Record<Tone, string> = {
  warn: 'h-[9px] w-[9px] border-[1.75px] border-warn bg-[linear-gradient(to_top,var(--warn)_50%,transparent_50%)]',
  run: 'h-[9px] w-[9px] border-[1.75px] border-ok bg-[linear-gradient(to_right,var(--ok)_50%,transparent_50%)]',
  ok: 'h-[9px] w-[9px] bg-ok',
  bad: 'h-2 w-2 rotate-45 bg-bad',
  neutral: 'h-[9px] w-[9px] border-[1.75px] border-edge',
};

export function Status({
  status,
  children,
  className = '',
}: {
  status: RequestStatus;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <ToneStatus tone={TONE[status] ?? 'neutral'} className={className}>
      {children ?? statusLabel(status)}
    </ToneStatus>
  );
}

/**
 * The same glyph and word for anything that isn't a request (an agent,
 * a catalog entry): pick the tone, pass the exact status word.
 */
export function ToneStatus({ tone, children, className = '' }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[13px] font-medium leading-[18px] ${tone === 'neutral' ? 'text-muted' : 'text-ink'} ${className}`}>
      <span aria-hidden="true" className={'box-border shrink-0 ' + GLYPH[tone]} />
      {children}
    </span>
  );
}

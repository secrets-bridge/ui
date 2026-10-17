/**
 * A request status: one small square glyph and the exact API status as
 * a word, in sentence case. Colour never carries the meaning alone.
 *
 *   pending, pending_values, pending_verification   hollow, warn
 *   approved, executed                              solid, ok
 *   rejected, refused, failed                       solid, bad
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
export type Tone = 'warn' | 'ok' | 'bad' | 'neutral';

const TONE: Record<RequestStatus, Tone> = {
  pending: 'warn',
  pending_values: 'warn',
  pending_verification: 'warn',
  approved: 'ok',
  executed: 'ok',
  rejected: 'bad',
  refused: 'bad',
  failed: 'bad',
  cancelled: 'neutral',
  expired: 'neutral',
};

const GLYPH: Record<Tone, string> = {
  warn: 'border-2 border-warn',
  ok: 'bg-ok',
  bad: 'bg-bad',
  neutral: 'border-[1.5px] border-edge',
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
    <span className={'inline-flex items-center gap-[7px] whitespace-nowrap text-ui font-medium text-ink ' + className}>
      <span aria-hidden="true" className={'box-border h-2 w-2 shrink-0 ' + GLYPH[tone]} />
      {children}
    </span>
  );
}

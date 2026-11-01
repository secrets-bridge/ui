/**
 * Inline message. `error` for failures (an alert, with a retry action);
 * `note` for context, `warn` for something to act on soon, `ok` for a
 * result worth keeping on screen, and `prod` for what production refuses,
 * such as "Direct reveal is blocked in Production."
 * Never for marketing or upsell.
 */

import type { ReactNode } from 'react';

import { InfoIcon } from './icons';

type BannerTone = 'error' | 'note' | 'warn' | 'ok' | 'prod';

interface Props {
  tone?: BannerTone;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

const TONE: Record<BannerTone, { box: string; icon: string }> = {
  note: { box: 'border-info-line bg-info-bg', icon: 'text-info' },
  error: { box: 'border-bad-line bg-bad-bg', icon: 'text-bad' },
  warn: { box: 'border-warn-line bg-warn-bg', icon: 'text-warn' },
  ok: { box: 'border-ok-line bg-ok-bg', icon: 'text-ok' },
  prod: { box: 'border-ink bg-surface', icon: 'text-ink' },
};

export function Banner({ tone = 'note', title, children, action, className = '' }: Props) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={'flex items-start gap-3 rounded-lg border px-3.5 py-3 text-ui leading-[21px] font-normal text-ink ' + TONE[tone].box + ' ' + className}
    >
      <InfoIcon size={18} className={'mt-px ' + TONE[tone].icon} />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

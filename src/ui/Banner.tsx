/**
 * Inline message. `error` for failures (an alert, with a retry action);
 * `note` for context such as "Direct reveal is blocked in Production."
 * Never for marketing or upsell.
 */

import type { ReactNode } from 'react';

interface Props {
  tone?: 'error' | 'note';
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function Banner({ tone = 'note', title, children, action, className = '' }: Props) {
  return (
    <div
      role={tone === 'error' ? 'alert' : undefined}
      className={
        'flex items-start gap-3 rounded-md border px-3.5 py-3 text-ui font-normal ' +
        (tone === 'error' ? 'border-bad-line bg-surface' : 'border-border bg-sunken') +
        ' ' +
        className
      }
    >
      <div className="min-w-0 flex-1">
        {title && <p className={'font-semibold ' + (tone === 'error' ? 'text-bad' : 'text-ink')}>{title}</p>}
        {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
      </div>
      {action}
    </div>
  );
}

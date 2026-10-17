/**
 * Drawer — right-side panel for short forms. Full width on phones.
 * Header has a title + close button; body scrolls; an optional footer
 * pins the actions to the bottom right (Cancel, then submit).
 *
 * Replaces the per-page Drawer copies that the Workflows / Roles /
 * Policies / Integrations / Projects / Assignments pages each carried
 * locally.
 */

import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Drawer({ title, onClose, children, footer, wide }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        className="absolute inset-0 bg-scrim"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <div
        className={
          (wide ? 'w-[720px]' : 'w-[520px]') +
          ' relative max-w-full bg-surface border-l border-border h-full flex flex-col shadow-overlay'
        }
      >
        <div className="px-5 py-4 border-b border-rule flex items-center justify-between gap-3 shrink-0">
          <h2 className="text-[18px] leading-6 font-semibold text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="text-ink text-xl leading-none w-8 h-8 shrink-0 rounded-md hover:bg-sunken"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-[18px] overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-5 py-3.5 border-t border-rule flex flex-wrap items-center justify-end gap-2.5 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

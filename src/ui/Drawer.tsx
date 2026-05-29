/**
 * Drawer — right-anchored panel matching the Figma "Edit role" frame.
 * Header has a title + close X; body scrolls; an optional footer slot
 * pins action buttons to the bottom (Cancel + primary).
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
        className="absolute inset-0 bg-bg/70 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close drawer"
      />
      <div
        className={
          (wide ? 'w-[720px]' : 'w-[520px]') +
          ' relative max-w-full bg-surface border-l border-border h-full flex flex-col shadow-2xl'
        }
      >
        <div className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="text-text font-semibold text-base">{title}</div>
          <button
            onClick={onClose}
            className="text-muted hover:text-text text-xl leading-none w-8 h-8 rounded-full hover:bg-bg/40 transition-colors"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5 overflow-y-auto flex-1">{children}</div>
        {footer && (
          <div className="px-6 py-4 border-t border-border flex items-center justify-between gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

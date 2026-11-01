/**
 * Drawer — right-side dialog for short forms (Request access, admin
 * edits). At 900px and below it rises from the bottom as a sheet. The
 * body scrolls; an optional footer pins the actions to the bottom right
 * (Cancel, then submit; link the submit button to the form with `form=`).
 *
 * Same focus rules as Dialog: focus moves inside, Tab is trapped,
 * Escape closes the top layer and focus returns to the trigger.
 */

import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { CloseIcon } from './icons';
import { useModalFocus } from './useModalFocus';

interface Props {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** Above page dialogs (z-50), for a drawer the step-up modal opens. */
  elevated?: boolean;
}

export function Drawer({ title, subtitle, onClose, children, footer, wide, elevated }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(ref, onClose);

  return createPortal(
    <div className={(elevated ? 'z-[60]' : 'z-40') + ' fixed inset-0 flex justify-end max-[900px]:items-end'}>
      <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          (wide ? 'w-[720px]' : 'w-[520px]') +
          ' relative flex h-full max-w-full flex-col border-l border-border bg-raised shadow-overlay max-[900px]:h-auto max-[900px]:max-h-[92%] max-[900px]:w-full max-[900px]:rounded-t-3xl max-[900px]:border-l-0 max-[900px]:border-t'
        }
      >
        <div aria-hidden="true" className="mx-auto mt-2 hidden h-1 w-10 shrink-0 rounded-sm bg-edge max-[900px]:block" />
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4 max-[900px]:px-4 max-[900px]:py-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-dialog-title text-ink">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-caption text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink hover:bg-hover max-md:h-11 max-md:w-11"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-[18px] max-[900px]:px-4">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-border px-5 py-3.5 max-[900px]:px-4 max-[900px]:[&>button]:h-12 max-[900px]:[&>button]:flex-1">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

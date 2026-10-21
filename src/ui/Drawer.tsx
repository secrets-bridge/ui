/**
 * Drawer — right-side dialog for short forms (Request access, admin
 * edits). Full width on phones. The body scrolls; an optional footer
 * pins the actions to the bottom right (Cancel, then submit; link the
 * submit button to the form with `form=`).
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
    <div className={(elevated ? 'z-[60]' : 'z-40') + ' fixed inset-0 flex justify-end'}>
      <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={
          (wide ? 'w-[720px]' : 'w-[520px]') +
          ' relative flex h-full max-w-full flex-col border-l border-border bg-surface shadow-overlay'
        }
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[18px] font-semibold leading-6 text-ink">
              {title}
            </h2>
            {subtitle && <p className="mt-0.5 text-ui font-normal text-muted">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink hover:bg-sunken max-md:h-11 max-md:w-11"
          >
            <CloseIcon />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-[18px]">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2.5 border-t border-rule px-5 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

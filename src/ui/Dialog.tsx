/**
 * Dialog — a modal confirmation: approve, reject, cancel, MFA step-up,
 * sign out. The title is phrased as the question ("Approve REQ-1042?");
 * actions put the cancelling button first and the confirming one last.
 * At 900px and below it rises from the bottom as a sheet, with the
 * actions stacked at full width and the confirming one on top.
 *
 * Focus moves inside on open, Tab is trapped, Escape and the scrim
 * close it, and focus returns to the trigger (see useModalFocus).
 */

import { useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useModalFocus } from './useModalFocus';

interface Props {
  title: string;
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  /** Where focus goes on close if the trigger is gone. */
  fallbackFocus?: () => HTMLElement | null;
  /** Block closing from Escape and the scrim (e.g. while a call is in flight). */
  dismissible?: boolean;
  /** Above page dialogs, for the step-up modal, which can open over one. */
  elevated?: boolean;
}

export function Dialog({ title, children, actions, onClose, fallbackFocus, dismissible = true, elevated }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const close = () => {
    if (dismissible) onClose();
  };
  useModalFocus(ref, close, fallbackFocus);

  return createPortal(
    <div className={(elevated ? 'z-[60]' : 'z-50') + ' fixed inset-0 flex items-center justify-center p-4 max-[900px]:items-end max-[900px]:p-0'}>
      <div className="absolute inset-0 bg-scrim" onClick={close} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative max-h-[calc(100vh-32px)] w-[480px] max-w-full overflow-y-auto rounded-2xl border border-border bg-raised px-5 pt-[18px] shadow-overlay max-[900px]:max-h-[90%] max-[900px]:w-full max-[900px]:rounded-b-none max-[900px]:rounded-t-3xl max-[900px]:border-x-0 max-[900px]:border-b-0 max-[900px]:px-4 max-[900px]:pt-2"
      >
        <div aria-hidden="true" className="mx-auto mb-3 hidden h-1 w-10 rounded-sm bg-edge max-[900px]:block" />
        <h2 id={titleId} className="mb-2.5 text-dialog-title text-ink">
          {title}
        </h2>
        <div className="flex flex-col gap-3.5 text-body">{children}</div>
        <div className="-mx-5 mt-[18px] flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3.5 max-[900px]:-mx-4 max-[900px]:flex-col-reverse max-[900px]:gap-2.5 max-[900px]:px-4 max-[900px]:pb-[18px] max-[900px]:[&>button]:h-12 max-[900px]:[&>button]:text-[15px]">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}

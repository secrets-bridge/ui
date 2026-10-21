/**
 * Dialog — a modal confirmation: approve, reject, cancel, MFA step-up,
 * sign out. The title is phrased as the question ("Approve REQ-1042?");
 * actions put the cancelling button first and the confirming one last.
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
    <div className={(elevated ? 'z-[60]' : 'z-50') + ' fixed inset-0 flex items-center justify-center p-4'}>
      <div className="absolute inset-0 bg-scrim" onClick={close} aria-hidden="true" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative max-h-[calc(100vh-32px)] w-[520px] max-w-full overflow-y-auto rounded-md border border-border bg-surface px-5 py-[18px] shadow-overlay"
      >
        <h2 id={titleId} className="mb-2.5 text-dialog-title text-ink">
          {title}
        </h2>
        <div className="flex flex-col gap-3.5 text-body">{children}</div>
        <div className="mt-4 flex flex-wrap justify-end gap-2.5">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}

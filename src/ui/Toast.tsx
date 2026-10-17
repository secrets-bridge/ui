/**
 * Short confirmation after an action, in the past tense, with an
 * optional link to the result: "Requested 2 keys. Open REQ-1042".
 * Disappears after about 6 seconds, so it is never the only place
 * important information appears. Announced through role=status.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ToastContext, type ShowToast, type ToastLink } from './toastContext';

interface ToastMessage {
  id: number;
  text: string;
  link?: ToastLink;
}

const VISIBLE_MS = 6000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const next = useRef(1);

  const show = useCallback<ShowToast>((text, link) => {
    setToast({ id: next.current++, text, link });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), VISIBLE_MS);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-5 z-[60] flex justify-center px-4">
        {toast && (
          <div
            key={toast.id}
            className="pointer-events-auto flex items-center gap-3 rounded-md bg-ink px-4 py-2.5 text-body text-bg shadow-overlay"
          >
            <span>{toast.text}</span>
            {toast.link && (
              <Link
                to={toast.link.to}
                onClick={() => setToast(null)}
                className="font-semibold text-bg underline underline-offset-2"
              >
                {toast.link.label}
              </Link>
            )}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

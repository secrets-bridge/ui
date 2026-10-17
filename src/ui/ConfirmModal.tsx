/**
 * ConfirmModal — 420px centered card matching the Figma "Delete role?"
 * frame. Title in bold, muted description, optional inline error
 * banner with red border-left for API failures (e.g. "409 · Role is
 * referenced by 2 policies"), and a footer with Cancel + danger CTA.
 *
 * Replaces the per-page ConfirmModal copies that the admin pages
 * each carried locally.
 */

import { useEffect } from 'react';

import { ApiError } from '../api/client';
import { Button } from './Button';

interface Props {
  title: string;
  body: string;
  confirmText: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => Promise<unknown>;
  loading: boolean;
  error?: unknown;
}

export function ConfirmModal({
  title,
  body,
  confirmText,
  danger,
  onCancel,
  onConfirm,
  loading,
  error,
}: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        className="absolute inset-0 bg-scrim"
        onClick={onCancel}
        aria-label="Close"
      />
      <div className="relative bg-surface border border-border rounded-md w-[520px] max-w-full px-5 py-[18px] space-y-3.5 shadow-overlay">
        <h2 className="text-dialog-title text-ink">{title}</h2>
        <p className="text-body text-muted">{body}</p>

        {error instanceof ApiError && (
          <div role="alert" className="border border-bad-line rounded-md px-3.5 py-3 text-ui">
            <div className="text-bad font-semibold mb-0.5">
              {error.status} · {statusLabel(error.status)}
            </div>
            <div className="text-ink mt-0.5">{error.message}</div>
          </div>
        )}
        {error != null && !(error instanceof ApiError) && (
          <div role="alert" className="border border-bad-line rounded-md px-3.5 py-3 text-ui">
            <div className="text-bad font-semibold mb-0.5">Network error</div>
            <div className="text-ink mt-0.5">
              {error instanceof Error ? error.message : String(error)}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-2">
          <Button variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            size="md"
            disabled={loading}
            onClick={() => void onConfirm()}
          >
            {loading ? 'Working…' : confirmText}
          </Button>
        </div>
      </div>
    </div>
  );
}

function statusLabel(s: number): string {
  if (s === 409) return 'Conflict';
  if (s === 403) return 'Forbidden';
  if (s === 404) return 'Not found';
  if (s === 400) return 'Bad request';
  if (s === 500) return 'Server error';
  if (s === 502) return 'Bad gateway';
  if (s === 503) return 'Service unavailable';
  if (s === 504) return 'Gateway timeout';
  return 'Error';
}

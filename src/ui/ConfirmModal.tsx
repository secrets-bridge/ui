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
        className="absolute inset-0 bg-bg/80 backdrop-blur-sm"
        onClick={onCancel}
        aria-label="Close"
      />
      <div className="relative bg-surface border border-border rounded-2xl w-[440px] max-w-full p-6 space-y-4 shadow-2xl">
        <div className="text-text font-bold text-xl tracking-tight">{title}</div>
        <div className="text-muted text-sm leading-relaxed">{body}</div>

        {error instanceof ApiError && (
          <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-4 py-3 text-sm">
            <div className="text-red-300 font-semibold mb-0.5">
              {error.status} · {statusLabel(error.status)}
            </div>
            <div className="text-red-200/90 text-xs">{error.message}</div>
          </div>
        )}

        <div className="flex items-center justify-between pt-2 border-t border-border/60">
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
  return 'Error';
}

/**
 * ConfirmModal — a yes/no Dialog for destructive or irreversible
 * actions (sign out, revoke, delete). Shows an API failure inline with
 * its status and keeps the dialog open so the user can retry or back
 * out. While the call is in flight the dialog can't be dismissed.
 */

import { ApiError } from '../api/client';
import { Button } from './Button';
import { Dialog } from './Dialog';

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
  return (
    <Dialog
      title={title}
      onClose={onCancel}
      dismissible={!loading}
      actions={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant={danger ? 'danger' : 'primary'}
            disabled={loading}
            aria-busy={loading}
            onClick={() => void onConfirm()}
          >
            {loading ? 'Working…' : confirmText}
          </Button>
        </>
      }
    >
      <p className="text-muted">{body}</p>

      {error != null && (
        <div role="alert" className="rounded-md border border-bad-line px-3.5 py-3 text-ui">
          <div className="font-semibold text-bad">
            {error instanceof ApiError
              ? `${error.status} · ${statusLabel(error.status)}`
              : 'Network error'}
          </div>
          <div className="mt-0.5 text-ink">
            {error instanceof Error ? error.message : String(error)}
          </div>
        </div>
      )}
    </Dialog>
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

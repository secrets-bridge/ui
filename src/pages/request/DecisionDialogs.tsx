/**
 * Approve, reject and cancel confirmations for a request.
 *
 * - Approve shows what is being approved and what happens next, with an
 *   optional note. Approving records a decision; it never runs anything.
 * - Reject needs a reason of at least 10 characters, because the
 *   requester sees it.
 * - Cancel is for the requester while the request is still open.
 *
 * The api asks for a fresh MFA step-up on approve and reject; the
 * step-up dialog opens on top of these and the call retries by itself.
 */

import { useState, type ReactNode } from 'react';

import { ApiError } from '../../api/client';
import { useApproveRequest, useCancelRequest, useRejectRequest } from '../../api/requests';
import type { AccessRequest } from '../../api/types';
import { requestRef } from '../../lib/requestRef';
import { keysOf } from '../../requests/describe';
import type { ScopeDisplay } from '../../requests/scope';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import { Field, Textarea } from '../../ui/Field';
import { Keys } from '../../ui/Keys';
import { ScopeLabel } from '../../ui/ScopeLabel';

const REJECT_MIN = 10;

// After a decision the trigger button is gone; focus the new state heading.
const stateHeading = () => document.getElementById('state-heading');

interface Common {
  request: AccessRequest;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Plain-language reason for a refused decision. */
function decisionError(err: unknown): string {
  if (!(err instanceof ApiError)) return err instanceof Error ? err.message : String(err);
  const msg = err.message.toLowerCase();
  if (err.status === 410) return 'This request expired before your decision. Nothing was recorded.';
  if (err.status === 409) return 'This request changed while you were looking at it. Nothing was recorded; the page now shows its current state.';
  if (err.status === 403 && msg.includes('self')) return "You can't decide on your own request.";
  if (err.status === 403) return `You can't decide on this request. ${err.message}`;
  if (err.status === 401) return 'Your second factor wasn\'t confirmed, so nothing was recorded.';
  if (err.status === 412) return 'Deciding needs a second factor, so nothing was recorded. Try again to add one.';
  return `${err.status}: ${err.message}`;
}

function Summary({ request: r, display, extra }: { request: AccessRequest; display: ScopeDisplay; extra?: ReactNode }) {
  const keys = keysOf(r);
  return (
    <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md border border-border bg-sunken px-3.5 py-3 text-ui font-normal">
      <dt className="text-muted">Request</dt>
      <dd className="m-0 font-mono text-mono">{requestRef(r.id)}</dd>
      <dt className="text-muted">Requester</dt>
      <dd className="m-0">{r.requester_display ?? 'The requester'}</dd>
      <dt className="text-muted">Where</dt>
      <dd className="m-0">
        <ScopeLabel project={display.project} env={display.env} envKind={display.envKind} logo={display.logo} />
      </dd>
      <dt className="text-muted">Keys</dt>
      <dd className="m-0">
        <Keys keys={keys} variant="chips" />
      </dd>
      {extra}
    </dl>
  );
}

export function ApproveDialog({
  request: r,
  display,
  lastApproval,
  onClose,
  onDone,
}: Common & { display: ScopeDisplay; lastApproval: boolean | undefined }) {
  const approve = useApproveRequest(r.id);
  const [note, setNote] = useState('');
  const submit = () =>
    approve.mutate(
      { comment: note.trim() || undefined },
      { onSuccess: () => onDone(`You approved ${requestRef(r.id)}.`) },
    );
  const next =
    lastApproval === true
      ? 'Your approval is the last one needed. The request becomes approved, then an agent reads the values. Approving does not reveal anything to you.'
      : lastApproval === false
        ? 'Your approval is recorded. More approvals are needed before an agent reads the values.'
        : 'Your approval is recorded. When every required approval is in, an agent reads the values. Approving does not reveal anything to you.';
  return (
    <Dialog
      title={`Approve ${requestRef(r.id)}?`}
      onClose={onClose}
      fallbackFocus={stateHeading}
      dismissible={!approve.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={approve.isPending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={approve.isPending} aria-busy={approve.isPending}>
            {approve.isPending ? 'Approving…' : 'Approve'}
          </Button>
        </>
      }
    >
      <Summary request={r} display={display} />
      <p className="text-muted">{next}</p>
      <Field id="approve-note" label="Note for the requester (optional)">
        {(p) => <Textarea {...p} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
      </Field>
      {approve.isError && <Banner tone="error" title="Not approved.">{decisionError(approve.error)}</Banner>}
    </Dialog>
  );
}

export function RejectDialog({ request: r, display, onClose, onDone }: Common & { display: ScopeDisplay }) {
  const reject = useRejectRequest(r.id);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const len = reason.trim().length;
  const invalid = len < REJECT_MIN;
  const submit = () => {
    setTried(true);
    if (invalid) {
      document.getElementById('reject-reason')?.focus();
      return;
    }
    reject.mutate({ reason: reason.trim() }, { onSuccess: () => onDone(`You rejected ${requestRef(r.id)}.`) });
  };
  return (
    <Dialog
      title={`Reject ${requestRef(r.id)}?`}
      onClose={onClose}
      fallbackFocus={stateHeading}
      dismissible={!reject.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={reject.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} disabled={reject.isPending} aria-busy={reject.isPending}>
            {reject.isPending ? 'Rejecting…' : 'Reject request'}
          </Button>
        </>
      }
    >
      <Summary request={r} display={display} />
      <Field
        id="reject-reason"
        label="Reason"
        hint="The requester sees this. Say what is wrong or what to do instead."
        error={tried && invalid ? `Give a reason of at least ${REJECT_MIN} characters (${len} so far).` : undefined}
      >
        {(p) => (
          <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} data-autofocus />
        )}
      </Field>
      {reject.isError && <Banner tone="error" title="Not rejected.">{decisionError(reject.error)}</Banner>}
    </Dialog>
  );
}

export function CancelDialog({ request: r, onClose, onDone }: Common) {
  const cancel = useCancelRequest(r.id);
  return (
    <Dialog
      title={`Cancel ${requestRef(r.id)}?`}
      onClose={onClose}
      fallbackFocus={stateHeading}
      dismissible={!cancel.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={cancel.isPending} data-autofocus>
            Keep request
          </Button>
          <Button
            variant="danger"
            onClick={() => cancel.mutate(undefined, { onSuccess: () => onDone(`You cancelled ${requestRef(r.id)}.`) })}
            disabled={cancel.isPending}
            aria-busy={cancel.isPending}
          >
            {cancel.isPending ? 'Cancelling…' : 'Cancel request'}
          </Button>
        </>
      }
    >
      <p className="text-muted">The request stops here and approvers no longer see it. You can request the same access again later.</p>
      {cancel.isError && <Banner tone="error" title="Not cancelled.">{decisionError(cancel.error)}</Banner>}
    </Dialog>
  );
}

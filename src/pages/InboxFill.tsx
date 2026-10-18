/**
 * Fill a cross-team request (`/inbox/:request_id`, secret.value.provide).
 *
 * Another team asked one of your teams for values. You either send a
 * value for every key the request names (POST /requests/:id/fill), or
 * refuse with a reason the requester will read (POST .../refuse).
 * Filled values go to the requester's approvers to verify, then an
 * agent writes them to the destination.
 *
 * Value hygiene:
 *   - Each value is a password input, masked until you press Show.
 *   - Values are sent as UTF-8 base64 (`encodeSecret`): `btoa()` threw
 *     on non-Latin-1 text and stored accents as invalid UTF-8.
 *   - State is blanked after a successful send and on unmount, the
 *     encoded copy is blanked in place, and the mutation is reset so
 *     the MutationCache doesn't keep it (UI-N-02).
 *   - Nothing goes to browser storage.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import { crossTeamErrorMessage, extractCrossTeamErrorCode, useFillCrossTeam, useRefuseCrossTeam } from '../api/crossTeam';
import { useRequest } from '../api/requests';
import type { AccessRequest } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { encodeSecret } from '../lib/decodeSecret';
import { requestRef } from '../lib/requestRef';
import { statusLabel } from '../lib/requestStatus';
import { formatExact } from '../lib/time';
import { useNow } from '../lib/useNow';
import { keysOf } from '../requests/crossTeam';
import { Banner } from '../ui/Banner';
import { Breadcrumb } from '../ui/Breadcrumb';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { Field, Input, Textarea } from '../ui/Field';
import { Path } from '../ui/Path';
import { Status } from '../ui/Status';
import { useToast } from '../ui/toastContext';
import { FillWindow } from './inbox/FillWindow';

const REASON_MIN = 10;

export function InboxFill() {
  const { hasPermission } = useAuth();
  if (!hasPermission('secret.value.provide')) return <Navigate to="/" replace />;
  return <InboxFillView />;
}

function describe(err: unknown): string {
  if (err instanceof ApiError) return `${err.status}: ${crossTeamErrorMessage(extractCrossTeamErrorCode(err.body)) ?? err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function InboxFillView() {
  const { request_id: id } = useParams<{ request_id: string }>();
  const req = useRequest(id);
  const now = useNow(30_000);

  useEffect(() => {
    document.title = `Provide values${id ? ` · ${requestRef(id)}` : ''} · Secrets Bridge`;
  }, [id]);

  const crumbs = [{ label: 'Inbox', to: '/inbox' }, { label: id ? requestRef(id) : 'Request', mono: true }];

  if (req.isLoading) {
    return (
      <div>
        <Breadcrumb items={crumbs} />
        <p className="mt-4 text-muted">Loading the request…</p>
      </div>
    );
  }
  if (!req.data) {
    return (
      <div>
        <Breadcrumb items={crumbs} />
        <h1 id="page-title" tabIndex={-1} className="mb-4 mt-3 text-console-title text-ink">
          You can't open this request
        </h1>
        <Banner title="It doesn't exist, or it isn't assigned to one of your teams.">
          {req.error instanceof ApiError ? `${req.error.status}: ${req.error.message}. ` : ''}
          <Link to="/inbox" className="font-medium text-accent hover:underline">
            Back to the inbox
          </Link>
        </Banner>
      </div>
    );
  }

  const r = req.data;
  const closed = r.type !== 'cross_team' || r.status !== 'pending_values';
  const expired = !!r.fill_expires_at && Date.parse(r.fill_expires_at) <= now;

  return (
    <div>
      <Breadcrumb items={crumbs} />
      <h1 id="page-title" tabIndex={-1} className="mt-3 text-console-title text-ink">
        Provide values
      </h1>
      <p className="mb-6 mt-[3px] max-w-3xl text-ui font-normal text-muted">
        {r.requester_display ?? 'Someone'}
        {r.source_project_name ? ` (${r.source_project_name})` : ''} asked {r.target_team_name ?? 'your team'} for{' '}
        {keysOf(r).length} {keysOf(r).length === 1 ? 'value' : 'values'}. After you send them, the requester's approvers
        verify the request and an agent writes the values to the destination.
      </p>

      <div className="grid grid-cols-1 items-start gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          {r.type !== 'cross_team' ? (
            <Banner title="This isn't a cross-team request.">
              <Link to={`/requests/${r.id}`} className="font-medium text-accent hover:underline">
                Open it in Requests
              </Link>
            </Banner>
          ) : closed ? (
            <Banner title="This request no longer needs values.">
              <span className="inline-flex flex-wrap items-center gap-2">
                Its status is <Status status={r.status}>{statusLabel(r.status)}</Status>.{' '}
                <Link to={`/requests/${r.id}`} className="font-medium text-accent hover:underline">
                  See the request
                </Link>
              </span>
            </Banner>
          ) : expired ? (
            <Banner tone="error" title="The fill window has closed.">
              It closed {formatExact(r.fill_expires_at)}. The request expires; the requester can submit a new one.
            </Banner>
          ) : (
            <FillForm r={r} />
          )}
        </div>
        <Details r={r} now={now} />
      </div>
    </div>
  );
}

function FillForm({ r }: { r: AccessRequest }) {
  const navigate = useNavigate();
  const toast = useToast();
  const fill = useFillCrossTeam(r.id);
  const keys = keysOf(r);

  // Plaintext lives only here, and is dropped after a send or on leave.
  const [values, setValues] = useState<Record<string, string>>({});
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [comment, setComment] = useState('');
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refusing, setRefusing] = useState(false);

  useEffect(
    () => () => {
      setValues({});
      setShown({});
    },
    [],
  );

  const missing = keys.filter((k) => !(values[k] ?? '').length);

  const send = async () => {
    setTried(true);
    setError(null);
    if (missing.length) {
      document.getElementById(`fill-${missing[0]}`)?.focus();
      return;
    }
    const encoded: Record<string, string> = {};
    for (const k of keys) encoded[k] = encodeSecret(values[k] ?? '');
    try {
      await fill.mutateAsync({ key_values: encoded, fill_comment: comment.trim() || undefined });
      setValues({});
      setShown({});
      setComment('');
      toast(`Sent ${keys.length} ${keys.length === 1 ? 'value' : 'values'} for ${requestRef(r.id)}. Approvers verify next.`, {
        to: `/requests/${r.id}`,
        label: 'Open it',
      });
      navigate('/inbox');
    } catch (err) {
      setError(describe(err));
    } finally {
      fill.reset();
      for (const k of Object.keys(encoded)) encoded[k] = '';
    }
  };

  return (
    <>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="rounded-md border border-border bg-surface"
      >
        <div className="border-b border-rule px-5 py-3.5">
          <h2 className="text-block-heading text-ink">
            Values
            <span className="ml-2 font-mono text-mono-small font-normal text-muted">{keys.length}</span>
          </h2>
          <p className="mt-0.5 text-caption text-muted">
            Each value is encrypted when it reaches the control plane and handed only to the agent that writes it. Nobody can
            read it back in the console.
          </p>
        </div>
        <div className="flex flex-col gap-4 px-5 py-4">
          {keys.map((k) => {
            const err = tried && !(values[k] ?? '').length ? `Enter a value for ${k}.` : undefined;
            return (
              <div key={k} className="flex min-w-0 flex-col gap-1.5">
                <label htmlFor={`fill-${k}`} className="font-mono text-mono font-semibold text-ink">
                  {k}
                </label>
                <div className="flex gap-2">
                  <Input
                    id={`fill-${k}`}
                    type={shown[k] ? 'text' : 'password'}
                    value={values[k] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [k]: e.target.value }))}
                    autoComplete="new-password"
                    spellCheck={false}
                    aria-invalid={err ? true : undefined}
                    aria-describedby={err ? `fill-${k}-error` : undefined}
                    className="min-w-0 flex-1 font-mono"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setShown((prev) => ({ ...prev, [k]: !prev[k] }))}
                    aria-pressed={!!shown[k]}
                    aria-label={`${shown[k] ? 'Hide' : 'Show'} ${k}`}
                  >
                    {shown[k] ? 'Hide' : 'Show'}
                  </Button>
                </div>
                {err && (
                  <p id={`fill-${k}-error`} className="text-caption font-medium text-bad">
                    {err}
                  </p>
                )}
              </div>
            );
          })}
          <Field id="fill-comment" label="Comment (optional)" hint="The requester and approvers see it, and it goes in the audit log. Never put a value here.">
            {(p) => <Textarea {...p} rows={2} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />}
          </Field>
          {error && (
            <Banner tone="error" title="Not sent.">
              {error}
            </Banner>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-rule px-5 py-3.5">
          <Button type="button" variant="danger" onClick={() => setRefusing(true)} disabled={fill.isPending}>
            Refuse…
          </Button>
          <Button type="submit" variant="primary" disabled={fill.isPending} aria-busy={fill.isPending}>
            {fill.isPending ? 'Sending…' : `Send ${keys.length === 1 ? 'value' : `${keys.length} values`}`}
          </Button>
        </div>
      </form>
      {refusing && <RefuseDialog r={r} onClose={() => setRefusing(false)} />}
    </>
  );
}

function RefuseDialog({ r, onClose }: { r: AccessRequest; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const refuse = useRefuseCrossTeam(r.id);
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const len = reason.trim().length;
  const fieldError = tried && len < REASON_MIN ? `Give a reason of at least ${REASON_MIN} characters (${len} so far).` : undefined;

  const confirm = async () => {
    setTried(true);
    if (len < REASON_MIN) {
      document.getElementById('refuse-reason')?.focus();
      return;
    }
    try {
      await refuse.mutateAsync({ reason: reason.trim() });
      toast(`Refused ${requestRef(r.id)}.`);
      navigate('/inbox');
    } catch {
      // Shown below.
    }
  };

  return (
    <Dialog
      title={`Refuse ${requestRef(r.id)}?`}
      onClose={onClose}
      dismissible={!refuse.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={refuse.isPending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={refuse.isPending} aria-busy={refuse.isPending}>
            {refuse.isPending ? 'Refusing…' : 'Refuse request'}
          </Button>
        </>
      }
    >
      <p className="text-muted">The request closes as refused. The requester sees your reason and can ask again.</p>
      <Field id="refuse-reason" label="Reason" hint="For example: these keys belong to another service, or ask the payments on-call instead." error={fieldError}>
        {(p) => <Textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} data-autofocus />}
      </Field>
      {refuse.isError && (
        <Banner tone="error" title="Not refused.">
          {describe(refuse.error)}
        </Banner>
      )}
    </Dialog>
  );
}

function Details({ r, now }: { r: AccessRequest; now: number }) {
  const rows: [string, ReactNode][] = [
    ['From', r.requester_display ?? 'Someone'],
    ['Their project', r.source_project_name ?? '—'],
    ['Asked of', [r.target_team_name, r.target_project_name, r.target_environment_name].filter(Boolean).join(' · ') || '—'],
    [
      'Destination',
      <span key="d">
        {r.destination_provider_label ?? r.target_provider_type}
        {r.destination_secret_ref && <Path value={r.destination_secret_ref} className="block" />}
      </span>,
    ],
    ['Asked', formatExact(r.created_at)],
    ['Time left', <FillWindow key="w" expiresAt={r.fill_expires_at} now={now} />],
  ];
  return (
    <aside className="flex flex-col gap-6">
      <section className="rounded-md border border-border bg-surface">
        <h2 className="border-b border-rule px-5 py-3.5 text-block-heading text-ink">Request</h2>
        <dl className="m-0 px-5 py-1">
          {rows.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal last:border-0">
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="rounded-md border border-border bg-surface">
        <h2 className="border-b border-rule px-5 py-3.5 text-block-heading text-ink">Justification</h2>
        <p className="whitespace-pre-wrap break-words px-5 py-4 text-ui font-normal">{r.justification}</p>
      </section>
    </aside>
  );
}

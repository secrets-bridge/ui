/**
 * Slice N5 — /inbox/:request_id: fill (or refuse) a cross-team request.
 *
 * Per §5 design + hard rules:
 *   - Per-key <input type="password"> with per-row visibility toggle
 *     (default masked, NO auto-reveal)
 *   - Optional fill_comment (small textarea)
 *   - Refuse opens an inline confirm with reason ≥ 10 chars
 *   - Submit base64-encodes per key, calls useFillCrossTeam, wipes
 *     state on success AND on unmount (defense in depth — values must
 *     NOT survive navigation)
 *   - NO localStorage / sessionStorage / IndexedDB writes (never)
 *   - NO service-worker cache (this is just a normal fetch)
 */

import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  crossTeamErrorMessage,
  useFillCrossTeam,
  useRefuseCrossTeam,
} from '../api/crossTeam';
import { useRequest } from '../api/requests';
import { useAuth } from '../auth/AuthContext';
import { Button } from '../ui/Button';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { extractErrorCode } from './CrossTeamSubmitDrawer';

export function InboxFill() {
  const { hasPermission } = useAuth();
  if (!hasPermission('secret.value.provide')) {
    return <Navigate to="/" replace />;
  }
  return <InboxFillView />;
}

function InboxFillView() {
  const { request_id: id } = useParams<{ request_id: string }>();
  const navigate = useNavigate();
  const req = useRequest(id);
  const fill = useFillCrossTeam(id ?? '');
  const refuse = useRefuseCrossTeam(id ?? '');

  // Plaintext lives in React state only. The full set is purged on
  // submit-success AND on unmount (the cleanup effect below). Order is
  // preserved by the keys array sourced from the request payload.
  const [values, setValues] = useState<Record<string, string>>({});
  const [reveal, setReveal] = useState<Record<string, boolean>>({});
  const [fillComment, setFillComment] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [refuseOpen, setRefuseOpen] = useState(false);
  const [refuseReason, setRefuseReason] = useState('');

  // Hard rule: wipe values on unmount. The browser GCs the strings
  // eventually anyway, but clearing the map drops the only reference
  // we hold immediately. No localStorage / sessionStorage to flush —
  // we never wrote them anywhere persistent.
  useEffect(() => {
    return () => {
      setValues({});
      setReveal({});
    };
  }, []);

  if (req.isLoading) {
    return <p className="p-6 text-muted">Loading…</p>;
  }
  if (!req.data) {
    return <p className="p-6 text-muted">Request not found.</p>;
  }

  const r = req.data;
  if (r.type !== 'cross_team') {
    return (
      <p className="p-6 text-muted">
        This is not a cross-team request.{' '}
        <Link to={`/requests/${r.id}`} className="text-accent underline">
          Open in Requests
        </Link>
        .
      </p>
    );
  }
  if (r.status !== 'pending_values') {
    return (
      <p className="p-6 text-muted">
        This request is no longer pending values (status: {r.status}). View
        details in{' '}
        <Link to={`/requests/${r.id}`} className="text-accent underline">
          Requests
        </Link>
        .
      </p>
    );
  }

  const keys = r.destination_keys ?? r.target_keys ?? [];
  const allFilled = keys.every((k) => (values[k] ?? '').length > 0);

  const onSubmit = async () => {
    setError(null);
    if (!allFilled) {
      setError('Provide a value for every key, or use Refuse if you cannot.');
      return;
    }
    // Base64-encode each value locally for binary safety on the wire
    // (matches the patch flow's posture).
    const encoded: Record<string, string> = {};
    for (const k of keys) {
      encoded[k] = btoa(values[k] ?? '');
    }
    try {
      await fill.mutateAsync({
        key_values: encoded,
        fill_comment: fillComment.trim() || undefined,
      });
      // Wipe plaintext immediately on success. The unmount effect is
      // the safety net.
      setValues({});
      setReveal({});
      setFillComment('');
      navigate('/inbox');
    } catch (err) {
      if (err instanceof ApiError) {
        const code = extractErrorCode(err);
        setError(crossTeamErrorMessage(code) ?? `${err.status} · ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  };

  const onRefuse = async () => {
    setError(null);
    if (refuseReason.trim().length < 10) {
      setError('Refuse reason needs at least 10 characters.');
      return;
    }
    try {
      await refuse.mutateAsync({ reason: refuseReason.trim() });
      navigate('/inbox');
    } catch (err) {
      if (err instanceof ApiError) {
        const code = extractErrorCode(err);
        setError(crossTeamErrorMessage(code) ?? `${err.status} · ${err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(String(err));
      }
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-5">
      <PageHeader
        title="Fill cross-team request"
        description={`from ${r.requester_id} · ${r.source_project_name ?? r.source_project_id ?? ''}`}
      />

      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold text-sm">Destination</h3>
        </CardHeader>
        <CardBody className="text-sm space-y-1">
          <p className="text-muted">
            <span className="text-text">{r.destination_provider_label ?? r.target_provider_type}</span>
            {r.destination_secret_ref && (
              <>
                {' · '}
                <span className="font-mono text-text">{r.destination_secret_ref}</span>
              </>
            )}
          </p>
          <p className="text-muted">Target team: <span className="text-text">{r.target_team_name ?? r.target_team_id}</span></p>
          <p className="text-muted">Target project / env: <span className="text-text">{r.target_project_name ?? r.target_project_id} / {r.target_environment_name ?? r.target_environment_id}</span></p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold text-sm">Justification</h3>
        </CardHeader>
        <CardBody className="text-sm text-muted whitespace-pre-wrap">
          {r.justification}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold text-sm">Values</h3>
          <span className="text-muted text-xs">
            {keys.length} {keys.length === 1 ? 'key' : 'keys'}
          </span>
        </CardHeader>
        <CardBody className="space-y-3">
          {keys.map((k) => (
            <div key={k}>
              <label className="block text-[11px] text-muted font-medium uppercase tracking-wider font-mono">
                {k}
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  type={reveal[k] ? 'text' : 'password'}
                  value={values[k] ?? ''}
                  onChange={(e) =>
                    setValues((prev) => ({ ...prev, [k]: e.target.value }))
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="flex-1 bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
                />
                <button
                  type="button"
                  onClick={() =>
                    setReveal((prev) => ({ ...prev, [k]: !prev[k] }))
                  }
                  className="px-3 py-2 text-xs text-muted hover:text-text border border-border rounded-lg"
                  title={reveal[k] ? 'Hide value' : 'Show value (one-shot)'}
                >
                  {reveal[k] ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
          ))}

          <div>
            <label className="block text-[11px] text-muted font-medium uppercase tracking-wider">
              Comment (optional)
            </label>
            <textarea
              value={fillComment}
              onChange={(e) => setFillComment(e.target.value)}
              rows={2}
              placeholder="Visible to the requester + approver in the audit trail."
              className="mt-1 w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            />
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 border-l-4 border-l-red-500 rounded-lg px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      {!refuseOpen && (
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
          <Button
            variant="danger"
            size="md"
            onClick={() => setRefuseOpen(true)}
            disabled={fill.isPending || refuse.isPending}
          >
            Refuse
          </Button>
          <Button
            variant="primary"
            size="md"
            disabled={!allFilled || fill.isPending}
            onClick={() => void onSubmit()}
          >
            {fill.isPending ? 'Submitting…' : 'Fill request'}
          </Button>
        </div>
      )}

      {refuseOpen && (
        <Card>
          <CardHeader>
            <h3 className="text-text font-semibold text-sm">Refuse this request</h3>
          </CardHeader>
          <CardBody className="space-y-2">
            <p className="text-muted text-xs">
              The requester will see your reason. Refusing closes the
              fill window; the request transitions to refused.
            </p>
            <textarea
              value={refuseReason}
              onChange={(e) => setRefuseReason(e.target.value)}
              rows={3}
              placeholder="Why are you refusing this request? (≥ 10 chars)"
              className="w-full bg-bg border border-border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40"
            />
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
              <Button variant="secondary" size="md" onClick={() => setRefuseOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="md"
                disabled={refuseReason.trim().length < 10 || refuse.isPending}
                onClick={() => void onRefuse()}
              >
                {refuse.isPending ? 'Refusing…' : 'Confirm refuse'}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

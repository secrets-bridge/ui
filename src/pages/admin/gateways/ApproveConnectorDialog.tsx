/**
 * Approve a connector (global gateway.bind, fresh second factor). With
 * discovery on, the admin approves a scope: the dialog shows the latest
 * upload's AppProjects and the digest, and sends that digest back, so a
 * scope that changes while it is open answers scope_digest_changed.
 *
 * Approve stays disabled until the api would accept it: the replicas
 * agree, the upload is of the scope they report, and every AppProject
 * has a team.
 */

import { ApiError } from '../../../api/client';
import { missingFactorText } from '../../../api/mfaErrors';
import { type GatewayConnector, useApproveConnector, useProjectTeams } from '../../../api/gateways';
import { useTeams } from '../../../api/teams';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { ToneStatus } from '../../../ui/Status';
import { useToast } from '../../../ui/toastContext';

const APPROVE_ERRORS: Record<string, string> = {
  scope_digest_changed: 'The scope changed while this was open. Review it again.',
  project_mapping_incomplete: 'Every AppProject needs a team first.',
};

interface Props {
  gatewayId: string;
  connector: GatewayConnector;
  onClose: () => void;
  onMapTeams: () => void;
}

export function ApproveConnectorDialog({ gatewayId, connector, onClose, onMapTeams }: Props) {
  const discovery = !!connector.discovery_enabled;
  const approve = useApproveConnector();
  const toast = useToast();
  const mapping = useProjectTeams(gatewayId, connector.id, discovery);
  const teams = useTeams();

  const digest = connector.scope_digest;
  const waiting = discovery && digest !== connector.discovery_scope_digest;
  const incomplete = discovery && mapping.isSuccess && !mapping.data.complete;
  const blocked = !!connector.scope_mismatch || waiting || incomplete || (discovery && !mapping.isSuccess);

  const teamName = new Map((teams.data ?? []).map((t) => [t.id, t.name]));
  const allowed = [...(mapping.data?.allowed_projects ?? [])].sort();
  const mapped = new Map((mapping.data?.mappings ?? []).map((m) => [m.app_project, m.team_ids ?? []]));
  const removed = [...mapped.keys()].filter((p) => !allowed.includes(p)).sort();

  const close = () => {
    approve.reset();
    onClose();
  };

  return (
    <Dialog
      title={`Approve ${connector.connector_id}?`}
      onClose={close}
      dismissible={!approve.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={close} disabled={approve.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={approve.isPending || blocked}
            aria-busy={approve.isPending}
            onClick={async () => {
              try {
                await approve.mutateAsync({ gatewayId, connectorId: connector.id, scopeDigest: digest });
                toast(`Approved ${connector.connector_id}.`);
                onClose();
              } catch {
                // Shown below.
              }
            }}
          >
            {approve.isPending ? 'Working…' : 'Approve connector'}
          </Button>
        </>
      }
    >
      <p className="text-muted">
        {discovery
          ? 'Teams can then see and bind the targets in these AppProjects.'
          : 'Its advertised Argo CD targets can then be bound to an environment.'}{' '}
        Approving grants the Gateway nothing in Argo CD; it keeps the read-only rights it has.
      </p>

      {discovery && mapping.isLoading && <p className="text-muted">Loading the mapping…</p>}
      {mapping.isError && (
        <Banner tone="error" title="Couldn't load the mapping.">
          {mapping.error instanceof ApiError ? `${mapping.error.status}: ${mapping.error.message}` : 'Network error.'}
        </Banner>
      )}
      {discovery && !waiting && (allowed.length > 0 || removed.length > 0) && (
        <ul className="m-0 list-none rounded-md border border-border p-0 text-ui">
          {allowed.map((p) => {
            const ids = mapped.get(p) ?? [];
            return (
              <li key={p} className="flex flex-wrap items-center justify-between gap-x-3 border-t border-rule px-3 py-2 first:border-t-0">
                <span className="font-mono text-mono-small break-all text-ink">{p}</span>
                {ids.length ? (
                  <span className="text-muted">{ids.map((id) => teamName.get(id) ?? id).join(', ')}</span>
                ) : (
                  <ToneStatus tone="warn">{mapped.size > 0 ? 'New, no team' : 'No team'}</ToneStatus>
                )}
              </li>
            );
          })}
          {removed.map((p) => (
            <li key={p} className="flex flex-wrap items-center justify-between gap-x-3 border-t border-rule px-3 py-2 first:border-t-0">
              <span className="font-mono text-mono-small break-all text-muted">{p}</span>
              <ToneStatus tone="neutral">Removed from the scope</ToneStatus>
            </li>
          ))}
        </ul>
      )}
      {digest && (
        <p className="text-caption text-muted">
          Scope <span className="font-mono text-mono-small break-all text-ink">{digest}</span>
        </p>
      )}

      {connector.scope_mismatch && (
        <Banner tone="note" title="The Gateway replicas disagree on the scope.">
          Finish the rollout. This can be approved once they agree.
        </Banner>
      )}
      {!connector.scope_mismatch && waiting && (
        <Banner tone="note" title="Waiting for the Gateway's next catalog.">
          The AppProjects to review arrive with it. This usually takes a few minutes.
        </Banner>
      )}
      {!waiting && incomplete && (
        <Banner
          tone="note"
          title="Every AppProject needs a team first."
          action={
            <Button variant="secondary" size="sm" onClick={onMapTeams}>
              Map teams…
            </Button>
          }
        >
          Teams only see targets in the AppProjects mapped to them.
        </Banner>
      )}
      {approve.isError && (
        <Banner tone="error" title="Not approved.">
          {missingFactorText(approve.error, 'nothing changed') ??
            (approve.error instanceof ApiError ? `${approve.error.status}: ${APPROVE_ERRORS[approve.error.message] ?? approve.error.message}` : 'Network error. Try again.')}
        </Banner>
      )}
    </Dialog>
  );
}

/**
 * An environment's observation source: who observes a change after the
 * agent has written it. Reading needs gateway.list, changing it
 * gateway.bind. The options are Gateway and None; the control plane no
 * longer observes Argo CD itself (secrets-bridge/gateway#13).
 *
 *   GET /admin/environments/:id/observation-source
 *   PUT /admin/environments/:id/observation-source {observation_source}
 *
 * Saving needs a fresh second factor; client.ts runs the step-up dialog.
 * Switching away from Gateway cancels the environment's open Gateway
 * tasks, so the dialog says so before saving.
 */

import { useState } from 'react';

import { ApiError } from '../../../api/client';
import { type ObservationSource, useObservationSource, useSetObservationSource } from '../../../api/gateways';
import type { Environment } from '../../../api/types';
import { useAuth } from '../../../auth/AuthContext';
import { SOURCE_LABEL, SOURCE_MEANING } from '../../../lib/gatewayStatus';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Dialog } from '../../../ui/Dialog';
import { useToast } from '../../../ui/toastContext';

const SOURCES: ObservationSource[] = ['gateway', 'none'];

export function ObservationSourceCell({ env }: { env: Environment }) {
  const { hasPermission } = useAuth();
  const canChange = hasPermission('gateway.bind');
  const source = useObservationSource(env.id);
  const [editing, setEditing] = useState(false);
  if (source.isLoading) return <span className="text-muted">…</span>;
  if (source.isError) {
    return <span className="text-caption text-bad">{source.error instanceof ApiError ? `${source.error.status}: ${source.error.message}` : 'Network error'}</span>;
  }
  const current = source.data ?? 'none';
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span>{SOURCE_LABEL[current] ?? current}</span>
      {canChange && (
        <Button variant="quiet" size="sm" onClick={() => setEditing(true)} aria-label={`Change observation for ${env.name}`}>
          Change…
        </Button>
      )}
      {editing && <ObservationSourceDialog env={env} current={current} onClose={() => setEditing(false)} />}
    </span>
  );
}

function ObservationSourceDialog({ env, current, onClose }: { env: Environment; current: ObservationSource; onClose: () => void }) {
  const set = useSetObservationSource();
  const toast = useToast();
  const [choice, setChoice] = useState<ObservationSource>(current);
  const leavingGateway = current === 'gateway' && choice !== 'gateway';

  return (
    <Dialog
      title={`Observation for ${env.name}`}
      onClose={onClose}
      dismissible={!set.isPending}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={set.isPending}>
            Cancel
          </Button>
          <Button
            variant={leavingGateway ? 'danger' : 'primary'}
            disabled={set.isPending || choice === current}
            aria-busy={set.isPending}
            onClick={async () => {
              try {
                const res = await set.mutateAsync({ envId: env.id, source: choice });
                toast(
                  `${env.name} is now observed by: ${SOURCE_LABEL[res.observation_source] ?? res.observation_source}.` +
                    (res.tasks_cancelled ? ` ${res.tasks_cancelled} open Gateway ${res.tasks_cancelled === 1 ? 'task was' : 'tasks were'} cancelled.` : ''),
                );
                onClose();
              } catch {
                // Shown below.
              }
            }}
          >
            {set.isPending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <fieldset className="m-0 flex flex-col gap-2.5 border-0 p-0">
        <legend className="mb-1 text-ui font-normal text-muted">Who observes a change in this environment after the agent writes it.</legend>
        {SOURCES.map((s) => (
          <label key={s} className="flex items-start gap-2 text-ui font-normal">
            <input type="radio" name={`obs-${env.id}`} className="mt-1" checked={choice === s} onChange={() => setChoice(s)} data-autofocus={s === current ? true : undefined} />
            <span>
              <span className="font-medium text-ink">{SOURCE_LABEL[s]}</span>
              <span className="block text-caption text-muted">{SOURCE_MEANING[s]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {leavingGateway && (
        <Banner tone="error" title="Open Gateway tasks will be cancelled.">
          Switching away from Gateway cancels every open Gateway observation task in {env.name}. The requests themselves are not
          affected.
        </Banner>
      )}
      {set.isError && (
        <Banner tone="error" title="Not saved.">
          {set.error instanceof ApiError ? `${set.error.status}: ${set.error.message}` : 'Network error.'}
        </Banner>
      )}
    </Dialog>
  );
}

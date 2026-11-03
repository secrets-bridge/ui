/**
 * Map a connector's AppProjects to teams (PUT .../project-teams, global
 * gateway.bind, fresh second factor). It has its own drawer because the
 * mapping stays editable after approval.
 *
 * The list is the latest upload's AppProjects. One no longer in that
 * upload is shown as removed and dropped on save, since the api refuses
 * an AppProject it doesn't know. The write is a full replace: a change
 * that leaves a binding's project uncovered suspends that binding.
 */

import { useMemo, useState } from 'react';

import { ApiError } from '../../../api/client';
import { missingFactorText } from '../../../api/mfaErrors';
import { type GatewayConnector, type ProjectTeams, usePutProjectTeams, useProjectTeams } from '../../../api/gateways';
import { useTeams, type Team } from '../../../api/teams';
import { Banner } from '../../../ui/Banner';
import { Button } from '../../../ui/Button';
import { Drawer } from '../../../ui/Drawer';
import { Select } from '../../../ui/Field';
import { ToneStatus } from '../../../ui/Status';
import { useToast } from '../../../ui/toastContext';

const MAX_TEAMS = 16;

const MAPPING_ERRORS: Record<string, string> = {
  project_mapping_incomplete: 'An approved connector needs a team on every AppProject.',
  unknown_app_project: 'The Gateway uploaded a new catalog while this was open. Reopen it to see the current AppProjects.',
  team_not_found: 'One of those teams no longer exists.',
};

export function ProjectMappingDrawer({ gatewayId, connector, onClose }: { gatewayId: string; connector: GatewayConnector; onClose: () => void }) {
  const current = useProjectTeams(gatewayId, connector.id);
  const put = usePutProjectTeams();
  const empty = !current.data?.allowed_projects?.length;
  return (
    <Drawer
      title={`Map teams: ${connector.connector_id}`}
      subtitle="Which teams can see and bind each AppProject's targets."
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={put.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="project-mapping" variant="primary" disabled={put.isPending || empty} aria-busy={put.isPending}>
            {put.isPending ? 'Saving…' : 'Save mapping'}
          </Button>
        </>
      }
    >
      {current.isLoading && <p className="text-muted">Loading the mapping…</p>}
      {current.isError && (
        <Banner tone="error" title="Couldn't load the mapping.">
          {current.error instanceof ApiError ? `${current.error.status}: ${current.error.message}` : 'Network error.'}
        </Banner>
      )}
      {current.data && <Form gatewayId={gatewayId} connector={connector} current={current.data} put={put} onClose={onClose} />}
    </Drawer>
  );
}

interface FormProps {
  gatewayId: string;
  connector: GatewayConnector;
  current: ProjectTeams;
  put: ReturnType<typeof usePutProjectTeams>;
  onClose: () => void;
}

function Form({ gatewayId, connector, current, put, onClose }: FormProps) {
  const teams = useTeams();
  const toast = useToast();
  const allowed = useMemo(() => [...(current.allowed_projects ?? [])].sort(), [current.allowed_projects]);
  const mapped = useMemo(() => new Map((current.mappings ?? []).map((m) => [m.app_project, m.team_ids ?? []])), [current.mappings]);
  const removed = [...mapped.keys()].filter((p) => !allowed.includes(p)).sort();
  const [draft, setDraft] = useState<Record<string, string[]>>(() => Object.fromEntries(allowed.map((p) => [p, mapped.get(p) ?? []])));

  const active = (teams.data ?? []).filter((t) => t.status === 'active').sort((a, b) => a.name.localeCompare(b.name));
  const teamName = new Map((teams.data ?? []).map((t: Team) => [t.id, t.name]));
  const unmapped = allowed.filter((p) => !draft[p]?.length).length;

  const save = async () => {
    const mappings = allowed.filter((p) => draft[p]?.length).map((p) => ({ app_project: p, team_ids: draft[p] }));
    try {
      await put.mutateAsync({ gatewayId, connectorId: connector.id, mappings });
      toast(`Saved the team mapping for ${connector.connector_id}.`);
      onClose();
    } catch {
      // Shown in the banner below.
    }
  };

  return (
    <form
      id="project-mapping"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      className="flex flex-col gap-4"
    >
      {allowed.length === 0 ? (
        <p className="text-muted">No catalog yet. The AppProjects appear after the Gateway's first upload.</p>
      ) : (
        <ul className="m-0 list-none rounded-lg border border-border p-0">
          {allowed.map((p) => {
            const ids = draft[p] ?? [];
            const options = active.filter((t) => !ids.includes(t.id));
            return (
              <li key={p} className="flex flex-col gap-2 border-t border-rule px-3.5 py-3 first:border-t-0">
                <p className="flex flex-wrap items-center gap-x-3">
                  <span className="font-mono text-mono break-all text-ink">{p}</span>
                  {mapped.size > 0 && !mapped.has(p) && <ToneStatus tone="warn">New</ToneStatus>}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {ids.map((id) => (
                    <button
                      key={id}
                      type="button"
                      aria-label={`Remove team ${teamName.get(id) ?? id} from ${p}`}
                      onClick={() => setDraft({ ...draft, [p]: ids.filter((x) => x !== id) })}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-border px-2 py-0.5 text-ui hover:border-bad-line"
                    >
                      {teamName.get(id) ?? id} <span aria-hidden="true">×</span>
                    </button>
                  ))}
                  {ids.length < MAX_TEAMS && (
                    <Select
                      aria-label={`Add a team to ${p}`}
                      value=""
                      onChange={(e) => e.target.value && setDraft({ ...draft, [p]: [...ids, e.target.value] })}
                      className="max-w-[240px]"
                    >
                      <option value="">Add a team</option>
                      {options.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {removed.length > 0 && (
        <p className="text-ui text-muted">
          No longer in the Gateway's scope, dropped on save: <span className="font-mono text-mono-small text-ink">{removed.join(', ')}</span>
        </p>
      )}
      {allowed.length > 0 && <p className="text-ui text-muted">A team also covers the teams below it. Bindings a change no longer covers are suspended.</p>}
      {unmapped > 0 && (
        <Banner tone="note" title={`${unmapped} ${unmapped === 1 ? 'AppProject has' : 'AppProjects have'} no team.`}>
          The connector can't be approved until every AppProject has one.
        </Banner>
      )}
      {put.isError && (
        <Banner tone="error" title="The mapping wasn't saved.">
          {missingFactorText(put.error, 'nothing changed') ??
            (put.error instanceof ApiError ? `${put.error.status}: ${MAPPING_ERRORS[put.error.message] ?? put.error.message}` : 'Network error. Try again.')}
        </Banner>
      )}
    </form>
  );
}

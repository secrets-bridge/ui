/**
 * Ask another team for values (cross-team request, Slice N5). Opened
 * from an environment page, which is the source: its provider
 * connections receive the values.
 *
 *   - Who has them: team, then one of its projects, then an environment.
 *   - Where they go: a provider connection bound to the source project
 *     and environment, the secret path, and the key names.
 *   - Justification: at least 10 characters, no pasted values. The
 *     other team's value provider and the approvers read it.
 *
 * Key names only, never values. Errors show under their field after a
 * submit attempt and focus moves to the first. `buildCrossTeamSubmitBody`
 * stays the single place the body is built and checked (every id a real
 * UUID, the source project present).
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../api/client';
import {
  buildCrossTeamSubmitBody,
  crossTeamErrorMessage,
  extractCrossTeamErrorCode,
  useProviderConnections,
  useSubmitCrossTeam,
} from '../api/crossTeam';
import { useEnvironmentsForProject, useProjects } from '../api/tenancy';
import { useTeams } from '../api/teams';
import type { MyProject } from '../api/types';
import { useAuth } from '../auth/AuthContext';
import { looksLikeASecret } from '../lib/justification';
import { providerLabel } from '../lib/providers';
import { requestRef } from '../lib/requestRef';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { Drawer } from '../ui/Drawer';
import { EnvTag } from '../ui/EnvTag';
import { Field, Input, Select, Textarea } from '../ui/Field';
import { Keys } from '../ui/Keys';
import { useToast } from '../ui/toastContext';

const WHY_MIN = 10;

interface Props {
  /** The requester's project; its provider connection receives the values. */
  sourceProject?: MyProject | null;
  /** The source environment; narrows the connections to its bindings. */
  sourceEnvironmentID?: string;
  onClose: () => void;
}

export function CrossTeamSubmitDrawer({ sourceProject, sourceEnvironmentID, onClose }: Props) {
  const { hasPermission } = useAuth();
  const toast = useToast();
  const teams = useTeams();
  const projects = useProjects();

  const [teamId, setTeamId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [envId, setEnvId] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [secretRef, setSecretRef] = useState('');
  const [keysText, setKeysText] = useState('');
  const [why, setWhy] = useState('');
  const [tried, setTried] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // A project belongs to a team through `team_id`; `owner_team_id` is the
  // legacy free-text field, empty on newer projects (ui#86).
  const teamProjects = useMemo(
    () => (projects.data ?? []).filter((p) => (p.team_id ?? p.owner_team_id ?? '') === teamId && p.status === 'active'),
    [projects.data, teamId],
  );
  const envs = useEnvironmentsForProject(projectId || undefined);
  const sourceEnv = sourceProject?.environments?.find((e) => e.id === sourceEnvironmentID);
  const connections = useProviderConnections(sourceProject?.id, sourceEnvironmentID);
  const keys = useMemo(() => [...new Set(keysText.split(/[\s,]+/).map((k) => k.trim()).filter(Boolean))], [keysText]);
  const submit = useSubmitCrossTeam();

  const build = buildCrossTeamSubmitBody({
    sourceProjectID: sourceProject?.id,
    sourceEnvironmentID,
    sourceEnvironmentName: sourceEnv?.name,
    targetTeamID: teamId,
    targetProjectID: projectId,
    targetEnvironmentID: envId,
    destinationProviderConnectionID: connectionId,
    destinationSecretRef: secretRef,
    destinationKeys: keys,
    justification: why,
  });

  const whyLen = why.trim().length;
  const errors: Record<string, string> = {};
  if (!teamId) errors.team = 'Choose the team that has the values.';
  else if (!projectId) errors.project = 'Choose one of their projects.';
  else if (!envId) errors.env = 'Choose the environment the values come from.';
  if (!connectionId) errors.connection = 'Choose where the values are written.';
  if (!secretRef.trim()) errors.ref = 'Enter the secret path the values are written to.';
  if (keys.length === 0) errors.keys = 'Name at least one key.';
  if (whyLen < WHY_MIN) errors.why = `Explain why in at least ${WHY_MIN} characters (${whyLen} so far).`;
  else if (looksLikeASecret(why)) errors.why = "This looks like it contains a secret value. Describe the need instead; don't paste values here.";
  const show = (k: string) => (tried ? errors[k] : undefined);
  const order = ['team', 'project', 'env', 'connection', 'ref', 'keys', 'why'];

  const onSubmit = async () => {
    setTried(true);
    setServerError(null);
    const first = order.find((k) => errors[k]);
    if (first) {
      document.getElementById(`ct-${first}`)?.focus();
      return;
    }
    if (!build.ok) {
      setServerError(build.errors.join(' '));
      return;
    }
    try {
      const created = await submit.mutateAsync(build.body);
      const team = teams.data?.find((t) => t.id === teamId)?.name ?? 'the other team';
      toast(`Asked ${team} for ${keys.length} ${keys.length === 1 ? 'value' : 'values'} (${requestRef(created.id)}).`, {
        to: `/requests/${created.id}`,
        label: 'Open it',
      });
      onClose();
    } catch (err) {
      setServerError(
        err instanceof ApiError
          ? `${err.status}: ${crossTeamErrorMessage(extractCrossTeamErrorCode(err.body)) ?? err.message}`
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  };

  const noConnections = connections.data && connections.data.length === 0;

  return (
    <Drawer
      title="Ask another team for values"
      subtitle={
        sourceProject ? (
          <>
            For {sourceProject.name} {sourceEnv && <EnvTag kind={sourceEnv.kind}>{sourceEnv.name}</EnvTag>}. Their value
            provider fills it, your approvers verify it, then an agent writes the values for you.
          </>
        ) : (
          'Open this from one of your environment pages.'
        )
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="cross-team" variant="primary" disabled={submit.isPending} aria-busy={submit.isPending}>
            {submit.isPending ? 'Sending…' : 'Send request'}
          </Button>
        </>
      }
    >
      <form
        id="cross-team"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
        className="flex flex-col gap-[18px]"
      >
        <fieldset className="flex min-w-0 flex-col gap-3.5">
          <legend className="mb-1 text-body font-semibold text-ink">Who has the values</legend>
          <Field id="ct-team" label="Team" error={show('team')}>
            {(p) => (
              <Select
                {...p}
                value={teamId}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setProjectId('');
                  setEnvId('');
                }}
                data-autofocus
              >
                <option value="">{teams.isLoading ? 'Loading teams…' : 'Choose a team'}</option>
                {(teams.data ?? [])
                  .filter((t) => t.status === 'active')
                  .map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
          <Field
            id="ct-project"
            label="Their project"
            hint={teamId && teamProjects.length === 0 && !projects.isLoading ? 'This team has no active projects.' : undefined}
            error={show('project')}
          >
            {(p) => (
              <Select
                {...p}
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setEnvId('');
                }}
                disabled={!teamId}
              >
                <option value="">Choose a project</option>
                {teamProjects.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="ct-env" label="Their environment" error={show('env')}>
            {(p) => (
              <Select {...p} value={envId} onChange={(e) => setEnvId(e.target.value)} disabled={!projectId}>
                <option value="">Choose an environment</option>
                {(envs.data ?? []).map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                    {(e.kind ?? e.type) === 'prod' ? ' (production)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </fieldset>

        <fieldset className="flex min-w-0 flex-col gap-3.5">
          <legend className="mb-1 text-body font-semibold text-ink">Where the values go</legend>
          <Field
            id="ct-connection"
            label="Provider connection"
            hint={noConnections ? undefined : 'Connections bound to your project and environment.'}
            error={show('connection')}
          >
            {(p) => (
              <Select {...p} value={connectionId} onChange={(e) => setConnectionId(e.target.value)} disabled={!!noConnections}>
                <option value="">{connections.isLoading ? 'Loading connections…' : 'Choose a connection'}</option>
                {(connections.data ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} · {providerLabel(c.type)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {noConnections && (
            <Banner title="No provider connection is bound here.">
              {hasPermission('integration.edit') ? (
                <>
                  Bind one on the environment page or in{' '}
                  <Link to="/admin/provider-connections" className="font-medium text-accent hover:underline">
                    Provider connections
                  </Link>{' '}
                  so the agent can write the values.
                </>
              ) : (
                'Ask the platform team to bind one to this project and environment.'
              )}
            </Banner>
          )}
          <Field id="ct-ref" label="Secret path" hint="Where the agent writes the values, in your provider." error={show('ref')}>
            {(p) => (
              <Input
                {...p}
                value={secretRef}
                onChange={(e) => setSecretRef(e.target.value)}
                placeholder="team-alpha/uat/db"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          <Field
            id="ct-keys"
            label="Keys"
            hint="Names only, separated by commas or spaces. The other team fills one value for each."
            error={show('keys')}
          >
            {(p) => (
              <Input
                {...p}
                value={keysText}
                onChange={(e) => setKeysText(e.target.value)}
                placeholder="DB_USERNAME, DB_PASSWORD"
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
              />
            )}
          </Field>
          {keys.length > 0 && <Keys keys={keys} variant="chips" />}
        </fieldset>

        <Field
          id="ct-why"
          label="Justification"
          hint={`The other team and your approvers read this. At least ${WHY_MIN} characters.`}
          error={show('why')}
        >
          {(p) => (
            <Textarea
              {...p}
              rows={3}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              placeholder="What needs these values, and why can't you get them yourself?"
              maxLength={1000}
            />
          )}
        </Field>

        {serverError && (
          <Banner tone="error" title="Not sent.">
            {serverError}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

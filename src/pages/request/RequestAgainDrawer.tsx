/**
 * Request again: the drawer that made a closed request, pre-filled from
 * it. A read or change request reopens with the same operation, keys and
 * reason, a cross-team request with the same teams, destination and keys.
 * It needs approval again. New values are never carried over; the api
 * doesn't return them, and a change request asks for them again.
 */

import { useMe } from '../../api/me';
import type { AccessRequest } from '../../api/types';
import { keysOf, pathOf } from '../../requests/describe';
import { requestScope } from '../../requests/scope';
import { CrossTeamSubmitDrawer } from '../CrossTeamSubmitDrawer';
import { RequestAccessDrawer } from '../RequestAccessDrawer';

interface Props {
  request: AccessRequest;
  onClose: () => void;
  onCreated: (id: string) => void;
}

export function RequestAgainDrawer({ request: r, onClose, onCreated }: Props) {
  const me = useMe();
  const { projectId, envName } = requestScope(r);

  if (r.type === 'cross_team') {
    const project = me.data?.projects.find((p) => p.id === projectId);
    return (
      <CrossTeamSubmitDrawer
        sourceProject={project}
        sourceEnvironmentID={project?.environments?.find((e) => e.name === envName)?.id}
        prefill={{
          teamId: r.target_team_id,
          projectId: r.target_project_id,
          envId: r.target_environment_id,
          connectionId: r.destination_provider_connection_id,
          secretRef: pathOf(r),
          keys: keysOf(r),
          why: r.justification,
        }}
        onClose={onClose}
        onCreated={onCreated}
      />
    );
  }

  return (
    <RequestAccessDrawer
      prefill={{ op: r.type, projectId, envName, secretRef: pathOf(r), keys: keysOf(r), why: r.justification }}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

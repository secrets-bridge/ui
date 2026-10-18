import type { Team } from '../../../api/teams';
import type { Project } from '../../../api/types';

/**
 * The team a project belongs to, for display: the team named by the
 * typed `team_id`, else the legacy free-text `owner_team_id`, else "—".
 */
export function projectTeamLabel(p: Project, teams: Team[]): string {
  if (p.team_id) return teams.find((t) => t.id === p.team_id)?.name ?? 'Unknown team';
  return p.owner_team_id || '—';
}

/**
 * EPIC R (api#108) Slice R3 — project picker for the sidebar
 * "Project policies" entry.
 *
 *   /projects/policies
 *
 * Behaviour per §5 Q13 lock:
 *   - Actor covers exactly one project → auto-route to that project's
 *     policies page (skips the picker noise).
 *   - Actor covers multiple → show a picker list (this page).
 *   - Actor covers none → "Nothing to author here" message.
 */

import { Navigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

import { useMe } from '../api/me';
import { Card, CardBody, CardHeader } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';

export function ProjectPoliciesPicker() {
  const me = useMe();

  if (me.isLoading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <Card>
          <CardBody>
            <p className="text-sm text-muted">Loading your projects…</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  const projects = me.data?.projects ?? [];

  if (projects.length === 1) {
    return <Navigate to={`/projects/${projects[0].id}/policies`} replace />;
  }

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <PageHeader
        title="Project policies"
        description="Pick a project to manage its non-prod policy rules."
      />
      <Card>
        <CardHeader>
          <h3 className="text-text font-semibold">Your projects</h3>
        </CardHeader>
        <CardBody>
          {projects.length === 0 ? (
            <p className="text-sm text-muted">
              You don't have any projects with policy authoring access yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id} className="py-3 flex items-center justify-between">
                  <span className="text-sm text-text">{p.name}</span>
                  <Link
                    to={`/projects/${p.id}/policies`}
                    className="text-[12px] text-accent hover:underline"
                  >
                    Manage policies →
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

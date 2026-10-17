/**
 * A project with its mark and, when there is one, its environment tag:
 * the way a scope is shown in tables, headers and detail rows.
 */

import { EntityMark } from './EntityMark';
import { EnvTag } from './EnvTag';

export function ScopeLabel({
  project,
  env,
  envKind,
  size = 'sm',
  logo,
}: {
  project: string;
  env?: string;
  envKind?: 'prod' | 'non_prod';
  size?: 'sm' | 'md';
  /** Logo URL; without one the initials tile shows. */
  logo?: string;
}) {
  const known = !!project && project !== '—';
  return (
    <span className="inline-flex max-w-full items-center gap-2 whitespace-nowrap">
      {known && <EntityMark name={project} size={size} src={logo} />}
      <span className="truncate">{project}</span>
      {env && <EnvTag kind={envKind}>{env}</EnvTag>}
    </span>
  );
}

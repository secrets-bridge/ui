/**
 * How the console names an Argo CD target. A name alone can't tell two
 * Applications apart, so it never appears without its AppProject,
 * namespace and id (ADR 0002 C5). The id is what the api binds.
 */

import { useToast } from '../../ui/toastContext';

function CopyId({ id }: { id: string }) {
  const toast = useToast();
  return (
    <button
      type="button"
      aria-label={`Copy target id ${id}`}
      onClick={() => {
        void navigator.clipboard.writeText(id).then(
          () => toast('Copied the target id.'),
          () => toast("Couldn't copy the target id."),
        );
      }}
      className="text-left font-mono text-mono-small whitespace-nowrap text-muted hover:text-accent-ink hover:underline"
    >
      {id}
    </button>
  );
}

interface Props {
  targetId: string;
  name?: string;
  appProject?: string;
  namespace?: string;
  /** A static target has no AppProject. */
  isStatic?: boolean;
}

export function TargetIdentity({ targetId, name, appProject, namespace, isStatic }: Props) {
  const place = [isStatic ? 'Static target' : appProject && `AppProject ${appProject}`, namespace && `namespace ${namespace}`]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className="flex min-w-0 flex-col">
      <span className="font-medium break-words text-ink">{name || 'Target details hidden'}</span>
      {place && <span className="text-caption text-muted">{place}</span>}
      <CopyId id={targetId} />
    </span>
  );
}

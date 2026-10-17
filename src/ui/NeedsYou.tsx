/**
 * The short strip of items the signed-in person should act on. Shown
 * only when it has items. Each item: ref, keys, scope, a one-line note
 * with a tone (`ok` for a reveal deadline, `bad` for a failure) and one
 * action.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ScopeLabel } from './ScopeLabel';

export interface NeedsYouItem {
  key: string;
  ref: string;
  to: string;
  keys: string;
  project: string;
  env?: string;
  envKind?: 'prod' | 'non_prod';
  note: string;
  tone: 'ok' | 'bad' | 'warn';
  action: ReactNode;
}

const TONE = { ok: 'text-ok', bad: 'text-bad', warn: 'text-warn' };

export function NeedsYou({ items }: { items: NeedsYouItem[] }) {
  // One grid for the whole list (each row a subgrid), so the columns line
  // up from row to row whatever the length of the keys or the note.
  return (
    <ul className="m-0 grid list-none grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] rounded-md border border-border bg-surface p-0 max-[700px]:block">
      {items.map((it) => (
        <li
          key={it.key}
          className="col-span-5 grid grid-cols-subgrid items-center gap-x-4 border-t border-rule px-3.5 py-2.5 first:border-t-0 max-[700px]:grid-cols-[minmax(0,1fr)_auto] max-[700px]:gap-x-3 max-[700px]:gap-y-1"
        >
          <Link to={it.to} className="whitespace-nowrap font-mono text-mono font-medium text-accent hover:underline max-[700px]:col-start-1">
            {it.ref}
          </Link>
          <span title={it.keys} className="truncate font-mono text-mono max-[700px]:col-start-1">
            {it.keys}
          </span>
          <span className="text-ui max-[700px]:col-start-1">
            <ScopeLabel project={it.project} env={it.env} envKind={it.envKind} />
          </span>
          <span className={'whitespace-nowrap text-caption max-[700px]:col-start-1 ' + TONE[it.tone]}>{it.note}</span>
          <span className="justify-self-end max-[700px]:col-start-2 max-[700px]:row-span-4 max-[700px]:row-start-1 max-[700px]:self-center">
            {it.action}
          </span>
        </li>
      ))}
    </ul>
  );
}

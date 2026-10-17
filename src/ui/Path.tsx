/**
 * A secret path in mono that wraps after a slash, never in the middle of
 * a segment ("example/payments/dev/" then "database", not "datab" + "ase").
 * A single segment longer than the line still breaks as a last resort.
 */

import { Fragment } from 'react';

export function Path({ value, className = '' }: { value: string; className?: string }) {
  const parts = value.split('/');
  return (
    <span className={'font-mono text-mono [overflow-wrap:anywhere] ' + className}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part}
          {i < parts.length - 1 && (
            <>
              /<wbr />
            </>
          )}
        </Fragment>
      ))}
    </span>
  );
}

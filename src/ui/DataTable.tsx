/**
 * The table every list of records uses. One row per record; the whole
 * row opens the record, and the first cell keeps a real link so the
 * row works by keyboard and in a new tab.
 *
 * The table scrolls sideways inside its own box; the page never does.
 * Pass `stacked` to render each row as a block at 700px and below
 * (Overview tables); the Requests table keeps scrolling instead.
 *
 * Never put a secret value in a cell.
 */

import type { MouseEvent, ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /** Visually hidden header (e.g. an action column). */
  hiddenHeader?: boolean;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible name of the table region. */
  label: string;
  onRowClick?: (row: T) => void;
  /** Phone layout for the row at 700px and below. */
  stacked?: (row: T) => ReactNode;
  minWidth?: number;
  /** Align cells to the top, for rows whose first cell runs to two lines. */
  alignTop?: boolean;
}

// A click on a control inside the row belongs to that control.
function fromControl(e: MouseEvent): boolean {
  return !!(e.target as HTMLElement).closest('a,button,input,select,textarea,label,summary');
}

export function DataTable<T>({ columns, rows, rowKey, label, onRowClick, stacked, minWidth = 640, alignTop }: Props<T>) {
  return (
    <>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className={
          'relative overflow-x-auto rounded-md border border-border bg-surface' +
          (stacked ? ' max-[700px]:hidden' : '')
        }
      >
        <table className="w-full border-collapse" style={{ minWidth }}>
          <thead>
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={
                    'whitespace-nowrap border-b border-border px-2.5 py-2 text-label text-muted ' +
                    (c.align === 'right' ? 'text-right' : 'text-left')
                  }
                >
                  {c.hiddenHeader ? <span className="sr-only">{c.header}</span> : c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={rowKey(r)}
                onClick={onRowClick ? (e) => !fromControl(e) && onRowClick(r) : undefined}
                className={
                  'border-t border-rule first:border-t-0 ' +
                  (onRowClick ? 'cursor-pointer hover:bg-sunken' : '')
                }
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={
                      'px-2.5 py-[9px] text-ui font-normal ' +
                      (alignTop ? 'align-top ' : 'align-middle ') +
                      (c.align === 'right' ? 'text-right ' : '') +
                      (c.className ?? '')
                    }
                  >
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {stacked && (
        <ul
          aria-label={label}
          className="hidden rounded-md border border-border bg-surface max-[700px]:block"
        >
          {rows.map((r) => (
            <li
              key={rowKey(r)}
              onClick={onRowClick ? (e) => !fromControl(e) && onRowClick(r) : undefined}
              className={'border-t border-rule px-2.5 py-3 first:border-t-0' + (onRowClick ? ' cursor-pointer' : '')}
            >
              {stacked(r)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

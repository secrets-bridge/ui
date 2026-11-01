/**
 * The counts at the top of a focus page, as a tablist. The count is the
 * first word of each tab's name, so a screen reader says "5 Needs you".
 * Arrow keys, Home and End move between tabs (roving tabindex), and Tab
 * leaves the list. Wrap the content in `<TabPanel>` with the same prefix.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface CounterDef {
  id: string;
  count: number;
  /** The rest of the name, after the count. */
  label: ReactNode;
}

interface Props {
  counters: CounterDef[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab and panel ids. */
  idPrefix: string;
}

export function Counters({ counters, value, onChange, label, idPrefix }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = counters.findIndex((c) => c.id === value);
    let j: number | null = null;
    if (e.key === 'ArrowRight') j = (i + 1) % counters.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + counters.length) % counters.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = counters.length - 1;
    if (j === null) return;
    e.preventDefault();
    const next = counters[j].id;
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(200px,100%),1fr))] overflow-hidden rounded-xl border border-border bg-bg"
    >
      {counters.map((c) => {
        const on = c.id === value;
        return (
          <button
            key={c.id}
            ref={(el) => {
              refs.current[c.id] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${c.id}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={on ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => onChange(c.id)}
            className={
              'relative flex flex-col items-start gap-0.5 border-r border-border px-[18px] py-3.5 text-left last:border-r-0 hover:bg-hover ' +
              (on ? 'bg-surface' : '')
            }
          >
            <span className={'text-count ' + (c.count === 0 ? 'text-muted' : 'text-ink')}>{c.count}</span>
            <span className={'text-caption ' + (on ? 'text-ink' : 'text-muted')}>{c.label}</span>
            {on && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[3px] bg-accent-ink" />}
          </button>
        );
      })}
    </div>
  );
}

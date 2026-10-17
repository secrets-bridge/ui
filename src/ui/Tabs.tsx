/**
 * Queue tabs with counts, for people with more than one queue
 * (approvers). Arrow keys, Home and End move between tabs (roving
 * tabindex). Wrap the content in `<TabPanel>` with the same prefix.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface TabDef {
  id: string;
  label: string;
  count?: number;
}

interface Props {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name of the tab list. */
  label: string;
  /** Prefix for tab and panel ids. */
  idPrefix: string;
}

export function Tabs({ tabs, value, onChange, label, idPrefix }: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = tabs.findIndex((t) => t.id === value);
    let j: number | null = null;
    if (e.key === 'ArrowRight') j = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') j = 0;
    else if (e.key === 'End') j = tabs.length - 1;
    if (j === null) return;
    e.preventDefault();
    const next = tabs[j].id;
    onChange(next);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={on ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => onChange(t.id)}
            className={
              '-mb-px inline-flex h-[34px] shrink-0 items-center gap-2 border-b-[3px] px-3 text-ui max-md:h-(--control-touch) ' +
              (on ? 'border-accent font-semibold text-ink' : 'border-transparent font-medium text-muted hover:text-ink')
            }
          >
            {t.label}
            {t.count !== undefined && <span className="font-mono text-mono-small">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ idPrefix, value, children }: { idPrefix: string; value: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={`${idPrefix}-panel`} aria-labelledby={`${idPrefix}-tab-${value}`}>
      {children}
    </div>
  );
}

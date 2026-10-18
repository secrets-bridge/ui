/**
 * Checkboxes for the keys a request covers. Pass the secret's key names
 * from the catalog and the selected names; at least one is required.
 */

import type { ReactNode } from 'react';

interface Props {
  id: string;
  keys: string[];
  selected: string[];
  onToggle: (key: string) => void;
  legend?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Focus the first key when the drawer or dialog opens. */
  autoFocus?: boolean;
}

export function KeyPicker({
  id,
  keys,
  selected,
  onToggle,
  legend = 'Keys',
  hint = 'Pick only the keys this task needs.',
  error,
  autoFocus,
}: Props) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <fieldset
      id={id}
      tabIndex={-1}
      aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
      className="flex min-w-0 flex-col gap-1.5"
    >
      <legend className="mb-1.5 p-0 text-body font-semibold text-ink">{legend}</legend>
      {hint && (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        {keys.map((k, i) => {
          const checked = selected.includes(k);
          return (
            <label
              key={k}
              className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border px-2.5 py-1.5 font-mono text-[13px] hover:bg-sunken max-md:min-h-(--control-touch)"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(k)}
                data-autofocus={autoFocus && i === 0 ? true : undefined}
                className="m-0 h-4 w-4 accent-accent"
              />
              {k}
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="text-caption font-medium text-bad">
          {error}
        </p>
      )}
    </fieldset>
  );
}

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
      <legend className="mb-1.5 p-0 text-ui font-semibold text-ink">{legend}</legend>
      {hint && (
        <p id={hintId} className="text-[13px] leading-[19px] text-muted">
          {hint}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {keys.map((k, i) => {
          const checked = selected.includes(k);
          return (
            <label
              key={k}
              className="flex min-h-(--control-md) max-w-full cursor-pointer items-center gap-2 rounded-md border border-edge bg-field px-3 font-mono text-mono [overflow-wrap:anywhere] hover:bg-hover has-[input:checked]:border-accent-ink has-[input:checked]:bg-accent-soft max-md:min-h-(--control-touch)"
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(k)}
                data-autofocus={autoFocus && i === 0 ? true : undefined}
                className="m-0 h-4 w-4 accent-accent-ink"
              />
              {k}
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="flex items-start gap-2 text-[13px] leading-[19px] text-bad">
          <span aria-hidden="true" className="mt-1.5 h-[7px] w-[7px] shrink-0 rotate-45 bg-bad" />
          <span className="min-w-0">{error}</span>
        </p>
      )}
    </fieldset>
  );
}

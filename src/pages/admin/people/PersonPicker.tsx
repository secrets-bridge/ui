/**
 * Choose a person by name or email (api#240). Two letters bring up the
 * matches; arrow keys and Enter or a click pick one, and a pasted user id
 * counts too. Disabled accounts show but can't be picked. Someone the
 * lookup refuses keeps the plain id box.
 */

import { forwardRef, useId, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react';

import { USER_SEARCH_MAX, USER_SEARCH_MIN, personName, useCanLookUpUsers, useUserSearch, useUsersByIds, type UserSummary } from '../../../api/users';
import { useDebounced } from '../../../lib/useDebounced';
import { Button } from '../../../ui/Button';
import { Input, type ControlProps } from '../../../ui/Field';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props extends ControlProps {
  /** The chosen user id, empty when nobody is chosen. */
  value: string;
  onChange: (id: string, person?: UserSummary) => void;
  /** Why this person can't be picked here, such as already being a member. */
  unavailable?: (person: UserSummary) => string | undefined;
  'data-autofocus'?: boolean;
}

export const PersonPicker = forwardRef<HTMLInputElement, Props>(({ value, onChange, unavailable, ...control }, ref) => {
  const canLookUp = useCanLookUpUsers();
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<UserSummary>();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement);

  const query = text.trim();
  const search = useUserSearch(useDebounced(query));
  const pasted = useUsersByIds(value && picked?.id !== value ? [value] : []).get(value);
  const chosen = picked?.id === value ? picked : pasted;

  if (!canLookUp) {
    return (
      <Input
        {...control}
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="00000000-0000-0000-0000-000000000000"
        className="w-full font-mono"
        autoComplete="off"
        spellCheck={false}
      />
    );
  }

  const whyNot = (u: UserSummary) => (u.disabled ? 'Disabled' : unavailable?.(u));
  const people = search.data ?? [];
  const pickable = people.filter((u) => !whyNot(u));
  const current = pickable[Math.min(active, pickable.length - 1)];
  const listOpen = open && !value && [...query].length >= USER_SEARCH_MIN;
  const optionId = (u: UserSummary) => `${listId}-${u.id}`;

  const pick = (u: UserSummary) => {
    setPicked(u);
    setText('');
    setOpen(false);
    onChange(u.id, u);
  };
  const clear = () => {
    setPicked(undefined);
    onChange('');
    input.current?.focus();
  };
  const type = (next: string) => {
    if (UUID.test(next.trim())) {
      setText('');
      setOpen(false);
      onChange(next.trim());
      return;
    }
    setText(next);
    setActive(0);
    setOpen(true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!listOpen) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (pickable.length === 0) return;
      const at = pickable.indexOf(current);
      setActive((at + (e.key === 'ArrowDown' ? 1 : pickable.length - 1)) % pickable.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (current) pick(current);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // The email is what tells two people of the same name apart, so it stays
  // readable under the box however long the name is.
  const detail = value ? [chosen?.display_name ? chosen.email : '', chosen?.disabled ? 'Disabled' : ''].filter(Boolean).join(' · ') : '';

  return (
    <div className="relative w-full min-w-0">
      <Input
        {...control}
        ref={input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={listOpen}
        aria-controls={listOpen && people.length > 0 ? listId : undefined}
        aria-activedescendant={listOpen && current ? optionId(current) : undefined}
        aria-describedby={[control['aria-describedby'], detail ? `${listId}-detail` : ''].filter(Boolean).join(' ') || undefined}
        value={value ? personName(value, chosen) : text}
        readOnly={!!value}
        title={value || undefined}
        onChange={(e) => type(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder="Search by name or email"
        className={`w-full truncate ${value ? 'pr-[84px]' : ''} ${value && !chosen ? 'font-mono' : ''}`}
        autoComplete="off"
        spellCheck={false}
      />
      {value && (
        <Button type="button" variant="quiet" size="sm" onClick={clear} className="absolute right-1 top-[calc(var(--control-md)/2)] -translate-y-1/2 max-md:top-[calc(var(--control-touch)/2)]">
          Change
        </Button>
      )}
      {detail && (
        <p id={`${listId}-detail`} className="mt-1.5 break-all text-caption text-muted">
          {detail}
        </p>
      )}
      {listOpen && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[300px] overflow-y-auto rounded-md border border-border bg-surface shadow-overlay">
          {people.length > 0 && (
            <ul id={listId} role="listbox" aria-label="Matching people" className="m-0 list-none p-1">
              {people.map((u) => {
                const why = whyNot(u);
                return (
                  <li
                    key={u.id}
                    id={optionId(u)}
                    role="option"
                    aria-selected={u === current}
                    aria-disabled={!!why}
                    // Keeps focus in the input, so the blur doesn't close the list first.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      if (!why) pick(u);
                    }}
                    className={`rounded-sm px-2.5 py-1.5 ${why ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-sunken'} ${u === current ? 'bg-sunken' : ''}`}
                  >
                    <span className="flex min-w-0 items-baseline justify-between gap-3">
                      <span className="truncate text-ui font-normal text-ink">{personName(u.id, u)}</span>
                      {why && <span className="shrink-0 text-caption text-muted">{why}</span>}
                    </span>
                    {u.display_name && <span className="block truncate text-caption text-muted">{u.email}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {search.isError ? (
            <p className="m-0 px-3 py-2 text-caption text-bad">Couldn't search. Paste the user id instead.</p>
          ) : people.length === 0 ? (
            <p className="m-0 px-3 py-2 text-caption text-muted">{search.isFetching || search.isPending ? 'Searching…' : `No one matches “${query}”.`}</p>
          ) : (
            people.length >= USER_SEARCH_MAX && (
              <p className="m-0 border-t border-rule px-3 py-2 text-caption text-muted">Showing the first {USER_SEARCH_MAX}. Keep typing to narrow it down.</p>
            )
          )}
        </div>
      )}
      <p role="status" className="sr-only">
        {listOpen && !search.isFetching && !search.isError ? `${people.length} ${people.length === 1 ? 'person' : 'people'} found.` : ''}
      </p>
    </div>
  );
});
PersonPicker.displayName = 'PersonPicker';

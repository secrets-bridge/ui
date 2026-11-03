/**
 * Form fields. Every field has an id, a visible label and, where
 * useful, a hint. On submit, set `error` on each invalid field and move
 * focus to the first one. Errors say what to do: "Explain the task in
 * at least 15 characters (5 so far)."
 *
 * `Field` wires the label, hint and error to the control through a
 * render prop, so it works with react-hook-form's `register`:
 *
 *   <Field id="why" label="Justification" hint="…" error={errors.why?.message}>
 *     {(p) => <Textarea {...p} {...register('why')} />}
 *   </Field>
 */

import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

export interface ControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

interface FieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: (props: ControlProps) => ReactNode;
}

export function Field({ id, label, hint, error, className = '', children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return (
    <div className={'flex min-w-0 flex-col gap-1.5 ' + className}>
      <label htmlFor={id} className="text-ui font-semibold text-ink">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-[13px] leading-[19px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-2 text-[13px] leading-[19px] text-bad">
          <span aria-hidden="true" className="mt-1.5 h-[7px] w-[7px] shrink-0 rotate-45 bg-bad" />
          <span className="min-w-0">{error}</span>
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'min-w-0 rounded-md border border-edge bg-field px-3 text-[14.5px] leading-5 font-normal text-ink enabled:hover:border-muted focus:border-accent-ink focus:outline-2 focus:outline-offset-1 focus:outline-accent-ink aria-[invalid=true]:border-bad disabled:cursor-not-allowed disabled:border-border disabled:bg-hover disabled:text-muted';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...rest }, ref) => (
    <input ref={ref} className={`${CONTROL} h-(--control-field) max-[900px]:h-(--control-touch) ${className}`} {...rest} />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', ...rest }, ref) => (
    <select ref={ref} className={`${CONTROL} select-chevron h-(--control-field) pr-9 max-[900px]:h-(--control-touch) ${className}`} {...rest} />
  ),
);
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', rows = 4, ...rest }, ref) => (
    <textarea ref={ref} rows={rows} className={`${CONTROL} min-h-[96px] resize-y py-2.5 leading-[22px] ${className}`} {...rest} />
  ),
);
Textarea.displayName = 'Textarea';

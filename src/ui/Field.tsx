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
      <label htmlFor={id} className="text-body font-semibold text-ink">
        {label}
      </label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && (
        <p id={hintId} className="text-caption text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-caption font-medium text-bad">
          {error}
        </p>
      )}
    </div>
  );
}

const CONTROL =
  'min-w-0 rounded-md border border-edge bg-surface px-2.5 text-ui font-normal text-ink aria-[invalid=true]:border-bad disabled:cursor-not-allowed disabled:opacity-60';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...rest }, ref) => (
    <input ref={ref} className={`${CONTROL} h-(--control-md) max-md:h-(--control-touch) ${className}`} {...rest} />
  ),
);
Input.displayName = 'Input';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', ...rest }, ref) => (
    <select ref={ref} className={`${CONTROL} h-(--control-md) max-md:h-(--control-touch) ${className}`} {...rest} />
  ),
);
Select.displayName = 'Select';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className = '', rows = 4, ...rest }, ref) => (
    <textarea ref={ref} rows={rows} className={`${CONTROL} min-h-[92px] py-2 leading-normal ${className}`} {...rest} />
  ),
);
Textarea.displayName = 'Textarea';

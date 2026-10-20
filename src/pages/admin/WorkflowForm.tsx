/**
 * Create or edit a workflow, in a drawer. A workflow sets how many
 * approvals a request needs, whether a reason is required, whether a
 * requester may approve their own request, and how long requests and
 * values last.
 *
 * Times are entered in seconds (the api's unit) with a plain-words
 * readout under each. Zod checks for fast feedback; the api checks too.
 *
 * Two fields are stored but not acted on by the current api:
 * wrap_ttl_claimed_seconds and notification_channels. Their hints say
 * so rather than promising behaviour.
 *
 * Built-in workflows (`is_system`) can be edited but not deleted.
 */

import { forwardRef, useEffect, type ChangeEvent, type FocusEvent, type ReactNode } from 'react';
import { useForm, useWatch, type SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

import type { Workflow, WorkflowInput } from '../../api/types';
import { Banner } from '../../ui/Banner';
import { Button } from '../../ui/Button';
import { Drawer } from '../../ui/Drawer';
import { Field, Input } from '../../ui/Field';
import { errorText, formatDuration } from './roles/format';

const seconds = (what: string) =>
  z.coerce
    .number({ message: `Enter ${what} in seconds.` })
    .int(`Enter ${what} as a whole number of seconds.`)
    .positive(`Enter ${what} as more than 0 seconds.`);

const schema = z.object({
  name: z.string().trim().min(1, 'Name the workflow.').max(120, 'Keep the name under 120 characters.'),
  description: z.string().max(500, 'Keep the description under 500 characters.').optional(),
  min_approvers: z.coerce
    .number({ message: 'Enter a number of approvals.' })
    .int('Enter a whole number of approvals.')
    .min(0, "Approvals can't be negative.")
    .max(20, 'Ask for at most 20 approvals.'),
  wrap_ttl_created_seconds: seconds('how long values wait'),
  wrap_ttl_approved_seconds: seconds('how long values stay available'),
  wrap_ttl_claimed_seconds: seconds('the claimed-values time'),
  request_ttl_seconds: seconds('when requests expire'),
  require_justification: z.boolean(),
  notification_channels_csv: z.string().optional(),
  enabled: z.boolean(),
  scoped_policy_authorable: z.boolean(),
});

// z.coerce.number() fields make the schema's input type differ from
// its output (zod 4 types coerce input as unknown), so the form holds
// the input shape and onValid receives the parsed output.
type FormInput = z.input<typeof schema>;
type FormShape = z.output<typeof schema>;

interface Props {
  initial?: Workflow;
  onSubmit: (body: WorkflowInput) => Promise<unknown>;
  onCancel: () => void;
  submitting: boolean;
  submitError?: unknown;
}

const defaults: FormShape = {
  name: '',
  description: '',
  min_approvers: 1,
  wrap_ttl_created_seconds: 7 * 24 * 3600,
  wrap_ttl_approved_seconds: 3600,
  wrap_ttl_claimed_seconds: 300,
  request_ttl_seconds: 7 * 24 * 3600,
  require_justification: true,
  notification_channels_csv: '',
  enabled: true,
  // R-follow-up #1 (api#118): off on create. Edit reseeds it from
  // `initial.scoped_policy_authorable`.
  scoped_policy_authorable: false,
};

export function WorkflowForm({ initial, onSubmit, onCancel, submitting, submitError }: Props) {
  const {
    register,
    handleSubmit,
    reset,
    control,
    formState: { errors, dirtyFields },
  } = useForm<FormInput, unknown, FormShape>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
  });

  useEffect(() => {
    if (initial) {
      reset({
        name: initial.name,
        description: initial.description ?? '',
        min_approvers: initial.min_approvers,
        wrap_ttl_created_seconds: initial.wrap_ttl_created_seconds,
        wrap_ttl_approved_seconds: initial.wrap_ttl_approved_seconds,
        wrap_ttl_claimed_seconds: initial.wrap_ttl_claimed_seconds,
        request_ttl_seconds: initial.request_ttl_seconds,
        require_justification: initial.require_justification,
        notification_channels_csv: (initial.notification_channels ?? []).join(', '),
        enabled: initial.enabled,
        // An older api response may lack the field: seed false, and the
        // submit below decides whether to send it.
        scoped_policy_authorable: initial.scoped_policy_authorable ?? false,
      });
    } else {
      reset(defaults);
    }
  }, [initial, reset]);

  const ttl = useWatch({
    control,
    name: ['request_ttl_seconds', 'wrap_ttl_created_seconds', 'wrap_ttl_approved_seconds', 'wrap_ttl_claimed_seconds'],
  });
  // The explanation, then the value in words so a wrong unit is obvious.
  const ttlHint = (explanation: string, v: unknown) => {
    const n = Number(v);
    return (
      <>
        {explanation}
        {Number.isFinite(n) && n > 0 && <span className="text-ink"> That's {formatDuration(n)}.</span>}
      </>
    );
  };

  const onValid: SubmitHandler<FormShape> = async (data) => {
    const channels =
      data.notification_channels_csv
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    // Every field this form shows is sent, a cleared description as "".
    // PUT /workflows/:id keeps the stored value for an absent key, so
    // leaving it out would not clear it. approver_role_id,
    // fill_ttl_seconds and requires_security_approval are not on this
    // form and stay out of the body so the api keeps them.
    const body: WorkflowInput = {
      name: data.name,
      description: data.description ?? '',
      min_approvers: data.min_approvers,
      wrap_ttl_created_seconds: data.wrap_ttl_created_seconds,
      wrap_ttl_approved_seconds: data.wrap_ttl_approved_seconds,
      wrap_ttl_claimed_seconds: data.wrap_ttl_claimed_seconds,
      request_ttl_seconds: data.request_ttl_seconds,
      require_justification: data.require_justification,
      notification_channels: channels,
      enabled: data.enabled,
    };
    // R-follow-up #1 (api#118) rolling-deploy safety: on create always
    // send the flag; on edit send it only when the loaded workflow had
    // it or the admin touched the box. Otherwise leave it out and the
    // api keeps the stored value, so an older response can't silently
    // switch every workflow off on the next save.
    const initialHadField = initial?.scoped_policy_authorable !== undefined;
    if (!initial || initialHadField || dirtyFields.scoped_policy_authorable) {
      body.scoped_policy_authorable = data.scoped_policy_authorable;
    }
    try {
      await onSubmit(body);
    } catch {
      // The caller's mutation holds the error; it shows below the form.
    }
  };

  return (
    <Drawer
      title={initial ? `Edit ${initial.name}` : 'Create workflow'}
      subtitle="How many approvals a request needs, and how long requests and values last."
      onClose={onCancel}
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" form="workflow-form" variant="primary" disabled={submitting} aria-busy={submitting}>
            {submitting ? 'Saving…' : initial ? 'Save workflow' : 'Create workflow'}
          </Button>
        </>
      }
    >
      <form id="workflow-form" noValidate onSubmit={handleSubmit(onValid)} className="flex flex-col gap-[18px]">
        {initial?.is_system && <Banner>This is a built-in workflow. You can edit it, but not delete it.</Banner>}

        <Field id="wf-name" label="Name" error={errors.name?.message}>
          {(p) => <Input {...p} {...register('name')} placeholder="standard" className="font-mono" autoComplete="off" spellCheck={false} data-autofocus />}
        </Field>
        <Field id="wf-description" label="Description (optional)" error={errors.description?.message}>
          {(p) => <Input {...p} {...register('description')} placeholder="One approver, values available for an hour" />}
        </Field>

        <Section title="Approvals">
          <Field
            id="wf-min"
            label="Approvals needed"
            hint="How many approvers must approve a request. The requester never counts: nobody can approve their own request."
            error={errors.min_approvers?.message}
          >
            {(p) => <Input {...p} type="number" min={0} max={20} {...register('min_approvers')} className="w-32" />}
          </Field>
          <Check
            label="Require a justification"
            hint="Requesters must say why they need access."
            {...register('require_justification')}
          />
        </Section>

        <Section title="Timing">
          <div className="grid grid-cols-1 gap-3.5 min-[600px]:grid-cols-2">
            <Field
              id="wf-request-ttl"
              label="Requests expire after (s)"
              hint={ttlHint('An undecided request expires this long after it was submitted.', ttl[0])}
              error={errors.request_ttl_seconds?.message}
            >
              {(p) => <Input {...p} type="number" min={1} {...register('request_ttl_seconds')} />}
            </Field>
            <Field
              id="wf-wrap-created"
              label="Values wait for approval (s)"
              hint={ttlHint('How long values sent with a request are kept while it waits.', ttl[1])}
              error={errors.wrap_ttl_created_seconds?.message}
            >
              {(p) => <Input {...p} type="number" min={1} {...register('wrap_ttl_created_seconds')} />}
            </Field>
            <Field
              id="wf-wrap-approved"
              label="Values available after approval (s)"
              hint={ttlHint('How long approved values can be revealed or picked up by the agent.', ttl[2])}
              error={errors.wrap_ttl_approved_seconds?.message}
            >
              {(p) => <Input {...p} type="number" min={1} {...register('wrap_ttl_approved_seconds')} />}
            </Field>
            <Field
              id="wf-wrap-claimed"
              label="Claimed values (s)"
              hint={ttlHint("Saved with the workflow; the current release doesn't apply it.", ttl[3])}
              error={errors.wrap_ttl_claimed_seconds?.message}
            >
              {(p) => <Input {...p} type="number" min={1} {...register('wrap_ttl_claimed_seconds')} />}
            </Field>
          </div>
        </Section>

        <Section title="Availability">
          <Check label="Enabled" hint="A disabled workflow isn't used for new requests." {...register('enabled')} />
          <Check
            label="Offer to project policy authors"
            hint="People with policy.author can pick it on a project's policies page. Off by default; administrators can always use it."
            {...register('scoped_policy_authorable')}
          />
          <Field
            id="wf-channels"
            label="Notification channels (optional)"
            hint="Comma-separated. Saved with the workflow; the current release doesn't send notifications."
          >
            {(p) => <Input {...p} {...register('notification_channels_csv')} placeholder="slack, email" autoComplete="off" />}
          </Field>
        </Section>

        {submitError != null && (
          <Banner tone="error" title={initial ? 'Not saved.' : 'Not created.'}>
            {errorText(submitError)}
          </Banner>
        )}
      </form>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3.5 border-t border-rule pt-4">
      <legend className="float-left mb-1 w-full text-body font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

// register() returns name, the handlers and a ref; the checkbox needs
// all of them. Without forwardRef the box opened unticked whatever the
// stored value and a click set the value to undefined, which failed the
// zod boolean and blocked the save.
type CheckProps = {
  label: string;
  hint?: string;
  name: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur: (e: FocusEvent<HTMLInputElement>) => void;
};
const Check = forwardRef<HTMLInputElement, CheckProps>(function Check({ label, hint, ...rest }, ref) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-ui font-normal text-ink max-md:min-h-(--control-touch)">
      <input type="checkbox" ref={ref} {...rest} className="mt-[3px] h-4 w-4 shrink-0 accent-accent" />
      <span>
        <span className="block font-medium">{label}</span>
        {hint && <span className="block text-caption text-muted">{hint}</span>}
      </span>
    </label>
  );
});

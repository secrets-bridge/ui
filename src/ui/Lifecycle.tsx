/**
 * The request's path as a compact stepper, under the title of the
 * request page. Each step: a square glyph, its name, and a short line
 * (who it waits on, counts, or the UTC time it happened).
 *
 *   done      solid ok square
 *   current   hollow warn square (waiting on someone or the agent)
 *   ready     hollow accent square (ready to reveal)
 *   stopped   solid bad square and the exact word (rejected, refused, failed)
 *   closed    hollow edge square and the word (expired, cancelled)
 *   upcoming  hollow edge square, muted
 *
 * An ordered list; the step that needs attention carries
 * aria-current="step", and a visually hidden sentence says where the
 * request is. Stacks vertically on phones.
 */

import type { LifecycleStep, StepState } from '../requests/lifecycle';
import { lifecycleSummary } from '../requests/lifecycle';
import { formatExact, formatShort } from '../lib/time';

const GLYPH: Record<StepState, string> = {
  done: 'bg-ok',
  current: 'border-2 border-warn',
  ready: 'border-2 border-accent',
  stopped: 'bg-bad',
  closed: 'border-[1.5px] border-edge',
  upcoming: 'border-[1.5px] border-edge',
};

export function Lifecycle({ steps, now }: { steps: LifecycleStep[]; now: number }) {
  const attention = steps.findIndex((s) => s.state !== 'done');
  return (
    <div className="mb-6">
      <p className="sr-only">{lifecycleSummary(steps)}</p>
      <ol
        aria-label="Request progress"
        className="m-0 grid list-none grid-flow-col auto-cols-fr gap-0 rounded-md border border-border bg-surface p-0 max-[600px]:grid-flow-row max-[600px]:auto-cols-auto"
      >
        {steps.map((s, i) => {
          const muted = s.state === 'upcoming';
          return (
            <li
              key={s.key}
              aria-current={i === attention ? 'step' : undefined}
              className={
                'relative min-w-0 border-l border-rule px-4 py-3 first:border-l-0 max-[600px]:border-l-0 max-[600px]:border-t max-[600px]:first:border-t-0 ' +
                (i === attention && s.state !== 'closed' ? 'bg-sunken' : '')
              }
            >
              <p className="m-0 flex items-center gap-2 text-ui">
                <span aria-hidden="true" className={'box-border h-2 w-2 shrink-0 ' + GLYPH[s.state]} />
                <span className={'truncate ' + (muted ? 'font-normal text-muted' : 'font-medium text-ink')}>{s.label}</span>
              </p>
              {(s.detail || s.time) && (
                <p className="m-0 mt-0.5 truncate pl-4 text-caption text-muted" title={s.time ? formatExact(s.time, true) : undefined}>
                  {s.detail}
                  {s.detail && s.time ? (s.state === 'ready' ? ' ' : ' · ') : ''}
                  {s.time && <time dateTime={s.time} className="font-mono text-mono-small">{formatShort(s.time, now)}{s.state === 'ready' ? ' UTC' : ''}</time>}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

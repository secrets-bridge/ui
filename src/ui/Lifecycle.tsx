/**
 * The request's path as a checkpoint route, under the title of the
 * request page. Each step: a node, its name, and a short line (who it
 * waits on, counts, or the UTC time it happened).
 *
 *   done      solid square, and the line to the next step is lit
 *   current   ring (waiting on someone or the agent)
 *   ready     filled ring (ready to reveal)
 *   stopped   diamond in bad and the exact word (rejected, refused, failed)
 *   closed    dashed square and the word (expired, cancelled)
 *   upcoming  hollow square, muted
 *
 * An ordered list; the step that needs attention carries
 * aria-current="step", and a visually hidden sentence says where the
 * request is. Stacks vertically on phones.
 */

import type { LifecycleStep, StepState } from '../requests/lifecycle';
import { lifecycleSummary } from '../requests/lifecycle';
import { formatExact, formatShort } from '../lib/time';

const NODE: Record<StepState, string> = {
  done: 'border-2 border-accent-ink bg-accent-ink',
  current: 'rounded-full border-[3px] border-accent-ink bg-surface',
  ready: 'rounded-full border-[3px] border-accent-ink bg-accent',
  stopped: 'rotate-45 scale-[.85] border-2 border-bad bg-bad',
  closed: 'border-2 border-dashed border-edge bg-surface',
  upcoming: 'border-2 border-edge bg-surface',
};

export function Lifecycle({ steps, now }: { steps: LifecycleStep[]; now: number }) {
  const attention = steps.findIndex((s) => s.state !== 'done');
  return (
    <div className="mb-6">
      <p className="sr-only">{lifecycleSummary(steps)}</p>
      <ol
        aria-label="Request progress"
        className="m-0 grid list-none auto-cols-fr grid-flow-col gap-0 rounded-xl border border-border bg-surface px-4 py-3.5 max-[600px]:grid-flow-row max-[600px]:auto-cols-auto"
      >
        {steps.map((s, i) => {
          const quiet = s.state === 'upcoming' || s.state === 'closed';
          const last = i === steps.length - 1;
          return (
            <li
              key={s.key}
              aria-current={i === attention ? 'step' : undefined}
              className="relative min-w-0 pr-2.5 pt-[22px] max-[600px]:pb-3.5 max-[600px]:pl-7 max-[600px]:pr-0 max-[600px]:pt-0"
            >
              {!last && (
                <span
                  aria-hidden="true"
                  className={
                    'absolute left-4 right-1 top-1.5 h-0.5 max-[600px]:bottom-0 max-[600px]:left-1.5 max-[600px]:right-auto max-[600px]:top-[18px] max-[600px]:h-auto max-[600px]:w-0.5 ' +
                    (s.state === 'done' ? 'bg-accent-ink' : 'bg-border')
                  }
                />
              )}
              <span aria-hidden="true" className={'absolute left-0 top-0 box-border h-3.5 w-3.5 ' + NODE[s.state]} />
              <p className={'m-0 truncate text-[13px] leading-[18px] ' + (quiet ? 'font-medium text-muted' : 'font-semibold text-ink')}>{s.label}</p>
              {(s.detail || s.time) && (
                <p className="m-0 truncate font-mono text-[11px] leading-[15px] text-muted" title={s.time ? formatExact(s.time, true) : undefined}>
                  {s.detail}
                  {s.detail && s.time ? (s.state === 'ready' ? ' ' : ' · ') : ''}
                  {s.time && <time dateTime={s.time}>{formatShort(s.time, now)}{s.state === 'ready' ? ' UTC' : ''}</time>}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

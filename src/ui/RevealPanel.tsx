/**
 * The bounded viewing panel: the only place a secret value appears.
 * Each key with its value, its own Copy button, the time left and Hide
 * now. Values come in through props from memory only; the parent drops
 * them on hide, at the deadline and on navigation.
 *
 * The wording about rotation and pasted copies is part of the component:
 * hiding clears this page, nothing else.
 */

import type { DecodedSecret } from '../lib/decodeSecret';
import { Button } from './Button';

export interface RevealedValue {
  key: string;
  value: DecodedSecret;
  copied?: boolean;
  /** Set when this one key couldn't be fetched. */
  error?: string;
}

interface Props {
  reference: string;
  values: RevealedValue[];
  secondsLeft: number;
  totalSeconds: number;
  onCopy: (key: string) => void;
  onHide: () => void;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function RevealPanel({ reference, values, secondsLeft, totalSeconds, onCopy, onHide }: Props) {
  const left = Math.max(0, secondsLeft);
  const pct = totalSeconds > 0 ? Math.round((left / totalSeconds) * 100) : 0;
  return (
    <div role="region" aria-label="Revealed values" className="rounded-md border border-ink bg-surface">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-b border-rule px-4 py-3">
        <b className="text-body font-semibold text-ink">Values for {reference}</b>
        <span role="timer" className="font-mono text-mono text-muted">
          Viewing closes in {clock(left)}
        </span>
        <span className="flex-1" />
        <Button variant="secondary" size="sm" onClick={onHide}>
          Hide now
        </Button>
      </div>
      <div aria-hidden="true" className="relative h-[3px] overflow-hidden bg-rule">
        <i className="absolute inset-y-0 left-0 bg-accent motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear" style={{ width: `${pct}%` }} />
      </div>
      <ul className="m-0 list-none p-0">
        {values.map((v) => (
          <li
            key={v.key}
            className="grid grid-cols-[180px_minmax(0,1fr)_auto] items-center gap-3 border-t border-rule px-4 py-3 first:border-t-0 max-[700px]:grid-cols-[minmax(0,1fr)_auto]"
          >
            <span className="break-all font-mono text-mono text-ink">{v.key}</span>
            {v.error ? (
              <span className="text-caption text-bad max-[700px]:col-span-2 max-[700px]:row-start-2">{v.error}</span>
            ) : (
              <span className="min-w-0 max-[700px]:col-span-2 max-[700px]:row-start-2">
                {v.value.kind === 'binary' && (
                  <span className="mb-1 block text-caption text-muted">Binary value, shown as base64</span>
                )}
                <code className="block select-all rounded-sm border border-dashed border-edge bg-sunken px-2 py-1 font-mono text-[13px] [overflow-wrap:anywhere]">
                  {v.value.kind === 'text' ? v.value.text : v.value.base64}
                </code>
              </span>
            )}
            {!v.error && (
              <span className="flex items-center gap-2">
                <span role="status" className="min-w-[48px] text-label font-medium text-ok">
                  {v.copied ? 'Copied' : ''}
                </span>
                <Button variant="secondary" size="sm" onClick={() => onCopy(v.key)}>
                  Copy<span className="sr-only"> {v.key}</span>
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="m-0 border-t border-rule bg-sunken px-4 py-3 text-caption text-muted">
        Hiding clears the values from this page. It doesn't rotate the provider credential, and it can't clear
        anything already copied or pasted elsewhere.
      </p>
    </div>
  );
}

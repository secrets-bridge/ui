/**
 * Next up: the one thing to do now, with the context to do it. The rest
 * of the list sits under it as rows (`ThenRow`). A production request
 * carries the hatched band; a reveal that's ready sits on the soft fill.
 * Never shows a value.
 */

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import type { AccessRequest } from '../../api/types';
import { requestRef } from '../../lib/requestRef';
import { formatAge } from '../../lib/time';
import { askedFor, keysOf, pathOf } from '../../requests/describe';
import type { ScopeDisplay } from '../../requests/scope';
import { providerLabel } from '../../lib/providers';
import { Avatar } from '../../ui/Avatar';
import { Button } from '../../ui/Button';
import { EntityMark } from '../../ui/EntityMark';
import { EnvTag } from '../../ui/EnvTag';
import { Keys } from '../../ui/Keys';
import { Path } from '../../ui/Path';
import { Status } from '../../ui/Status';

export function NextPanel({
  id,
  prod,
  soft,
  eyebrow,
  aside,
  children,
}: {
  id: string;
  prod?: boolean;
  soft?: boolean;
  eyebrow: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={'overflow-hidden rounded-xl border ' + (soft ? 'border-accent-line bg-accent-soft' : 'border-border bg-surface')}>
      {prod && <div aria-hidden="true" className="bg-prod-hatch h-1" />}
      <div className="flex flex-col gap-[18px] px-6 py-[22px] max-[600px]:px-4 max-[600px]:py-[18px]">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <span className="text-label font-semibold text-accent-ink">{eyebrow}</span>
          {aside && <span className="flex items-center gap-2.5">{aside}</span>}
        </div>
        {children}
      </div>
    </section>
  );
}

export function NextTitle({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="font-display text-[24px] font-bold leading-[29px] tracking-[-0.02em] text-ink">
      {children}
    </h2>
  );
}

export function NextDecision({
  r,
  display: d,
  now,
  detailed,
  onApprove,
  onReject,
}: {
  r: AccessRequest;
  display: ScopeDisplay;
  now: number;
  /** The Approvals page shows every fact; the Overview a shorter version. */
  detailed?: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const who = r.requester_display ?? 'Someone';
  const first = r.requester_display?.split(/\s+/)[0] ?? 'the requester';
  const prod = d.envKind === 'prod';
  const n = keysOf(r).length;
  const keysWord = n === 0 ? 'all the keys' : n === 1 ? 'this key' : `these ${n} keys`;
  const id = `next-${r.id}`;
  return (
    <NextPanel
      id={id}
      prod={prod}
      eyebrow="Next up · waiting longest"
      aside={
        <>
          <span className="font-mono text-mono">{requestRef(r.id)}</span>
          <Status status={r.status} />
        </>
      }
    >
      <div className="flex items-start gap-3.5">
        <Avatar name={who} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <NextTitle id={id}>
            {who} {askedFor(r, d)}
          </NextTitle>
          {!detailed && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-caption text-ink">{d.project}</span>
              {d.env && <EnvTag kind={d.envKind}>{d.env}</EnvTag>}
              <Keys keys={keysOf(r)} variant="chips" />
              <span className="font-mono text-mono-small text-muted">waiting {formatAge(r.created_at, now)}</span>
            </div>
          )}
          {detailed && <span className="text-caption text-muted">Waiting {formatAge(r.created_at, now)}</span>}
        </div>
      </div>

      {detailed && (
        <dl className="m-0 grid grid-cols-[minmax(110px,max-content)_minmax(0,1fr)] gap-x-5 gap-y-2.5 text-ui leading-[21px] max-[600px]:grid-cols-1 max-[600px]:gap-y-1">
          <dt className="text-muted">Where</dt>
          <dd className="m-0 flex min-w-0 items-center gap-2">
            <EntityMark name={d.project} src={d.logo} />
            <span className="min-w-0 truncate">{d.project}</span>
            {d.env && <EnvTag kind={d.envKind}>{d.env}</EnvTag>}
          </dd>
          <dt className="text-muted">Secret</dt>
          <dd className="m-0 min-w-0">
            <Path value={pathOf(r)} />
          </dd>
          <dt className="text-muted">Keys</dt>
          <dd className="m-0 min-w-0">
            <Keys keys={keysOf(r)} variant="chips" />
          </dd>
          <dt className="text-muted">Provider</dt>
          <dd className="m-0">{providerLabel(r.target_provider_type)}</dd>
        </dl>
      )}

      <blockquote className="m-0 rounded-lg border border-border bg-raised px-3.5 py-3 text-[15px] leading-[23px] text-ink">{r.justification}</blockquote>

      {detailed && (
        <p className="m-0 rounded-lg border border-border bg-bg px-3.5 py-3 text-caption text-ink">
          If you approve, an agent in your infrastructure {r.type === 'patch' ? `writes the new value${n === 1 ? '' : 's'}` : `reads ${keysWord} and ${first} can reveal each value once`}. Nothing is shown to you.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="primary" className="h-11 px-[18px] text-[15px]" onClick={onApprove}>
            Approve…
          </Button>
          <Button variant="secondary" className="h-11 px-[18px] text-[15px]" onClick={onReject}>
            Reject…
          </Button>
          <Link to={`/requests/${r.id}`} className="ml-1 text-caption text-accent-ink underline underline-offset-[3px] hover:decoration-2">
            See full request
          </Link>
        </div>
        <span className="font-mono text-mono-small text-muted">
          {detailed ? "Both ask for your second factor if it's older than 15 minutes." : r.type === 'patch' ? 'You never see the values. An agent writes them.' : `You never see the values. An agent reads them; ${first} reveals them once.`}
        </span>
      </div>
    </NextPanel>
  );
}

export function ThenList({ title, id, link, filters, children }: { title: string; id: string; link?: ReactNode; filters?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-xl border border-border bg-surface p-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5 px-3 pb-1.5 pt-2.5">
        <h2 id={id} className="text-block-heading text-ink">
          {title}
        </h2>
        {link}
        {filters}
      </div>
      <ul className="m-0 list-none p-0">{children}</ul>
    </section>
  );
}

/** One row of Then. The title link covers the row; the action sits above it. */
export function ThenRow({
  mark,
  to,
  title,
  meta,
  metaTone,
  children,
  action,
}: {
  mark: ReactNode;
  to: string;
  title: ReactNode;
  meta?: ReactNode;
  metaTone?: 'ready' | 'muted';
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className="relative flex items-start gap-3 rounded-lg px-3.5 py-3 hover:bg-hover max-[600px]:flex-wrap">
      {mark}
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <Link to={to} className="min-w-0 text-ui text-ink after:absolute after:inset-0 after:rounded-lg">
            {title}
          </Link>
          {meta && <span className={'font-mono text-mono-small ' + (metaTone === 'ready' ? 'font-semibold text-accent-ink' : 'text-muted')}>{meta}</span>}
        </div>
        {children}
      </div>
      {action && <span className="relative z-10 shrink-0 self-center max-[600px]:w-full">{action}</span>}
    </li>
  );
}

/** A round mark for a row with no person: ready, or something that went wrong. */
export function StateMark({ tone, children }: { tone: 'ready' | 'bad' | 'count'; children?: ReactNode }) {
  const cls = {
    ready: 'border-accent-line bg-accent-soft text-accent-ink',
    bad: 'border-bad text-bad',
    count: 'border-border bg-raised text-ink',
  }[tone];
  return (
    <span aria-hidden="true" className={'inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border text-[13px] font-semibold ' + cls}>
      {tone === 'ready' ? '✓' : tone === 'bad' ? '!' : children}
    </span>
  );
}

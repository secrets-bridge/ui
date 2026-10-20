/**
 * Argo CD state for a request, from accepted Gateway evidence
 * (GET /requests/:id/observations, api#294). Read-only.
 *
 * Every line is observed operational state, as the Gateway saw it from
 * inside the workload boundary. Argo CD Healthy and Synced is never
 * shown as proof that the new value reached the app. Pending, unverified
 * and timed out are shown as such, never as a failure.
 *
 * Rollup "none" means no observation is configured for this change.
 */

import { type ReactNode } from 'react';

import { ApiError } from '../../api/client';
import type { EvidenceStage, RequestObservations, RequestObservationTask } from '../../api/gateways';
import {
  ARGOCD_NOT_PROOF,
  OUTCOME_LABEL,
  OUTCOME_TONE,
  ROLLUP_LABEL,
  ROLLUP_MEANING,
  ROLLUP_TONE,
  STAGE_LABEL,
  TASK_STATE_LABEL,
  VERDICT_REASON,
  caveatText,
  words,
} from '../../lib/gatewayStatus';
import { formatExact } from '../../lib/time';
import { Banner } from '../../ui/Banner';
import { ToneStatus } from '../../ui/Status';

const LABEL_TEXT: Record<string, string> = {
  observed_operational_state: 'Observed operational state',
};

const FACT_LABEL: [string, string][] = [
  ['sync_status', 'Sync'],
  ['health_status', 'Health'],
  ['operation_phase', 'Last operation'],
  ['sync_revision', 'Revision'],
  ['operation_finished_at', 'Operation finished'],
  ['reconciled_at', 'Reconciled'],
  ['error_code', 'Error'],
];

const TIME_FACTS = new Set(['operation_finished_at', 'reconciled_at']);

export function ObservationPanel({
  data,
  error,
  loading,
  requestStatus,
}: {
  data: RequestObservations | undefined;
  error: unknown;
  loading: boolean;
  requestStatus: string;
}) {
  // An api without the endpoint answers 404: nothing to show.
  if (error instanceof ApiError && error.status === 404) return null;
  if (loading) return null;

  const tasks = data?.tasks ?? [];
  const names = [...new Set(tasks.map((t) => t.gateway_name).filter(Boolean))];
  const title = names.length ? `Argo CD (observed by Gateway ${names.join(', ')})` : 'Argo CD';
  const label = data ? (LABEL_TEXT[data.label] ?? data.label.replace(/_/g, ' ')) : '';

  return (
    <section aria-labelledby="observation-heading" className="rounded-md border border-border bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-rule px-5 py-3.5">
        <h2 id="observation-heading" className="text-block-heading text-ink">
          {title}
        </h2>
        {label && <span className="text-caption text-muted">{label} · times in UTC</span>}
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        {error ? (
          <Banner tone="error" title="Couldn't load the Argo CD state.">
            {error instanceof ApiError ? `${error.status}: ${error.message}` : 'Network error.'}
          </Banner>
        ) : data ? (
          <>
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-live="polite">
              <ToneStatus tone={ROLLUP_TONE[data.rollup] ?? 'neutral'}>{ROLLUP_LABEL[data.rollup] ?? data.rollup}</ToneStatus>
              <span className="text-ui font-normal text-muted">
                {data.rollup === 'none' && data.observation_source === 'gateway' && requestStatus !== 'executed'
                  ? 'The Gateway observes a change once the agent has written it, when a binding covers it.'
                  : (ROLLUP_MEANING[data.rollup] ?? '')}
              </span>
            </p>
            {tasks.map((t) => (
              <TaskBlock key={t.task_id} task={t} />
            ))}
          </>
        ) : null}
      </div>
    </section>
  );
}

function TaskBlock({ task: t }: { task: RequestObservationTask }) {
  const stages = t.stages ?? [];
  const expected = t.expected_stages ?? [];
  const missing = expected.filter((s) => !stages.some((e) => e.stage === s));
  return (
    <div className="rounded-md border border-rule">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-rule px-3.5 py-2.5 text-ui">
        <span className="font-medium text-ink">Gateway {t.gateway_name}</span>
        <ToneStatus tone={ROLLUP_TONE[t.verdict] ?? 'neutral'}>{ROLLUP_LABEL[t.verdict] ?? t.verdict}</ToneStatus>
        <span className="text-caption text-muted">
          task {(TASK_STATE_LABEL[t.state] ?? t.state).toLowerCase()} · {t.terminal_at ? `closed ${formatExact(t.terminal_at)}` : `deadline ${formatExact(t.deadline_at)}`}
        </span>
      </div>
      {t.verdict_reason && <p className="px-3.5 pt-2.5 text-ui font-normal text-muted">{words(t.verdict_reason, VERDICT_REASON)}</p>}
      <ul className="m-0 list-none p-0">
        {stages.map((s) => (
          <StageLine key={`${s.stage}-${s.attempt_id}`} s={s} />
        ))}
        {missing.map((stage) => (
          <li key={stage} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-rule px-3.5 py-2.5 text-ui first:border-t-0">
            <span className="font-medium text-ink">{STAGE_LABEL[stage] ?? stage}</span>
            <span className="text-muted">{t.verdict === 'pending' ? 'Waiting for evidence.' : 'No accepted evidence.'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StageLine({ s }: { s: EvidenceStage }) {
  const facts = s.facts ?? {};
  const shown = FACT_LABEL.filter(([k]) => facts[k] !== undefined && facts[k] !== '');
  const caveats = s.caveats ?? [];
  const rows: [string, ReactNode][] = shown.map(([k, label]) => [
    label,
    TIME_FACTS.has(k) ? formatExact(String(facts[k]), true) : <span className="font-mono text-mono">{String(facts[k])}</span>,
  ]);
  return (
    <li className="flex flex-col gap-2 border-t border-rule px-3.5 py-3 first:border-t-0">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ui">
        <span className="font-medium text-ink">{STAGE_LABEL[s.stage] ?? s.stage}</span>
        <ToneStatus tone={OUTCOME_TONE[s.outcome] ?? 'neutral'}>{OUTCOME_LABEL[s.outcome] ?? s.outcome}</ToneStatus>
        <span className="text-caption text-muted">observed {formatExact(s.observed_at, true)}</span>
      </p>
      {s.reported_outcome && s.reported_outcome !== s.outcome && (
        <p className="text-caption text-muted">The Gateway reported {words(s.reported_outcome, OUTCOME_LABEL).toLowerCase()}; the control plane&apos;s checks made it {words(s.outcome, OUTCOME_LABEL).toLowerCase()}.</p>
      )}
      {rows.length > 0 && (
        <dl className="m-0 grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1 text-ui font-normal max-[600px]:grid-cols-[110px_minmax(0,1fr)]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted">{k}</dt>
              <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {caveats.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ui font-normal text-ink">
          {caveats.map((c) => (
            <li key={c} className={c === 'argocd_health_not_proof' ? 'rounded-md border border-border bg-sunken px-3 py-2' : 'text-muted'}>
              {c === 'argocd_health_not_proof' ? ARGOCD_NOT_PROOF : caveatText(c)}
            </li>
          ))}
        </ul>
      )}
      <details className="text-caption text-muted">
        <summary className="cursor-pointer">Evidence details</summary>
        <dl className="m-0 mt-1 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-0.5">
          {(
            [
              ['Connector', s.connector_id],
              ['Target', s.target_id],
              ['Confidence', s.confidence],
              ['Linkage', s.linkage],
              ['Received', formatExact(s.received_at, true)],
              ['Gateway id', s.gateway_id],
              ['Replica id', s.replica_id],
              ['Attempt id', s.attempt_id],
            ] as [string, string][]
          )
            .filter(([, v]) => !!v)
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt>{k}</dt>
                <dd className="m-0 min-w-0 break-all font-mono text-mono-small">{v}</dd>
              </div>
            ))}
        </dl>
      </details>
    </li>
  );
}

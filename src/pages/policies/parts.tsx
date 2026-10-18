/**
 * Pieces the policy pages share: how a rule's selector reads, its
 * enabled state, a label/value list, and the frame of a rule's detail
 * page (breadcrumb, title, fact line, Overview and History tabs).
 */

import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ApiError } from '../../api/client';
import { Banner } from '../../ui/Banner';
import { Breadcrumb, type Crumb } from '../../ui/Breadcrumb';
import { Button } from '../../ui/Button';
import { ToneStatus } from '../../ui/Status';
import { TabPanel, Tabs } from '../../ui/Tabs';
import { selectorKeyLabel, selectorValue, type SelectorNames } from './labels';

const CHIP = 'inline-flex h-[22px] max-w-full items-center gap-1.5 rounded-sm border border-border bg-sunken px-[7px] text-[12px]';

/**
 * A rule's selector. With `selector`, each key and its value; with only
 * `keys` (inherited rules, whose values the api withholds), the keys.
 * An empty selector matches every request.
 */
export function Selector({
  selector,
  keys,
  names,
}: {
  selector?: Record<string, unknown> | null;
  keys?: readonly string[];
  names?: SelectorNames;
}) {
  if (selector) {
    const entries = Object.entries(selector);
    if (entries.length === 0) return <span className="text-muted">Every request</span>;
    return (
      <span className="inline-flex flex-wrap gap-1.5">
        {entries.map(([k, v]) => {
          const val = selectorValue(k, v, names);
          return (
            <span key={k} className={CHIP} title={`${k} = ${String(v)}`}>
              <span className="text-muted">{selectorKeyLabel(k)}</span>
              <span className={'truncate text-ink ' + (val.mono ? 'font-mono' : '')}>{val.text}</span>
            </span>
          );
        })}
      </span>
    );
  }
  const list = keys ?? [];
  if (list.length === 0) return <span className="text-muted">Every request</span>;
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {list.map((k) => (
        <span key={k} className={CHIP} title={k}>
          {selectorKeyLabel(k)}
        </span>
      ))}
    </span>
  );
}

export function RuleStatus({ enabled }: { enabled: boolean }) {
  return <ToneStatus tone={enabled ? 'ok' : 'neutral'}>{enabled ? 'Enabled' : 'Disabled'}</ToneStatus>;
}

/** Label and value rows, as on the request page. */
export function DetailRows({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="m-0 px-5 py-1">
      {rows.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[150px_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-ui font-normal last:border-0 max-[600px]:grid-cols-1 max-[600px]:gap-0.5">
          <dt className="text-muted">{k}</dt>
          <dd className="m-0 min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-surface">
      {title && <h2 className="border-b border-rule px-5 py-3.5 text-block-heading text-ink">{title}</h2>}
      {children}
    </section>
  );
}

export type RuleTab = 'overview' | 'history';

/** The frame every rule detail page shares. */
export function RuleDetailFrame({
  crumbs,
  title,
  fact,
  tab,
  onTab,
  overview,
  history,
}: {
  crumbs: Crumb[];
  title: string;
  fact: ReactNode;
  tab: RuleTab;
  onTab: (t: RuleTab) => void;
  overview: ReactNode;
  history: ReactNode;
}) {
  useEffect(() => {
    document.title = `${title} · Secrets Bridge`;
  }, [title]);
  return (
    <div>
      <Breadcrumb items={crumbs} />
      <h1 id="page-title" tabIndex={-1} className="mt-3 break-words text-console-title text-ink">
        {title}
      </h1>
      <p className="mb-5 mt-[3px] max-w-3xl text-ui font-normal text-muted">{fact}</p>
      <Tabs
        label="Rule"
        idPrefix="rule"
        value={tab}
        onChange={(id) => onTab(id as RuleTab)}
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'history', label: 'History' },
        ]}
      />
      <TabPanel idPrefix="rule" value={tab}>
        <div className="pt-5">{tab === 'overview' ? overview : history}</div>
      </TabPanel>
    </div>
  );
}

/** A rule that couldn't be loaded: what happened and the way back. */
export function RuleLoadProblem({
  crumbs,
  error,
  back,
  onRetry,
}: {
  crumbs: Crumb[];
  error: unknown;
  back: { to: string; label: string };
  onRetry: () => void;
}) {
  const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
  return (
    <div>
      <Breadcrumb items={crumbs} />
      <h1 id="page-title" tabIndex={-1} className="mb-4 mt-3 text-console-title text-ink">
        {notFound ? "You can't open this rule" : "Couldn't load this rule"}
      </h1>
      <Banner
        tone={notFound ? 'note' : 'error'}
        title={notFound ? "It doesn't exist, or your permissions don't cover it." : 'Something went wrong.'}
        action={
          notFound ? undefined : (
            <Button variant="secondary" size="sm" onClick={onRetry}>
              Try again
            </Button>
          )
        }
      >
        {error instanceof ApiError ? `${error.status}: ${error.message}. ` : ''}
        <Link to={back.to} className="font-medium text-accent hover:underline">
          {back.label}
        </Link>
      </Banner>
    </div>
  );
}

/** Loading line for a page or panel. */
export function Loading({ children }: { children: ReactNode }) {
  return <p className="text-muted">{children}</p>;
}

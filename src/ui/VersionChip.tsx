/**
 * Version chip — small "v0.1.0 · abc1234" pill that lives in the
 * sidebar footer (and gets re-used in the Dashboard footer / Me
 * page). Reads from the vite-injected
 * `import.meta.env.VITE_APP_VERSION` / `VITE_APP_GIT_SHA` /
 * `VITE_APP_BUILD_TIME` constants.
 *
 * `kubectl exec` should never be needed to answer "which UI build is
 * production on right now?" — this chip is the answer.
 */

const version =
  (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() || 'unknown';
const gitSha =
  (import.meta.env.VITE_APP_GIT_SHA as string | undefined)?.trim() || '';
const buildTime =
  (import.meta.env.VITE_APP_BUILD_TIME as string | undefined)?.trim() || '';

export interface VersionChipProps {
  className?: string;
}

export function VersionChip({ className }: VersionChipProps) {
  const label = gitSha ? `v${version} · ${gitSha}` : `v${version}`;
  const title = buildTime ? `built ${buildTime}` : 'build time unknown';
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-md border border-border/60 bg-bg/40 px-1.5 py-0.5 text-[10px] font-mono text-muted/80 ' +
        (className || '')
      }
      title={title}
    >
      {label}
    </span>
  );
}

export const appVersion = version;
export const appGitSha = gitSha;
export const appBuildTime = buildTime;

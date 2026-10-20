// The node APIs the suite uses, declared here so the e2e typecheck
// doesn't need @types/node (the app build avoids it too).
declare const process: {
  env: Record<string, string | undefined>;
  stdout: { write(chunk: string): boolean };
};

declare module 'node:fs' {
  export function appendFileSync(path: string, data: string, options?: { mode?: number }): void;
  export function rmSync(path: string, options?: { force?: boolean }): void;
  export function writeFileSync(path: string, data: string, options?: { mode?: number }): void;
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
}

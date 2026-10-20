import { existsSync, readFileSync } from 'node:fs';
import type { Reporter } from '@playwright/test/reporter';

// A value a test reads off a page (keepOutOfArtifacts in stack.ts) is
// looked for by the leak scan after the run, but the job log is public
// and shows the list reporter's output as it happens, a failing
// matcher's "Received" included. GitHub Actions hides a value once it
// has seen `::add-mask::<value>` at the start of a line. A worker can't
// print that reliably (its stdout reaches the log through the reporters,
// not always at the start of a line), so this reporter, listed ahead of
// the list reporter, reads the recorded values after every step and test
// and masks each new one before the list reporter prints anything about
// it. Outside Actions nothing swallows the command and it would print
// the values to the terminal, so there it does nothing.
export default class MaskRecorded implements Reporter {
  private readonly masked = new Set<string>();

  onStepEnd(): void {
    this.maskNew();
  }

  onTestEnd(): void {
    this.maskNew();
  }

  onEnd(): void {
    this.maskNew();
  }

  private maskNew(): void {
    const state = process.env.E2E_STATE;
    if (process.env.GITHUB_ACTIONS !== 'true' || !state) return;
    const file = `${state}/test-secrets`;
    if (!existsSync(file)) return;
    for (const value of readFileSync(file, 'utf8').split('\n')) {
      if (!value || this.masked.has(value)) continue;
      this.masked.add(value);
      process.stdout.write(`::add-mask::${value}\n`);
    }
  }
}

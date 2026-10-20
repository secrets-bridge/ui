import { rmSync } from 'node:fs';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';

// A failing matcher attaches an accessibility snapshot of the page, which
// holds whatever the page showed, revealed values included. The worker
// writes it to error-context.md before any reporter runs, and no setting
// turns it off, so this reporter (listed first) deletes the file and drops
// the attachment as soon as the test ends. The failure itself still shows
// in the list output and the JSON summary.
export default class DropErrorContext implements Reporter {
  onTestEnd(_test: TestCase, result: TestResult): void {
    for (let i = result.attachments.length - 1; i >= 0; i--) {
      const a = result.attachments[i];
      if (a.name !== 'error-context') continue;
      if (a.path) rmSync(a.path, { force: true });
      result.attachments.splice(i, 1);
    }
  }
}

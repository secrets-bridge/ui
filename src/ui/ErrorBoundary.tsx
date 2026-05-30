import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Top-level error boundary. Without it, any thrown render error in any
 * page component unmounts the whole React tree and the user sees a
 * blank page (no error message, no nav, nothing to recover from).
 *
 * Reference incident: ui#28's ProjectSecretsPanel dereferenced
 * `binding.allowed_keys!.map(...)` while the api returns the field as
 * absent (omitempty) when nil. The TypeError took down the entire SPA.
 *
 * This boundary catches the throw, shows the actual error message, and
 * preserves nav so the user can click their way out.
 */
type State =
  | { hasError: false }
  | { hasError: true; error: Error };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info);
  }

  reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-bg flex items-center justify-center px-4">
          <div className="w-full max-w-2xl bg-surface border border-red-500/40 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div>
              <div className="text-red-300 font-semibold text-lg">
                Something went wrong.
              </div>
              <div className="text-muted text-xs mt-1">
                A render error was caught here so the rest of the UI
                stays usable. Open the browser console for the full
                stack trace.
              </div>
            </div>
            <pre className="bg-bg border border-border rounded-lg p-3 text-text text-xs font-mono whitespace-pre-wrap break-all">
              {this.state.error.message}
            </pre>
            <div className="flex gap-2">
              <button
                onClick={this.reset}
                className="px-3 py-1.5 rounded-lg bg-accent text-bg text-sm font-medium hover:bg-accent-bright transition-colors"
              >
                Try again
              </button>
              <button
                onClick={() => {
                  window.location.href = '/';
                }}
                className="px-3 py-1.5 rounded-lg border border-border text-text text-sm font-medium hover:bg-bg/30 transition-colors"
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

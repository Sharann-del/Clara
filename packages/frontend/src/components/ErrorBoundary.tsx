import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Changing this (e.g. the route path) clears a caught error. */
  resetKey?: string;
  /** Compact inline fallback for a panel instead of a full page. */
  inline?: boolean;
}

interface State {
  error: Error | null;
}

/** Catches render errors so one broken view doesn't blank the whole app. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Clara UI error', error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.inline) {
      return (
        <div className="panel error-panel" role="alert">
          <strong>This part of the page couldn’t be shown.</strong>
          <p className="muted" style={{ margin: '4px 0 8px' }}>
            {error.message}
          </p>
          <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return (
      <div className="crash" role="alert">
        <span className="code404">error: {error.name}</span>
        <h1>Something broke on this page.</h1>
        <p>
          Your work up to the last save is safe. Reload to try again; if it keeps happening, go back to your workspaces.
        </p>
        <pre className="crash-detail">{error.message}</pre>
        <div className="cta-row" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => window.location.reload()}>
            Reload the page
          </button>
          <a className="btn btn-lg" href="/app">
            Go to your workspaces
          </a>
        </div>
      </div>
    );
  }
}

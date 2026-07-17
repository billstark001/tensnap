import React from 'react';

interface AppErrorBoundaryProps {
  children: React.ReactNode;
}

interface AppErrorBoundaryState {
  hasError: boolean;
}

/** Last-resort shell so a bad remote payload cannot blank the whole app. */
export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    console.error('Failed to render TenSnap application', error);
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <main role="alert">
          <h1>TenSnap could not render this view.</h1>
          <p>The simulator data may be invalid. Reload after reconnecting the simulator.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload</button>
        </main>
      );
    }
    return this.props.children;
  }
}

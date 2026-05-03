import React from 'react';

interface ViewErrorBoundaryProps {
  kind: 'environment' | 'chart';
  identifier: string;
  resetKey?: string | number;
  children: React.ReactNode;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
}

export class ViewErrorBoundary extends React.Component<ViewErrorBoundaryProps, ViewErrorBoundaryState> {
  state: ViewErrorBoundaryState = { hasError: false };

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  static getDerivedStateFromError(): ViewErrorBoundaryState {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    console.error(`Failed to render ${this.props.kind} view "${this.props.identifier}"`, error);
  }

  override componentDidUpdate(prevProps: ViewErrorBoundaryProps): void {
    if (
      this.state.hasError
      && (
        prevProps.identifier !== this.props.identifier
        || prevProps.kind !== this.props.kind
        || prevProps.resetKey !== this.props.resetKey
      )
    ) {
      this.setState({ hasError: false });
    }
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div>
          <div>Failed to render {this.props.kind}: {this.props.identifier}</div>
          <button onClick={this.handleRetry} type="button">Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
import React from 'react';

interface ViewErrorBoundaryProps {
  kind: 'environment' | 'chart';
  identifier: string;
  resetKey?: string | number;
  children: React.ReactNode;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
  kind: ViewErrorBoundaryProps['kind'];
  identifier: string;
  resetKey?: string | number;
}

export class ViewErrorBoundary extends React.Component<
  ViewErrorBoundaryProps,
  ViewErrorBoundaryState
> {
  state: ViewErrorBoundaryState = {
    hasError: false,
    kind: this.props.kind,
    identifier: this.props.identifier,
    resetKey: this.props.resetKey,
  };

  private handleRetry = (): void => {
    this.setState({ hasError: false });
  };

  static getDerivedStateFromError(): Partial<ViewErrorBoundaryState> {
    return { hasError: true };
  }

  override componentDidCatch(error: Error): void {
    console.error(`Failed to render ${this.props.kind} view "${this.props.identifier}"`, error);
  }

  static getDerivedStateFromProps(
    props: ViewErrorBoundaryProps,
    state: ViewErrorBoundaryState,
  ): Partial<ViewErrorBoundaryState> | null {
    if (
      state.identifier !== props.identifier ||
      state.kind !== props.kind ||
      !Object.is(state.resetKey, props.resetKey)
    ) {
      return {
        hasError: false,
        kind: props.kind,
        identifier: props.identifier,
        resetKey: props.resetKey,
      };
    }
    return null;
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div>
          <div>
            Failed to render {this.props.kind}: {this.props.identifier}
          </div>
          <button onClick={this.handleRetry} type="button">
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

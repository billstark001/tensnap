import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewErrorBoundary } from './ViewErrorBoundary';

function Content({ fail }: { fail: boolean }) {
  if (fail) throw new Error('Broken view');
  return <div>Healthy view</div>;
}

describe('ViewErrorBoundary', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  it('retains the error for unchanged identity and recovers after an explicit retry', () => {
    const { rerender } = render(
      <ViewErrorBoundary kind="chart" identifier="population">
        <Content fail />
      </ViewErrorBoundary>,
    );
    expect(screen.getByText('Failed to render chart: population')).toBeInTheDocument();
    rerender(
      <ViewErrorBoundary kind="chart" identifier="population">
        <Content fail={false} />
      </ViewErrorBoundary>,
    );
    expect(screen.queryByText('Healthy view')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('Healthy view')).toBeInTheDocument();
  });

  it.each([
    { kind: 'environment' as const, identifier: 'population', resetKey: 0 },
    { kind: 'chart' as const, identifier: 'other', resetKey: 0 },
    { kind: 'chart' as const, identifier: 'population', resetKey: 1 },
  ])('recovers when identity changes to %j', (next) => {
    const { rerender } = render(
      <ViewErrorBoundary kind="chart" identifier="population" resetKey={0}>
        <Content fail />
      </ViewErrorBoundary>,
    );
    rerender(
      <ViewErrorBoundary {...next}>
        <Content fail={false} />
      </ViewErrorBoundary>,
    );
    expect(screen.getByText('Healthy view')).toBeInTheDocument();
  });

  it('retains a new error after a reset instead of repeatedly retrying it', () => {
    const { rerender } = render(
      <ViewErrorBoundary kind="chart" identifier="population" resetKey={0}>
        <Content fail />
      </ViewErrorBoundary>,
    );
    rerender(
      <ViewErrorBoundary kind="chart" identifier="population" resetKey={1}>
        <Content fail />
      </ViewErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    rerender(
      <ViewErrorBoundary kind="chart" identifier="population" resetKey={1}>
        <Content fail={false} />
      </ViewErrorBoundary>,
    );
    expect(screen.queryByText('Healthy view')).not.toBeInTheDocument();
  });

  it('treats a stable NaN reset key as unchanged', () => {
    render(
      <ViewErrorBoundary kind="chart" identifier="population" resetKey={NaN}>
        <Content fail />
      </ViewErrorBoundary>,
    );
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

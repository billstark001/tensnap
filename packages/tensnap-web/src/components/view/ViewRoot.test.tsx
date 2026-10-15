import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ViewRoot from './ViewRoot';
import { useViewContext } from './useViewContext';
import type { ContainerView } from '@/types/ui';

vi.mock('./useDragAndResizeContent', () => ({
  useDragContent: () => ({ dragState: { state: { guideLines: [] } } }),
  useResizeContent: () => ({ resizeState: { state: { guideLines: [] } } }),
}));

vi.mock('./ContainerViewComponent', () => ({
  ContainerViewComponent: ({ view }: { view: ContainerView }) => {
    const { AnchoredViewRenderer, isRunning } = useViewContext();
    return (
      <>
        <span>{isRunning('test') ? 'Running' : 'Idle'}</span>
        <AnchoredViewRenderer view={view} id="test" type="chart" />
      </>
    );
  },
}));

function Counter() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(count + 1)}>Count {count}</button>;
}

function Replacement() {
  return <div>Replacement renderer</div>;
}

it('preserves renderer state across root updates and renders a replacement component immediately', () => {
  const view: ContainerView = {
    id: 'root',
    type: 'container',
    left: 0,
    top: 0,
    width: 100,
    height: 100,
    expanded: true,
    disabled: false,
    data: { title: 'Root' },
    views: [],
  };
  const { rerender } = render(<ViewRoot view={view} AnchoredViewRenderer={Counter} />);
  fireEvent.click(screen.getByRole('button', { name: 'Count 0' }));
  rerender(<ViewRoot view={view} updateTrigger={1} AnchoredViewRenderer={Counter} />);
  expect(screen.getByRole('button', { name: 'Count 1' })).toBeInTheDocument();
  rerender(<ViewRoot view={view} updateTrigger={2} AnchoredViewRenderer={Replacement} />);
  expect(screen.getByText('Replacement renderer')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Count 1' })).not.toBeInTheDocument();
  expect(screen.getByText('Idle')).toBeInTheDocument();
  rerender(<ViewRoot view={view} AnchoredViewRenderer={Replacement} isRunning={() => true} />);
  expect(screen.getByText('Running')).toBeInTheDocument();
});

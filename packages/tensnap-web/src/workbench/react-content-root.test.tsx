import {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
  StrictMode,
  type ReactNode,
} from 'react';
import * as ReactDOMClient from 'react-dom/client';
import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { reactContent } from '@tensnap/web-common/workbench/dialog-content';
import { mountContent } from '@tensnap/web-common/workbench/content';

vi.mock('react-dom/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom/client')>();
  return { ...actual, createRoot: vi.fn(actual.createRoot) };
});

it('mounts, updates and disposes native business content through the existing root without losing context or drafts', () => {
  const roots = vi.mocked(ReactDOMClient.createRoot);
  roots.mockClear();
  const Context = createContext('missing');
  let publish!: (node: ReactNode) => void;
  function Owner() {
    const [content, setContent] = useState<ReactNode>(null);
    useLayoutEffect(() => {
      publish = setContent;
    }, []);
    return (
      <Context.Provider value="owner context">
        <button>Bootstrap stays mounted</button>
        {content}
      </Context.Provider>
    );
  }
  function Business({ title }: { title: string }) {
    return (
      <>
        <p>
          {title}: {useContext(Context)}
        </p>
        <input aria-label="Draft" defaultValue="initial" />
      </>
    );
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = ReactDOMClient.createRoot(container);
  act(() =>
    root.render(
      <StrictMode>
        <Owner />
      </StrictMode>,
    ),
  );
  let content!: ReturnType<typeof mountContent<{ title: string }>>;
  try {
    const definition = reactContent(
      Business,
      (node) => node,
      (node) => publish(node),
    );
    act(() => {
      content = mountContent(definition, container, { title: 'First' });
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'unsaved' },
    });
    act(() => content.update({ title: 'Second' }));
    expect(screen.getByText('Second: owner context')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('unsaved');
    expect(roots).toHaveBeenCalledTimes(1);
    act(() => content.dispose());
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('button', { name: 'Bootstrap stays mounted' })).toBeTruthy();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});

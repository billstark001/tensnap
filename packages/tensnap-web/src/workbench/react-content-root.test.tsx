import { Activity, createContext, useContext, useEffect, StrictMode, useState } from 'react';
import { createPortal } from 'react-dom';
import * as ReactDOMClient from 'react-dom/client';
import { act, fireEvent, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('react-dom/client', async (original) => {
  const actual = await original<typeof ReactDOMClient>();
  return { ...actual, createRoot: vi.fn(actual.createRoot) };
});

it('keeps one root, inherited context and drafts while portals update and hidden panels pause effects', async () => {
  const Context = createContext('missing');
  const effect = vi.fn(),
    cleanup = vi.fn();
  const host = document.createElement('div');
  const container = document.createElement('div');
  document.body.append(container, host);
  function Business() {
    const [draft, setDraft] = useState('initial');
    useEffect(() => {
      effect();
      return cleanup;
    }, []);
    return (
      <>
        <p>{useContext(Context)}</p>
        <input
          aria-label="Draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </>
    );
  }
  const createRoot = vi.mocked(ReactDOMClient.createRoot);
  createRoot.mockClear();
  const root = ReactDOMClient.createRoot(container);
  const view = (visible: boolean, context: string) => (
    <StrictMode>
      <Context.Provider value={context}>
        <Activity mode={visible ? 'visible' : 'hidden'}>
          {createPortal(<Business />, host)}
        </Activity>
      </Context.Provider>
    </StrictMode>
  );
  try {
    await act(async () => root.render(view(true, 'first')));
    fireEvent.change(screen.getByRole('textbox', { name: 'Draft' }), {
      target: { value: 'unsaved' },
    });
    await act(async () => root.render(view(false, 'second')));
    const stopped = cleanup.mock.calls.length;
    expect(stopped).toBeGreaterThan(0);
    await act(async () => root.render(view(true, 'second')));
    expect(screen.getByText('second')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Draft' })).toHaveValue('unsaved');
    expect(effect.mock.calls.length).toBeGreaterThan(stopped);
    expect(createRoot).toHaveBeenCalledTimes(1);
  } finally {
    act(() => root.unmount());
    host.remove();
    container.remove();
  }
});

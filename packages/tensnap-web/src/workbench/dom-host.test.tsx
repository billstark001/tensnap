import React from 'react';
import { useEffect, useState } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as Dialog from '@tensnap/web-common/components/ui/Dialog';
import { createSplit } from '@tensnap/web-common/workbench/layout';
import { createWinBoxHost } from '@tensnap/web-common/workbench/winbox-host';
import { configureDialogHost, mountContent } from '@tensnap/web-common/workbench/content';
// Controllers are intentionally plain DOM; these tests run in jsdom, with no browser/desktop input.
import { defineDialog, dialogContent } from '@tensnap/web-common/workbench/dialog-content';
import { openMenu } from '../../../web-common/src/workbench/menu';
afterEach(() =>
  document.querySelectorAll('[data-workbench-menu]').forEach((node) => node.remove()),
);
it('keeps business content mounted in WinBox and dismisses only the top nested dialog', async () => {
  configureDialogHost(createWinBoxHost());
  const mounted = vi.fn();
  const unmounted = vi.fn();
  function Content() {
    useEffect(() => {
      mounted();
      return unmounted;
    }, []);
    return <input aria-label="Draft" defaultValue="unchanged" />;
  }
  function Fixture() {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(false);
    return (
      <Dialog.Root title="Outer" open={outer} onOpenChange={setOuter}>
        <Content />
        <button onClick={() => setInner(true)}>Nested</button>
        <Dialog.Root title="Inner" open={inner} onOpenChange={setInner}>
          <button>Inner action</button>
        </Dialog.Root>
      </Dialog.Root>
    );
  }
  const view = render(<Fixture />);
  const draft = await screen.findByRole('textbox', { name: 'Draft' });
  fireEvent.change(draft, { target: { value: 'preserved' } });
  const shell = draft.closest('.winbox') as HTMLElement;
  shell.style.width = '700px';
  shell.style.left = '40px';
  expect((draft as HTMLInputElement).value).toBe('preserved');
  expect(mounted).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByText('Nested'));
  const inner = await screen.findByRole('dialog', { name: 'Inner' });
  // Its coordinates can be outside the parent's shell without dismissing the parent.
  fireEvent.pointerDown(inner, { clientX: 1000, clientY: 1000 });
  expect(screen.getByRole('dialog', { name: 'Outer' })).toBeTruthy();
  fireEvent.keyDown(inner, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Inner' })).toBeNull());
  expect(screen.getByRole('dialog', { name: 'Outer' })).toBeTruthy();
  expect((draft as HTMLInputElement).value).toBe('preserved');
  view.unmount();
  expect(unmounted).toHaveBeenCalledTimes(1);
  expect(document.querySelector('.winbox')).toBeNull();
});
it('moves DOM separators with the keyboard, hides slots without replacing them and detaches on disposal', () => {
  const split = createSplit('horizontal', 0.7);
  document.body.append(split.element);
  const separator = split.element.querySelector('[role=separator]')!;
  fireEvent.keyDown(separator, { key: 'ArrowLeft' });
  expect(separator.getAttribute('aria-valuenow')).toBe('68');
  split.first.textContent = 'state';
  split.setVisible(false);
  expect(split.second.style.display).toBe('none');
  split.setVisible(true);
  expect(split.first.textContent).toBe('state');
  split.dispose();
  expect(split.element.isConnected).toBe(false);
});
it('supports DOM menu navigation, disabled items, typeahead, replacement and returned focus', async () => {
  const trigger = document.createElement('button');
  document.body.append(trigger);
  trigger.focus();
  const closed = vi.fn();
  const menu = openMenu(20, 30, trigger, closed);
  menu.element.innerHTML =
    '<button role="menuitem">Alpha</button><button role="menuitem" disabled>Disabled</button><button role="menuitem">Beta</button>';
  await act(async () => {});
  expect(document.activeElement?.textContent).toBe('Alpha');
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  expect(document.activeElement?.textContent).toBe('Beta');
  fireEvent.keyDown(document.activeElement!, { key: 'Home' });
  expect(document.activeElement?.textContent).toBe('Alpha');
  fireEvent.keyDown(document.activeElement!, { key: 'b' });
  expect(document.activeElement?.textContent).toBe('Beta');
  const next = openMenu(30, 40, trigger, vi.fn());
  expect(closed).toHaveBeenCalledTimes(1);
  expect(menu.element.isConnected).toBe(false);
  fireEvent.keyDown(next.element, { key: 'Escape' });
  expect(document.activeElement).toBe(trigger);
  expect(next.element.isConnected).toBe(false);
  trigger.remove();
});

it('owns mount/update/resize/visibility/dispose notifications for every host', () => {
  let notify!: ResizeObserverCallback;
  const disconnect = vi.fn();
  const resize = vi.fn();
  const visibility = vi.fn();
  const update = vi.fn();
  const dispose = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  try {
    const mount = vi.fn(() => ({ update, resize, visibility, dispose }));
    const host = document.createElement('div');
    const instance = mountContent({ mount }, host, { id: 1 }, false);
    expect(mount).toHaveBeenCalledWith(host, { id: 1 });
    expect(visibility).toHaveBeenCalledWith(false);
    notify(
      [{ contentRect: { width: 320, height: 200 } }] as ResizeObserverEntry[],
      {} as ResizeObserver,
    );
    expect(resize).toHaveBeenCalledWith(320, 200);
    instance.update({ id: 2 });
    instance.setVisible(true);
    expect(update).toHaveBeenCalledWith({ id: 2 });
    expect(visibility).toHaveBeenLastCalledWith(true);
    instance.dispose();
    instance.dispose();
    instance.update({ id: 3 });
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});

it('updates a stable content ID when its module definition is registered again', () => {
  const First = () => <span>First</span>;
  const Current = () => <span>Current</span>;
  defineDialog('hot-content-test', First);
  expect(
    render(React.createElement(dialogContent('hot-content-test'))).getByText('First'),
  ).toBeTruthy();
  defineDialog('hot-content-test', Current);
  expect(
    render(React.createElement(dialogContent('hot-content-test'))).getByText('Current'),
  ).toBeTruthy();
  expect(() => dialogContent('missing-content-test')).toThrow('Unknown dialog content');
});

it('dismisses the focused nonmodal window without trapping focus in a different window', async () => {
  const host = createWinBoxHost();
  const closeFirst = vi.fn();
  const closeSecond = vi.fn();
  const options = {
    type: 'Floating',
    title: 'Floating',
    size: 'md' as const,
    modal: false,
    dismissible: true,
  };
  const first = host.create({ ...options, onClose: closeFirst });
  const second = host.create({ ...options, onClose: closeSecond });
  try {
    await act(async () => {});
    first.element.focus();
    fireEvent.keyDown(first.element, { key: 'Escape' });
    expect(closeFirst).toHaveBeenCalledTimes(1);
    expect(closeSecond).not.toHaveBeenCalled();
    expect(first.element.getAttribute('aria-modal')).toBe('false');
  } finally {
    second.dispose();
    first.dispose();
  }
});

it('uses one visible title and one keyboard-operable close control owned by WinBox', async () => {
  configureDialogHost(createWinBoxHost());
  const close = vi.fn();
  const view = render(
    <Dialog.Root title="Themed dialog" open onOpenChange={close}>
      <Dialog.Body>Body</Dialog.Body>
    </Dialog.Root>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Themed dialog' });
  expect(dialog.querySelector('h2')).toBeNull();
  const shell = dialog.closest('.winbox')!;
  expect(shell.querySelector('.wb-title')).toHaveTextContent('Themed dialog');
  expect(dialog.querySelector('[data-dialog-close]')).toBeNull();
  const control = screen.getByRole('button', { name: 'Close' });
  fireEvent.keyDown(control, { key: 'Enter' });
  expect(close).toHaveBeenCalledExactlyOnceWith(false);
  view.unmount();
});

it('keeps the window open when a resize handle lies outside its frame or the backdrop is pressed', async () => {
  configureDialogHost(createWinBoxHost());
  const close = vi.fn();
  const view = render(
    <Dialog.Root title="Resize regression" open onOpenChange={close}>
      <input aria-label="Resize draft" defaultValue="preserved" />
    </Dialog.Root>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Resize regression' });
  const frame = dialog.closest('.winbox') as HTMLElement;
  const handle = frame.querySelector('.wb-se')!;
  expect(handle).toBeTruthy();
  fireEvent.click(frame.querySelector('.wb-max')!);
  expect(parseFloat(frame.style.width)).toBeLessThanOrEqual(innerWidth - 24);
  expect(parseFloat(frame.style.height)).toBeLessThanOrEqual(innerHeight - 24);
  fireEvent.click(frame.querySelector('.wb-max')!);
  fireEvent.pointerDown(handle, { clientX: -100, clientY: -100 });
  fireEvent.pointerMove(document, { clientX: 800, clientY: 600 });
  fireEvent.pointerUp(document, { clientX: 800, clientY: 600 });
  fireEvent.pointerDown(document.body, { clientX: -100, clientY: -100 });
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole('textbox', { name: 'Resize draft' })).toHaveValue('preserved');
  view.unmount();
});

it('opens ordinary windows without modal backdrops and permits selecting the workspace behind them', async () => {
  configureDialogHost(createWinBoxHost());
  const selected = vi.fn();
  const view = render(
    <>
      <button onClick={selected}>Select another agent</button>
      <Dialog.Root open title="Floating inspector">
        <input aria-label="Inspector input" />
      </Dialog.Root>
    </>,
  );
  const dialog = await screen.findByRole('dialog', { name: 'Floating inspector' });
  expect(dialog.getAttribute('aria-modal')).toBe('false');
  expect(dialog.closest('.winbox')!.classList.contains('modal')).toBe(false);
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Select another agent' }));
  fireEvent.click(screen.getByRole('button', { name: 'Select another agent' }));
  expect(selected).toHaveBeenCalledOnce();
  expect(dialog.isConnected).toBe(true);
  view.unmount();
});

it('keeps explicit modal confirmations keyboard-modal without enabling the WinBox backdrop', async () => {
  const host = createWinBoxHost();
  const window = host.create({
    type: 'Confirmation',
    title: 'Decision',
    size: 'md',
    modal: true,
    dismissible: false,
    onClose: vi.fn(),
  });
  try {
    await act(async () => {});
    expect(window.element).toHaveAttribute('aria-modal', 'true');
    expect(window.element.closest('.winbox')!.classList.contains('modal')).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(window.element));
  } finally {
    window.dispose();
  }
});

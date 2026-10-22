import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Item, Root, Viewport } from '@tensnap/web-common/components/ui/Select';
import * as styles from '../../../web-common/src/components/ui/Select.css';
import Dialog from '@tensnap/web-common/components/ui/Dialog';

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);
afterEach(() => {
  cleanup();
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
});

it('dismisses a select with Escape before dismissing its containing dialog', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  const onClose = vi.fn();
  render(
    <Dialog.Root title="Select settings" open onOpenChange={onClose}>
      <Dialog.Body>
        <Root defaultValue="one">
          <Item value="one">One</Item>
          <Item value="two">Two</Item>
        </Root>
      </Dialog.Body>
    </Dialog.Root>,
  );
  const trigger = screen.getByRole('combobox');
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  const popup = await screen.findByRole('listbox');
  fireEvent.keyDown(popup, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(trigger, { key: 'Escape' });
  expect(onClose).toHaveBeenCalledWith(false);
});

it('forwards Select content attributes and keyboard handlers to the popup', () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  });
  const onEscapeKeyDown = vi.fn();
  render(
    <Root
      open
      value="one"
      triggerProps={{ className: 'custom-trigger' }}
      contentProps={{
        className: 'custom-content',
        id: 'custom-popup',
        title: 'Choose a value',
        position: 'item-aligned',
        onEscapeKeyDown,
      }}
    >
      <Viewport>
        <Item value="one">One</Item>
      </Viewport>
    </Root>,
  );
  const popup = screen.getByRole('listbox');
  expect(screen.getByRole('combobox', { hidden: true })).toHaveClass(
    styles.selectTrigger,
    'custom-trigger',
  );
  expect(popup).toHaveClass(styles.selectContent, 'custom-content');
  expect(popup).toHaveAttribute('id', 'custom-popup');
  expect(popup).toHaveAttribute('title', 'Choose a value');
  fireEvent.keyDown(popup, { key: 'Escape' });
  expect(onEscapeKeyDown).toHaveBeenCalledTimes(1);
});

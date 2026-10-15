import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Item, Root, Viewport } from '@tensnap/web-common/components/ui/Select';

const originalScrollIntoView = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'scrollIntoView',
);
afterEach(() => {
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScrollIntoView);
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  }
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
      contentProps={{
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
  expect(popup).toHaveAttribute('id', 'custom-popup');
  expect(popup).toHaveAttribute('title', 'Choose a value');
  fireEvent.keyDown(popup, { key: 'Escape' });
  expect(onEscapeKeyDown).toHaveBeenCalledTimes(1);
});

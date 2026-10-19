// oxlint-disable-next-line typescript/triple-slash-reference -- Shared source consumers need the untyped dependency and CSS declarations.
/// <reference path="./winbox.d.ts" />
import WinBox from 'winbox/src/js/winbox';
import 'winbox/dist/css/winbox.min.css';
import { createFocusTrap } from 'focus-trap';
import type { DialogHost, WindowOptions } from './content';
import './workbench.css';
import './window-theme.css';

/** WinBox exclusively owns the shell; moving it never remounts its content. */
export function createWinBoxHost(): DialogHost {
  const windows: HTMLElement[] = [];
  return {
    create(initial) {
      let options = initial;
      let disposing = false;
      const previousFocus = document.activeElement as HTMLElement | null;
      const element = document.createElement('section');
      element.className = 'content-island';
      const activate = () => {
        const index = windows.indexOf(element);
        if (index >= 0) windows.splice(index, 1);
        windows.push(element);
      };
      activate();
      element.addEventListener('focusin', activate);
      element.tabIndex = -1;
      element.setAttribute('role', options.dismissible ? 'dialog' : 'alertdialog');
      element.setAttribute('aria-modal', String(options.modal));
      const sizes = { md: 480, lg: 680, xl: 1060, full: Math.max(320, innerWidth - 32) };
      const box = new WinBox({
        title: options.title,
        mount: element,
        modal: options.modal,
        width: Math.min(sizes[options.size], innerWidth - 24),
        height: options.size === 'full' ? innerHeight - 32 : Math.min(700, innerHeight - 48),
        x: 'center',
        y: 'center',
        minwidth: 240,
        minheight: 160,
        header: 40,
        class: [
          'tensnap-window',
          'no-full',
          'no-min',
          ...(options.dismissible ? [] : ['no-close']),
        ],
        onfocus: activate,
        onclose: () => {
          if (disposing) return false;
          if (options.dismissible) options.onClose();
          return true;
        },
      });
      const boxElement = box.dom as HTMLElement;
      const title = boxElement.querySelector<HTMLElement>('.wb-title')!;
      title.setAttribute('aria-hidden', 'true');
      const close = boxElement.querySelector<HTMLElement>('.wb-close')!;
      close.setAttribute('role', 'button');
      close.setAttribute('aria-label', 'Close');
      close.setAttribute('aria-hidden', String(!options.dismissible));
      close.tabIndex = options.dismissible ? 0 : -1;
      const closeKey = (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          close.click();
        }
      };
      close.addEventListener('keydown', closeKey);
      const trap = createFocusTrap(boxElement, {
        fallbackFocus: element,
        escapeDeactivates: false,
        clickOutsideDeactivates: false,
        allowOutsideClick: (event) => !!(event.target as Element)?.closest('[data-workbench-menu]'),
        tabbableOptions: { displayCheck: 'none' },
      });
      const keydown = (event: KeyboardEvent) => {
        if (
          windows[windows.length - 1] === element &&
          event.key === 'Escape' &&
          options.dismissible &&
          !document.querySelector('[data-workbench-menu]')
        ) {
          event.preventDefault();
          options.onClose();
        }
      };
      const outside = (event: PointerEvent) => {
        if (
          windows[windows.length - 1] !== element ||
          !options.modal ||
          !options.dismissible ||
          (event.target as Element)?.closest('[data-workbench-menu]')
        )
          return;
        const rect = boxElement.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) {
          event.preventDefault();
          event.stopPropagation();
          options.onClose();
        }
      };
      document.addEventListener('pointerdown', outside, true);
      boxElement.addEventListener('keydown', keydown);
      const observer = new MutationObserver(() => {
        const heading = element.querySelector<HTMLElement>('[data-dialog-title]');
        if (heading?.textContent) box.setTitle(heading.textContent);
        if (heading?.id) element.setAttribute('aria-labelledby', heading.id);
        const description = element.querySelector('[data-dialog-description]');
        if (description?.id) element.setAttribute('aria-describedby', description.id);
      });
      observer.observe(element, { childList: true, subtree: true, characterData: true });
      queueMicrotask(() => {
        if (!disposing) {
          if (options.modal) trap.activate();
          else element.focus();
        }
      });
      return {
        element,
        ownsCloseControl: true,
        update(next: WindowOptions) {
          options = next;
          boxElement.classList.toggle('no-close', !next.dismissible);
          close.tabIndex = next.dismissible ? 0 : -1;
          close.setAttribute('aria-hidden', String(!next.dismissible));
        },
        dispose() {
          if (disposing) return;
          disposing = true;
          windows.splice(windows.indexOf(element), 1);
          observer.disconnect();
          close.removeEventListener('keydown', closeKey);
          element.removeEventListener('focusin', activate);
          document.removeEventListener('pointerdown', outside, true);
          boxElement.removeEventListener('keydown', keydown);
          trap.deactivate({ returnFocus: false });
          box.close(true);
          if (previousFocus?.isConnected) previousFocus.focus();
        },
      };
    },
  };
}

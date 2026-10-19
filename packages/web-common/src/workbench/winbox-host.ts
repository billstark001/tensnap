// oxlint-disable-next-line typescript/triple-slash-reference -- Shared source consumers need the untyped dependency and CSS declarations.
/// <reference path="./winbox.d.ts" />
import { readWindowPlacement, saveWindowPlacement, windowGeometry } from './window-state';
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
      const area = () => ({
        x: 12,
        y: 12,
        width: Math.max(1, innerWidth - 24),
        height: Math.max(1, innerHeight - 24),
      });
      const geometry = windowGeometry(options.type, area(), undefined, options.size);
      const box = new WinBox({
        title: options.title,
        mount: element,
        modal: options.modal,
        width: geometry.width,
        height: geometry.height,
        x: geometry.x,
        y: geometry.y,
        minwidth: geometry.minWidth,
        minheight: geometry.minHeight,
        maxwidth: geometry.maxWidth,
        maxheight: geometry.maxHeight,
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
      element.setAttribute('aria-label', options.title);
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
      boxElement.addEventListener('keydown', keydown);
      // Resize handles extend outside the frame. Only explicit chrome/Escape closes a window.
      let touched = false;
      let generation: string | undefined;
      let saveTimer: ReturnType<typeof setTimeout> | undefined;
      const placement = () => ({ x: box.x, y: box.y, width: box.width, height: box.height });
      const save = () => {
        if (generation !== undefined)
          void saveWindowPlacement(options.type, generation, placement());
      };
      const moved = () => {
        touched = true;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(save, 150);
      };
      const restored = readWindowPlacement(options.type).then((value) => {
        generation = value.generation;
        if (!disposing && !touched && value.placement) {
          const next = windowGeometry(options.type, area(), value.placement, options.size);
          box.resize(next.width, next.height).move(next.x, next.y);
        }
      });
      box.onmove = moved;
      box.onresize = moved;
      const viewportChanged = () => {
        const next = windowGeometry(options.type, area(), placement(), options.size);
        box.minwidth = next.minWidth;
        box.minheight = next.minHeight;
        box.maxwidth = next.maxWidth;
        box.maxheight = next.maxHeight;
        if (box.max) {
          box
            .resize(next.maxWidth, next.maxHeight, true)
            .move(
              area().x + (area().width - next.maxWidth) / 2,
              area().y + (area().height - next.maxHeight) / 2,
              true,
            );
        } else box.resize(next.width, next.height).move(next.x, next.y);
      };
      box.onmaximize = viewportChanged;
      window.addEventListener('resize', viewportChanged);
      queueMicrotask(() => {
        if (!disposing) {
          if (options.modal) trap.activate();
          else element.focus();
        }
      });
      return {
        element,
        update(next: WindowOptions) {
          if (disposing) return;
          options = next;
          box.setTitle(next.title);
          element.setAttribute('aria-label', next.title);
          boxElement.classList.toggle('no-close', !next.dismissible);
          close.tabIndex = next.dismissible ? 0 : -1;
          close.setAttribute('aria-hidden', String(!next.dismissible));
        },
        dispose() {
          if (disposing) return;
          disposing = true;
          windows.splice(windows.indexOf(element), 1);
          clearTimeout(saveTimer);
          const finalPlacement = placement();
          void restored.then(() => saveWindowPlacement(options.type, generation!, finalPlacement));
          window.removeEventListener('resize', viewportChanged);
          close.removeEventListener('keydown', closeKey);
          element.removeEventListener('focusin', activate);
          boxElement.removeEventListener('keydown', keydown);
          trap.deactivate({ returnFocus: false });
          box.close(true);
          if (previousFocus?.isConnected) previousFocus.focus();
        },
      };
    },
  };
}

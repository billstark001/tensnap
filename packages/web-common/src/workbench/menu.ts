export interface MenuController {
  element: HTMLElement;
  close(): void;
  decorate(className: string, style?: Partial<CSSStyleDeclaration>): void;
}
const stack: MenuController[] = [];
export function openMenu(
  x: number,
  y: number,
  restoreFocus: HTMLElement | null,
  onClose: () => void,
): MenuController {
  // A new root menu replaces the previous root rather than leaving orphan overlays.
  stack[stack.length - 1]?.close();
  const element = document.createElement('div');
  element.dataset.workbenchMenu = '';
  element.setAttribute('role', 'menu');
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.tabIndex = -1;
  (restoreFocus?.closest('.content-island') ?? document.body).append(element);
  let disposed = false;
  const items = () =>
    Array.from(element.querySelectorAll<HTMLElement>('[role=menuitem]:not(:disabled)'));
  const close = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', key, true);
    const index = stack.indexOf(controller);
    if (index >= 0) stack.splice(index, 1);
    observer.disconnect();
    element.remove();
    restoreFocus?.focus();
    onClose();
  };
  const outside = (event: PointerEvent) => {
    if (!element.contains(event.target as Node)) close();
  };
  const key = (event: KeyboardEvent) => {
    if (stack[stack.length - 1] !== controller) return;
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    let next: number | undefined;
    if (event.key === 'ArrowDown') next = (current + 1) % list.length;
    if (event.key === 'ArrowUp') next = (current - 1 + list.length) % list.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = list.length - 1;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopImmediatePropagation();
      close();
      return;
    }
    if (next !== undefined) {
      event.preventDefault();
      list[next]?.focus();
      return;
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const ordered = [...list.slice(current + 1), ...list.slice(0, current + 1)];
      const match = ordered.find((item) =>
        item.textContent?.trim().toLowerCase().startsWith(event.key.toLowerCase()),
      );
      if (match) {
        event.preventDefault();
        match.focus();
      }
    }
  };
  const observer = new MutationObserver(() => {
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
    if (!element.contains(document.activeElement)) (items()[0] ?? element).focus();
  });
  observer.observe(element, { childList: true, subtree: true });
  const controller = {
    element,
    close,
    decorate(className: string, style?: Partial<CSSStyleDeclaration>) {
      element.className = className;
      Object.assign(element.style, style);
    },
  };
  stack.push(controller);
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key, true);
  return controller;
}

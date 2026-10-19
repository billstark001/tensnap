export interface MenuController {
  element: HTMLElement;
  close(): void;
}
const stack: MenuController[] = [];
const owners = new Map<MenuController, HTMLElement | null>();
const listeners = new Set<() => void>();
/** Include body-level menus in their owning modal's focus boundary. */
export function observeOwnedMenus(owner: HTMLElement, update: (menus: HTMLElement[]) => void) {
  const notify = () =>
    update(
      stack.filter((menu) => owner.contains(owners.get(menu) ?? null)).map((menu) => menu.element),
    );
  listeners.add(notify);
  notify();
  return () => {
    listeners.delete(notify);
    for (const menu of [...stack]) {
      if (owner.contains(owners.get(menu) ?? null)) menu.close();
    }
  };
}
function notifyOwners() {
  for (const listener of listeners) listener();
}
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
  element.style.left = `${x}px`;
  element.style.top = `${y}px`;
  element.tabIndex = -1;
  // Coordinates are viewport-relative. Window bodies can establish fixed-position
  // containing blocks and clip descendants, so all menus live at the document root.
  document.body.append(element);
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
    resizeObserver.disconnect();
    window.removeEventListener('resize', close);
    document.removeEventListener('scroll', scrolled, true);
    owners.delete(controller);
    notifyOwners();
    element.remove();
    if (restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
    onClose();
  };
  const outside = (event: PointerEvent) => {
    const target = event.target as Node;
    // Let an ordinary trigger's click handler toggle its already-open menu.
    if (restoreFocus?.matches('[aria-haspopup="menu"]') && restoreFocus.contains(target)) return;
    if (!element.contains(target)) close();
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
  const position = () => {
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(x, innerWidth - rect.width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(y, innerHeight - rect.height - 4))}px`;
  };
  const scrolled = (event: Event) => {
    if (!(event.target instanceof Node) || !element.contains(event.target)) close();
  };
  const observer = new MutationObserver(() => {
    position();
    if (!element.contains(document.activeElement))
      (items()[0] ?? element).focus({ preventScroll: true });
  });
  const resizeObserver = new ResizeObserver(position);
  resizeObserver.observe(element);
  observer.observe(element, { childList: true, subtree: true });
  const controller = {
    element,
    close,
  };
  stack.push(controller);
  owners.set(controller, restoreFocus);
  notifyOwners();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', key, true);
  window.addEventListener('resize', close);
  document.addEventListener('scroll', scrolled, true);
  return controller;
}

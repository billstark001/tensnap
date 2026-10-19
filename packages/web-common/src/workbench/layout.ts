// oxlint-disable-next-line typescript/triple-slash-reference -- Shared source consumers need the untyped dependency and CSS declarations.
/// <reference path="./winbox.d.ts" />
import './workbench.css';

export function createWorkbenchShell() {
  const element = document.createElement('div');
  element.className = 'workbench-shell';
  const toolbar = document.createElement('header');
  const workspace = document.createElement('main');
  workspace.className = 'workbench-workspace';
  workspace.dataset.fileDropTarget = 'workbench';
  element.append(toolbar, workspace);
  return { element, toolbar, workspace, dispose: () => element.remove() };
}

/** DOM split controller shared by every panel content implementation. */
export function createSplit(axis: 'horizontal' | 'vertical', ratio: number) {
  const element = document.createElement('div');
  element.className = 'workbench-split';
  element.dataset.axis = axis;
  const first = document.createElement('div');
  first.dataset.panel = 'first';
  const second = document.createElement('div');
  second.dataset.panel = 'second';
  const divider = document.createElement('div');
  divider.className = 'workbench-divider';
  divider.tabIndex = 0;
  divider.setAttribute('role', 'separator');
  divider.setAttribute('aria-orientation', axis === 'horizontal' ? 'vertical' : 'horizontal');
  let visible = true;
  const update = () => {
    first.style.flex = visible ? `0 0 calc(${ratio * 100}% - 2px)` : '1';
    second.style.flex = '1';
    second.style.display = visible ? 'flex' : 'none';
    divider.style.display = visible ? '' : 'none';
    divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  };
  const move = (event: PointerEvent) => {
    if (!divider.hasPointerCapture(event.pointerId)) return;
    const rect = element.getBoundingClientRect();
    ratio = Math.max(
      0.1,
      Math.min(
        0.9,
        axis === 'horizontal'
          ? (event.clientX - rect.left) / rect.width
          : (event.clientY - rect.top) / rect.height,
      ),
    );
    update();
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
  };
  const key = (event: KeyboardEvent) => {
    const backwards = axis === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
    const forwards = axis === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
    if (event.key !== backwards && event.key !== forwards) return;
    event.preventDefault();
    ratio = Math.max(0.1, Math.min(0.9, ratio + (event.key === backwards ? -0.02 : 0.02)));
    update();
  };
  divider.addEventListener('pointerdown', down);
  divider.addEventListener('pointermove', move);
  divider.addEventListener('keydown', key);
  element.append(first, divider, second);
  update();
  return {
    element,
    first,
    second,
    setVisible(next: boolean) {
      visible = next;
      update();
    },
    dispose() {
      divider.removeEventListener('pointerdown', down);
      divider.removeEventListener('pointermove', move);
      divider.removeEventListener('keydown', key);
      element.remove();
    },
  };
}

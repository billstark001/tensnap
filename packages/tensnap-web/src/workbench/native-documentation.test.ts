import { expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../../tensnap-tauri/node_modules/@tauri-apps/api/core.js', () => ({ invoke }));
import { openDocumentation } from '../../../tensnap-tauri/src/adapters/common';
it('asks the native host to open its fixed documentation target without a popup or renderer-provided URL', async () => {
  const browser = vi.spyOn(window, 'open');
  try {
    await openDocumentation();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_documentation_handler');
    expect(browser).not.toHaveBeenCalled();
  } finally {
    browser.mockRestore();
  }
});

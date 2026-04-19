import { describe, expect, it } from 'vitest';
import { resolveRuntimeContextPaths, sanitizeContextName } from './context';

describe('sanitizeContextName', () => {
  it('normalizes unsafe characters', () => {
    expect(sanitizeContextName(' Agent Session / Demo ')).toBe('agent-session-demo');
  });

  it('falls back to default for empty names', () => {
    expect(sanitizeContextName('   ')).toBe('default');
  });
});

describe('resolveRuntimeContextPaths', () => {
  it('uses .tensnap under cwd by default', () => {
    const paths = resolveRuntimeContextPaths({ cwd: '/tmp/tensnap-demo', contextName: 'researcher-1' });
    expect(paths.rootDir).toBe('/tmp/tensnap-demo/.tensnap');
    expect(paths.contextDir).toBe('/tmp/tensnap-demo/.tensnap/contexts/researcher-1');
    expect(paths.snapshotFile).toBe('/tmp/tensnap-demo/.tensnap/contexts/researcher-1/scene.snapshot.json');
  });
});
/**
 * runtime/SyncBoundary.test.ts
 *
 * Unit tests for the SyncBoundary sub-component.
 */

import { describe, it, expect } from 'vitest';
import { SyncBoundary } from './SyncBoundary';

describe('SyncBoundary – initial state', () => {
  it('starts idle with no requestId', () => {
    const sb = new SyncBoundary();
    expect(sb.phase).toBe('idle');
    expect(sb.requestId).toBeNull();
    expect(sb.isIdle).toBe(true);
  });
});

describe('SyncBoundary – requestSync', () => {
  it('transitions to requested phase', () => {
    const sb = new SyncBoundary();
    sb.requestSync('sync-1');
    expect(sb.phase).toBe('requested');
    expect(sb.requestId).toBe('sync-1');
    expect(sb.isIdle).toBe(false);
  });

  it('accepts undefined requestId', () => {
    const sb = new SyncBoundary();
    sb.requestSync();
    expect(sb.phase).toBe('requested');
    expect(sb.requestId).toBeNull();
  });
});

describe('SyncBoundary – recordBoundary', () => {
  it('begin moves to receiving phase', () => {
    const sb = new SyncBoundary();
    sb.requestSync('sync-1');
    const ok = sb.recordBoundary('begin', { request_id: 'sync-1' });
    expect(ok).toBe(true);
    expect(sb.phase).toBe('receiving');
    expect(sb.requestId).toBe('sync-1');
  });

  it('end moves back to idle and calls onEndIdle', () => {
    const sb = new SyncBoundary();
    sb.requestSync('sync-1');
    sb.recordBoundary('begin', { request_id: 'sync-1' });
    let idleCalled = false;
    const ok = sb.recordBoundary('end', { request_id: 'sync-1' }, () => { idleCalled = true; });
    expect(ok).toBe(true);
    expect(sb.isIdle).toBe(true);
    expect(idleCalled).toBe(true);
  });

  it('rejects boundary with mismatched requestId', () => {
    const sb = new SyncBoundary();
    sb.requestSync('sync-1');
    const ok = sb.recordBoundary('end', { request_id: 'other-sync' });
    expect(ok).toBe(false);
    expect(sb.phase).toBe('requested');
  });

  it('rejects boundary when no requestId is set', () => {
    const sb = new SyncBoundary();
    const ok = sb.recordBoundary('begin', { request_id: 'sync-1' });
    expect(ok).toBe(false);
    expect(sb.isIdle).toBe(true);
  });
});

describe('SyncBoundary – reset', () => {
  it('resets to idle state', () => {
    const sb = new SyncBoundary();
    sb.requestSync('sync-1');
    sb.recordBoundary('begin', { request_id: 'sync-1' });
    sb.reset();
    expect(sb.isIdle).toBe(true);
    expect(sb.requestId).toBeNull();
  });
});

describe('SyncBoundary – getSnapshot', () => {
  it('returns a copy of the sync state', () => {
    const sb = new SyncBoundary();
    sb.requestSync('sync-1');
    const snap = sb.getSnapshot();
    expect(snap.phase).toBe('requested');
    expect(snap.requestId).toBe('sync-1');
    // Mutating the snapshot does not affect internal state
    snap.phase = 'idle' as never;
    expect(sb.phase).toBe('requested');
  });
});

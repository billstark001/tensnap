import { describe, it, expect, vi } from 'vitest';
import { LazyEventTarget } from './LazyEventTarget';

function listener() {
  return vi.fn() as unknown as EventListener;
}

describe('LazyEventTarget', () => {
  // #region 1. Basic lazy dispatch
  describe('1. Basic lazy dispatch', () => {
    it('should NOT call factory when no listener is present', () => {
      const t = new LazyEventTarget();
      const factory = vi.fn(() => new Event('ping'));

      t.dispatchLazy('ping', factory);

      expect(factory).not.toHaveBeenCalled();
    });

    it('should call factory and notify listener when listener is present', () => {
      const t = new LazyEventTarget();
      const factory = vi.fn(() => new Event('ping'));
      const listener = vi.fn();

      t.addEventListener('ping', listener);
      t.dispatchLazy('ping', factory);

      expect(factory).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledOnce();
    });
  });
  // #endregion

  // #region 2. listenerCount / hasListeners
  describe('2. listenerCount / hasListeners', () => {
    it('should correctly track the number of active listeners', () => {
      const t = new LazyEventTarget();
      expect(t.listenerCount('x')).toBe(0);
      expect(t.hasListeners('x')).toBe(false);

      const fn = vi.fn();
      t.addEventListener('x', fn);

      expect(t.listenerCount('x')).toBe(1);
      expect(t.hasListeners('x')).toBe(true);

      t.removeEventListener('x', fn);

      expect(t.listenerCount('x')).toBe(0);
      expect(t.hasListeners('x')).toBe(false);
    });
  });
  // #endregion

  // #region 3. Deduplication
  describe('3. Deduplication (same listener twice)', () => {
    it('should ignore duplicate listeners', () => {
      const t = new LazyEventTarget();
      const fn = vi.fn();

      t.addEventListener('click', fn);
      t.addEventListener('click', fn); // duplicate

      expect(t.listenerCount('click')).toBe(1);
    });
  });
  // #endregion

  // #region 4. once option
  describe('4. once option', () => {
    it('should invoke listener only once and remove it', () => {
      const t = new LazyEventTarget();
      const listener = vi.fn();

      t.addEventListener('ev', listener, { once: true });
      expect(t.listenerCount('ev')).toBe(1);

      t.dispatchEvent(new Event('ev'));
      expect(listener).toHaveBeenCalledTimes(1);
      expect(t.listenerCount('ev')).toBe(0);

      t.dispatchEvent(new Event('ev'));
      expect(listener).toHaveBeenCalledTimes(1); // Not called a second time
    });
  });
  // #endregion

  // #region 5. once removed before firing
  describe('5. once listener removed before firing', () => {
    it('should not fire if a once-listener is explicitly removed beforehand', () => {
      const t = new LazyEventTarget();
      const listener = vi.fn();

      t.addEventListener('ev', listener, { once: true });
      t.removeEventListener('ev', listener);

      expect(t.listenerCount('ev')).toBe(0);

      t.dispatchEvent(new Event('ev'));
      expect(listener).not.toHaveBeenCalled();
    });
  });
  // #endregion

  // #region 6. AbortSignal
  describe('6. AbortSignal removes listener', () => {
    it('should remove the listener when the AbortSignal aborts', () => {
      const t = new LazyEventTarget();
      const ac = new AbortController();
      const listener = vi.fn();

      t.addEventListener('ev', listener, { signal: ac.signal });
      expect(t.listenerCount('ev')).toBe(1);

      t.dispatchEvent(new Event('ev'));
      expect(listener).toHaveBeenCalledTimes(1);

      ac.abort();
      expect(t.listenerCount('ev')).toBe(0);

      t.dispatchEvent(new Event('ev'));
      expect(listener).toHaveBeenCalledTimes(1); // Does not fire again
    });
  });
  // #endregion

  // #region 7. Pre-aborted signal
  describe('7. Pre-aborted signal', () => {
    it('should not register the listener if the signal is already aborted', () => {
      const t = new LazyEventTarget();
      const ac = new AbortController();
      ac.abort();

      t.addEventListener('ev', listener(), { signal: ac.signal });
      expect(t.listenerCount('ev')).toBe(0);
    });
  });
  // #endregion

  // #region 8. Capture vs bubble
  describe('8. Capture vs bubble are independent registrations', () => {
    it('should count and remove capture and bubble listeners separately', () => {
      const t = new LazyEventTarget();
      const fn = vi.fn();

      t.addEventListener('ev', fn, { capture: false });
      t.addEventListener('ev', fn, { capture: true });
      expect(t.listenerCount('ev')).toBe(2);

      t.removeEventListener('ev', fn, { capture: true });
      expect(t.listenerCount('ev')).toBe(1);
    });
  });
  // #endregion

  // #region 9. EventListenerObject
  describe('9. EventListenerObject (handleEvent)', () => {
    it('should support objects with a handleEvent method', () => {
      const t = new LazyEventTarget();
      const obj = { handleEvent: vi.fn() };

      t.addEventListener('ev', obj);
      t.dispatchEvent(new Event('ev'));

      expect(obj.handleEvent).toHaveBeenCalledOnce();

      t.removeEventListener('ev', obj);
      expect(t.listenerCount('ev')).toBe(0);
    });
  });
  // #endregion

  // #region 10. dispatchLazyCustom
  describe('10. dispatchLazyCustom<T>', () => {
    type Payload = { value: number };

    it('should skip factory and return false when no listeners are present', () => {
      const t = new LazyEventTarget();
      const factory = vi.fn(() => ({ value: 42 }));

      const dispatched = t.dispatchLazyCustom<Payload>('data', factory);

      expect(factory).not.toHaveBeenCalled();
      expect(dispatched).toBe(false);
    });

    it('should call factory and dispatch CustomEvent when listeners are present', () => {
      const t = new LazyEventTarget();
      const factory = vi.fn(() => ({ value: 42 }));
      const listener = vi.fn();

      t.addEventListener('data', listener);
      t.dispatchLazyCustom<Payload>('data', factory);

      expect(factory).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledOnce();

      const eventArg = listener.mock.calls[0][0] as CustomEvent<Payload>;
      expect(eventArg.detail).toEqual({ value: 42 });
    });
  });
  // #endregion

  // #region 11. once + AbortSignal
  describe('11. once + AbortSignal', () => {
    it('should give precedence to abort removal over once', () => {
      const t = new LazyEventTarget();
      const ac = new AbortController();
      const listener = vi.fn();

      t.addEventListener('ev', listener, { once: true, signal: ac.signal });
      expect(t.listenerCount('ev')).toBe(1);

      ac.abort();
      expect(t.listenerCount('ev')).toBe(0);

      t.dispatchEvent(new Event('ev'));
      expect(listener).not.toHaveBeenCalled();
    });
  });
  // #endregion

  // #region 12. Multiple event types
  describe('12. Multiple event types are tracked independently', () => {
    it('should track listener counts independently per event type', () => {
      const t = new LazyEventTarget();

      t.addEventListener('foo', listener());
      t.addEventListener('bar', listener());
      t.addEventListener('bar', listener());

      expect(t.listenerCount('foo')).toBe(1);
      expect(t.listenerCount('bar')).toBe(2);
    });
  });
  // #endregion
});
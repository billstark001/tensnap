/**
 * LazyEventTarget.ts
 *
 * An EventTarget subclass that accurately tracks listener registrations and
 * exposes lazy-dispatch helpers, ensuring expensive payload factories are only
 * invoked when at least one listener is registered for the event type.
 *
 * Spec-compliant edge-cases handled:
 *  1. Deduplication   – adding the same (type, listener, capture) tuple twice
 *                       is silently ignored, mirroring native behaviour.
 *  2. `once` option   – one-shot listeners are cleaned up from our registry
 *                       after the first invocation (the native side removes the
 *                       listener automatically, but our count would otherwise
 *                       never decrement).
 *  3. `signal` option – when an AbortSignal fires, the native side removes the
 *                       listener; we mirror that in our count/registry.
 *  4. Pre-aborted signal – if the signal is already aborted at registration
 *                          time the call is a no-op per spec.
 *  5. null listener   – silently ignored per spec.
 *  6. `capture` flag  – the same listener registered for both capture and
 *                       bubble phases are counted as two independent entries.
 *  7. EventListenerObject – objects with `handleEvent` are supported in
 *                           addition to plain function listeners.
 *
 * References:
 *  - https://dom.spec.whatwg.org/#dom-eventtarget-addeventlistener
 *  - https://developer.mozilla.org/en-US/docs/Web/API/EventTarget/addEventListener
 */

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the effective `capture` boolean from the overloaded options argument.
 * Only `capture` (not `once`, `passive`, etc.) affects listener identity.
 */
function resolveCapture(
  options?: boolean | AddEventListenerOptions | EventListenerOptions
): boolean {
  if (typeof options === "boolean") return options;
  return options?.capture ?? false;
}

/**
 * Dispatch a listener — handles both plain functions and EventListenerObjects.
 */
function invokeListener(
  listener: EventListenerOrEventListenerObject,
  event: Event,
  context: EventTarget
): void {
  if (typeof listener === "function") {
    listener.call(context, event);
  } else {
    listener.handleEvent(event);
  }
}

// ─── Internal record ──────────────────────────────────────────────────────────

interface ListenerRecord {
  /** Original listener reference supplied by the caller. */
  readonly original: EventListenerOrEventListenerObject;
  /**
   * The listener actually registered with the native super.
   * Equals `original` for normal listeners; equals a wrapper function for
   * `once: true` listeners so we can intercept the invocation.
   */
  readonly wrapped: EventListenerOrEventListenerObject;
  readonly capture: boolean;
  /**
   * Removes our 'abort' handler from the AbortSignal, preventing a leak when
   * the listener is explicitly removed before the signal fires.
   */
  abortCleanup?: () => void;
}

// ─── Public types ─────────────────────────────────────────────────────────────

/** Options accepted by dispatchLazy(). */
export interface DispatchLazyOptions {
  /**
   * When true, dispatchLazy() throws if the factory throws.
   * When false (default), errors are silently swallowed and false is returned.
   */
  throwOnError?: boolean;
}

// ─── LazyEventTarget ──────────────────────────────────────────────────────────

export class LazyEventTarget extends EventTarget {
  /**
   * Three-level registry:  type → original-listener → capture → record
   *
   * This mirrors the (type, callback, capture) identity key used by the
   * native EventTarget specification for deduplication purposes.
   */
  readonly #registry = new Map<
    string, // event type
    Map<
      EventListenerOrEventListenerObject, // original listener
      Map<boolean, ListenerRecord>         // capture → record
    >
  >();

  /** Active listener count keyed by event type. */
  readonly #counts = new Map<string, number>();

  // ── Registry helpers ────────────────────────────────────────────────────────

  #getRecord(
    type: string,
    listener: EventListenerOrEventListenerObject,
    capture: boolean
  ): ListenerRecord | undefined {
    return this.#registry.get(type)?.get(listener)?.get(capture);
  }

  #setRecord(
    type: string,
    listener: EventListenerOrEventListenerObject,
    capture: boolean,
    record: ListenerRecord
  ): void {
    let byListener = this.#registry.get(type);
    if (!byListener) {
      byListener = new Map();
      this.#registry.set(type, byListener);
    }
    let byCapture = byListener.get(listener);
    if (!byCapture) {
      byCapture = new Map();
      byListener.set(listener, byCapture);
    }
    byCapture.set(capture, record);
  }

  /**
   * Removes a record and prunes empty parent Maps to prevent memory leaks.
   * Returns true when a record was present (i.e., a real removal occurred).
   */
  #deleteRecord(
    type: string,
    listener: EventListenerOrEventListenerObject,
    capture: boolean
  ): boolean {
    const byListener = this.#registry.get(type);
    if (!byListener) return false;
    const byCapture = byListener.get(listener);
    if (!byCapture) return false;

    const existed = byCapture.delete(capture);
    if (byCapture.size === 0) byListener.delete(listener);
    if (byListener.size === 0) this.#registry.delete(type);
    return existed;
  }

  #incrementCount(type: string): void {
    this.#counts.set(type, (this.#counts.get(type) ?? 0) + 1);
  }

  #decrementCount(type: string): void {
    const n = this.#counts.get(type) ?? 0;
    if (n <= 1) this.#counts.delete(type);
    else this.#counts.set(type, n - 1);
  }

  /**
   * Internal unified teardown: detach from AbortSignal, delete record, and
   * decrement count.  Does NOT call super.removeEventListener() — callers are
   * responsible for that when necessary (see removeEventListener override and
   * the abort handler comment in addEventListener).
   */
  #unregister(
    type: string,
    listener: EventListenerOrEventListenerObject,
    capture: boolean
  ): ListenerRecord | undefined {
    const record = this.#getRecord(type, listener, capture);
    if (!record) return undefined;

    record.abortCleanup?.();
    this.#deleteRecord(type, listener, capture);
    this.#decrementCount(type);
    return record;
  }

  // ── EventTarget overrides ───────────────────────────────────────────────────

  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void {
    // Per spec, a null/undefined listener is silently ignored.
    if (listener == null) return;

    const capture = resolveCapture(options);
    const opts = typeof options === "object" ? options : undefined;
    const signal = opts?.signal;
    const once   = opts?.once ?? false;

    // Per spec, an already-aborted signal makes the call a no-op.
    if (signal?.aborted) return;

    // Deduplication: (type, listener, capture) already in our registry means
    // the native EventTarget would also ignore this call — keep our count stable.
    if (this.#getRecord(type, listener, capture)) {
      // Still delegate so the native side can reflect any option changes (passive).
      super.addEventListener(type, listener, options);
      return;
    }

    let wrapped: EventListenerOrEventListenerObject;

    if (once) {
      /**
       * Wrap the listener so we can intercept the single invocation and clean
       * up our tracking immediately after.  The native EventTarget removes the
       * wrapper from its own registry automatically, but it has no way to
       * update ours — hence the explicit teardown inside the wrapper.
       *
       * We use a mutable ref cell (`abortCleanupRef`) to break the
       * chicken-and-egg dependency: the closure needs `record.abortCleanup`
       * but `record` is only created after the closure.
       */
      const abortCleanupRef: { fn?: () => void } = {};
      const onceWrapper: EventListener = (event: Event) => {
        invokeListener(listener, event, this);
        // Remove our tracking entry (native already removed `wrapped`).
        this.#deleteRecord(type, listener, capture);
        this.#decrementCount(type);
        abortCleanupRef.fn?.();
      };
      wrapped = onceWrapper;

      const record: ListenerRecord = { original: listener, wrapped, capture };

      if (signal) {
        const abortHandler = () => {
          // Native removes the wrapper when signal fires; we clean up our side.
          this.#unregister(type, listener, capture);
          // Note: no super.removeEventListener() needed — native handles it.
        };
        // once: true so the handler is auto-removed after the signal fires.
        signal.addEventListener("abort", abortHandler, { once: true });
        const cleanup = () =>
          signal.removeEventListener("abort", abortHandler);
        abortCleanupRef.fn = cleanup;
        record.abortCleanup = cleanup;
      }

      this.#setRecord(type, listener, capture, record);
      this.#incrementCount(type);
      super.addEventListener(type, wrapped, options);
    } else {
      // Non-once path: no wrapping needed; the original reference is reused.
      wrapped = listener;
      const record: ListenerRecord = { original: listener, wrapped, capture };

      if (signal) {
        const abortHandler = () => {
          this.#unregister(type, listener, capture);
        };
        signal.addEventListener("abort", abortHandler, { once: true });
        record.abortCleanup = () =>
          signal.removeEventListener("abort", abortHandler);
      }

      this.#setRecord(type, listener, capture, record);
      this.#incrementCount(type);
      super.addEventListener(type, wrapped, options);
    }
  }

  override removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    if (listener == null) return;

    const capture = resolveCapture(options);
    const record = this.#unregister(type, listener, capture);

    // For once-wrapped listeners we must pass the wrapper to super so the
    // native registry can find and remove it; otherwise we pass the original.
    super.removeEventListener(type, record?.wrapped ?? listener, options);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Returns the total number of active listeners registered for `type`,
   * summed across both capture and bubble phases.
   */
  listenerCount(type: string): number {
    return this.#counts.get(type) ?? 0;
  }

  /**
   * Returns true when at least one listener is registered for `type`.
   */
  hasListeners(type: string): boolean {
    return this.listenerCount(type) > 0;
  }

  /**
   * Dispatches an event only when at least one listener is registered for
   * `type`.  The `factory` function is called lazily — it is never invoked
   * when no listeners exist, making this suitable for expensive payloads.
   *
   * @param type    - Event type string.
   * @param factory - Called only when listeners are present; must return a
   *                  fully constructed Event (or CustomEvent) to dispatch.
   * @param opts    - Optional behaviour tweaks (see DispatchLazyOptions).
   * @returns false if no listeners were registered and the event was skipped;
   *          otherwise the return value of dispatchEvent() (false if any
   *          listener called preventDefault(), true otherwise).
   */
  dispatchLazy(
    type: string,
    factory: () => Event,
    opts: DispatchLazyOptions = {}
  ): boolean {
    if (!this.hasListeners(type)) return false;
    try {
      return this.dispatchEvent(factory());
    } catch (err) {
      if (opts.throwOnError) throw err;
      return false;
    }
  }

  /**
   * Convenience overload of dispatchLazy for CustomEvent<T>.
   * Only `detailFactory` is called lazily; `init` fields are plain values.
   *
   * @param type          - Event type string.
   * @param detailFactory - Expensive computation that produces the payload.
   * @param init          - Optional extra CustomEventInit fields (bubbles,
   *                        cancelable, composed …) excluding `detail`.
   * @param opts          - Optional behaviour tweaks.
   */
  dispatchLazyCustom<T = unknown>(
    type: string,
    detailFactory: () => T,
    init?: Omit<CustomEventInit<T>, "detail">,
    opts: DispatchLazyOptions = {}
  ): boolean {
    if (!this.hasListeners(type)) return false;
    try {
      return this.dispatchEvent(
        new CustomEvent<T>(type, { ...init, detail: detailFactory() })
      );
    } catch (err) {
      if (opts.throwOnError) throw err;
      return false;
    }
  }
}

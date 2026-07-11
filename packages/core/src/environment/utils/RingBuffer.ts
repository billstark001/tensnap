
/**
 * Fixed-capacity circular buffer.
 *
 * - **O(1) push** — overwrites the oldest element when full; no shifting or splicing.
 * - **Pre-allocated backing store** — no heap growth or reallocation after construction.
 * - **`capacity = 0`** → unbounded mode (plain growing array, no eviction).
 */
export interface RingBufferPushResult<T> {
  /** The overwritten oldest item when a bounded ring wraps. */
  evicted?: T;
}

export class RingBuffer<T> {
  /**
   * Backing store. Sized to `capacity` for bounded buffers;
   * grows dynamically for unbounded ones.
   */
  private readonly buf: (T | undefined)[];
  /**
   * Index of the next write slot.
   * When the buffer is full this also equals the index of the **oldest** element.
   */
  private head = 0;
  private _size = 0;
  readonly capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buf = capacity > 0 ? new Array<T | undefined>(capacity) : [];
  }

  get size(): number {
    return this._size;
  }

  push(item: T): RingBufferPushResult<T> {
    if (this.capacity === 0) {
      (this.buf as T[]).push(item);
      this._size++;
      return {};
    }
    const evicted = this._size === this.capacity ? this.buf[this.head] : undefined;
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.capacity;
    if (this._size < this.capacity) this._size++;
    return evicted === undefined ? {} : { evicted };
  }

  /**
   * Returns a new `RingBuffer<T>` with `newCapacity`, retaining the
   * newest `min(size, newCapacity)` elements. Used when the resolved
   * limit changes due to a config update.
   */
  resize(newCapacity: number): RingBuffer<T> {
    const next = new RingBuffer<T>(newCapacity);
    // Skip the oldest elements that no longer fit.
    const skip = newCapacity > 0 ? Math.max(0, this._size - newCapacity) : 0;
    let seen = 0;
    for (const item of this) {
      if (seen++ >= skip) next.push(item);
    }
    return next;
  }

  *[Symbol.iterator](): Iterator<T> {
    if (this.capacity === 0 || this._size < this.capacity) {
      // Items are contiguous from index 0.
      for (let i = 0; i < this._size; i++) yield this.buf[i] as T;
    } else {
      // Full ring: oldest element is at `head`.
      for (let i = 0; i < this._size; i++) {
        yield this.buf[(this.head + i) % this.capacity] as T;
      }
    }
  }

  toArray(): T[] {
    if (this._size === 0) return [];
    const arr = new Array<T>(this._size);
    let i = 0;
    for (const item of this) arr[i++] = item;
    return arr;
  }
}

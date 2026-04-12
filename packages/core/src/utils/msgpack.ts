/**
 * Checks for all cases in an object that cannot be correctly handled by @msgpack/msgpack
 * @param obj - The object to check
 * @param path - The current property path (used internally for recursion)
 * @param seen - Used to detect circular references (used internally for recursion)
 */
export function checkMsgpackCompatibility(
  obj: any,
  path: string = 'root',
  seen: WeakSet<object> = new WeakSet()
): void {
  // Allow null and undefined. msgpack supports undefined (in some versions).
  if (obj === null || obj === undefined) return;

  // Check for circular references
  if (typeof obj === 'object' && obj !== null) {
    if (seen.has(obj)) {
      console.warn(`[msgpack] Circular reference: ${path}`);
      return;
    }
    seen.add(obj);
  }

  // Check type
  const type = typeof obj;
  if (type === 'function') {
    console.warn(`[msgpack] Cannot serialize function: ${path}`);
    return;
  }
  if (type === 'symbol') {
    console.warn(`[msgpack] Cannot serialize Symbol: ${path}`);
    return;
  }
  if (type === 'bigint') {
    console.warn(`[msgpack] Cannot serialize BigInt: ${path}`);
    return;
  }

  // Check special objects
  if (obj instanceof Map) {
    console.warn(`[msgpack] Cannot directly serialize Map: ${path}`);
    return;
  }
  if (obj instanceof Set) {
    console.warn(`[msgpack] Cannot directly serialize Set: ${path}`);
    return;
  }
  if (obj instanceof Date) {
    console.warn(`[msgpack] Cannot directly serialize Date: ${path}`);
    return;
  }
  if (obj instanceof RegExp) {
    console.warn(`[msgpack] Cannot directly serialize RegExp: ${path}`);
    return;
  }
  if (
    typeof obj === 'object' &&
    obj !== null &&
    obj.constructor &&
    obj.constructor !== Object &&
    !Array.isArray(obj) &&
    !(obj instanceof Uint8Array)
  ) {
    // Not a plain object/array/Uint8Array
    console.warn(`[msgpack] Non-plain object (custom class instance) may not be directly serializable: ${path} [${obj.constructor.name}]`);
    return;
  }

  // Recursively check arrays and objects
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => {
      checkMsgpackCompatibility(item, `${path}[${i}]`, seen);
    });
  } else if (typeof obj === 'object' && obj !== null) {
    for (const key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      checkMsgpackCompatibility(obj[key], `${path}.${key}`, seen);
    }
  }
}


export function arrayBufferToJsonString(buffer: ArrayBuffer): string {
  let binary = new TextDecoder('latin1').decode(new Uint8Array(buffer));
  return JSON.stringify(binary);
}

/**
 * Converts a Uint8Array to an ArrayBuffer.
 * - If the Uint8Array covers the entire underlying buffer, returns the original ArrayBuffer.
 * - Otherwise, creates a new ArrayBuffer and copies the relevant bytes, minimizing memory usage.
 * 
 * @param uint8Array The source Uint8Array.
 * @returns An ArrayBuffer containing the same data.
 */
export function uint8ArrayToArrayBuffer(uint8Array: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = uint8Array;

  // Check if Uint8Array covers the entire buffer
  if (byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer as ArrayBuffer;
  }

  // Otherwise, allocate a new ArrayBuffer and copy the relevant bytes
  const newBuffer = new ArrayBuffer(byteLength);
  new Uint8Array(newBuffer).set(uint8Array);

  return newBuffer;
}
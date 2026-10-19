/**
 * JSON omits undefined object properties, whereas MessagePack writes them as
 * null. Strip them explicitly so both save formats have the same on-disk
 * shape and continue to satisfy the project schema after a round trip.
 */
export const omitUndefinedObjectProperties = (value: unknown): unknown => {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (value instanceof Uint8Array || value instanceof ArrayBuffer) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (item === undefined) {
        throw new Error(`Project data contains an undefined array item at index ${index}.`);
      }
      return omitUndefinedObjectProperties(item);
    });
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
    return value;

  const result: Record<string, unknown> = Object.create(null);
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) result[key] = omitUndefinedObjectProperties(item);
  }
  return result;
};

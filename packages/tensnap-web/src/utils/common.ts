/**
 * Central ID policy for Web: every generated ID uses crypto.randomUUID().
 * Keep callers behind this helper so the generation policy stays consistent.
 */
export function generateUniqueId(): string {
  return crypto.randomUUID();
}

import type { HonoRequest } from 'hono';
import { HTTPException } from 'hono/http-exception';

/** Decode the object envelope shared by control routes before invoking runtime work. */
export async function readJsonObject<T extends object>(
  request: HonoRequest,
  options: { optional?: boolean } = {},
): Promise<T> {
  const text = await request.text();
  if (options.optional && !text.trim()) return {} as T;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    throw new HTTPException(400, { message: 'Request body must be valid JSON.', cause });
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new HTTPException(400, { message: 'Request body must be a JSON object.' });
  }
  return value as T;
}

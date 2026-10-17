import { HTTPException } from 'hono/http-exception';

type Field =
  | 'string'
  | 'boolean'
  | 'number'
  | 'positive'
  | 'integer'
  | 'object'
  | 'array'
  | readonly string[];
export function validateFields(
  body: object,
  fields: Record<string, Field>,
  required: string[] = [],
): void {
  const record = body as Record<string, unknown>;
  for (const key of required) if (record[key] === undefined) invalid(`Missing ${key}.`);
  for (const [key, value] of Object.entries(record)) {
    const field = fields[key];
    if (!field) invalid(`Unknown field: ${key}.`);
    if (value === undefined) continue;
    let valid: boolean;
    if (Array.isArray(field)) valid = typeof value === 'string' && field.includes(value);
    else if (field === 'array') valid = Array.isArray(value);
    else if (field === 'object')
      valid = typeof value === 'object' && value !== null && !Array.isArray(value);
    else if (field === 'number' || field === 'positive' || field === 'integer')
      valid =
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (field === 'number' || value > 0) &&
        (field !== 'integer' || Number.isSafeInteger(value));
    else valid = typeof value === field && (field !== 'string' || !!(value as string).trim());
    if (!valid)
      invalid(`Invalid ${key}: expected ${Array.isArray(field) ? field.join(', ') : field}.`);
  }
}

export function invalid(message: string): never {
  throw new HTTPException(400, { message });
}

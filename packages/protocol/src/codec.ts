import { decode, encode } from '@msgpack/msgpack';
import { decodeBinaryString, encodeBytesAsDataUrl } from './binary';
import {
  AnyProtocolMessageSchema,
  RendererToSimulatorMessageSchema,
  SimulatorToRendererMessageSchema,
} from './schemas';
import type {
  AnyProtocolMessage,
  AssetDataPayload,
  SceneCaptureResultPayload,
  SceneRestorePayload,
  ScreenshotResponsePayload,
} from './types';

export type ProtocolEncoding = 'json' | 'msgpack';
export type ProtocolCodecMode = 'strict' | 'legacy';
export type ProtocolValidationLevel = 'off' | 'warning' | 'error';
export type ProtocolMessageDirection = 'renderer-to-simulator' | 'simulator-to-renderer' | 'any';

export interface ProtocolValidationIssue {
  code: string;
  path: Array<string | number>;
  message: string;
}

export interface ProtocolValidationWarning {
  level: 'warning';
  direction: ProtocolMessageDirection;
  message: string;
  issues: ProtocolValidationIssue[];
}

export interface ProtocolValidationOptions {
  level?: ProtocolValidationLevel;
  direction?: ProtocolMessageDirection;
  onWarning?: (warning: ProtocolValidationWarning) => void;
}

export interface ProtocolCodecWarning {
  code: 'legacy_alias' | 'legacy_discarded' | 'legacy_duplicate';
  message: string;
  path: string;
}

export interface ProtocolCodecOptions {
  /** Select once at session setup; it is deliberately immutable afterwards. */
  mode?: ProtocolCodecMode;
  onWarning?: (warning: ProtocolCodecWarning) => void;
  /** Runtime schema validation is opt-in and performs at most one envelope parse per message. */
  validation?: ProtocolValidationOptions;
}

export class ProtocolValidationError extends Error {
  readonly direction: ProtocolMessageDirection;
  readonly issues: ProtocolValidationIssue[];

  constructor(direction: ProtocolMessageDirection, message: string, issues: ProtocolValidationIssue[]) {
    super(message);
    this.name = 'ProtocolValidationError';
    this.direction = direction;
    this.issues = issues;
  }
}

/** Raised when a peer requests a v0.2 representation that would lose v0.3 data. */
export class UnsupportedLegacyMessageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedLegacyMessageError';
  }
}

/** Generic MessagePack helpers for persistence formats outside the wire codec. */
export function encodeMessagePack(value: unknown): Uint8Array {
  return encode(value);
}

export function decodeMessagePack<T>(data: Uint8Array | ArrayBuffer): T {
  return decode(data instanceof Uint8Array ? data : new Uint8Array(data)) as T;
}

export function detectProtocolEncoding(data: string | Uint8Array | ArrayBuffer): ProtocolEncoding {
  return typeof data === 'string' ? 'json' : 'msgpack';
}

/** Compare parsed major/minor numbers, never lexical version strings. */
export function selectProtocolCodecMode(protocolVersion: string | undefined): ProtocolCodecMode {
  if (!protocolVersion) return 'legacy';
  const match = /^(\d+)\.(\d+)/.exec(protocolVersion);
  if (!match) throw new Error(`Invalid protocol version: ${protocolVersion}`);
  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  return major > 0 || (major === 0 && minor >= 3) ? 'strict' : 'legacy';
}

/**
 * Session-local protocol codec. Strict v0.3 is the default. Legacy conversion
 * is deliberately opt-in and path-aware: arbitrary user maps are untouched.
 */
export class ProtocolCodec {
  readonly mode: ProtocolCodecMode;
  private readonly onWarning?: (warning: ProtocolCodecWarning) => void;
  private validation: Required<Pick<ProtocolValidationOptions, 'level' | 'direction'>>
    & Pick<ProtocolValidationOptions, 'onWarning'>;

  constructor(options: ProtocolCodecOptions = {}) {
    this.mode = options.mode ?? 'strict';
    this.onWarning = options.onWarning;
    this.validation = {
      level: options.validation?.level ?? 'off',
      direction: options.validation?.direction ?? 'any',
      onWarning: options.validation?.onWarning,
    };
  }

  /** Update validation policy without recreating a stateful legacy codec. */
  setValidation(options: ProtocolValidationOptions): void {
    this.validation = {
      level: options.level ?? 'off',
      direction: options.direction ?? 'any',
      onWarning: options.onWarning,
    };
  }

  /**
   * v0.2 did not echo a state-sync request id on its boundary messages.  A
   * codec is session-local so it is the one safe place to retain the one
   * outstanding legacy transaction correlation id.
   */
  private legacyStateSyncRequestId: string | null = null;

  encode(message: AnyProtocolMessage, encoding: ProtocolEncoding): string | Uint8Array {
    const canonical = this.validate(message);
    if (this.mode === 'legacy' && canonical.type === 'state_sync') {
      this.legacyStateSyncRequestId = (canonical.payload as { request_id: string }).request_id;
    }
    const semantic = this.mode === 'legacy'
      ? encodeLegacyMessage(canonical)
      : canonical;
    const normalized = normalizeBinarySemanticMessage(semantic, encoding);
    return encoding === 'json' ? JSON.stringify(normalized) : encode(normalized);
  }

  decode(data: string | Uint8Array | ArrayBuffer): AnyProtocolMessage {
    const decoded = typeof data === 'string'
      ? JSON.parse(data) as unknown
      : decode(data instanceof Uint8Array ? data : new Uint8Array(data));
    const normalized = this.mode === 'legacy'
      ? normalizeLegacyMessage(decoded, (warning) => this.onWarning?.(warning), this.legacyStateSyncRequestId)
      : decoded;
    const canonical = this.validate(normalized);
    return normalizeDecodedBinarySemanticMessage(canonical);
  }

  private validate(message: unknown): AnyProtocolMessage {
    if (this.validation.level === 'off') return message as AnyProtocolMessage;
    const schema = this.validation.direction === 'renderer-to-simulator'
      ? RendererToSimulatorMessageSchema
      : this.validation.direction === 'simulator-to-renderer'
        ? SimulatorToRendererMessageSchema
        : AnyProtocolMessageSchema;
    const result = schema.safeParse(message);
    if (result.success) return result.data as AnyProtocolMessage;

    const issues = result.error.issues.map((issue) => ({
      code: issue.code,
      path: issue.path.map((segment) => typeof segment === 'symbol' ? String(segment) : segment),
      message: issue.message,
    }));
    const detail = issues
      .map((issue) => `${issue.path.length > 0 ? issue.path.join('.') : '<message>'}: ${issue.message}`)
      .join(', ');
    const validationMessage = `Protocol message validation failed (${this.validation.direction}): ${detail}`;
    if (this.validation.level === 'warning') {
      try {
        this.validation.onWarning?.({
          level: 'warning',
          direction: this.validation.direction,
          message: validationMessage,
          issues,
        });
      } catch {
        // Warning observers are non-fatal and cannot turn warning mode into error mode.
      }
      return message as AnyProtocolMessage;
    }
    throw new ProtocolValidationError(this.validation.direction, validationMessage, issues);
  }
}

export function createProtocolCodec(options: ProtocolCodecOptions = {}): ProtocolCodec {
  return new ProtocolCodec(options);
}

/** Canonical v0.3 convenience function; runtime schema validation remains opt-in. */
export function encodeProtocolMessage(
  message: AnyProtocolMessage,
  encoding: ProtocolEncoding,
  options: ProtocolCodecOptions = {},
): string | Uint8Array {
  return new ProtocolCodec(options).encode(message, encoding);
}

/** Canonical v0.3 convenience function; runtime schema validation remains opt-in. */
export function decodeProtocolMessage(
  data: string | Uint8Array | ArrayBuffer,
  options: ProtocolCodecOptions = {},
): AnyProtocolMessage {
  return new ProtocolCodec(options).decode(data);
}

function normalizeBinarySemanticMessage(
  message: Record<string, unknown>,
  encoding: ProtocolEncoding,
): Record<string, unknown> {
  if (!isRecord(message) || !isRecord(message.payload)) return message;
  switch (message.type) {
    case 'asset_data': {
      const payload = message.payload as AssetDataPayload;
      return { ...message, payload: { ...payload, data: normalizeBinaryDataForEncoding(payload.data, payload.mime, encoding) } };
    }
    case 'screenshot_response': {
      const payload = message.payload as ScreenshotResponsePayload;
      return {
        ...message,
        payload: {
          ...payload,
          data: payload.data === undefined ? undefined : normalizeBinaryDataForEncoding(payload.data, payload.mime, encoding),
        },
      };
    }
    case 'scene_restore': {
      const payload = message.payload as SceneRestorePayload;
      return {
        ...message,
        payload: payload.checkpoint === undefined
          ? payload
          : { ...payload, checkpoint: { ...payload.checkpoint, data: normalizeBinaryDataForEncoding(payload.checkpoint.data, undefined, encoding) } },
      };
    }
    case 'scene_capture_result': {
      const payload = message.payload as SceneCaptureResultPayload;
      return {
        ...message,
        payload: { ...payload, checkpoint: { ...payload.checkpoint, data: normalizeBinaryDataForEncoding(payload.checkpoint.data, undefined, encoding) } },
      };
    }
    default:
      return message;
  }
}

function normalizeDecodedBinarySemanticMessage(message: AnyProtocolMessage): AnyProtocolMessage {
  if (!isRecord(message.payload)) return message;
  switch (message.type) {
    case 'asset_data': {
      const payload = message.payload as AssetDataPayload;
      return { ...message, payload: { ...payload, data: decodeBinaryValue(payload.data) } } as AnyProtocolMessage;
    }
    case 'screenshot_response': {
      const payload = message.payload as ScreenshotResponsePayload;
      return { ...message, payload: { ...payload, data: payload.data === undefined ? undefined : decodeBinaryValue(payload.data) } } as AnyProtocolMessage;
    }
    case 'scene_restore': {
      const payload = message.payload as SceneRestorePayload;
      return {
        ...message,
        payload: payload.checkpoint === undefined ? payload : {
          ...payload,
          checkpoint: { ...payload.checkpoint, data: decodeBinaryValue(payload.checkpoint.data) },
        },
      } as AnyProtocolMessage;
    }
    case 'scene_capture_result': {
      const payload = message.payload as SceneCaptureResultPayload;
      return {
        ...message,
        payload: { ...payload, checkpoint: { ...payload.checkpoint, data: decodeBinaryValue(payload.checkpoint.data) } },
      } as AnyProtocolMessage;
    }
    default:
      return message;
  }
}

function decodeBinaryValue(value: string | Uint8Array): Uint8Array {
  return typeof value === 'string' ? decodeBinaryString(value).bytes : value;
}

function normalizeBinaryDataForEncoding(
  value: string | Uint8Array,
  mime: string | undefined,
  encoding: ProtocolEncoding,
): string | Uint8Array {
  if (encoding === 'json') {
    return typeof value === 'string'
      ? value
      : encodeBytesAsDataUrl(value, mime ?? 'application/octet-stream');
  }
  return typeof value === 'string' ? decodeBinaryString(value).bytes : value;
}

function normalizeLegacyMessage(
  input: unknown,
  warn: (warning: ProtocolCodecWarning) => void,
  stateSyncRequestId: string | null,
): Record<string, unknown> {
  if (!isRecord(input) || typeof input.type !== 'string' || !isRecord(input.payload)) {
    throw new Error('Legacy protocol message must be an envelope with object payload.');
  }
  const type = legacyMessageTypes[input.type] ?? input.type;
  const payload = cloneRecord(input.payload);
  if (type !== input.type) warnLegacy(warn, 'legacy_alias', `Translated ${input.type} to ${type}.`, 'type');

  if (input.type === 'action_start') {
    renameKnownKey(payload, 'request_id', 'tick_id', 'payload', warn);
  }
  if (input.type === 'action_end') {
    renameKnownKey(payload, 'request_id', 'tick_id', 'payload', warn);
    renameKnownKey(payload, 'should_continue', 'continue', 'payload', warn);
  }
  if (input.type === 'asset_meta') {
    // The message discriminator is the only difference for this payload.
  }
  if (type === 'env_layer_create' || type === 'env_layer_update') {
    renameKnownKey(payload, 'metadata', 'data', 'payload', warn);
  }
  if (type === 'action_create' || type === 'action_update') {
    discardKnownKey(payload, 'allowRuntimeChange', 'payload', warn);
  }
  if (type === 'param_create' || type === 'param_update') {
    renameKnownKey(payload, 'allow_runtime_change', 'allowRuntimeChange', 'payload', warn);
  }
  if (type === 'chart_create') {
    renameKnownKey(payload, 'data_list', 'dataList', 'payload', warn);
  }
  if (type === 'state_sync') {
    normalizeLegacyStateSync(payload, warn);
  }
  if (type === 'state_sync_begin') {
    normalizeLegacyStateSyncBegin(payload, warn, stateSyncRequestId);
  }
  if (type === 'state_sync_end') {
    normalizeLegacyStateSyncEnd(payload, warn, stateSyncRequestId);
  }
  if (type === 'error') {
    normalizeLegacyError(payload, warn);
  }
  if (type === 'chart_update') {
    normalizeLegacyChartUpdate(payload, warn);
  }
  if (type === 'chart_delete' && Object.prototype.hasOwnProperty.call(payload, 'id') && !Object.prototype.hasOwnProperty.call(payload, 'kind')) {
    // v0.2 ChartStorage.delete(id) addressed chart groups. A series was never
    // independently deleted on that wire format, so this is a semantic
    // migration rather than a best-effort guess.
    payload.kind = 'group';
    warnLegacy(warn, 'legacy_alias', 'Resolved legacy chart_delete as a chart group deletion.', 'payload.kind');
  }

  return { ...input, type, payload };
}

const legacyMessageTypes: Record<string, string> = {
  action_start: 'action_invoke',
  action_end: 'action_result',
  asset_meta: 'asset_metadata',
};

function normalizeLegacyStateSync(payload: Record<string, unknown>, warn: (warning: ProtocolCodecWarning) => void): void {
  if (typeof payload.request_id !== 'string') {
    payload.request_id = 'legacy-state-sync';
    warnLegacy(warn, 'legacy_alias', 'Added legacy state sync request_id.', 'payload.request_id');
  }
  if (typeof payload.model_id !== 'string') {
    payload.model_id = 'legacy';
    warnLegacy(warn, 'legacy_alias', 'Added opaque legacy model_id.', 'payload.model_id');
  }
  if (!Array.isArray(payload.monitors)) payload.monitors = [];
  normalizeParameterArray(payload.parameters, 'payload.parameters', warn);
  normalizeActionArray(payload.actions, 'payload.actions', warn);
  normalizeChartArray(payload.charts, 'payload.charts', warn);
}

function normalizeLegacyStateSyncBegin(
  payload: Record<string, unknown>,
  warn: (warning: ProtocolCodecWarning) => void,
  stateSyncRequestId: string | null,
): void {
  if (typeof payload.request_id !== 'string') {
    payload.request_id = stateSyncRequestId ?? 'legacy-state-sync';
    warnLegacy(warn, 'legacy_alias', 'Added legacy state sync request_id.', 'payload.request_id');
  }
  if (typeof payload.model_id !== 'string') {
    payload.model_id = 'legacy';
    warnLegacy(warn, 'legacy_alias', 'Added opaque legacy model_id.', 'payload.model_id');
  }
  if (typeof payload.instance_id !== 'string') {
    payload.instance_id = 'legacy';
    warnLegacy(warn, 'legacy_alias', 'Added opaque legacy instance_id.', 'payload.instance_id');
  }
  if (payload.mode !== 'replace' && payload.mode !== 'reconcile') {
    payload.mode = 'replace';
    warnLegacy(warn, 'legacy_alias', 'Assumed replace mode for legacy state sync.', 'payload.mode');
  }
}

function normalizeLegacyStateSyncEnd(
  payload: Record<string, unknown>,
  warn: (warning: ProtocolCodecWarning) => void,
  stateSyncRequestId: string | null,
): void {
  if (typeof payload.request_id !== 'string') {
    payload.request_id = stateSyncRequestId ?? 'legacy-state-sync';
    warnLegacy(warn, 'legacy_alias', 'Added legacy state sync request_id.', 'payload.request_id');
  }
  if (typeof payload.state_revision !== 'string') {
    payload.state_revision = 'legacy';
    warnLegacy(warn, 'legacy_alias', 'Added opaque legacy state revision.', 'payload.state_revision');
  }
}

function normalizeLegacyError(payload: Record<string, unknown>, warn: (warning: ProtocolCodecWarning) => void): void {
  if (typeof payload.error !== 'string') return;
  if (typeof payload.message === 'string' || typeof payload.code === 'string') {
    throw new Error('Conflicting canonical and legacy error fields at payload.error.');
  }
  payload.code = 'legacy_error';
  payload.message = payload.error;
  delete payload.error;
  warnLegacy(warn, 'legacy_alias', 'Translated legacy error string to code/message.', 'payload.error');
}

function normalizeParameterArray(value: unknown, path: string, warn: (warning: ProtocolCodecWarning) => void): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    if (isRecord(entry)) renameKnownKey(entry, 'allow_runtime_change', 'allowRuntimeChange', `${path}[${index}]`, warn);
  });
}

function normalizeActionArray(value: unknown, path: string, warn: (warning: ProtocolCodecWarning) => void): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    if (isRecord(entry)) discardKnownKey(entry, 'allowRuntimeChange', `${path}[${index}]`, warn);
  });
}

function normalizeChartArray(value: unknown, path: string, warn: (warning: ProtocolCodecWarning) => void): void {
  if (!Array.isArray(value)) return;
  value.forEach((entry, index) => {
    if (isRecord(entry)) renameKnownKey(entry, 'data_list', 'dataList', `${path}[${index}]`, warn);
  });
}

function normalizeLegacyChartUpdate(payload: Record<string, unknown>, warn: (warning: ProtocolCodecWarning) => void): void {
  if (!Array.isArray(payload.operations)) return;
  for (const [index, operation] of payload.operations.entries()) {
    if (!isRecord(operation)) continue;
    if (operation.operation === 'clear' && typeof operation.id === 'string' && operation.kind === undefined) {
      operation.kind = 'group';
      warnLegacy(
        warn,
        'legacy_alias',
        `Resolved legacy chart_update.operations[${index}] as a chart group operation.`,
        `payload.operations[${index}].kind`,
      );
    }
  }
}

function encodeLegacyMessage(message: AnyProtocolMessage): Record<string, unknown> {
  const payload = isRecord(message.payload) ? cloneRecord(message.payload) : message.payload;
  let type: string = message.type;
  switch (message.type) {
    case 'action_invoke': {
      const invocation = payload as Record<string, unknown>;
      if (invocation.target !== undefined || invocation.kwargs !== undefined) {
        throw new UnsupportedLegacyMessageError('v0.2 cannot represent action targets or kwargs.');
      }
      renameKnownKey(invocation, 'tick_id', 'request_id', 'payload', () => undefined);
      type = 'action_start';
      break;
    }
    case 'action_result': {
      const result = payload as Record<string, unknown>;
      if (result.error !== undefined) throw new UnsupportedLegacyMessageError('v0.2 cannot represent correlated action errors.');
      renameKnownKey(result, 'tick_id', 'request_id', 'payload', () => undefined);
      renameKnownKey(result, 'continue', 'should_continue', 'payload', () => undefined);
      type = 'action_end';
      break;
    }
    case 'asset_metadata':
      type = 'asset_meta';
      break;
    case 'state_sync': {
      const sync = payload as Record<string, unknown>;
      // v0.2 has no model, instance, revision, or monitor inventory fields.
      for (const key of ['model_id', 'instance_id', 'state_revision', 'metadata_revision', 'monitors']) delete sync[key];
      break;
    }
    case 'screenshot_response': {
      const response = payload as Record<string, unknown>;
      if (isRecord(response.error)) {
        response.error = typeof response.error.message === 'string'
          ? response.error.message
          : 'Screenshot failed.';
      }
      break;
    }
    case 'scene_restore':
    case 'scene_restore_begin':
    case 'scene_restore_end':
    case 'scene_capture':
    case 'scene_capture_result':
    case 'monitor_create':
    case 'monitor_update':
    case 'monitor_delete':
    case 'simulator_info':
      throw new UnsupportedLegacyMessageError(`v0.2 cannot represent ${message.type}.`);
    default:
      break;
  }
  if (isRecord(payload)) {
    if (type === 'param_create' || type === 'param_update') renameKnownKey(payload, 'allowRuntimeChange', 'allow_runtime_change', 'payload', () => undefined);
    if (type === 'chart_create') renameKnownKey(payload, 'dataList', 'data_list', 'payload', () => undefined);
    if (type === 'env_layer_create' || type === 'env_layer_update') renameKnownKey(payload, 'data', 'metadata', 'payload', () => undefined);
  }
  return { ...message, type, payload };
}

function renameKnownKey(
  object: Record<string, unknown>,
  canonical: string,
  legacy: string,
  path: string,
  warn: (warning: ProtocolCodecWarning) => void,
): void {
  if (!Object.prototype.hasOwnProperty.call(object, legacy)) return;
  const legacyValue = object[legacy];
  if (Object.prototype.hasOwnProperty.call(object, canonical)) {
    if (!deepEqual(object[canonical], legacyValue)) {
      throw new Error(`Conflicting canonical and legacy fields at ${path}.${canonical}.`);
    }
    delete object[legacy];
    warnLegacy(warn, 'legacy_duplicate', `Discarded duplicate legacy ${legacy} field.`, `${path}.${legacy}`);
    return;
  }
  object[canonical] = legacyValue;
  delete object[legacy];
  warnLegacy(warn, 'legacy_alias', `Translated ${legacy} to ${canonical}.`, `${path}.${legacy}`);
}

function discardKnownKey(
  object: Record<string, unknown>,
  key: string,
  path: string,
  warn: (warning: ProtocolCodecWarning) => void,
): void {
  if (!Object.prototype.hasOwnProperty.call(object, key)) return;
  delete object[key];
  warnLegacy(warn, 'legacy_discarded', `Discarded obsolete ${key}.`, `${path}.${key}`);
}

function warnLegacy(
  warn: (warning: ProtocolCodecWarning) => void,
  code: ProtocolCodecWarning['code'],
  message: string,
  path: string,
): void {
  warn({ code, message, path });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Uint8Array);
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (value instanceof Uint8Array) return value.slice();
  if (isRecord(value)) return cloneRecord(value);
  return value;
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left);
    const rightKeys = Object.keys(right);
    return leftKeys.length === rightKeys.length
      && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && deepEqual(left[key], right[key]));
  }
  return false;
}

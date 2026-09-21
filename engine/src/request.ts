import { MAX_BYTES, parseBoc } from './boc.js';
import { BocError, DecompilerError } from './errors.js';
export const MAX_BODY = Math.ceil(MAX_BYTES / 3) * 4 + 1024;
export function decodeBase64(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_BYTES / 3) * 4)
    throw new DecompilerError(
      'INVALID_BASE64',
      'code must be a base64 string of at most 1 MiB decoded',
      'input',
      400,
    );
  const text = value.replace(/[\t\r\n ]/g, '');
  if (!text || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text))
    throw new DecompilerError('INVALID_BASE64', 'code is not valid base64', 'input', 400);
  return Buffer.from(text, 'base64');
}
export function validateRequest(value: unknown): {
  boc: Buffer;
  milliseconds: number;
  verify: boolean;
} {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !['code', 'max_search_time_ms', 'verify'].includes(k))
  )
    throw new DecompilerError(
      'INVALID_REQUEST',
      'Expected code and optional max_search_time_ms and verify',
      'input',
      400,
    );
  const request = value as Record<string, unknown>,
    milliseconds = Object.hasOwn(request, 'max_search_time_ms')
      ? request.max_search_time_ms
      : 30000;
  if (
    typeof milliseconds !== 'number' ||
    !Number.isInteger(milliseconds) ||
    milliseconds < 1 ||
    milliseconds > 30000
  )
    throw new DecompilerError(
      'INVALID_REQUEST',
      'max_search_time_ms must be an integer from 1 to 30000',
      'input',
      400,
    );
  if (Object.hasOwn(request, 'verify') && typeof request.verify !== 'boolean')
    throw new DecompilerError('INVALID_REQUEST', 'verify must be a boolean', 'input', 400);
  const boc = decodeBase64(request.code);
  try {
    parseBoc(boc);
  } catch (e) {
    if (e instanceof BocError) throw new DecompilerError('INVALID_BOC', e.message, 'boc', 400);
    throw e;
  }
  return { boc, milliseconds, verify: request.verify !== false };
}

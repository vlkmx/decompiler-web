import { Buffer } from 'buffer';
import { MAX_BYTES } from './boc';
import { DecompilerError } from './errors';
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

import { createHash } from 'node:crypto';
import { BocError } from './errors.js';
export { BocError } from './errors.js';
export const MAX_BYTES = 1_048_576,
  MAX_CELLS = 16_384,
  MAX_DEPTH = 512;
export interface Cell {
  descriptors: Buffer;
  data: Buffer;
  refs: number[];
  bits: number;
  digest: Buffer;
  depth: number;
}
export interface Boc {
  cells: Cell[];
  root: number;
  codeHash: string;
}
export const sha256 = (data: Uint8Array | string): Buffer =>
  createHash('sha256').update(data).digest();
export function crc32c(data: Uint8Array): Buffer {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0x82f63b78 : 0);
  }
  const out = Buffer.alloc(4);
  out.writeUInt32LE((crc ^ 0xffffffff) >>> 0);
  return out;
}
export function parseBoc(data: Uint8Array): Boc {
  if (!(data instanceof Uint8Array) || data.length < 11 || data.length > MAX_BYTES)
    throw new BocError('BOC size must be between 11 bytes and 1 MiB');
  const buf = Buffer.from(data);
  let pos = 0;
  function take(n: number) {
    if (n < 0 || pos + n > buf.length) throw new BocError('Truncated BOC');
    const value = buf.subarray(pos, pos + n);
    pos += n;
    return value;
  }
  function integer(n: number) {
    let value = 0n;
    for (const byte of take(n)) value = (value << 8n) | BigInt(byte);
    if (value > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BocError('BOC integer exceeds safe size');
    return Number(value);
  }
  const magic = take(4).toString('hex');
  let indexed: boolean, checksum: boolean, explicit: boolean, width: number;
  if (magic === 'b5ee9c72') {
    const flags = integer(1);
    indexed = !!(flags & 128);
    checksum = !!(flags & 64);
    if (flags & 0x38) throw new BocError('Cache bits and reserved BOC flags are unsupported');
    width = flags & 7;
    explicit = true;
  } else if (['68ff65f3', 'acc3a728'].includes(magic)) {
    width = integer(1);
    indexed = true;
    checksum = magic === 'acc3a728';
    explicit = false;
  } else throw new BocError('Invalid BOC magic');
  const offsetWidth = integer(1);
  if (width < 1 || width > 4 || offsetWidth < 1 || offsetWidth > 8)
    throw new BocError('Invalid BOC integer widths');
  const count = integer(width),
    roots = integer(width),
    absent = integer(width),
    total = integer(offsetWidth);
  if (count < 1 || count > MAX_CELLS || roots !== 1 || absent)
    throw new BocError('Expected one root, no absent cells, and at most 16384 cells');
  const root = explicit ? integer(width) : 0;
  if (root >= count) throw new BocError('Invalid root index');
  const offsets = indexed ? Array.from({ length: count }, () => integer(offsetWidth)) : [],
    start = pos;
  if (start + total + (checksum ? 4 : 0) !== buf.length)
    throw new BocError('BOC length does not match header');
  if (checksum && !crc32c(buf.subarray(0, -4)).equals(buf.subarray(-4)))
    throw new BocError('Invalid BOC CRC32C');
  const cells: Cell[] = [],
    stored: Array<[Buffer | undefined, number | undefined]> = [];
  for (let index = 0; index < count; index++) {
    const d1 = integer(1),
      d2 = integer(1),
      refs = d1 & 7;
    if (refs > 4) throw new BocError('A cell cannot have more than four references');
    if (d1 & 0xe8) throw new BocError('Exotic and levelled cells are unsupported');
    const hash = d1 & 16 ? take(32) : undefined,
      depth = d1 & 16 ? integer(2) : undefined;
    const payload = take(Math.floor((d2 + 1) / 2));
    let bits = payload.length * 8;
    if (d2 & 1) {
      const last = payload.at(-1) ?? 0;
      if (!(last & 0x7f)) throw new BocError('Invalid cell top-up bits');
      bits -= Math.log2(last & -last) + 1;
    }
    const references = Array.from({ length: refs }, () => integer(width));
    if (references.some((ref) => ref <= index || ref >= count))
      throw new BocError('Invalid or cyclic cell reference ordering');
    if (pos > start + total) throw new BocError('Cells exceed declared BOC length');
    if (indexed && offsets[index] !== pos - start)
      throw new BocError('BOC index does not match cell boundaries');
    cells.push({
      descriptors: Buffer.from([d1 & ~16, d2]),
      data: payload,
      refs: references,
      bits,
      digest: Buffer.alloc(0),
      depth: 0,
    });
    stored.push([hash, depth]);
  }
  if (pos !== start + total) throw new BocError('Unused bytes in cell data');
  for (let i = count - 1; i >= 0; i--) {
    const cell = cells[i];
    cell.depth = 1 + Math.max(-1, ...cell.refs.map((ref) => cells[ref].depth));
    if (cell.depth > MAX_DEPTH) throw new BocError('Cell depth exceeds 512');
    cell.digest = sha256(
      Buffer.concat([
        cell.descriptors,
        cell.data,
        ...cell.refs.map((ref) => uint(cells[ref].depth, 2)),
        ...cell.refs.map((ref) => cells[ref].digest),
      ]),
    );
    if (stored[i][0] && (!stored[i][0]!.equals(cell.digest) || stored[i][1] !== cell.depth))
      throw new BocError('Stored cell hash/depth is incorrect');
  }
  const reached = new Set<number>(),
    pending = [root];
  while (pending.length) {
    const i = pending.pop()!;
    if (!reached.has(i)) {
      reached.add(i);
      pending.push(...cells[i].refs);
    }
  }
  if (reached.size !== count) throw new BocError('BOC contains unreachable cells');
  return { cells, root, codeHash: cells[root].digest.toString('hex') };
}
export const codeHash = (data: Uint8Array): string => parseBoc(data).codeHash;
function uint(value: number | bigint, bytes: number): Buffer {
  const out = Buffer.alloc(bytes);
  let v = BigInt(value);
  for (let i = bytes - 1; i >= 0; i--) {
    out[i] = Number(v & 255n);
    v >>= 8n;
  }
  return out;
}
const asBigInt = (data: Buffer): bigint => (data.length ? BigInt('0x' + data.toString('hex')) : 0n);
export function sliceBoc(boc: Boc, index: number, offset = 0): Buffer {
  const cell = boc.cells[index];
  if (offset < 0 || offset > cell.bits) throw new BocError('Invalid cell slice offset');
  const bits = cell.bits - offset,
    bytes = Math.ceil(bits / 8);
  const value =
    (asBigInt(cell.data) >> BigInt(cell.data.length * 8 - cell.bits)) & ((1n << BigInt(bits)) - 1n);
  let payload = value << BigInt(bytes * 8 - bits);
  if (bits % 8) payload |= 1n << BigInt(bytes * 8 - bits - 1);
  const synthetic = boc.cells.length;
  const cells = [
    ...boc.cells,
    {
      ...cell,
      descriptors: Buffer.from([cell.refs.length, Math.floor(bits / 8) + bytes]),
      data: uint(payload, bytes),
    },
  ];
  const reached = new Set<number>(),
    work = [...cell.refs];
  while (work.length) {
    const i = work.pop()!;
    if (!reached.has(i)) {
      reached.add(i);
      work.push(...cells[i].refs);
    }
  }
  const order = [synthetic, ...[...reached].sort((a, b) => a - b)],
    ids = new Map(order.map((old, i) => [old, i]));
  const width = Math.max(1, Math.ceil(order.length.toString(2).length / 8));
  const serialized = Buffer.concat(
    order.flatMap((i) => [
      cells[i].descriptors,
      cells[i].data,
      ...cells[i].refs.map((ref) => uint(ids.get(ref)!, width)),
    ]),
  );
  const offsetWidth = Math.max(1, Math.ceil(serialized.length.toString(2).length / 8));
  return Buffer.concat([
    Buffer.from('b5ee9c72', 'hex'),
    Buffer.from([width, offsetWidth]),
    uint(order.length, width),
    uint(1, width),
    uint(0, width),
    uint(serialized.length, offsetWidth),
    uint(0, width),
    serialized,
  ]);
}
export function methodCells(data: Uint8Array): Map<number, Buffer> {
  const boc = parseBoc(data),
    root = boc.cells[boc.root];
  if (
    root.data.toString('hex') !== 'ff00f4a413f4bcf2c80b' ||
    root.bits !== 80 ||
    root.refs.length !== 1
  )
    throw new BocError('Nonstandard dispatcher: cannot preserve method cells');
  const leaves = new Map<number, Buffer>(),
    work: Array<[number, number, number]> = [[root.refs[0], 19, 0]];
  let visited = 0;
  while (work.length) {
    const [index, width, initialPrefix] = work.pop()!;
    if (++visited > MAX_CELLS) throw new BocError('Method dictionary exceeds node limit');
    const cell = boc.cells[index],
      value = asBigInt(cell.data);
    let offset = 0,
      length: number,
      label: number;
    function read(n: number): number {
      if (n < 0 || offset + n > cell.bits) throw new BocError('Truncated method dictionary label');
      const v = Number(
        (value >> BigInt(cell.data.length * 8 - offset - n)) & ((1n << BigInt(n)) - 1n),
      );
      offset += n;
      return v;
    }
    if (read(1) === 0) {
      length = 0;
      while (read(1))
        if (++length > width) throw new BocError('Method dictionary label exceeds key width');
      label = read(length);
    } else if (read(1) === 0) {
      length = read(width ? width.toString(2).length : 0);
      if (length > width) throw new BocError('Method dictionary label exceeds key width');
      label = read(length);
    } else {
      const repeated = read(1);
      length = read(width ? width.toString(2).length : 0);
      if (length > width) throw new BocError('Method dictionary label exceeds key width');
      label = repeated ? 2 ** length - 1 : 0;
    }
    const prefix = initialPrefix * 2 ** length + label,
      remaining = width - length;
    if (remaining) {
      if (offset !== cell.bits || cell.refs.length !== 2)
        throw new BocError('Invalid method dictionary fork');
      work.push(
        [cell.refs[0], remaining - 1, prefix * 2],
        [cell.refs[1], remaining - 1, prefix * 2 + 1],
      );
    } else {
      const method = prefix & (1 << 18) ? prefix - (1 << 19) : prefix;
      if (leaves.has(method)) throw new BocError('Duplicate method ID');
      leaves.set(method, sliceBoc(boc, index, offset));
    }
  }
  return new Map([...leaves].sort(([a], [b]) => a - b));
}

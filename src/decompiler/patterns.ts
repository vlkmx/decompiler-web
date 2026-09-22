import { Cell } from '@ton/core';
import { Buffer } from 'buffer';
import type { Instruction } from './asm';

/** A dynamic call whose normal return is immediately discarded by THROW.
 * Keep the call and terminating instruction together: no return arity is implied.
 */
export function matchTerminalExecute(code: Instruction[], start: number): {
  length: number; nullable: boolean; exit: number;
} | undefined {
  const is = (i: Instruction | undefined, op: string) =>
    i?.opcode === op && !i.operands.length && !i.blocks.length;
  let length = 2, nullable = false;
  if (!is(code[start], 'EXECUTE')) {
    const a = code[start + 2], b = code[start + 3];
    if (!is(code[start], 'DUP') || !is(code[start + 1], 'ISNULL') ||
        a?.opcode !== 'PUSHCONT' || a.operands.length || a.blocks.length !== 1 ||
        b?.opcode !== 'PUSHCONT' || b.operands.length || b.blocks.length !== 1 ||
        a.blocks[0].length !== 1 || !is(a.blocks[0][0], 'DROP') ||
        b.blocks[0].length !== 3 || !['CTOS', 'BLESS', 'EXECUTE'].every((op,n) => is(b.blocks[0][n], op)) ||
        !is(code[start + 4], 'IFELSE')) return;
    length = 6; nullable = true;
  }
  const stop = code[start + length - 1];
  if (stop?.opcode !== 'THROW' || stop.blocks.length || stop.operands.length !== 1 ||
      !/^\d+$/.test(stop.operands[0])) return;
  const exit = Number(stop.operands[0]);
  if (exit > 2047) return;
  return { length, nullable, exit };
}

/** Compiler-emitted transactional try/catch, with a fresh catch continuation.
 * Only exact register snapshots and a statically bounded captured stack qualify.
 * Arbitrary SETCONTCTR / mutated continuations must remain opaque.
 */
export function matchTryCatch(code: Instruction[], start: number): {
  length: number; captured: number; savesC3: boolean;
  body: Instruction[]; handler: Instruction[];
} | undefined {
  const simple = (at: number, op: string, operands: string[] = []) => {
    const i = code[at];
    return i?.opcode === op && !i.blocks.length &&
      JSON.stringify(i.operands) === JSON.stringify(operands);
  };
  const regs = simple(start, 'PUSH', ['c1']) ? [1, 3, 4, 5, 7] : [4, 5, 7];
  let p = start;
  for (const r of regs) if (!simple(p++, 'PUSH', [`c${r}`])) return;
  const handler = code[p++];
  if (handler?.opcode !== 'PUSHCONT' || handler.operands.length || handler.blocks.length !== 1) return;
  for (const r of [...regs].reverse()) {
    if (!simple(p, 'SETCONTCTR', [`c${r}`]) && !simple(p, 'SETCONTCTR', [String(r)])) return;
    p++;
  }
  let captured = 0;
  if (code[p]?.opcode === 'SETCONTARGS') {
    if (code[p].blocks.length || code[p].operands.length !== 2 || code[p].operands[1] !== '-1') return;
    captured = Number(code[p++].operands[0]);
  } else if (code[p]?.opcode === 'PUSHINT') {
    if (code[p].blocks.length || code[p].operands.length !== 1 ||
        !simple(p + 1, 'PUSHINT', ['-1']) || !simple(p + 2, 'SETCONTVARARGS')) return;
    captured = Number(code[p].operands[0]);
    p += 3;
  }
  if (!Number.isInteger(captured) || captured < 0 || captured > 255) return;
  const body = code[p++];
  if (body?.opcode !== 'PUSHCONT' || body.operands.length || body.blocks.length !== 1) return;
  if (!simple(p++, 'PUSH', ['c1']) ||
      !(simple(p, 'BOOLOR') || simple(p, 'COMPOSALT')) ||
      !simple(p + 1, 'SWAP') || !simple(p + 2, 'TRY')) return;
  p += 3;
  return { length: p - start, captured, savesC3: regs.includes(3),
    body: body.blocks[0], handler: handler.blocks[0] };
}

/** Exact stack-growing decimal digit loop followed by its consuming store loop.
 * Tolk stdlib int.toDecimalString: digits accumulate below b/count/quotient.
 * Do not generalize this to arbitrary UNTIL loops with changing stack height.
 */
export function isDecimalDigitLoop(loop: Instruction[], tail: Instruction[]): boolean {
  const flat = (code: Instruction[]) => code.map(i => [i.opcode, i.operands, i.blocks.length]);
  const expected = [
    ['PUSHINT', ['10'], 0], ['DIVMOD', [], 0], ['ADDINT', ['48'], 0],
    ['XCHG3', ['s3', 's1', 's3'], 0], ['INC', [], 0],
    ['XCPU', ['s1', 's0'], 0], ['EQINT', ['0'], 0],
  ];
  return JSON.stringify(flat(loop)) === JSON.stringify(expected)
    && tail[0]?.opcode === 'DROP' && !tail[0].operands.length && !tail[0].blocks.length
    && tail[1]?.opcode === 'PUSHCONT' && !tail[1].operands.length && tail[1].blocks.length === 1
    && JSON.stringify(flat(tail[1].blocks[0])) === JSON.stringify([['STU', ['8'], 0]])
    && tail[2]?.opcode === 'REPEAT' && !tail[2].operands.length && !tail[2].blocks.length;
}

/** Confirm the sign normalization too: without it negative floor division can
 * loop indefinitely, so replacing its dynamic stack with a tuple is not valid.
 */
export function isDecimalConversion(code: Instruction[]): boolean {
  const simple = (i: Instruction | undefined, op: string, operands: string[] = []) =>
    i?.opcode === op && !i.blocks.length && JSON.stringify(i.operands) === JSON.stringify(operands);
  if (!(simple(code[0], 'NEWC') && simple(code[1], 'SWAP') && simple(code[2], 'DUP') &&
      simple(code[3], 'LESSINT', ['0']) && code[4]?.opcode === 'PUSHCONT' && code[4].blocks.length === 1 &&
      simple(code[5], 'IF') && simple(code[6], 'PUSHINT', ['0']) && simple(code[7], 'SWAP') &&
      code[8]?.opcode === 'PUSHCONT' && code[8].blocks.length === 1 && simple(code[9], 'UNTIL') &&
      isDecimalDigitLoop(code[8].blocks[0], code.slice(10, 13)) && simple(code[13], 'ENDC') &&
      (code.length === 14 || (code.length === 15 && simple(code[14], 'TPUSH'))))) return false;
  const sign = code[4].blocks[0];
  if (!(sign.length === 4 && simple(sign[0], 'SWAP') && simple(sign[2], 'SWAP') && simple(sign[3], 'NEGATE') &&
      sign[1].opcode === 'STSLICECONST' && sign[1].operands.length === 1 && !sign[1].blocks.length)) return false;
  const value = sign[1].operands[0];
  if (/^x\{2d\}$/i.test(value)) return true;
  if (!/^(?:[\da-f]{2})+$/i.test(value)) return false;
  try {
    const roots = Cell.fromBoc(Buffer.from(value, 'hex'));
    return roots.length === 1 && roots[0].refs.length === 0 && roots[0].bits.length === 8 && roots[0].beginParse().loadUint(8) === 45;
  } catch { return false; }
}

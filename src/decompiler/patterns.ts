import { Cell } from '@ton/core';
import { Buffer } from 'buffer';
import type { Instruction } from './asm';

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

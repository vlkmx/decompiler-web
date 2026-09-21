import { Cell, runtime } from '@ton/tasm';
import { methodCells, parseBoc } from './boc.js';
import { instruction, formatAsm, type Instruction, type Program } from './asm.js';
import { AsmError } from './errors.js';
// TASM's typed decoder retains cells/slices, unlike textual disassembly.
function convert(items: runtime.Instr[], depth = 0): Instruction[] {
  if (depth > 128) throw new AsmError('Continuation nesting exceeds limit');
  return items.flatMap((item) => {
    const record = item as unknown as Record<string, unknown>;
    let op = item.$,
      args = Object.keys(record)
        .filter((k) => /^arg\d+$/.test(k))
        .sort()
        .map((k) => record[k]);
    let blocks: Instruction[][] = [];
    const decodeCode = (value: unknown): Instruction[] => {
      const code = value as runtime.util.Code;
      if (code.$ === 'Instructions') return convert(code.instructions, depth + 1);
      if (code.$ === 'Raw') return convert(runtime.decompileCell(code.slice.asCell()), depth + 1);
      throw new AsmError('Undecoded code reference');
    };
    // A bare reference after the last bit is TVM's implicit code continuation.
    if (op === 'PSEUDO_PUSHREF') return decodeCode(args[0]);
    if (['IFREFELSE', 'IFELSEREF', 'IFREFELSEREF'].includes(op)) {
      return instruction(op === 'IFREFELSEREF' ? 'IFELSE' : op, [], args.map(decodeCode));
    }

    if (
      /^PUSHCONT(?:_SHORT)?$/.test(op) ||
      ['CALLREF', 'JMPREF', 'PUSHREFCONT', 'IFREF', 'IFNOTREF', 'IFJMPREF', 'IFNOTJMPREF'].includes(
        op,
      )
    ) {
      const code = args[0] as runtime.util.Code;
      if (code.$ === 'Instructions') blocks = [convert(code.instructions, depth + 1)];
      else if (code.$ === 'Raw')
        blocks = [convert(runtime.decompileCell(code.slice.asCell()), depth + 1)];
      else throw new AsmError(`Undecoded continuation: ${op}`);
      const mapped: Record<string, string> = {
        PUSHCONT_SHORT: 'PUSHCONT',
        PUSHREFCONT: 'PUSHCONT',
        CALLREF: 'CALL',
        JMPREF: 'JMP',
        IFREF: 'IF',
        IFNOTREF: 'IFNOT',
        IFJMPREF: 'IFJMP',
        IFNOTJMPREF: 'IFNOTJMP',
      };
      op = (mapped[op] ?? op) as typeof op;
      args = [];
    }
    const operands = args.map((value) => {
      if (typeof value === 'bigint' || typeof value === 'number') return String(value);
      if (value && typeof value === 'object') {
        if ('asCell' in value && typeof value.asCell === 'function')
          return (value.asCell() as Cell).toBoc({ idx: false }).toString('hex');
        const code = value as runtime.util.Code;
        if (code.$ === 'Raw') return code.slice.asCell().toBoc({ idx: false }).toString('hex');
        if (code.$ === 'Instructions')
          return runtime.compileCell(code.instructions).toBoc({ idx: false }).toString('hex');
      }
      throw new AsmError(`Unsupported operand encoding: ${op}`);
    });
    let name: string = op;
    if (/^PUSHINT_/.test(name)) name = 'PUSHINT';
    if (/^(PUSH|POP)_LONG$/.test(name)) name = name.split('_')[0];
    if (name === 'PUSHCTR' || name === 'POPCTR') {
      name = name.slice(0, -3);
      operands[0] = 'c' + operands[0];
    } else if (name === 'SAVECTR') operands[0] = 'c' + operands[0];
    else if (
      [
        'PUSH',
        'POP',
        'XCHG2',
        'XCHG3',
        'PUSH2',
        'PUSH3',
        'XCPU',
        'PUXC',
        'XC2PU',
        'XCPUXC',
        'XCPU2',
        'PUXC2',
        'PUXCPU',
        'PU2XC',
      ].includes(name)
    )
      operands.splice(
        0,
        operands.length,
        ...operands.map((x) => (Number(x) < 0 ? `s(${x})` : 's' + x)),
      );
    if (name.startsWith('XCHG_')) {
      if (name.startsWith('XCHG_0I')) operands.unshift('0');
      name = 'XCHG';
      operands.splice(0, operands.length, ...operands.map((x) => 's' + x));
    }
    if (/^(MULRSHIFT[RC]?|RSHIFT[RC]|MODPOW2)_$/.test(name)) name = name.slice(0, -1) + '#';
    const aliases: Record<string, string> = {
      DROP2: '2DROP',
      DUP2: '2DUP',
      SWAP2: '2SWAP',
      OVER2: '2OVER',
      ROTREV: '-ROT',
      TWODUP: '2DUP',
      TWODROP: '2DROP',
      TWOOVER: '2OVER',
      TWOSWAP: '2SWAP',
      PUSHSLICE_REFS: 'PUSHSLICE',
      PUSHSLICE_LONG: 'PUSHSLICE',
    };
    name = aliases[name] ?? name.replace(/_(?:SHORT|LONG|ALT)$/, '');
    return instruction(name, operands, blocks);
  });
}
export function disassembleProgram(boc: Uint8Array): Program {
  parseBoc(boc);
  const methods = new Map<number, Instruction[]>();
  // Keep method extraction independent of the disassembler. Unknown instructions
  // must not prevent lossless preservation of otherwise valid method cells.
  for (const [id, bytes] of methodCells(boc)) {
    try {
      methods.set(id, convert(runtime.decompileCell(Cell.fromBoc(bytes)[0])));
    } catch (error) {
      methods.set(id, [
        instruction('UNDECODED', [], [], error instanceof Error ? error.message : String(error)),
      ]);
    }
  }
  return {
    methods,
    instructions: [
      instruction('SETCP', ['0']),
      instruction('DICTPUSHCONST', ['19']),
      instruction('DICTIGETJMPZ', [...methods.keys()].map(String), [...methods.values()]),
      instruction('THROWARG', ['11']),
    ],
  };
}
export function disassemble(boc: Uint8Array): string {
  return formatAsm(disassembleProgram(boc).instructions) + '\n';
}

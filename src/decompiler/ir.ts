import { Buffer } from 'buffer';
import { sha256_sync } from '@ton/crypto';
import { Cell } from '@ton/core';
import { instruction, type Instruction } from './asm';
import { UnsupportedInstruction } from './errors';
import { primitiveSignatures } from './primitives';
import { parseBoc } from './boc';
import { isDecimalDigitLoop, isDecimalConversion, matchTryCatch, matchTerminalExecute } from './patterns';
export { UnsupportedInstruction } from './errors';
export interface Expr {
  op: string;
  args: Expr[];
  value: string;
  type: string;
}
export interface Statement {
  kind: string;
  values: Expr[];
  then: Statement[];
  otherwise: Statement[];
}
export interface Primitive {
  name: string;
  inputs: string[];
  outputs: string[];
  assembly: string;
}
export interface StackIR {
  changesC3?: boolean;
  inlineBody?: boolean;
  arguments: number;
  argumentTypes: string[];
  returns: Expr[];
  statements: Statement[];
  primitives: Primitive[];
}
export interface PartialIR {
  args: Expr[];
  stack: Expr[];
  statements: Statement[];
  primitives: Primitive[];
  remaining: Instruction[];
}
export const expr = (op: string, value = '', type = 'int', args: Expr[] = []): Expr => ({
  op,
  value,
  type,
  args,
});
export const statement = (
  kind: string,
  values: Expr[] = [],
  then: Statement[] = [],
  otherwise: Statement[] = [],
): Statement => ({ kind, values, then, otherwise });
export const literal = (n: string | number | bigint): Expr => expr('literal', String(n));
export const binary: Record<string, string> = {
  ADD: '+',
  SUB: '-',
  MUL: '*',
  DIV: '/',
  MOD: '%',
  AND: '&',
  OR: '|',
  XOR: '^',
  LSHIFT: '<<',
  RSHIFT: '>>',
  EQUAL: '==',
  NEQ: '!=',
  LESS: '<',
  GREATER: '>',
  LEQ: '<=',
  GEQ: '>=',
};
export function tupleTypes(type: string): string[] {
  if (!type.startsWith('[') || !type.endsWith(']'))
    throw new UnsupportedInstruction('type', 'Unknown tuple element types');
  const parts: string[] = [];
  let depth = 0,
    start = 1;
  for (let i = 1; i < type.length - 1; i++) {
    if (type[i] === '[') depth++;
    if (type[i] === ']') depth--;
    if (type[i] === ',' && depth === 0) {
      parts.push(type.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (start < type.length - 1) parts.push(type.slice(start, -1).trim());
  return parts;
}
const typeKey = (type: string) => sha256_sync(type).toString('hex').slice(0, 16);
class StackUnderflow extends Error {}
export function continuations(code: Instruction[]): Instruction[] {
  return code.flatMap((i) => {
    if (i.opcode === 'CONT' && i.blocks.length) return [instruction('PUSHCONT', [], i.blocks)];
    if (
      i.blocks.length &&
      ['IF', 'IFNOT', 'IFELSE', 'IFJMP', 'IFNOTJMP', 'REPEAT', 'UNTIL', 'WHILE'].includes(i.opcode)
    )
      return [
        ...i.blocks.map((b) => instruction('PUSHCONT', [], [b])),
        instruction(i.opcode, i.operands),
      ];
    return [i];
  });
}
export function analyze(
  instructions: Instruction[],
  options: {
    arguments?: number;
    hints?: string[];
    // Unlike entrypoint hints, caller hints do not bound inferred stack depth.
    // The caller may itself still be discovering its arguments.
    argumentHints?: string[];
    methods?: Map<number, StackIR> | ((id: number, hints?: string[]) => StackIR);
    globalTypes?: Map<number, string>;
    onPartial?: (partial: PartialIR) => void;
  } = {},
): StackIR {
  if (options.arguments === undefined) {
    for (let count = 0; count <= 32; count++) {
      try {
        return analyze(instructions, { ...options, arguments: count });
      } catch (e) {
        if (!(e instanceof StackUnderflow)) throw e;
      }
    }
    throw new UnsupportedInstruction('stack', 'More than 32 inferred arguments');
  }
  const count = options.arguments;
  const globalTypes = options.globalTypes ?? new Map<number, string>();
  if (options.hints && count > options.hints.length)
    throw new UnsupportedInstruction(
      'entrypoint',
      'Inferred arguments exceed entrypoint signature',
    );
  const hints = options.hints ?? options.argumentHints;
  const args = Array.from({ length: count }, (_, i) =>
    expr('arg', `arg${i}`, hints?.[hints.length - count + i] ?? 'unknown'),
  );
  const primitives = new Map<string, Primitive>();
  let localCount = 0,
    steps = 0;
  let changesC3 = false, restrictedC3Depth = 0;
  const local = (type: string) => expr('local', `v${localCount++}`, type);
  // A generic call result and its corresponding input share a type constraint,
  // not a value. Keep that relationship until all uses have been analyzed.
  const typeGroups = new Map<Expr, Set<Expr>>();
  const nullBindings: Expr[] = [];
  const group = (value: Expr) => {
    if (!typeGroups.has(value)) typeGroups.set(value, new Set([value]));
    return typeGroups.get(value)!;
  };
  function bindType(value: Expr, type: string) {
    for (const member of group(value)) member.type = type;
  }
  function unifyTypes(a: Expr, b: Expr) {
    if (a.type === 'null' || b.type === 'null') return;
    if (a.type !== 'unknown' && b.type !== 'unknown') {
      requireType(b, a.type);
      return;
    }
    const left = group(a), right = group(b);
    if (left === right) return;
    const type = a.type === 'unknown' ? b.type : a.type;
    if (type !== 'unknown') {
      if (a.type === 'unknown') for (const member of left) member.type = type;
      if (b.type === 'unknown') for (const member of right) member.type = type;
    }
    // Merge smaller groups into larger ones: long chains of pass-through calls
    // must not repeatedly copy every already-linked expression.
    const [large, small] = left.size >= right.size ? [left, right] : [right, left];
    for (const member of small) {
      large.add(member);
      typeGroups.set(member, large);
    }
  }
  function requireType(value: Expr, type: string) {
    if (type === 'X' || /^X\d+$/.test(type) || value.type === 'null') return;
    if (value.type === 'vector_empty' && type.startsWith('vector_')) return;
    if (type === 'tuple' && /^(vector_|list_|\[)/.test(value.type)) return;
    if (value.type === 'unknown' && (value.op === 'arg' || typeGroups.has(value))) {
      bindType(value, type);
      return;
    }
    if (value.type.startsWith('[') && type.startsWith('[')) {
      const actual = tupleTypes(value.type),
        expected = tupleTypes(type);
      if (actual.length === expected.length) {
        actual.forEach((t, n) => requireType(expr('type', '', t), expected[n]));
        value.type = type;
        return;
      }
    }
    if (value.type !== type)
      throw new UnsupportedInstruction(
        'type',
        `Conflicting stack types: ${value.type} and ${type}`,
      );
  }
  const product = (values: Expr[]) =>
    values.length === 1 ? values[0] : expr('product', '', '()', values);
  const same = (a: Expr, b: Expr) => a === b || JSON.stringify(a) === JSON.stringify(b);
  // SAMEALTSAVE makes c1 the enclosing function return continuation.
  let alternateReturn = false;
  if (
    instructions[0]?.opcode === 'SAVECTR' &&
    ['c2', '2'].includes(instructions[0].operands[0]) &&
    instructions[1]?.opcode === 'SAMEALTSAVE'
  ) {
    alternateReturn = true;
    instructions = instructions.slice(2);
  } else if (instructions[0]?.opcode === 'SAMEALTSAVE') {
    alternateReturn = true;
    instructions = instructions.slice(1);
  }
  function execute(
    input: Instruction[],
    stack: Expr[],
    depth = 0,
    localReturn = false,
  ): { body: Statement[]; terminal: boolean } {
    if (depth > 64)
      throw new UnsupportedInstruction('complexity', 'Symbolic continuation nesting limit');
    let code = continuations(input);
    // A local return skips the rest of this continuation, not its caller.
    // Make that tail the opposite branch so normal stack merging applies.
    if (localReturn) {
      for (let p = code.length - 1; p >= 0; p--) {
        const op = code[p].opcode;
        if (op === 'IFRET' || op === 'IFNOTRET') {
          const tail = code.slice(p + 1);
          code = [
            ...code.slice(0, p),
            ...continuations([instruction('IFELSE', [], op === 'IFRET' ? [[], tail] : [tail, []])]),
          ];
        } else if (['IFJMP', 'IFNOTJMP'].includes(op) && code[p - 1]?.opcode === 'PUSHCONT') {
          const jump = code[p - 1].blocks[0],
            tail = code.slice(p + 1);
          code = [
            ...code.slice(0, p - 1),
            ...continuations([
              instruction('IFELSE', [], op === 'IFJMP' ? [jump, tail] : [tail, jump]),
            ]),
          ];
        }
      }
    }
    const body: Statement[] = [],
      pending: Instruction[][] = [];
    const pop = (): Expr => {
      if (!stack.length) throw new StackUnderflow();
      return stack.pop()!;
    };
    const take = (n: number): Expr[] => {
      if (n < 0 || stack.length < n) throw new StackUnderflow();
      return stack.splice(stack.length - n, n);
    };
    const slot = (n: number): number => {
      if (!Number.isInteger(n) || n < 0) throw new UnsupportedInstruction('register');
      if (n >= stack.length) throw new StackUnderflow();
      return stack.length - 1 - n;
    };
    const swap = (x: number, y: number) => {
      const a = slot(x),
        b = slot(y);
      [stack[a], stack[b]] = [stack[b], stack[a]];
    };
    const push = (n: number) => stack.push(stack[slot(n)]);
    function computed(value: Expr): void {
      // Preserve TVM arithmetic exceptions and evaluation order, including dropped results.
      const target = local(value.type);
      primitives.set('impure_touch', {
        name: 'impure_touch',
        inputs: ['X'],
        outputs: ['X'],
        assembly: 'NOP',
      });
      body.push(statement('assign', [target, expr('call', 'impure_touch', value.type, [value])]));
      stack.push(target);
    }
    function primitive(
      op: string,
      inputs: string[],
      outputs: string[],
      assembly = op,
      suffix = '',
    ): void {
      const operands = take(inputs.length).map((v, n) => v.type === 'null' && /^X\d*$/.test(inputs[n])
        ? { ...v, type: 'unknown' } : v);
      operands.forEach((v, i) => requireType(v, inputs[i]));
      const name = 'tvm_' + op.toLowerCase().replace(/[^a-z0-9]/g, '_') + suffix;
      primitives.set(name, { name, inputs, outputs, assembly });
      const results = outputs.map(local),
        call = expr('call', name, outputs[0] ?? '()', operands);
      body.push(
        results.length ? statement('assign', [product(results), call]) : statement('call', [call]),
      );
      stack.push(...results);
    }
    // A preview may stop only at a boundary with no pending static continuations.
    // Keep it separate from executable IR: the remaining stack effect is unknown.
    let boundary = 0, boundaryBody = 0, boundaryStack = [...stack];
    try {
    for (let index = 0; index < code.length; index++) {
      if (!pending.length) {
        boundary = index;
        boundaryBody = body.length;
        boundaryStack = [...stack];
      }
      if (++steps > 100_000)
        throw new UnsupportedInstruction('complexity', 'Symbolic execution limit');
      const i = code[index],
        op = i.opcode,
        imm = () => {
          if (i.operands.length !== 1 || !/^-?(?:\d+|0x[\da-f]+)$/i.test(i.operands[0]))
            throw new UnsupportedInstruction(op, 'Invalid integer operand');
          return BigInt(i.operands[0]);
        };
      const number = () => {
        const v = Number(imm());
        if (!Number.isSafeInteger(v)) throw new UnsupportedInstruction(op, 'Oversized immediate');
        return v;
      };
      const registers = () =>
        i.operands.map((v) => {
          const m = /^s(?:([0-9]+)|\((-?[0-9]+)\))$/.exec(v);
          if (!m) throw new UnsupportedInstruction('register');
          return Number(m[1] ?? m[2]);
        });
      if (op === 'NOP') continue;
      const dynamicExit = !pending.length && matchTerminalExecute(code, index);
      if (dynamicExit) {
        // EXECUTE can inspect every stack slot. Minimal inferred arity is not
        // sufficient: only an entrypoint with a known complete stack qualifies.
        if (!options.hints) throw new UnsupportedInstruction('EXECUTE', 'Dynamic tail needs a complete entrypoint stack');
        if (count < options.hints.length) throw new StackUnderflow();
        if (restrictedC3Depth) throw new UnsupportedInstruction('TRY', 'Dynamic call may change c3 outside catch snapshot');
        if (!stack.length) throw new StackUnderflow();
        requireType(stack.at(-1)!, dynamicExit.nullable ? 'cell' : 'cont');
        const width = stack.length;
        if (width > 16) throw new UnsupportedInstruction('EXECUTE', 'Dynamic tail stack exceeds the 16-argument asm limit');
        changesC3 = true;
        primitive('EXECUTE_TERMINAL', stack.map((_, n) => n === width - 1
          ? dynamicExit.nullable ? 'cell' : 'cont' : `X${n}`), [],
          // The compiler may retain temporaries below the explicit arguments.
          // Move only the modeled stack into a tuple, remove that hidden prefix,
          // then restore the exact original stack before entering runtime code.
          `${width} PUSHINT TUPLEVAR DEPTH DEC <{ NIP }>CONT REPEAT ${width} PUSHINT UNTUPLEVAR ` +
          `${dynamicExit.nullable ? 'DUP ISNULL <{ DROP }>CONT <{ CTOS BLESS EXECUTE }>CONT IFELSE' : 'EXECUTE'} ${dynamicExit.exit} THROW`,
          `_${dynamicExit.nullable ? 'optional' : 'direct'}_${width}_${dynamicExit.exit}`);
        // Make the terminal edge explicit to the source compiler as well, so
        // values needed only by sibling branches are not retained below inputs.
        body.push(statement('throw', [literal(dynamicExit.exit)]));
        return { body, terminal: true };
      }
      const transactional = pending.length ? undefined : op === 'TRY_CATCH' && i.blocks.length === 2
        && i.operands.length === 2 && /^\d+$/.test(i.operands[0]) && Number(i.operands[0]) <= 255
        && ['0', '1'].includes(i.operands[1])
        ? { length: 1, captured: Number(i.operands[0]), savesC3: i.operands[1] === '1', body: i.blocks[0], handler: i.blocks[1] }
        : op === 'PUSH' ? matchTryCatch(code, index) : undefined;
      if (transactional) {
        const captured = take(transactional.captured);
        const success = [...stack];
        const exceptionArg = local('unknown'), exceptionCode = local('int');
        group(exceptionArg);
        const failure = [...captured, exceptionArg, exceptionCode];
        let a: ReturnType<typeof execute>;
        if (!transactional.savesC3) restrictedC3Depth++;
        try { a = execute(transactional.body, success, depth + 1, true); }
        finally { if (!transactional.savesC3) restrictedC3Depth--; }
        const b = execute(transactional.handler, failure, depth + 1, true);
        // Unconstrained exception arguments may be any TVM slot. Keep them
        // opaque when unused; escaping unconstrained values need union types.
        if (exceptionArg.type === 'unknown') {
          const escaped = [...success, ...failure].some(v => group(v) === group(exceptionArg));
          if (escaped) throw new UnsupportedInstruction('TRY', 'Unconstrained exception argument escapes catch');
          bindType(exceptionArg, 'int');
        }
        const exits = [!a.terminal ? success : undefined, !b.terminal ? failure : undefined]
          .filter((v): v is Expr[] => v !== undefined);
        if (exits.length === 2 && exits[0].length !== exits[1].length)
          throw new UnsupportedInstruction('TRY', 'Try and catch stack heights differ');
        const targets = (exits[0] ?? []).map((value, k) => {
          const other = exits[1]?.[k];
          const kind = ['null', 'unknown', 'vector_empty'].includes(value.type) && other
            ? other.type : value.type;
          if (other) { requireType(value, kind); requireType(other, kind); }
          const target = local(kind === 'null' ? 'cell' : kind);
          if (kind === 'unknown') {
            unifyTypes(target, value.type === 'unknown' ? value : other!);
            if (other) unifyTypes(target, other);
          }
          body.push(statement('declare', [target]));
          return target;
        });
        if (targets.length) {
          if (!a.terminal) a.body.push(statement('set', [product(targets), product(success)]));
          if (!b.terminal) b.body.push(statement('set', [product(targets), product(failure)]));
        }
        body.push(statement('try', [exceptionArg, exceptionCode], a.body, b.body));
        stack.splice(0, stack.length, ...targets);
        index += transactional.length - 1;
        if (!exits.length) return { body, terminal: true };
        continue;
      }
      if (op === 'PREPAREDICT' && /^CALLXARGS(?:_1)?$/.test(code[index + 1]?.opcode ?? '')) {
        if (pending.length) throw new UnsupportedInstruction(op, 'Mixed static and dynamic continuations');
        const [passed, returned] = code[index + 1].operands.map(Number);
        // PREPAREDICT adds the method ID to the arguments supplied to c3.
        // Preserve the runtime dispatcher (it may have been replaced by BLESS).
        if (!Number.isInteger(passed) || passed < 1 || passed > 15 || returned !== 0)
          throw new UnsupportedInstruction(op, 'Continuation call has an unresolved return signature');
        const id = number();
        if (restrictedC3Depth) throw new UnsupportedInstruction('TRY', 'Dynamic call may change c3 outside catch snapshot');
        changesC3 = true;
        primitive('CALL_PREPARED', Array.from({ length: passed - 1 }, (_, n) => `X${n}`), [],
          `${id} PREPAREDICT ${passed} 0 CALLXARGS`, `_${id}_${passed}`);
        index++;
        continue;
      }
      if (/^CALLXARGS(?:_1)?$/.test(op) && !pending.length) {
        const [passed, returned] = i.operands.map(Number);
        if (!Number.isInteger(passed) || passed < 0 || passed > 15 || returned !== 0)
          throw new UnsupportedInstruction(op, 'Continuation call has an unresolved return signature');
        if (restrictedC3Depth) throw new UnsupportedInstruction('TRY', 'Dynamic call may change c3 outside catch snapshot');
        changesC3 = true;
        primitive('CALL_CONTINUATION', [...Array.from({ length: passed }, (_, n) => `X${n}`), 'cont'], [],
          `${passed} 0 CALLXARGS`, `_${passed}`);
        continue;
      }
      if (op === 'BLESS') {
        if (pending.length) throw new UnsupportedInstruction(op, 'Mixed static and dynamic continuations');
        primitive('BLESS', ['slice'], ['cont']);
        continue;
      }
      if ((op === 'PUSH' || op === 'POP') && i.operands[0] === 'c3') {
        if (op === 'POP') {
          if (restrictedC3Depth) throw new UnsupportedInstruction('TRY', 'Catch snapshot does not restore changed c3');
          changesC3 = true;
        }
        if (pending.length) throw new UnsupportedInstruction(op, 'Mixed static and dynamic continuations');
        primitive(op === 'PUSH' ? 'GETC3' : 'SETC3', op === 'POP' ? ['cont'] : [],
          op === 'PUSH' ? ['cont'] : [], `c3 ${op}`);
        continue;
      }
      if (op === 'PUSH' && ['c5', 'c7'].includes(i.operands[0])) {
        primitive('GET' + i.operands[0].toUpperCase(), [],
          [i.operands[0] === 'c5' ? 'cell' : 'tuple'], `${i.operands[0]} PUSH`);
        continue;
      }
      if (op === 'GETGLOB' || op === 'SETGLOB') {
        const slotNumber = number();
        if (slotNumber < 1 || slotNumber > 31)
          throw new UnsupportedInstruction(op, 'Unsupported global slot');
        if (op === 'GETGLOB' && code[index + 1]?.opcode === 'ISNULL') {
          primitive(
            'IS_GLOBAL_NULL',
            [],
            ['int'],
            `${slotNumber} GETGLOB ISNULL`,
            '_' + slotNumber,
          );
          index++;
          continue;
        }
        let kind = globalTypes.get(slotNumber);
        if (op === 'SETGLOB') {
          const value = stack[stack.length - 1];
          if (!value) throw new StackUnderflow();
          if (!kind && value.type !== 'unknown' && value.type !== 'null') kind = value.type;
          if (kind) {
            requireType(value, kind);
            globalTypes.set(slotNumber, kind);
          }
          primitive(op, ['X'], [], `${slotNumber} ${op}`, '_' + slotNumber);
        } else {
          if (!kind) throw new UnsupportedInstruction(op, 'Global value type is not established');
          primitive(op, [], [kind], `${slotNumber} ${op}`, '_' + slotNumber);
        }
        continue;
      }
      if (op === 'RETALT') {
        if (!alternateReturn)
          throw new UnsupportedInstruction(op, 'Unknown alternate return target');
        body.push(statement('return', [...stack]));
        return { body, terminal: true };
      }
      if (['IFRET', 'IFNOTRET', 'IFRETALT', 'IFNOTRETALT'].includes(op)) {
        if (op.endsWith('ALT') && !alternateReturn)
          throw new UnsupportedInstruction(op, 'Unknown alternate return target');
        const condition = pop();
        requireType(condition, 'int');
        body.push(
          statement(
            'if',
            [
              op.startsWith('IFNOT')
                ? expr('binary', '==', 'int', [condition, literal(0)])
                : condition,
            ],
            [statement('return', [...stack])],
          ),
        );
        continue;
      }
      if (['LDSLICEX', 'LDUX', 'LDIX', 'PLDUX', 'PLDIX', 'PLDSLICEX'].includes(op)) {
        primitive(
          op,
          ['slice', 'int'],
          op === 'LDSLICEX'
            ? ['slice', 'slice']
            : op === 'PLDSLICEX'
              ? ['slice']
              : op.startsWith('PL')
                ? ['int']
                : ['int', 'slice'],
        );
        continue;
      }
      if (
        ['MULRSHIFT#', 'MULRSHIFTR#', 'MULRSHIFTC#', 'RSHIFTR#', 'RSHIFTC#', 'MODPOW2#'].includes(
          op,
        )
      ) {
        const width = number();
        if (width < 1 || width > 256) throw new UnsupportedInstruction(op, 'Invalid shift width');
        primitive(
          op.slice(0, -1),
          op.startsWith('MUL') ? ['int', 'int'] : ['int'],
          ['int'],
          `${width} ${op}`,
          '_' + width,
        );
        continue;
      }
      if (['STSLICECONST', 'SDBEGINS', 'SDBEGINSQ'].includes(op)) {
        let prefix = i.operands[0];
        if (i.operands.length !== 1) throw new UnsupportedInstruction(op, 'Missing slice literal');
        if (/^(?:[a-f0-9]{2})+$/i.test(prefix)) {
          const cell = Cell.fromBoc(Buffer.from(prefix, 'hex'))[0];
          if (cell.refs.length) throw new UnsupportedInstruction(op, 'Referenced inline slice');
          prefix = `x{${cell.bits.toString()}}`;
        }
        if (!/^x\{[a-f0-9]*_?\}$/i.test(prefix))
          throw new UnsupportedInstruction(op, 'Invalid slice literal');
        primitive(
          op,
          [op === 'STSLICECONST' ? 'builder' : 'slice'],
          op === 'STSLICECONST' ? ['builder'] : op.endsWith('Q') ? ['slice', 'int'] : ['slice'],
          `${prefix} ${op}`,
          '_' + prefix.slice(2, -1),
        );
        continue;
      }
      if (['DICTUDELGET', 'DICTIDELGET', 'PFXDICTGETQ'].includes(op)) {
        const padding = op === 'PFXDICTGETQ' ? 'NULLSWAPIFNOT2' : 'NULLSWAPIFNOT';
        if (code[index + 1]?.opcode !== padding)
          throw new UnsupportedInstruction(op, 'Dictionary operation needs padded results');
        primitive(
          op,
          [op === 'PFXDICTGETQ' ? 'slice' : 'int', 'cell', 'int'],
          op === 'PFXDICTGETQ' ? ['slice', 'slice', 'slice', 'int'] : ['cell', 'slice', 'int'],
          `${op} ${padding}`,
        );
        index++;
        continue;
      }
      if (['DICTGET', 'DICTUGET', 'DICTIGET', 'DICTGETREF', 'DICTUGETREF', 'DICTIGETREF'].includes(op)) {
        const next = code[index + 1];
        if (next?.opcode === 'THROWIFNOT' && next.operands.length === 1 && /^\d+$/.test(next.operands[0])) {
          primitive(op, [op === 'DICTGET' || op === 'DICTGETREF' ? 'slice' : 'int', 'cell', 'int'],
            [op.endsWith('REF') ? 'cell' : 'slice'], `${op} ${next.operands[0]} THROWIFNOT`, '_assert_' + next.operands[0]);
          index++;
          continue;
        }
        if (next?.opcode !== 'NULLSWAPIFNOT')
          throw new UnsupportedInstruction(op, 'Dictionary lookup needs padding or immediate success assertion');
        primitive(
          op,
          [op === 'DICTGET' || op === 'DICTGETREF' ? 'slice' : 'int', 'cell', 'int'],
          [op.endsWith('REF') ? 'cell' : 'slice', 'int'],
          op + ' NULLSWAPIFNOT',
        );
        index++;
        continue;
      }
      if (
        /^DICT[UI]?(?:(?:REM)?(?:MIN|MAX)(?:REF)?|GET(?:NEXT|PREV)(?:EQ)?)$/.test(op) ||
        op === 'DICTREMMIN' ||
        op === 'DICTUMINREF'
      ) {
        if (code[index + 1]?.opcode !== 'NULLSWAPIFNOT2')
          throw new UnsupportedInstruction(op, 'Dictionary iteration needs padded results');
        primitive(
          op,
          op.includes('GET') ? [/^DICT[UI]/.test(op) ? 'int' : 'slice', 'cell', 'int'] : ['cell', 'int'],
          [
            ...(op.includes('REM') ? ['cell'] : []),
            op.endsWith('REF') ? 'cell' : 'slice',
            /^DICT[UI]/.test(op) ? 'int' : 'slice',
            'int',
          ],
          op + ' NULLSWAPIFNOT2',
        );
        index++;
        continue;
      }

      if (/^DICT[UI]?(?:SETGET|ADDGET)B$/.test(op)) {
        if (code[index + 1]?.opcode !== 'NULLSWAPIFNOT')
          throw new UnsupportedInstruction(op, 'Dictionary update needs padded results');
        primitive(op, ['builder', /^DICT[UI]/.test(op) ? 'int' : 'slice', 'cell', 'int'],
          ['cell', 'slice', 'int'], `${op} NULLSWAPIFNOT`);
        index++;
        continue;
      }
      if (/^LSHIFT_DIV[RC]?$/.test(op)) {
        const width = number();
        if (width < 1 || width > 256) throw new UnsupportedInstruction(op, 'Invalid shift width');
        primitive(op, ['int', 'int'], ['int'], `${width} ${op.replace('LSHIFT_DIV', 'LSHIFT#DIV')}`, '_' + width);
        continue;
      }
      if (op === 'RET') return { body, terminal: false };
      if (op === 'PUSHINT') {
        stack.push(literal(imm()));
        continue;
      }
      const constants: Record<string, number> = {
        TRUE: -1,
        FALSE: 0,
        ZERO: 0,
        ONE: 1,
        TWO: 2,
        TEN: 10,
      };
      if (op in constants) {
        stack.push(literal(constants[op]));
        continue;
      }
      if (['PUSHPOW2', 'PUSHPOW2DEC', 'PUSHNEGPOW2'].includes(op)) {
        const n = number();
        if (n < 0 || n > 256) throw new UnsupportedInstruction(op);
        stack.push(
          literal(
            op === 'PUSHNEGPOW2'
              ? -(1n << BigInt(n))
              : (1n << BigInt(n)) - (op === 'PUSHPOW2DEC' ? 1n : 0n),
          ),
        );
        continue;
      }
      if (op === 'PUSHNULL') {
        stack.push(expr('literal', 'null()', 'null'));
        continue;
      }
      if (op === 'DUP') {
        push(0);
        continue;
      }
      if (op === 'OVER') {
        push(1);
        continue;
      }
      if (op === 'SWAP') {
        swap(0, 1);
        continue;
      }
      if (op === 'DROP') {
        pop();
        continue;
      }
      if (op === 'NIP') {
        const top = pop();
        pop();
        stack.push(top);
        continue;
      }
      if (op === '2DROP') {
        take(2);
        continue;
      }
      if (op === '2DUP') {
        const v = take(2);
        stack.push(...v, ...v);
        continue;
      }
      if (op === '2SWAP') {
        const v = take(4);
        stack.push(v[2], v[3], v[0], v[1]);
        continue;
      }
      if (op === '2OVER') {
        const v = take(4);
        stack.push(...v, v[0], v[1]);
        continue;
      }
      if (op === 'ROT' || op === '-ROT' || op === 'ROTREV') {
        const v = take(3);
        stack.push(...(op === 'ROT' ? [v[1], v[2], v[0]] : [v[2], v[0], v[1]]));
        continue;
      }
      if (op === 'TUCK') {
        const v = take(2);
        stack.push(v[1], v[0], v[1]);
        continue;
      }
      if (op === 'PUSH' && i.operands[0] === 'c4') {
        primitive('GETDATA', [], ['cell'], 'c4 PUSH');
        continue;
      }
      if (op === 'POP' && i.operands[0] === 'c4') {
        primitive('SETDATA', ['cell'], [], 'c4 POP');
        continue;
      }
      if (op === 'POP' && i.operands[0] === 'c5') {
        primitive('SETC5', ['cell'], [], 'c5 POP');
        continue;
      }
      if (op === 'PUSH') {
        push(registers()[0]);
        continue;
      }
      if (op === 'POP') {
        const dest = slot(registers()[0]);
        stack[dest] = stack[stack.length - 1];
        stack.pop();
        continue;
      }
      if (op === 'XCHG') {
        const [x, y] = registers();
        swap(x, y);
        continue;
      }
      if (
        [
          'XCHG2',
          'XCHG3',
          'XCPU',
          'PUXC',
          'PUSH2',
          'PUSH3',
          'XC2PU',
          'XCPUXC',
          'XCPU2',
          'PUXC2',
          'PUXCPU',
          'PU2XC',
        ].includes(op)
      ) {
        const [x, y, z] = registers();
        switch (op) {
          case 'XCHG2':
            swap(1, x);
            swap(0, y);
            break;
          case 'XCHG3':
            swap(2, x);
            swap(1, y);
            swap(0, z);
            break;
          case 'XCPU':
            swap(0, x);
            push(y);
            break;
          case 'PUXC':
            push(x);
            swap(0, 1);
            swap(0, y + 1);
            break;
          case 'PUSH2':
            push(x);
            push(y + 1);
            break;
          case 'PUSH3':
            push(x);
            push(y + 1);
            push(z + 2);
            break;
          case 'XC2PU':
            swap(1, x);
            swap(0, y);
            push(z);
            break;
          case 'XCPUXC':
            swap(1, x);
            push(y);
            swap(0, 1);
            swap(0, z + 1);
            break;
          case 'XCPU2':
            swap(0, x);
            push(y);
            push(z + 1);
            break;
          case 'PUXC2':
            push(x);
            swap(2, 0);
            swap(1, y + 1);
            swap(0, z + 1);
            break;
          case 'PUXCPU':
            push(x);
            swap(0, 1);
            swap(0, y + 1);
            push(z + 1);
            break;
          case 'PU2XC':
            push(x);
            swap(1, 0);
            push(y + 1);
            swap(1, 0);
            swap(0, z + 2);
            break;
        }
        continue;
      }
      if (op === 'BLKDROP2') {
        const [n, k] = i.operands.map(Number);
        const top = take(k);
        take(n);
        stack.push(...top);
        continue;
      }
      if (op === 'BLKPUSH') {
        const [n, k] = i.operands.map(Number);
        if (n < 0 || n > 32) throw new UnsupportedInstruction(op);
        for (let j = 0; j < n; j++) push(k);
        continue;
      }
      if (op === 'BLKDROP') {
        take(number());
        continue;
      }
      if (op === 'BLKSWAP') {
        const [a, b] = i.operands.map(Number);
        if (a < 1 || b < 1 || a + b > 32) throw new UnsupportedInstruction(op);
        const v = take(a + b);
        stack.push(...v.slice(a), ...v.slice(0, a));
        continue;
      }
      if (op === 'REVERSE') {
        const [n, offset] = i.operands.map(Number);
        if (n < 0 || offset < 0 || n + offset > 32) throw new UnsupportedInstruction(op);
        const v = take(n + offset);
        stack.push(...v.slice(0, n).reverse(), ...v.slice(n));
        continue;
      }
      if ((op in binary && !i.operands.length) || op === 'SUBR') {
        const [a, b] = take(2);
        requireType(a, 'int');
        requireType(b, 'int');
        computed(expr('binary', binary[op] ?? '-', 'int', op === 'SUBR' ? [b, a] : [a, b]));
        continue;
      }
      if (op === 'CONDSEL') {
        if (stack.length < 3) throw new StackUnderflow();
        const a = stack[stack.length - 3], b = stack[stack.length - 2];
        const kind = [a.type, b.type].find(t => t !== 'null' && t !== 'unknown');
        if (!kind) throw new UnsupportedInstruction(op, 'Unresolved selected value type');
        // Preserve eager operands, TVM flag validation, and the exact selection order.
        primitive(op, [kind, kind, 'int'], [kind], op, '_' + typeKey(kind));
        continue;
      }
      if (op === 'CDATASIZEQ' || op === 'SDATASIZEQ') {
        // Quiet failures have fewer results; only lift the explicitly padded form.
        if (code[index + 1]?.opcode !== 'NULLSWAPIFNOT2' || code[index + 2]?.opcode !== 'NULLSWAPIFNOT')
          throw new UnsupportedInstruction(op, 'Data size operation needs padded results');
        primitive(op, [op === 'CDATASIZEQ' ? 'cell' : 'slice', 'int'],
          ['int', 'int', 'int', 'int'], `${op} NULLSWAPIFNOT2 NULLSWAPIFNOT`);
        index += 2;
        continue;
      }
      if (op === 'NEGATE' || op === 'NOT') {
        const a = pop();
        requireType(a, 'int');
        computed(expr('unary', op === 'NOT' ? '~' : '-', 'int', [a]));
        continue;
      }
      const immediates: Record<string, string> = {
        ADDCONST: '+',
        MULCONST: '*',
        ADDINT: '+',
        MULINT: '*',
        EQINT: '==',
        NEQINT: '!=',
        LESSINT: '<',
        GTINT: '>',
        LSHIFT: '<<',
        RSHIFT: '>>',
      };
      if (op === 'INC' || op === 'DEC' || op in immediates) {
        const a = pop();
        requireType(a, 'int');
        computed(
          expr('binary', op === 'INC' ? '+' : op === 'DEC' ? '-' : immediates[op], 'int', [
            a,
            literal(op === 'INC' || op === 'DEC' ? 1 : imm()),
          ]),
        );
        continue;
      }
      if (op === 'LSHIFT#' || op === 'RSHIFT#') {
        const a = pop();
        requireType(a, 'int');
        computed(expr('binary', op === 'LSHIFT#' ? '<<' : '>>', 'int', [a, literal(imm())]));
        continue;
      }
      if (op === 'THROW' || op === 'THROWANY' || op === 'THROWIF' || op === 'THROWIFNOT') {
        const values = [op === 'THROWANY' ? pop() : literal(imm())];
        requireType(values[0], 'int');
        if (op !== 'THROW' && op !== 'THROWANY') {
          const c = pop();
          requireType(c, 'int');
          values.push(c);
        }
        body.push(statement(op === 'THROWANY' ? 'throw' : op.toLowerCase(), values));
        if (op === 'THROW' || op === 'THROWANY') return { body, terminal: true };
        continue;
      }
      if (op === 'PUSHCONT' && i.blocks.length === 1) {
        pending.push(i.blocks[0]);
        continue;
      }
      if ((op === 'CALL' && i.blocks.length === 1) || op === 'EXECUTE') {
        const continuation = op === 'CALL' ? i.blocks[0] : pending.pop();
        if (!continuation) throw new UnsupportedInstruction(op, 'Dynamic continuation: runtime code and stack signature are unknown');
        const r = execute(continuation, stack, depth + 1, true);
        body.push(...r.body);
        if (r.terminal) return { body, terminal: true };
        continue;
      }
      if (op === 'CALLDICT' || op === 'JMPDICT') {
        const id = number(),
          callee =
            typeof options.methods === 'function'
              ? options.methods(id, stack.map((v) => v.type))
              : options.methods?.get(id);
        if (!callee)
          throw new UnsupportedInstruction(op, `Unknown or recursive method signature: ${id}`);
        if (callee.changesC3) {
          if (restrictedC3Depth) throw new UnsupportedInstruction('TRY', 'Callee changes c3 outside catch snapshot');
          changesC3 = true;
        }
        const values = take(callee.arguments);
        values.forEach((v, j) => requireType(v, callee.argumentTypes[j]));
        const bindings = new Map<string, Expr>();
        callee.argumentTypes.forEach((type, j) => {
          if (!/^X\d*$/.test(type)) return;
          const existing = bindings.get(type);
          if (existing) unifyTypes(existing, values[j]);
          if (!existing || existing.type === 'null') bindings.set(type, values[j]);
        });
        for (const [type, value] of bindings) {
          if (value.type !== 'null') continue;
          const nullable = { ...value, type: 'unknown' };
          values.forEach((v, j) => { if (v === value) values[j] = nullable; });
          bindings.set(type, nullable);
          nullBindings.push(nullable);
        }
        values.forEach((value, j) => {
          const binding = bindings.get(callee.argumentTypes[j]);
          if (value.type !== 'null' || !binding) return;
          const nullable = { ...value, type: binding.type };
          if (binding.type === 'unknown') unifyTypes(nullable, binding);
          values[j] = nullable;
          nullBindings.push(nullable);
        });
        const resultLocal = (type: string) => {
          const binding = bindings.get(type);
          const target = local(binding?.type ?? type);
          if (binding && binding.type !== 'null') unifyTypes(target, binding);
          return target;
        };
        if (callee.inlineBody) {
          const locals = new Map<string, Expr>();
          const substitute = (value: Expr): Expr => {
            if (value.op === 'arg') return values[Number(value.value.slice(3))];
            if (value.op === 'local') {
              if (!locals.has(value.value)) locals.set(value.value, resultLocal(value.type));
              return locals.get(value.value)!;
            }
            const binding = bindings.get(value.type);
            const rewritten = { ...value, type: binding?.type ?? value.type,
              args: value.args.map(substitute) };
            if (binding && binding.type === 'unknown') unifyTypes(rewritten, binding);
            return rewritten;
          };
          const rewrite = (s: Statement): Statement => ({
            ...s,
            values: s.values.map(substitute),
            then: s.then.map(rewrite),
            otherwise: s.otherwise.map(rewrite),
          });
          body.push(...callee.statements.map(rewrite));
          callee.primitives.forEach((p) => primitives.set(p.name, p));
          stack.push(...callee.returns.map(substitute));
          if (op === 'JMPDICT') {
            if (localReturn) return { body, terminal: false };
            body.push(statement('return', [...stack]));
            return { body, terminal: true };
          }
          continue;
        }
        const results = callee.returns.map((v) => resultLocal(v.type)),
          call = expr('call', methodName(id), results[0]?.type ?? '()', values);
        body.push(
          results.length
            ? statement('assign', [product(results), call])
            : statement('call', [call]),
        );
        stack.push(...results);
        if (op === 'JMPDICT') {
          if (localReturn) return { body, terminal: false };
          body.push(statement('return', [...stack]));
          return { body, terminal: true };
        }
        continue;
      }
      if (['IF', 'IFNOT', 'IFELSE', 'IFJMP', 'IFNOTJMP', 'IFREFELSE', 'IFELSEREF'].includes(op)) {
        const needed = op === 'IFELSE' ? 2 : 1;
        if (pending.length < needed) throw new UnsupportedInstruction(op, 'Dynamic continuation');
        const branches =
            op === 'IFREFELSE'
              ? [i.blocks[0], pending.pop()!]
              : op === 'IFELSEREF'
                ? [pending.pop()!, i.blocks[0]]
                : pending.splice(pending.length - needed, needed),
          cond = pop();
        requireType(cond, 'int');
        const condition = op.startsWith('IFNOT')
          ? expr('binary', '==', 'int', [cond, literal(0)])
          : cond;
        const left = [...stack],
          right = [...stack],
          a = execute(
            branches[0],
            left,
            depth + 1,
            localReturn || (!op.includes('JMP') && index !== code.length - 1),
          ),
          b = execute(
            branches[1] ?? [],
            right,
            depth + 1,
            localReturn || (!op.includes('JMP') && index !== code.length - 1),
          );
        if (op.includes('JMP') && !a.terminal) {
          a.body.push(statement('return', [...left]));
          a.terminal = true;
        }
        if (a.terminal && b.terminal) {
          body.push(statement('if', [condition], a.body, b.body));
          return { body, terminal: true };
        }
        if (a.terminal || b.terminal) {
          if (a.terminal) {
            body.push(statement('if', [condition], a.body), ...b.body);
          } else {
            body.push(
              statement('if', [expr('binary', '==', 'int', [condition, literal(0)])], b.body),
              ...a.body,
            );
          }
          stack.splice(0, stack.length, ...(a.terminal ? right : left));
          continue;
        }
        if (left.length !== right.length)
          throw new UnsupportedInstruction(op, 'Branch stack heights differ');
        const merged: Expr[] = [],
          updatesA: Expr[] = [],
          updatesB: Expr[] = [],
          targets: Expr[] = [];
        for (let k = 0; k < left.length; k++) {
          if (same(left[k], right[k])) {
            merged.push(left[k]);
            continue;
          }
          const kind = ['null', 'unknown', 'vector_empty'].includes(left[k].type)
            ? right[k].type
            : left[k].type;
          requireType(left[k], kind);
          requireType(right[k], kind);
          const target = local(kind);
          if (kind === 'unknown') {
            unifyTypes(left[k], right[k]);
            unifyTypes(target, left[k].type === 'unknown' ? left[k] : right[k]);
          }
          body.push(statement('declare', [target]));
          merged.push(target);
          targets.push(target);
          updatesA.push(left[k]);
          updatesB.push(right[k]);
        }
        if (targets.length) {
          a.body.push(statement('set', [product(targets), product(updatesA)]));
          b.body.push(statement('set', [product(targets), product(updatesB)]));
        }
        body.push(statement('if', [condition], a.body, b.body));
        stack.splice(0, stack.length, ...merged);
        continue;
      }
      if (op === 'UNTIL' && isDecimalConversion(code) && pending.length === 1 &&
          isDecimalDigitLoop(pending[0], code.slice(index + 1, index + 4)) &&
          stack.at(-2)?.op === 'literal' && stack.at(-2)?.value === '0') {
        // The exact decimal conversion idiom has a bounded dynamic stack (at most
        // 78 digits for TVM integers). Spill those digits into a typed tuple so
        // the two loops have a fixed high-level state. The sign handling and
        // NEGATE preceding this idiom remain untouched, including overflow.
        const [initialBuilder, initialCount, initialValue] = take(3);
        requireType(initialBuilder, 'builder');
        requireType(initialValue, 'int');
        pending.pop();
        const b = local('builder'), n = local('int'), count = local('int'),
          digits = local('vector_int'), quotient = local('int'), remainder = local('int'),
          digit = local('int'), popped = local('int');
        const call = (name: string, inputs: string[], outputs: string[], assembly: string, args: Expr[]) => {
          primitives.set(name, { name, inputs, outputs, assembly });
          return expr('call', name, outputs[0] ?? '()', args);
        };
        const touch = (value: Expr) => call('impure_touch', ['X'], ['X'], 'NOP', [value]);
        body.push(statement('assign', [b, initialBuilder]), statement('assign', [n, initialValue]),
          statement('assign', [count, initialCount]),
          statement('assign', [digits, call('tvm_decimal_digits_empty', [], ['vector_int'], '0 TUPLE', [])]));
        body.push(statement('until', [expr('binary', '==', 'int', [n, literal(0)])], [
          statement('assign', [product([quotient, remainder]), call('tvm_divmod', ['int', 'int'], ['int', 'int'], 'DIVMOD', [n, literal(10)])]),
          statement('assign', [digit, touch(expr('binary', '+', 'int', [remainder, literal(48)]))]),
          statement('set', [digits, call('tvm_decimal_digits_push', ['vector_int', 'int'], ['vector_int'], 'TPUSH', [digits, digit])]),
          statement('set', [count, touch(expr('binary', '+', 'int', [count, literal(1)]))]),
          statement('set', [n, quotient]),
        ]));
        body.push(statement('repeat', [count], [
          statement('declare', [popped]),
          statement('set', [product([digits, popped]), call('tvm_decimal_digits_pop', ['vector_int'], ['vector_int', 'int'], 'TPOP', [digits])]),
          statement('set', [b, call('tvm_stu_8', ['int', 'builder'], ['builder'], '8 STU', [popped, b])]),
        ]));
        stack.push(b);
        index += 3;
        continue;
      }
      if (op === 'WHILE') {
        if (pending.length < 2) throw new UnsupportedInstruction(op, 'Dynamic loop');
        const [testCode, bodyCode] = pending.splice(pending.length - 2, 2);
        // A WHILE test transforms the head stack X into Y + flag. Its body
        // transforms Y back into X. The false exit exposes Y, not X.
        const probe = [...stack];
        const probeTest = execute(testCode, probe, depth + 1, true);
        if (probeTest.terminal) throw new UnsupportedInstruction(op, 'Terminal loop condition');
        const probeFlag = probe.pop();
        if (!probeFlag) throw new StackUnderflow();
        requireType(probeFlag, 'int');
        const probeRun = execute(bodyCode, probe, depth + 1, true);
        if (!probeRun.terminal && probe.length !== stack.length)
          throw new UnsupportedInstruction(op, 'Loop cycle changes stack height');
        const carried = stack.map((value, k) => {
          if (value.type === 'unknown' && (probeRun.terminal || same(value, probe[k]))) return value;
          const other = probeRun.terminal ? undefined : probe[k];
          const kind = ['null', 'vector_empty', 'unknown'].includes(value.type) && other && other.type !== 'null'
            ? other.type : value.type;
          requireType(value, kind);
          const target = local(kind);
          if (kind === 'unknown') {
            if (other) unifyTypes(value, other);
            unifyTypes(target, value);
          }
          body.push(statement('assign', [target, value]));
          return target;
        });
        const tested = [...carried];
        const test = execute(testCode, tested, depth + 1, true);
        const condition = tested.pop();
        if (!condition || test.terminal) throw new UnsupportedInstruction(op, 'Invalid loop condition');
        requireType(condition, 'int');
        const exits = tested.map(value => {
          if (value.type === 'unknown' && value.op === 'arg') return value;
          const target = local(value.type);
          if (value.type === 'unknown') unifyTypes(target, value);
          body.push(statement('declare', [target]));
          return target;
        });
        const runStack = [...tested];
        const run = execute(bodyCode, runStack, depth + 1, true);
        const loopBody = [...run.body];
        if (!run.terminal) {
          if (runStack.length !== carried.length) throw new UnsupportedInstruction(op, 'Loop cycle changes stack height');
          const updates = carried.map((target, k) => ({target, value: runStack[k]})).filter(p => !same(p.target, p.value));
          for (const {target, value} of updates) {
            if (target.op !== 'local') throw new UnsupportedInstruction(op, 'Loop changes inferred invariant');
            if (target.type === 'unknown') unifyTypes(target, value);
            else requireType(value, target.type);
          }
          if (updates.length) loopBody.push(statement('set', [product(updates.map(p=>p.target)), product(updates.map(p=>p.value))]));
        }
        const flag = local('int');
        body.push(statement('assign', [flag, literal(-1)]));
        const exitUpdates = exits.map((target,k)=>({target,value:tested[k]})).filter(p=>!same(p.target,p.value));
        body.push(statement('while', [flag], [
          ...test.body,
          ...(exitUpdates.length ? [statement('set', [product(exitUpdates.map(p=>p.target)), product(exitUpdates.map(p=>p.value))])] : []),
          statement('set', [flag, condition]),
          statement('if', [flag], loopBody),
        ]));
        stack.splice(0, stack.length, ...exits);
        continue;
      }
      if (['REPEAT', 'UNTIL', 'AGAINEND'].includes(op)) {
        const needed = op === 'AGAINEND' ? 0 : 1;
        if (pending.length < needed) throw new UnsupportedInstruction(op, 'Dynamic loop');
        const parts =
          op === 'AGAINEND'
            ? [code.slice(index + 1)]
            : pending.splice(pending.length - needed, needed);
        const loopOp = op;
        const repeats = op === 'REPEAT' ? pop() : undefined;
        if (repeats) requireType(repeats, 'int');
        const probe = [...stack];
        execute(parts[0], probe, depth + 1, true);
        const carried = stack.map((value, k) => {
          if (value.type === 'unknown' && probe[k] === value) return value;
          let kind = value.type;
          if (
            ['null', 'vector_empty'].includes(kind) &&
            probe[k] &&
            !['unknown', 'null'].includes(probe[k].type)
          )
            kind = probe[k].type;
          const target = local(kind);
          if (kind === 'unknown') {
            if (probe[k]) unifyTypes(value, probe[k]);
            unifyTypes(target, value);
          }
          body.push(statement('assign', [target, value]));
          return target;
        });
        let condition: Expr = repeats ?? literal(-1);
        const runStack = [...carried],
          run = execute(parts[0], runStack, depth + 1, true);
        let loopBody = [...run.body];
        if (loopOp === 'UNTIL') {
          const flag = runStack.pop();
          if (!flag) throw new StackUnderflow();
          requireType(flag, 'int');
          condition = local('int');
          body.push(statement('declare', [condition]));
          loopBody.push(statement('set', [condition, flag]));
        }
        if (!run.terminal) {
          if (runStack.length !== carried.length)
            throw new UnsupportedInstruction(op, 'Loop changes stack height');
          const changed = carried
            .map((target, k) => ({ target, value: runStack[k] }))
            .filter((p) => !same(p.target, p.value));
          for (const { target, value } of changed) {
            if (target.op !== 'local')
              throw new UnsupportedInstruction(op, 'Loop changes an inferred invariant');
            if (target.type === 'unknown') unifyTypes(target, value);
            else requireType(value, target.type);
          }
          if (changed.length)
            loopBody.push(
              statement('set', [
                product(changed.map((p) => p.target)),
                product(changed.map((p) => p.value)),
              ]),
            );
        }
        body.push(
          statement(loopOp === 'AGAINEND' ? 'while' : loopOp.toLowerCase(), [condition], loopBody),
        );
        stack.splice(0, stack.length, ...carried);
        if (loopOp === 'AGAINEND') return { body, terminal: true };
        continue;
      }
      if (op === 'TUPLE' || op === 'PAIR' || op === 'TRIPLE') {
        const n = op === 'PAIR' ? 2 : op === 'TRIPLE' ? 3 : number();
        if (n < 0 || n > 15) throw new UnsupportedInstruction(op);
        if (n === 0) {
          primitive('VECTOR_EMPTY', [], ['vector_empty'], '0 TUPLE');
          continue;
        }
        const values = take(n),
          types = values.map((v) => v.type);
        if (types.some((t) => t === 'unknown'))
          throw new UnsupportedInstruction(op, 'Unknown tuple element types');
        if (n === 2 && (types[1] === 'null' || types[1] === 'list_' + types[0])) {
          const kind = 'list_' + types[0],
            name = 'tvm_cons_' + typeKey(types[0]);
          primitives.set(name, {
            name,
            inputs: [types[0], 'tuple'],
            outputs: [kind],
            assembly: '2 TUPLE',
          });
          computed(expr('call', name, kind, values));
        } else computed(expr('tuple', '', '[' + types.join(', ') + ']', values));
        continue;
      }
      if (op === 'TPUSH') {
        const [vector, value] = take(2);
        let kind = vector.type;
        if (kind === 'vector_empty') {
          if (['unknown', 'null'].includes(value.type))
            throw new UnsupportedInstruction(op, 'Unknown vector element type');
          kind = 'vector_' + value.type;
        } else if (!kind.startsWith('vector_') || kind.slice(7) !== value.type)
          throw new UnsupportedInstruction(op, 'Vector element type differs');
        const name = 'tvm_tpush_' + typeKey(value.type);
        primitives.set(name, {
          name,
          inputs: ['tuple', value.type],
          outputs: [kind],
          assembly: 'TPUSH',
        });
        computed(expr('call', name, kind, [vector, value]));
        continue;
      }
      if (op === 'TLEN') {
        const value = stack[stack.length - 1];
        if (!value) throw new StackUnderflow();
        if (value.type === 'vector_empty') {
          pop();
          stack.push(literal(0));
        } else primitive(op, ['tuple'], ['int']);
        continue;
      }
      if (op === 'TPOP' || op === 'INDEXVAR' || op === 'LAST') {
        const vector = stack[stack.length - (op === 'INDEXVAR' ? 2 : 1)];
        if (!vector) throw new StackUnderflow();
        if (!vector.type.startsWith('vector_') || vector.type === 'vector_empty')
          throw new UnsupportedInstruction(op, 'Unknown vector element type');
        const element = vector.type.slice(7);
        primitive(
          op,
          op === 'INDEXVAR' ? [vector.type, 'int'] : [vector.type],
          op === 'TPOP' ? [vector.type, element] : [element],
          op,
          '_' + typeKey(element),
        );
        continue;
      }
      if (['INDEX', 'FIRST', 'SECOND', 'THIRD', 'UNTUPLE', 'UNPAIR'].includes(op)) {
        const value = stack[stack.length - 1];
        if (!value) throw new StackUnderflow();
        const n =
          op === 'FIRST'
            ? 0
            : op === 'SECOND'
              ? 1
              : op === 'THIRD'
                ? 2
                : op === 'UNPAIR'
                  ? 2
                  : number();
        if (value.type.startsWith('vector_') && value.type !== 'vector_empty' && !['UNTUPLE', 'UNPAIR'].includes(op)) {
          if (n < 0 || n > 254) throw new UnsupportedInstruction(op, 'Tuple index out of range');
          primitive('INDEX', [value.type], [value.type.slice(7)], `${n} INDEX`, '_' + n + '_' + typeKey(value.type));
          continue;
        }
        const list = value.type.startsWith('list_');
        const types = list ? [value.type.slice(5), value.type] : tupleTypes(value.type);
        if (op === 'UNTUPLE' || op === 'UNPAIR') {
          if (n !== types.length) throw new UnsupportedInstruction(op, 'Tuple arity mismatch');
          primitive(
            'UNTUPLE',
            [value.type],
            types,
            `${n} UNTUPLE`,
            '_' + n + '_' + typeKey(value.type),
          );
        } else {
          if (!types[n]) throw new UnsupportedInstruction(op, 'Tuple index out of range');
          primitive(
            'INDEX',
            [value.type],
            [types[n]],
            `${n} INDEX`,
            '_' + n + '_' + typeKey(value.type),
          );
        }
        continue;
      }
      if (/^PUSH(?:REF|REFSLICE|SLICE)$/.test(op) && i.operands.length === 1) {
        const hex = i.operands[0];
        if (!/^(?:[\da-f]{2})+$/i.test(hex))
          throw new UnsupportedInstruction(op, 'Missing referenced cell');
        const hash = parseBoc(Buffer.from(hex, 'hex')).codeHash;
        primitive(
          op,
          [],
          [op === 'PUSHREF' ? 'cell' : 'slice'],
          `B{${hex}} B>boc ${op === 'PUSHREF' ? 'PUSHREF' : '<s PUSHSLICE'}`,
          '_' + hash.slice(0, 16),
        );
        continue;
      }
      if (
        ['LDU', 'LDI', 'PLDU', 'PLDI', 'STU', 'STI', 'STUR', 'STIR', 'LDSLICE', 'PLDSLICE', 'PLDREFIDX'].includes(
          op,
        )
      ) {
        const n = number();
        if (n < 0 || n > 1023) throw new UnsupportedInstruction(op);
        const store = op.startsWith('ST'),
          load = op.startsWith('LD'),
          kind = op.includes('SLICE') ? 'slice' : op === 'PLDREFIDX' ? 'cell' : 'int';
        primitive(
          op,
          store ? (op.endsWith('R') ? ['builder', 'int'] : ['int', 'builder']) : ['slice'],
          store ? ['builder'] : load ? [kind, 'slice'] : [kind],
          `${n} ${op}`,
          '_' + n,
        );
        continue;
      }
      const simple: Record<string, [string[], string[]]> = {
        SKIPDICT: [['slice'], ['slice']],
        SBITREFS: [['slice'], ['int', 'int']],
        GETPRECOMPILEDGAS: [[], ['int']],
        STORAGEFEES: [[], ['int']],
        DUEPAYMENT: [[], ['int']],
        GASCONSUMED: [[], ['int']],
        GETGASFEE: [['int', 'int'], ['int']],
        GETGASFEESIMPLE: [['int', 'int'], ['int']],
        GETORIGINALFWDFEE: [['int', 'int'], ['int']],
        GETFORWARDFEE: [['int', 'int', 'int'], ['int']],
        GETFORWARDFEESIMPLE: [['int', 'int', 'int'], ['int']],
        GETSTORAGEFEE: [['int', 'int', 'int', 'int'], ['int']],
        SDCUTFIRST: [['slice', 'int'], ['slice']],
        SDCUTLAST: [['slice', 'int'], ['slice']],
        SDSKIPLAST: [['slice', 'int'], ['slice']],
        GETDATA: [[], ['cell']],
        SETDATA: [['cell'], []],
        NEWC: [[], ['builder']],
        ENDC: [['builder'], ['cell']],
        CTOS: [['cell'], ['slice']],
        ENDS: [['slice'], []],
        LDREF: [['slice'], ['cell', 'slice']],
        LDGRAMS: [['slice'], ['int', 'slice']],
        LDMSGADDR: [['slice'], ['slice', 'slice']],
        LDDICT: [['slice'], ['cell', 'slice']],
        STREF: [['cell', 'builder'], ['builder']],
        STDICT: [['cell', 'builder'], ['builder']],
        STGRAMS: [['builder', 'int'], ['builder']],
        STSLICE: [['slice', 'builder'], ['builder']],
        STSLICER: [['builder', 'slice'], ['builder']],
        STB: [['builder', 'builder'], ['builder']],
        NOW: [[], ['int']],
        LTIME: [[], ['int']],
        BLOCKLT: [[], ['int']],
        MYADDR: [[], ['slice']],
        MYCODE: [[], ['cell']],
        BALANCE: [[], ['[int, cell]']],
        ISNULL: [['X'], ['int']],
        ACCEPT: [[], []],
        COMMIT: [[], []],
        SENDRAWMSG: [['cell', 'int'], []],
        HASHCU: [['cell'], ['int']],
        HASHSU: [['slice'], ['int']],
        CHKSIGNU: [['int', 'slice', 'int'], ['int']],
        SDSKIPFIRST: [['slice', 'int'], ['slice']],
        SDEMPTY: [['slice'], ['int']],
        SEMPTY: [['slice'], ['int']],
        SBITS: [['slice'], ['int']],
        SREFS: [['slice'], ['int']],
        REWRITESTDADDR: [['slice'], ['int', 'int']],
      };
      const signature = simple[op] ?? primitiveSignatures[op];
      if (signature) {
        primitive(op, ...signature);
        continue;
      }
      throw new UnsupportedInstruction(op);
    }
    if (pending.length)
      throw new UnsupportedInstruction('continuation', 'Unused continuation value');
    } catch (error) {
      if (depth === 0 && error instanceof UnsupportedInstruction && boundaryBody > 0)
        options.onPartial?.({ args, stack: boundaryStack, statements: body.slice(0, boundaryBody),
          primitives: [...primitives.values()], remaining: code.slice(boundary) });
      throw error;
    }
    return { body, terminal: false };
  }
  const stack = [...args],
    result = execute(instructions, stack);
  const exits: Expr[][] = result.terminal ? [] : [stack];
  function collect(body: Statement[]) {
    for (const s of body) {
      if (s.kind === 'return') exits.push(s.values);
      collect(s.then);
      collect(s.otherwise);
    }
  }
  collect(result.body);
  const returns = exits[0] ?? [];
  if (exits.some((v) => v.length !== returns.length))
    throw new UnsupportedInstruction('return', 'Early and final stack heights differ');
  for (let i = 0; i < returns.length; i++) {
    const kinds = new Set(
      exits.map((v) => v[i].type).filter((t) => t !== 'null' && t !== 'unknown'),
    );
    if (kinds.size > 1)
      throw new UnsupportedInstruction('return', 'Early and final return types differ');
    // Preserve an unconstrained input/result relationship instead of guessing
    // int. A caller can instantiate the same signature with cell or slice.
    if (!kinds.size && exits.some((v) => v[i].type === 'unknown')) {
      const representative = exits.find((v) => v[i].type === 'unknown')![i];
      for (const values of exits) {
        if (values[i].type === 'null') values[i] = { ...values[i], type: 'unknown' };
        unifyTypes(representative, values[i]);
      }
      continue;
    }
    const kind = [...kinds][0] ?? 'cell';
    for (const values of exits) {
      requireType(values[i], kind);
      if (values[i].type === 'null') values[i] = { ...values[i], type: kind };
    }
  }
  args.forEach((a, i) => {
    if (a.type === 'unknown') bindType(a, `X${i}`);
  });
  nullBindings.forEach(value => {
    if (value.type === 'unknown') bindType(value, 'cell');
  });
  return {
    changesC3,
    arguments: count,
    argumentTypes: args.map((a) => a.type),
    returns,
    statements: result.body,
    primitives: [...primitives.values()],
  };
}
export function methodName(id: number): string {
  return id === 0
    ? 'recv_internal'
    : id === -1
      ? 'recv_external'
      : id === -2
        ? 'run_ticktock'
        : id < 0
          ? `method_neg_${-id}`
          : `method_${id}`;
}

import { instruction, type Instruction } from './asm.js';
import { UnsupportedInstruction } from './errors.js';
import { primitiveSignatures } from './primitives.js';
import { parseBoc } from './boc.js';
export { UnsupportedInstruction } from './errors.js';
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
  arguments: number;
  argumentTypes: string[];
  returns: Expr[];
  statements: Statement[];
  primitives: Primitive[];
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
  options: { arguments?: number; hints?: string[]; methods?: Map<number, StackIR> } = {},
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
  if (options.hints && count > options.hints.length)
    throw new UnsupportedInstruction(
      'entrypoint',
      'Inferred arguments exceed entrypoint signature',
    );
  const args = Array.from({ length: count }, (_, i) =>
    expr('arg', `arg${i}`, options.hints?.slice(-count)[i] ?? 'unknown'),
  );
  const primitives = new Map<string, Primitive>();
  let localCount = 0,
    steps = 0;
  const local = (type: string) => expr('local', `v${localCount++}`, type);
  function requireType(value: Expr, type: string) {
    if (type === 'X' || /^X\d+$/.test(type) || value.type === 'null') return;
    if (value.type === 'unknown' && value.op === 'arg') {
      value.type = type;
      return;
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
  function execute(
    input: Instruction[],
    stack: Expr[],
    depth = 0,
  ): { body: Statement[]; terminal: boolean } {
    if (depth > 64)
      throw new UnsupportedInstruction('complexity', 'Symbolic continuation nesting limit');
    const code = continuations(input),
      body: Statement[] = [],
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
      const operands = take(inputs.length);
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
    for (let index = 0; index < code.length; index++) {
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
      if (op === 'IFRET' || op === 'IFNOTRET') {
        if (depth !== 0)
          throw new UnsupportedInstruction(op, 'Conditional return targets a nested continuation');
        const condition = pop();
        requireType(condition, 'int');
        body.push(
          statement(
            'if',
            [op === 'IFNOTRET' ? expr('binary', '==', 'int', [condition, literal(0)]) : condition],
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
      if (['DICTGET', 'DICTUGET', 'DICTIGET', 'DICTUGETREF', 'DICTIGETREF'].includes(op)) {
        if (code[index + 1]?.opcode !== 'NULLSWAPIFNOT')
          throw new UnsupportedInstruction(op, 'Dictionary lookup needs padded results');
        primitive(
          op,
          [op === 'DICTGET' ? 'slice' : 'int', 'cell', 'int'],
          [op.endsWith('REF') ? 'cell' : 'slice', 'int'],
          op + ' NULLSWAPIFNOT',
        );
        index++;
        continue;
      }
      if (
        /^DICT[UI](?:(?:REM)?(?:MIN|MAX)|GET(?:NEXT|PREV)(?:EQ)?)$/.test(op) ||
        op === 'DICTREMMIN'
      ) {
        if (code[index + 1]?.opcode !== 'NULLSWAPIFNOT2')
          throw new UnsupportedInstruction(op, 'Dictionary iteration needs padded results');
        primitive(
          op,
          op.includes('GET') ? ['int', 'cell', 'int'] : ['cell', 'int'],
          [
            ...(op.includes('REM') ? ['cell'] : []),
            'slice',
            op === 'DICTREMMIN' ? 'slice' : 'int',
            'int',
          ],
          op + ' NULLSWAPIFNOT2',
        );
        index++;
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
      if (op === 'ROT' || op === '-ROT') {
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
      if (op === 'NEGATE' || op === 'NOT') {
        const a = pop();
        requireType(a, 'int');
        computed(expr('unary', op === 'NOT' ? '~' : '-', 'int', [a]));
        continue;
      }
      const immediates: Record<string, string> = {
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
      if (op === 'CALL' && i.blocks.length === 1) {
        const r = execute(i.blocks[0], stack, depth + 1);
        body.push(...r.body);
        if (r.terminal) return { body, terminal: true };
        continue;
      }
      if (op === 'CALLDICT' || op === 'JMPDICT') {
        const id = number(),
          callee = options.methods?.get(id);
        if (!callee)
          throw new UnsupportedInstruction(op, `Unknown or recursive method signature: ${id}`);
        const values = take(callee.arguments);
        values.forEach((v, j) => requireType(v, callee.argumentTypes[j]));
        const results = callee.returns.map((v) => local(v.type)),
          call = expr('call', methodName(id), results[0]?.type ?? '()', values);
        body.push(
          results.length
            ? statement('assign', [product(results), call])
            : statement('call', [call]),
        );
        stack.push(...results);
        if (op === 'JMPDICT') {
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
          a = execute(branches[0], left, depth + 1),
          b = execute(branches[1] ?? [], right, depth + 1);
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
          const kind = left[k].type === 'null' ? right[k].type : left[k].type;
          requireType(right[k], kind);
          if (kind === 'unknown')
            throw new UnsupportedInstruction('type', 'Unknown branch result type');
          const target = local(kind);
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
      if (['REPEAT', 'UNTIL', 'WHILE'].includes(op)) {
        const needed = op === 'WHILE' ? 2 : 1;
        if (pending.length < needed) throw new UnsupportedInstruction(op, 'Dynamic loop');
        const parts = pending.splice(pending.length - needed, needed);
        const repeats = op === 'REPEAT' ? pop() : undefined;
        if (repeats) requireType(repeats, 'int');
        // Infer types by probing once, then use mutable variables for loop-carried values.
        const probe = [...stack];
        const probeResult = execute(op === 'WHILE' ? parts[0] : parts[0], probe, depth + 1);
        if (probeResult.terminal) throw new UnsupportedInstruction(op, 'Terminal loop probe');
        if (op === 'WHILE') {
          requireType(probe.pop()!, 'int');
          execute(parts[1], probe, depth + 1);
        }
        if (op === 'UNTIL') requireType(probe.pop()!, 'int');
        if (probe.length !== stack.length)
          throw new UnsupportedInstruction(op, 'Loop changes stack height');
        const carried = stack.map((v, k) => {
          if (v.type === 'unknown') requireType(v, probe[k].type);
          if (v.type === 'null' && probe[k].type !== 'null') v = { ...v, type: probe[k].type };
          if (v.type === 'unknown')
            throw new UnsupportedInstruction(op, 'Unknown loop-carried type');
          const t = local(v.type);
          body.push(statement('assign', [t, v]));
          return t;
        });
        const loopStack = [...carried];
        let condition: Expr | undefined, loopBody: Statement[];
        if (op === 'WHILE') {
          const test = execute(parts[0], loopStack, depth + 1);
          condition = loopStack.pop();
          if (!condition) throw new StackUnderflow();
          requireType(condition, 'int');
          if (loopStack.length !== carried.length)
            throw new UnsupportedInstruction(op, 'Condition changes stack height');
          if (
            test.body.length === 1 &&
            test.body[0].kind === 'assign' &&
            test.body[0].values[0].op === 'local' &&
            same(test.body[0].values[0], condition) &&
            loopStack.every((v, k) => same(v, carried[k]))
          ) {
            const runStack = [...carried],
              run = execute(parts[1], runStack, depth + 1);
            if (run.terminal || runStack.length !== carried.length)
              throw new UnsupportedInstruction(op, 'Unsupported loop body exit');
            const changed = carried
              .map((target, k) => ({ target, value: runStack[k] }))
              .filter((pair) => !same(pair.target, pair.value));
            let loopCondition = test.body[0].values[1];
            if (loopCondition.op === 'call' && loopCondition.value === 'impure_touch')
              loopCondition = loopCondition.args[0];
            body.push(
              statement(
                'while',
                [loopCondition],
                [
                  ...run.body,
                  ...(changed.length
                    ? [
                        statement('set', [
                          product(changed.map((p) => p.target)),
                          product(changed.map((p) => p.value)),
                        ]),
                      ]
                    : []),
                ],
              ),
            );
            stack.splice(0, stack.length, ...carried);
            continue;
          }
          const condTarget = local('int');
          body.push(
            ...test.body,
            statement('assign', [condTarget, condition]),
            statement('set', [product(carried), product(loopStack)]),
          );
          const runStack = [...carried],
            run = execute(parts[1], runStack, depth + 1);
          if (run.terminal) throw new UnsupportedInstruction(op, 'Terminal loop body');
          if (runStack.length !== carried.length)
            throw new UnsupportedInstruction(op, 'Loop changes stack height');
          const repeatStack = [...carried],
            repeatTest = execute(parts[0], repeatStack, depth + 1),
            repeatCondition = repeatStack.pop();
          if (!repeatCondition || repeatStack.length !== carried.length)
            throw new UnsupportedInstruction(op);
          loopBody = [
            ...run.body,
            statement('set', [product(carried), product(runStack)]),
            ...repeatTest.body,
            statement('set', [condTarget, repeatCondition]),
            statement('set', [product(carried), product(repeatStack)]),
          ];
          body.push(statement('while', [condTarget], loopBody));
        } else {
          const run = execute(parts[0], loopStack, depth + 1);
          if (run.terminal) throw new UnsupportedInstruction(op, 'Terminal loop body');
          condition = op === 'UNTIL' ? loopStack.pop() : repeats;
          if (!condition) throw new StackUnderflow();
          requireType(condition, 'int');
          if (loopStack.length !== carried.length)
            throw new UnsupportedInstruction(op, 'Loop changes stack height');
          const condTarget = op === 'UNTIL' ? local('int') : undefined;
          if (condTarget) body.push(statement('declare', [condTarget]));
          loopBody = [
            ...run.body,
            ...(condTarget ? [statement('set', [condTarget, condition])] : []),
            statement('set', [product(carried), product(loopStack)]),
          ];
          body.push(
            statement(op === 'UNTIL' ? 'until' : 'repeat', [condTarget ?? condition], loopBody),
          );
        }
        stack.splice(0, stack.length, ...carried);
        continue;
      }
      if (op === 'TUPLE' || op === 'PAIR' || op === 'TRIPLE') {
        const n = op === 'PAIR' ? 2 : op === 'TRIPLE' ? 3 : number();
        if (n < 0 || n > 15) throw new UnsupportedInstruction(op);
        const values = take(n),
          types = values.map((v) => v.type);
        if (types.some((t) => t === 'unknown'))
          throw new UnsupportedInstruction(op, 'Unknown tuple element types');
        if (n === 2 && (types[1] === 'null' || types[1] === 'list_' + types[0])) {
          const kind = 'list_' + types[0],
            name = 'tvm_cons_' + types[0].replace(/[^a-z0-9]/gi, '_');
          primitives.set(name, {
            name,
            inputs: [types[0], 'tuple'],
            outputs: ['tuple'],
            assembly: '2 TUPLE',
          });
          computed(expr('call', name, kind, values));
        } else computed(expr('tuple', '', '[' + types.join(', ') + ']', values));
        continue;
      }
      if (['INDEX', 'FIRST', 'SECOND', 'THIRD', 'UNTUPLE', 'UNPAIR'].includes(op)) {
        const value = stack[stack.length - 1];
        if (!value) throw new StackUnderflow();
        if (!/^\[[a-z]+(?:, [a-z]+)*\]$/.test(value.type))
          throw new UnsupportedInstruction(op, 'Unknown tuple element types');
        const types = value.type.slice(1, -1).split(', '),
          n =
            op === 'FIRST'
              ? 0
              : op === 'SECOND'
                ? 1
                : op === 'THIRD'
                  ? 2
                  : op === 'UNPAIR'
                    ? 2
                    : number();
        if (op === 'UNTUPLE' || op === 'UNPAIR') {
          if (n !== types.length) throw new UnsupportedInstruction(op);
          primitive('UNTUPLE', [value.type], types, `${n} UNTUPLE`, '_' + n);
        } else {
          if (!types[n]) throw new UnsupportedInstruction(op);
          primitive('INDEX', [value.type], [types[n]], `${n} INDEX`, '_' + n);
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
        ['LDU', 'LDI', 'PLDU', 'PLDI', 'STU', 'STI', 'LDSLICE', 'PLDSLICE', 'PLDREFIDX'].includes(
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
          store ? ['int', 'builder'] : ['slice'],
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
    const kind = [...kinds][0] ?? (exits.some((v) => v[i].type === 'null') ? 'cell' : 'int');
    for (const values of exits) {
      requireType(values[i], kind);
      if (values[i].type === 'null') values[i] = { ...values[i], type: kind };
    }
  }
  args.forEach((a, i) => {
    if (a.type === 'unknown') a.type = `X${i}`;
  });
  return {
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

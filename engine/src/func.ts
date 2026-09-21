import { type Program, type Instruction, formatAsm, walk, instruction } from './asm.js';
import {
  analyze,
  tupleTypes,
  statement,
  expr,
  methodName,
  type Expr,
  type Statement,
  type Primitive,
  type StackIR,
} from './ir.js';
import { UnsupportedInstruction } from './errors.js';
export interface FunctionAst {
  id: number;
  name: string;
  args: Array<[string, string]>;
  returns: Expr[];
  statements: Statement[];
  assembly?: string[];
  diagnostic?: string;
  helper?: boolean;
}
export interface Module {
  functions: FunctionAst[];
  primitives: Primitive[];
  diagnostics: string[];
  unsupported: string[];
}
export function checkDispatcher(program: Program): void {
  const ops = program.instructions.map((i) => i.opcode).join(',');
  if (
    ![
      'SETCP,DICTPUSHCONST,DICTIGETJMPZ,THROWARG',
      'SETCP0,DICTPUSHCONST,DICTIGETJMPZ,THROWARG',
    ].includes(ops) ||
    (program.instructions[0].opcode === 'SETCP' &&
      program.instructions[0].operands.join() !== '0') ||
    program.instructions[1].operands[0] !== '19' ||
    program.instructions[3].operands.join() !== '11'
  )
    throw new UnsupportedInstruction('dispatcher', 'Nonstandard entry dispatcher');
}
export function fallbackCells(program: Program, cells: Map<number, Buffer>): Module {
  checkDispatcher(program);
  if (cells.size !== program.methods.size || [...cells.keys()].some((k) => !program.methods.has(k)))
    throw new UnsupportedInstruction('dictionary', 'Method set differs from disassembly');
  return {
    functions: [...cells]
      .sort(([a], [b]) => a - b)
      .map(([id, boc]) => ({
        id,
        name: methodName(id),
        args: [],
        returns: [],
        statements: [],
        assembly: [`B{${boc.toString('hex')}} B>boc <s s,`],
        diagnostic: 'Opaque TVM method; bytecode preserved, high-level semantics not recovered.',
      })),
    primitives: [],
    diagnostics: [],
    unsupported: [],
  };
}
export function reconstruct(program: Program, cells?: Map<number, Buffer>): Module {
  checkDispatcher(program);
  const stableDispatcher = ![...program.methods.values()]
    .flatMap((code) => [...walk(code)])
    .some(
      (i) =>
        (i.opcode !== 'PUSH' && i.operands.includes('c3')) ||
        /^(SETCONT|POPCTR|CALLCC|BLESS|TRY)/.test(i.opcode) ||
        (i.opcode === 'POP' && i.operands.some((r) => ['c0', 'c1', 'c2'].includes(r))),
    );
  const helperCode = new Map<number, Instruction[]>(),
    helperBodies = new Map<string, number>();
  let nextHelper = Math.max(0, ...program.methods.keys()) + 1;
  function staticCalls(code: Instruction[]): Instruction[] {
    const result: Instruction[] = [];
    for (let n = 0; n < code.length; n++) {
      const i = code[n];
      if (
        stableDispatcher &&
        i.opcode === 'PUSHINT' &&
        code[n + 1]?.opcode === 'PUSH' &&
        code[n + 1].operands[0] === 'c3' &&
        code[n + 2]?.opcode === 'EXECUTE' &&
        Number(i.operands[0]) > 0
      ) {
        result.push(instruction('CALLDICT', i.operands));
        n += 2;
      } else {
        const block =
          i.blocks.length === 1 &&
          (i.opcode === 'CALL' || (i.opcode === 'PUSHCONT' && code[n + 1]?.opcode === 'EXECUTE'))
            ? i.blocks[0]
            : undefined;
        // c1 scoped to a CALL cannot be represented as the caller's return.
        // Keep such continuations as typed private inline_ref functions.
        if (
          block &&
          (block[0]?.opcode === 'SAMEALTSAVE' ||
            (block[0]?.opcode === 'SAVECTR' && block[1]?.opcode === 'SAMEALTSAVE'))
        ) {
          const nested = staticCalls(block),
            key = JSON.stringify(nested);
          let id = helperBodies.get(key);
          if (id === undefined) {
            id = nextHelper++;
            helperBodies.set(key, id);
            helperCode.set(id, nested);
          }
          result.push(instruction('CALLDICT', [String(id)]));
          if (i.opcode === 'PUSHCONT') n++;
        } else result.push({ ...i, blocks: i.blocks.map(staticCalls) });
      }
    }
    return result;
  }
  const methods = new Map([...program.methods].map(([id, code]) => [id, staticCalls(code)]));
  for (const [id, code] of helperCode) methods.set(id, code);
  const irs = new Map<number, StackIR>(),
    globalTypes = new Map<number, string>(),
    failures = new Map<number, UnsupportedInstruction>(),
    active = new Set<number>();
  const fallback = cells
    ? new Map(fallbackCells(program, cells).functions.map((f) => [f.id, f]))
    : undefined;
  function lift(id: number): StackIR {
    if (irs.has(id)) return irs.get(id)!;
    if (failures.has(id)) throw failures.get(id)!;
    if (active.has(id)) throw new UnsupportedInstruction('CALLDICT', 'Recursive method signature');
    const code = methods.get(id);
    if (!code) throw new UnsupportedInstruction('CALLDICT', `Missing method ${id}`);
    active.add(id);
    try {
      const hints =
        id === 0
          ? ['int', 'int', 'cell', 'slice']
          : id === -1
            ? ['slice']
            : id === -2
              ? ['int', 'int']
              : undefined;
      // Resolve calls at their instruction position, after preceding SETGLOBs
      // have established types used by the callee (as in the Python engine).
      const result = analyze(code, { methods: lift, hints, globalTypes });
      // FunC assigns IDs to private functions starting at 1. For contracts
      // exporting those IDs, inline helper IR rather than creating collisions.
      if (
        helperCode.has(id) &&
        [...program.methods.keys()].some((key) => key > 0 && key <= helperCode.size)
      ) {
        const hasReturn = (body: Statement[]): boolean =>
          body.some((s) => s.kind === 'return' || hasReturn(s.then) || hasReturn(s.otherwise));
        const loopReturn = (body: Statement[]): boolean =>
          body.some(
            (s) =>
              (['while', 'until', 'repeat'].includes(s.kind) && hasReturn(s.then)) ||
              loopReturn(s.then) ||
              loopReturn(s.otherwise),
          );
        if (hasReturn(result.statements) && !loopReturn(result.statements)) {
          const values = [
            ...allValues(result.statements),
            ...result.returns.flatMap((v) => [...expressions(v)]),
          ];
          let next =
            1 +
            Math.max(
              -1,
              ...values.filter((v) => v.op === 'local').map((v) => Number(v.value.slice(1))),
            );
          const targets = result.returns.map((v) => expr('local', `v${next++}`, v.type));
          const product = (vs: Expr[]) => (vs.length === 1 ? vs[0] : expr('product', '', '()', vs));
          let count = 0;
          const lower = (body: Statement[]): Statement[] => {
            const out: Statement[] = [];
            for (let i = 0; i < body.length; i++) {
              if (++count > 256)
                throw new UnsupportedInstruction(
                  'CALL',
                  'Early-return inlining exceeds 256 statements',
                );
              const s = body[i];
              if (s.kind === 'return') {
                if (targets.length)
                  out.push(statement('set', [product(targets), product(s.values)]));
                break;
              }
              if (s.kind === 'if' && hasReturn([s])) {
                const tail = body.slice(i + 1);
                out.push({
                  ...s,
                  then: lower([...s.then, ...tail]),
                  otherwise: lower([...s.otherwise, ...tail]),
                });
                break;
              }
              out.push(s);
            }
            return out;
          };
          result.statements = [
            ...targets.map((t) => statement('declare', [t])),
            ...lower([...result.statements, statement('return', result.returns)]),
          ];
          result.returns = targets;
        }
        result.inlineBody = !hasReturn(result.statements);
      }
      if (id === 0 || id === -1) result.returns = [];
      irs.set(id, result);
      return result;
    } catch (e) {
      if (!(e instanceof UnsupportedInstruction)) throw e;
      failures.set(id, e);
      throw e;
    } finally {
      active.delete(id);
    }
  }
  const functions: FunctionAst[] = [],
    primitives = new Map<string, Primitive>(),
    diagnostics: string[] = [],
    unsupported: string[] = [];
  for (const [id] of [...program.methods].sort(([a], [b]) => a - b)) {
    try {
      const ir = lift(id);
      ir.primitives.forEach((p) => primitives.set(p.name, p));
      functions.push({
        id,
        name: methodName(id),
        args: ir.argumentTypes.map((t, i) => [t, `arg${i}`]),
        returns: ir.returns,
        statements: ir.statements,
      });
    } catch (e) {
      if (!(e instanceof UnsupportedInstruction) || !fallback) throw e;
      diagnostics.push(`Method ${id}: ${e.message}`);
      unsupported.push(e.opcode);
      functions.push({ ...fallback.get(id)!, diagnostic: e.message });
    }
  }
  // Only emit helpers actually reached by successfully analyzed methods.
  for (const [id, ir] of irs) {
    if (!helperCode.has(id) || ir.inlineBody) continue;
    ir.primitives.forEach((p) => primitives.set(p.name, p));
    functions.unshift({
      id,
      name: methodName(id),
      args: ir.argumentTypes.map((t, i) => [t, `arg${i}`]),
      returns: ir.returns,
      statements: ir.statements,
      helper: true,
    });
  }
  // FunC must see inline_ref bodies before their callers. Forward references
  // can otherwise be optimized away, particularly effectful () helpers.
  const order = new Map([...irs.keys()].map((id, index) => [id, index]));
  functions.sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity));
  return {
    functions,
    primitives: [...primitives.values()],
    diagnostics,
    unsupported: [...new Set(unsupported)].sort(),
  };
}
const names: Record<string, string> = {
  tvm_skipdict: 'skip_dict',
  tvm_sbitrefs: 'slice_bits_refs',
  tvm_sdeq: 'equal_slice_bits',
  tvm_rawreserve: 'raw_reserve',
  tvm_setcode: 'set_code',
  tvm_getprecompiledgas: 'get_precompiled_gas_consumption',
  tvm_storagefees: 'get_storage_fees',
  tvm_duepayment: 'get_due_payment',
  tvm_gasconsumed: 'gas_consumed',
  tvm_getgasfee: 'get_gas_fee',
  tvm_getgasfeesimple: 'get_gas_fee_simple',
  tvm_getoriginalfwdfee: 'get_original_fwd_fee',
  tvm_getforwardfee: 'get_forward_fee_raw',
  tvm_getforwardfeesimple: 'get_forward_fee_simple_raw',
  tvm_getstoragefee: 'get_storage_fee_raw',
  tvm_ldslicex: 'load_bits_raw',
  tvm_chksignu: 'check_signature',
  tvm_stslicer: 'store_slice',
  tvm_stbr: 'store_builder',
  tvm_dictget: 'dict_get_raw',
  tvm_dictremmin: 'dict_remove_min_raw',
  tvm_getdata: 'get_data',
  tvm_setdata: 'set_data',
  tvm_ctos: 'begin_parse',
  tvm_newc: 'begin_cell',
  tvm_endc: 'end_cell',
  tvm_now: 'now',
  tvm_ltime: 'cur_lt',
  tvm_blocklt: 'block_lt',
  tvm_myaddr: 'my_address',
  tvm_balance: 'get_balance',
  tvm_hashcu: 'cell_hash',
  tvm_hashsu: 'slice_hash',
  tvm_sendrawmsg: 'send_raw_message',
  tvm_accept: 'accept_message',
  tvm_commit: 'commit',
  tvm_stgrams: 'store_coins',
  tvm_ldgrams: 'load_coins_raw',
  tvm_ldmsgaddr: 'load_msg_addr_raw',
  tvm_ldref: 'load_ref_raw',
  tvm_stref: 'store_ref_raw',
  tvm_stdict: 'store_dict_raw',
  tvm_lddict: 'load_dict_raw',
  tvm_sbits: 'slice_bits',
  tvm_srefs: 'slice_refs',
  tvm_sempty: 'slice_empty?',
  tvm_sdempty: 'slice_data_empty?',
  tvm_sdskipfirst: 'skip_bits',
  tvm_rewritestdaddr: 'parse_std_addr',
  tvm_isnull: 'is_null',
};
export function primitiveName(name: string): string {
  if (names[name]) return names[name];
  const global = /^tvm_(getglob|setglob|is_global_null)_(\d+)$/.exec(name);
  if (global) {
    const prefix = {
      getglob: 'get_global',
      setglob: 'set_global',
      is_global_null: 'is_global_null',
    };
    return prefix[global[1] as keyof typeof prefix] + '_' + global[2];
  }
  const m = /^tvm_(ldu|ldi|pldu|pldi|stu|sti)_(\d+)$/.exec(name);
  return m
    ? {
        ldu: 'load_uint',
        ldi: 'load_int',
        pldu: 'preload_uint',
        pldi: 'preload_int',
        stu: 'store_uint',
        sti: 'store_int',
      }[m[1]] + `_${m[2]}_raw`
    : name;
}
function builderMethod(name: string): string {
  const m = /^tvm_st([ui])_\d+$/.exec(name);
  return m ? (m[1] === 'u' ? 'store_uint' : 'store_int') : primitiveName(name).replace(/_raw$/, '');
}
export function expression(e: Expr): string {
  if (['arg', 'local', 'literal'].includes(e.op)) {
    if (e.op === 'literal' && /^\d+$/.test(e.value)) {
      const n = BigInt(e.value);
      if (n > 2n ** 29n && !(n >= 1546300800n && n <= 1893456000n)) return '0x' + n.toString(16);
    }
    return e.value;
  }
  const args = e.args.map(expression);
  if (e.op === 'modify')
    return `${args[0]}~${primitiveName(e.value).replace(/_raw$/, '')}(${args.slice(1).join(', ')})`;
  if (e.op === 'chain') return `${args[0]}.${builderMethod(e.value)}(${args.slice(1).join(', ')})`;
  if (e.op === 'binary') return `(${args[0]} ${e.value} ${args[1]})`;
  if (e.op === 'unary') return `(${e.value} ${args[0]})`;
  if (e.op === 'call') return `${primitiveName(e.value)}(${args.join(', ')})`;
  if (e.op === 'tuple') return `[${args.join(', ')}]`;
  if (e.op === 'product') return `(${args.join(', ')})`;
  if (e.op === 'select') return `(${args[0]} ? ${args[1]} : ${args[2]})`;
  throw new UnsupportedInstruction(e.op, 'Unprintable expression');
}
function formattedExpression(e: Expr, indent: number): string {
  if (e.op === 'chain')
    return (
      formattedExpression(e.args[0], indent) +
      '\n' +
      ' '.repeat(indent + 4) +
      '.' +
      builderMethod(e.value) +
      '(' +
      e.args.slice(1).map(expression).join(', ') +
      ')'
    );
  if (e.op === 'call' && e.args.some((a) => a.op === 'chain'))
    return (
      primitiveName(e.value) +
      '(\n' +
      e.args.map((a) => ' '.repeat(indent + 4) + formattedExpression(a, indent + 4)).join(',\n') +
      '\n' +
      ' '.repeat(indent) +
      ')'
    );
  return expression(e);
}
function statements(body: Statement[], level = 2): string[] {
  const pad = ' '.repeat(level),
    out: string[] = [];
  for (const s of body) {
    const v = s.values.map((e) => formattedExpression(e, level));
    if (s.kind === 'assign') out.push(`${pad}var ${v[0]} = ${v[1]};`);
    else if (s.kind === 'declare')
      out.push(
        `${pad}${sourceType(s.values[0].type)} ${v[0]} = ${s.values[0].type === 'int' ? '0' : 'null()'};`,
      );
    else if (s.kind === 'set') out.push(`${pad}${v[0]} = ${v[1]};`);
    else if (s.kind === 'call') out.push(`${pad}${v[0]};`);
    else if (s.kind === 'return') out.push(`${pad}return (${v.join(', ')});`);
    else if (['throw', 'throwif', 'throwifnot'].includes(s.kind))
      out.push(
        `${pad}${{ throw: 'throw', throwif: 'throw_if', throwifnot: 'throw_unless' }[s.kind]}(${v.join(', ')});`,
      );
    else if (['if', 'repeat', 'while'].includes(s.kind)) {
      out.push(
        `${pad}${s.kind} (${s.values[0].op === 'binary' ? v[0].slice(1, -1) : v[0]}) {`,
        ...statements(s.then, level + 2),
        pad + '}',
      );
      if (s.otherwise.length) {
        out[out.length - 1] += ' else {';
        out.push(...statements(s.otherwise, level + 2), pad + '}');
      }
    } else if (s.kind === 'until')
      out.push(pad + 'do {', ...statements(s.then, level + 2), `${pad}} until (${v[0]});`);
    else throw new UnsupportedInstruction(s.kind, 'Unprintable statement');
  }
  return out;
}
function* expressions(e: Expr): Generator<Expr> {
  yield e;
  for (const a of e.args) yield* expressions(a);
}
function* allValues(body: Statement[]): Generator<Expr> {
  for (const s of body) {
    for (const v of s.values) yield* expressions(v);
    yield* allValues(s.then);
    yield* allValues(s.otherwise);
  }
}
const sourceType = (type: string): string =>
  type.startsWith('list_') || type.startsWith('vector_')
    ? 'tuple'
    : type.startsWith('[')
      ? '[' + tupleTypes(type).map(sourceType).join(', ') + ']'
      : type;
const signature = (types: string[]) =>
  types.length === 1 ? sourceType(types[0]) : `(${types.map(sourceType).join(', ')})`;
function hasNullDeclaration(body: Statement[]): boolean {
  return body.some(
    (s) =>
      (s.kind === 'declare' && s.values[0].type !== 'int') ||
      hasNullDeclaration(s.then) ||
      hasNullDeclaration(s.otherwise),
  );
}
export function renderParts(
  module: Module,
  display?: Program,
): { contract: string; stdlib: string } {
  const values = module.functions.flatMap((f) => [
    ...f.returns.flatMap((e) => [...expressions(e)]),
    ...allValues(f.statements),
  ]);
  const calls = new Set(values.filter((e) => e.op === 'call').map((e) => e.value));
  const modifying = new Set(values.filter((e) => e.op === 'modify').map((e) => e.value));
  const chained = new Set(values.filter((e) => e.op === 'chain').map((e) => e.value));
  const helpers: string[] = [];
  const chainNames = new Set<string>();
  if (
    values.some((e) => e.value === 'null()') ||
    module.functions.some((f) => hasNullDeclaration(f.statements))
  )
    helpers.push('forall X -> X null() asm "PUSHNULL";');
  for (const p of module.primitives) {
    const generic = [...new Set([...p.inputs, ...p.outputs].filter((t) => /^X\d*$/.test(t)))];
    const prefix = generic.length ? 'forall ' + generic.join(', ') + ' -> ' : '';
    const args = p.inputs.map((t, i) => `${sourceType(t)} arg${i}`).join(', ');
    const width = /^tvm_st([ui])_\d+$/.test(p.name);
    if (
      calls.has(p.name) ||
      (chained.has(p.name) && !width && !['tvm_stref', 'tvm_stdict'].includes(p.name))
    ) {
      helpers.push(
        `${prefix}${signature(p.outputs)} ${primitiveName(p.name)}(${args}) impure asm ${JSON.stringify(p.assembly)};`,
      );
    }
    if (chained.has(p.name)) {
      const name = builderMethod(p.name);
      if (!chainNames.has(name)) {
        // store_uint/store_int are built into FunC; redeclaring them is invalid.
        if (['tvm_stref', 'tvm_stdict'].includes(p.name))
          helpers.push(
            `builder ${name}(builder b, cell value) impure asm(value b) ${JSON.stringify(p.assembly)};`,
          );
        chainNames.add(name);
      }
    }
    if (modifying.has(p.name)) {
      const skip = p.name === 'tvm_sdskipfirst',
        outputs = skip ? ['slice', '()'] : [...p.outputs].reverse();
      helpers.push(
        `${signature(outputs)} ${skip ? '~' : ''}${primitiveName(p.name).replace(/_raw$/, '')}(${args}) impure asm${skip ? '' : '( -> 1 0)'} ${JSON.stringify(p.assembly)};`,
      );
    }
  }
  const lines: string[] = [];
  for (const f of module.functions) {
    const args = f.args.map(([t, n]) => `${sourceType(t)} ${n}`).join(', '),
      result = signature(f.returns.map((e) => (e.type === 'null' ? 'cell' : e.type)));
    const vars = [...new Set(f.args.map(([t]) => t).filter((t) => /^X\d*$/.test(t)))],
      prefix = vars.length ? 'forall ' + vars.join(', ') + ' -> ' : '';
    const attributes =
      ' impure' +
      (f.helper ? ' inline_ref' : [0, -1, -2].includes(f.id) ? '' : ` method_id(${f.id})`);
    if (f.assembly && display) {
      lines.push(
        `${f.name}(${args})${attributes} fift {`,
        formatAsm(display.methods.get(f.id) ?? [], '  '),
        '}',
        '',
      );
      continue;
    }
    if (f.diagnostic) lines.push(';; ' + f.diagnostic.replace(/[\r\n]/g, ' '));
    if (f.assembly) {
      lines.push(
        `${prefix}${result} asm_${f.name}(${args}) impure asm ${f.assembly.map((x) => JSON.stringify(x)).join(' ') || '""'};`,
        `${prefix}${result} ${f.name}(${args})${attributes} {`,
        `  return asm_${f.name}(${f.args.map(([, n]) => n).join(', ')});`,
        '}',
        '',
      );
    } else {
      lines.push(
        `${prefix}${result} ${f.name}(${args})${attributes} {`,
        ...statements(f.statements),
        `  return ${f.returns.length === 1 ? formattedExpression(f.returns[0], 2) : '(' + f.returns.map(expression).join(', ') + ')'};`,
        '}',
        '',
      );
    }
  }
  return { contract: lines.join('\n'), stdlib: helpers.join('\n') + (helpers.length ? '\n' : '') };
}
export function render(module: Module): string {
  const p = renderParts(module);
  return p.stdlib + '\n' + p.contract;
}
export { readableModule } from './readability.js';

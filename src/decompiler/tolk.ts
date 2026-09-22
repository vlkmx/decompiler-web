/** Tolk output from stack IR, never from rendered FunC text. */
import type { Module } from './func';
import { type Expr, type Statement, tupleTypes } from './ir';
import { formatAsm, type Program } from './asm';

function typeName(type: string): string {
  if (type === '()') return 'void';
  if (type === 'null') return 'null';
  if (type === 'unknown' || type === 'cont') return 'unknown';
  if (type.startsWith('[')) return `[${tupleTypes(type).map(typeName).join(', ')}]`;
  if (/^(vector_|list_)/.test(type)) return 'tuple';
  return type;
}
const functionName = (name: string) => ({ recv_internal: 'onInternalMessage', recv_external: 'onExternalMessage', run_ticktock: 'onRunTickTock' })[name] ?? name;
const signature = (types: string[]) => types.length === 0 ? 'void'
  : types.length === 1 ? typeName(types[0]) : `(${types.map(typeName).join(', ')})`;

function expression(e: Expr): string {
  const args = e.args.map(expression);
  if (['arg', 'local', 'literal'].includes(e.op)) return e.value === 'null()'
    ? e.type === 'null' ? 'decompiler_initial()' : `decompiler_initial<${typeName(e.type)}>()` : e.value;
  if (e.op === 'call') return `${functionName(e.value)}(${args.join(', ')})`;
  if (e.op === 'binary') {
    const value = `(${args[0]} ${e.value} ${args[1]})`;
    // TVM comparisons return -1/0; Tolk comparisons return bool. Preserve integers.
    return ['==', '!=', '<', '>', '<=', '>='].includes(e.value) ? `(${value} ? -1 : 0)` : value;
  }
  if (e.op === 'unary') return `(${e.value}${args[0]})`;
  if (e.op === 'tuple') return `([${args.join(', ')}] as ${typeName(e.type)})`;
  if (e.op === 'product') return `(${args.join(', ')})`;
  if (e.op === 'select') return `((${args[0]} != 0) ? ${args[1]} : ${args[2]})`;
  throw new Error(`Unsupported Tolk expression: ${e.op}`);
}
function statements(body: Statement[], level = 4, genericCalls = new Set<string>()): string[] {
  const pad = ' '.repeat(level), out: string[] = [];
  for (const s of body) {
    const v = s.values.map(expression);
    if (s.kind === 'assign') {
      // Exported methods use one-slot unknown for their generic TVM slots.
      // The IR has already instantiated these slots at this particular call.
      const target = s.values[0];
      const types = (target.op === 'product' ? target.args : [target]).map(e => e.type);
      const rhs = s.values[1];
      const value = rhs.op === 'call' && genericCalls.has(rhs.value)
        ? `(${v[1]} as ${signature(types)})` : v[1];
      out.push(`${pad}var ${v[0]} = ${value};`);
    }
    else if (s.kind === 'declare') out.push(`${pad}var ${v[0]}: ${typeName(s.values[0].type)} = ${s.values[0].type === 'int' ? '0' : `decompiler_initial<${typeName(s.values[0].type)}>()`};`);
    else if (s.kind === 'set') out.push(`${pad}${v[0]} = ${v[1]};`);
    else if (s.kind === 'call') out.push(`${pad}${v[0]};`);
    else if (s.kind === 'return') out.push(`${pad}return${v.length ? ' ' + (v.length === 1 ? v[0] : `(${v.join(', ')})`) : ''};`);
    else if (s.kind === 'try') {
      const arg = s.values[0];
      const binding = arg.type === 'unknown' ? v[0] : `${v[0]}_raw`;
      out.push(`${pad}try {`, ...statements(s.then, level + 4, genericCalls),
        `${pad}} catch (${v[1]}, ${binding}) {`);
      if (arg.type !== 'unknown') out.push(`${pad}    var ${v[0]} = ${binding} as ${typeName(arg.type)};`);
      out.push(...statements(s.otherwise, level + 4, genericCalls), `${pad}}`);
    }
    else if (s.kind === 'throw') out.push(`${pad}throw ${v[0]};`);
    else if (s.kind === 'throwif' || s.kind === 'throwifnot')
      out.push(`${pad}if (${v[1]} ${s.kind === 'throwif' ? '!=' : '=='} 0) { throw ${v[0]}; }`);
    else if (['if', 'repeat', 'while'].includes(s.kind)) {
      out.push(`${pad}${s.kind} (${v[0]}${s.kind === 'repeat' ? '' : ' != 0'}) {`,
        ...statements(s.then, level + 4, genericCalls), `${pad}}`);
      if (s.otherwise.length) {
        out[out.length - 1] += ' else {';
        out.push(...statements(s.otherwise, level + 4, genericCalls), `${pad}}`);
      }
    } else if (s.kind === 'until') out.push(`${pad}do {`, ...statements(s.then, level + 4, genericCalls), `${pad}} while (${v[0]} == 0);`);
    else throw new Error(`Unsupported Tolk statement: ${s.kind}`);
  }
  return out;
}
function terminates(body: Statement[]): boolean {
  const last = body.at(-1);
  return !!last && (['return', 'throw'].includes(last.kind) ||
    (last.kind === 'while' && last.values[0]?.op === 'literal' && BigInt(last.values[0].value) !== 0n) ||
    (['if', 'try'].includes(last.kind) && terminates(last.then) && terminates(last.otherwise)));
}
function generics(types: string[]): string {
  const names = [...new Set(types.flatMap(t => t.match(/\bX\d*\b/g) ?? []))];
  return names.length ? `<${names.join(', ')}>` : '';
}
const comment = (text: string) => text.split('\n').map(line => `// ${line}`).join('\n');

export function renderTolk(module: Module, program: Program) {
  const genericCalls = new Set(module.functions.filter(f => !f.helper && !f.assembly &&
    f.returns.some(e => /\bX\d*\b/.test(e.type))).map(f => f.name));
  const lines = [
    '// Tolk reconstruction from TVM bytecode. Compilation and equivalence are unverified.',
    '// Original names, structs and source language cannot be recovered reliably.',
    '// Low-level method IDs and TVM stack order are retained.', '',
  ];
  const primitives = new Map(module.primitives.map(p => [p.name, p]));
  for (const original of module.functions) {
    // Apply exported-slot erasure to local declarations as well as signatures.
    const erase = (e: Expr): Expr => ({ ...e,
      type: original.helper ? e.type : e.type.replace(/\bX\d*\b/g, 'unknown'),
      args: e.args.map(erase),
    });
    const eraseStatement = (s: Statement): Statement => ({ ...s,
      values: s.values.map(erase), then: s.then.map(eraseStatement), otherwise: s.otherwise.map(eraseStatement),
    });
    const f = { ...original, statements: original.statements.map(eraseStatement),
      returns: original.returns.map(erase) };
    lines.push(`// TVM method ${f.id}${f.helper ? ' (extracted continuation)' : ''}`);
    if (f.assembly) {
      lines.push(comment(`UNRESOLVED: ${f.diagnostic ?? 'Unknown stack signature'}`));
      if (f.partial) {
        for (const p of f.partial.primitives) primitives.set(p.name, p);
        // Keep partial code commented: its input and return signature is not known.
        lines.push(comment('Recovered prefix (not a complete function):'),
          ...statements(f.partial.statements).map(line => `// ${line}`),
          comment(`Stack at boundary: ${f.partial.stack.map(expression).join(', ')}`));
      }
      lines.push(comment('TVM assembly:'), comment(formatAsm(program.methods.get(f.id) ?? [])),
        comment(`Preserved method cell (Fift): ${f.assembly.join(' ')}`), '');
      continue;
    }
    if (!f.helper && ![0, -1, -2].includes(f.id)) lines.push(`@method_id(${f.id})`);
    // Exported TVM methods cannot be generic. An unconstrained stack slot
    // has the one-slot Tolk unknown type; private helpers may stay generic.
    const methodType = (t: string) => f.helper ? t : t.replace(/\bX\d*\b/g, 'unknown');
    const types = [...f.args.map(([t]) => methodType(t)), ...f.returns.map(e => methodType(e.type))];
    lines.push(`fun ${functionName(f.name)}${generics(types)}(${f.args.map(([t, n]) => `${n}: ${typeName(methodType(t))}`).join(', ')}): ${signature(f.returns.map(e => methodType(e.type)))} {`,
      ...statements(f.statements, 4, genericCalls));
    if (!terminates(f.statements)) {
      const values = f.returns.map(expression);
      lines.push(`    return${values.length ? ' ' + (values.length === 1 ? values[0] : `(${values.join(', ')})`) : ''};`);
    }
    if (f.statements.at(-1)?.kind === 'while' && terminates(f.statements))
      lines.push('    // Unreachable after the unconditional TVM loop.', '    throw 0;');
    lines.push('}', '');
  }
  const helpers = [...primitives.values()].map(p =>
    `fun ${p.name}${generics([...p.inputs, ...p.outputs])}(${p.inputs.map((t, i) => `arg${i}: ${typeName(t)}`).join(', ')}): ${signature(p.outputs)}\n    asm ${JSON.stringify(p.assembly)};`,
  );
  if (lines.some(line => line.includes('decompiler_initial'))) helpers.unshift('fun decompiler_initial<T>(): T asm \"PUSHNULL\";');
  const contract = lines.join('\n'), stdlib = helpers.join('\n\n') + '\n';
  return { contract, stdlib, source: stdlib + '\n' + contract };
}

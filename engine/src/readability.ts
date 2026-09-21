import { expr, statement, type Expr, type Statement, type Primitive } from './ir.js';
import type { Module } from './func.js';

function* expressions(value: Expr): Generator<Expr> {
  yield value;
  for (const arg of value.args) yield* expressions(arg);
}
function mapExpr(value: Expr, fn: (value: Expr) => Expr): Expr {
  return fn({ ...value, args: value.args.map((arg) => mapExpr(arg, fn)) });
}
function mapStatement(value: Statement, fn: (value: Expr) => Expr): Statement {
  return {
    ...value,
    values: value.values.map((v) => mapExpr(v, fn)),
    then: value.then.map((s) => mapStatement(s, fn)),
    otherwise: value.otherwise.map((s) => mapStatement(s, fn)),
  };
}
function uses(body: Statement[]) {
  const reads = new Map<string, number>(),
    writes = new Map<string, number>();
  const add = (map: Map<string, number>, v: Expr) => {
    for (const e of expressions(v))
      if (e.op === 'arg' || e.op === 'local') map.set(e.value, (map.get(e.value) ?? 0) + 1);
  };
  const count = (body: Statement[]) => {
    for (const s of body) {
      let values = s.values;
      if (['assign', 'set', 'declare'].includes(s.kind)) {
        add(writes, values[0]);
        values = values.slice(1);
      }
      values.forEach((v) => add(reads, v));
      count(s.then);
      count(s.otherwise);
    }
  };
  count(body);
  return { reads, writes };
}
const mentions = (value: Expr, name: string) =>
  [...expressions(value)].some((e) => e.op === 'local' && e.value === name);
function simplify(body: Statement[]): Statement[] {
  const { reads, writes } = uses(body);
  const pure = (v: Expr): boolean =>
    v.op === 'literal' ||
    ((v.op === 'local' || v.op === 'arg') &&
      (writes.get(v.value) ?? 0) === (v.op === 'local' ? 1 : 0));
  function firstEffect(v: Expr, name: string): boolean {
    if (v.op === 'select') return firstEffect(v.args[0], name);
    if (v.op === 'local' && v.value === name) return true;
    for (const arg of v.args) {
      if (mentions(arg, name)) return firstEffect(arg, name);
      if (!pure(arg)) return false;
    }
    return false;
  }
  function visit(input: Statement[]): Statement[] {
    const body = [...input],
      out: Statement[] = [];
    for (let index = 0; index < body.length; index++) {
      const s = body[index];
      if (s.kind === 'set' && JSON.stringify(s.values[0]) === JSON.stringify(s.values[1])) continue;
      if (s.kind === 'assign' && s.values[0].op === 'local') {
        const target = s.values[0],
          name = target.value;
        let value = s.values[1];
        if (value.op === 'call' && value.value === 'impure_touch' && value.args.length === 1)
          value = value.args[0];
        value = { ...value, type: target.type };
        if (writes.get(name) === 1) {
          if (!reads.get(name) && pure(value)) continue;
          if (reads.get(name) === 1) {
            const substitute = (v: Expr) => (v.op === 'local' && v.value === name ? value : v);
            if (pure(value)) {
              for (let n = index + 1; n < body.length; n++)
                body[n] = mapStatement(body[n], substitute);
              continue;
            }
            const next = body[index + 1];
            if (
              next &&
              [
                'assign',
                'set',
                'call',
                'return',
                'if',
                'repeat',
                'throw',
                'throwif',
                'throwifnot',
              ].includes(next.kind)
            ) {
              const values = ['assign', 'set'].includes(next.kind)
                ? next.values.slice(1)
                : next.values;
              let inline = false;
              for (let n = 0; n < values.length; n++)
                if (mentions(values[n], name)) {
                  inline = values.slice(0, n).every(pure) && firstEffect(values[n], name);
                  break;
                }
              if (inline) {
                body[index + 1] = mapStatement(next, substitute);
                continue;
              }
            }
          }
        }
      }
      out.push({ ...s, then: visit(s.then), otherwise: visit(s.otherwise) });
    }
    return out;
  }
  return visit(body);
}
function builderChains(value: Expr): Expr {
  if (value.op !== 'call') return value;
  const width = /^tvm_st([ui])_(\d+)$/.exec(value.value);
  if (width || ['tvm_stref', 'tvm_stdict'].includes(value.value)) {
    if (value.args.length !== 2 || !['literal', 'arg', 'local'].includes(value.args[0].op))
      return value;
    return {
      ...value,
      op: 'chain',
      args: [value.args[1], value.args[0], ...(width ? [expr('literal', width[2])] : [])],
    };
  }
  if (['tvm_stslicer', 'tvm_stgrams', 'tvm_stbr', 'tvm_endc'].includes(value.value))
    return { ...value, op: 'chain' };
  return value;
}
export function readableModule(module: Module): Module {
  const result = structuredClone(module),
    primitives = new Map(result.primitives.map((p) => [p.name, p]));
  const loaders = new Set(
    result.primitives
      .filter(
        (p) =>
          ['tvm_ldmsgaddr', 'tvm_ldgrams', 'tvm_ldref', 'tvm_lddict'].includes(p.name) ||
          /^tvm_ld[ui]_\d+$/.test(p.name),
      )
      .map((p) => p.name),
  );
  for (const f of result.functions) {
    if (f.assembly) continue;
    let body = simplify([...f.statements, statement('return', f.returns)]);
    const { reads, writes } = uses(body);
    function rewrite(
      input: Statement[],
      inherited: Map<string, Expr>,
      inLoop = false,
    ): Statement[] {
      const aliases = new Map(inherited),
        out: Statement[] = [];
      const resolve = (v: Expr): Expr => {
        if ((v.op === 'arg' || v.op === 'local') && aliases.has(v.value))
          return aliases.get(v.value)!;
        return { ...v, args: v.args.map(resolve) };
      };
      for (const s of input) {
        if (s.kind === 'assign') {
          let [target, value] = s.values;
          const load = value.op === 'call' && loaders.has(value.value) && target.op === 'product';
          const skip =
            value.op === 'call' && value.value === 'tvm_sdskipfirst' && target.op === 'local';
          if (
            ((load && target.args.length === 2) || skip) &&
            [...expressions(target)]
              .filter((e) => e.op === 'local')
              .every((e) => writes.get(e.value) === 1)
          ) {
            const remainder = load ? target.args[1] : target;
            let source = value.args[0];
            const skips: Expr[] = [];
            while (source.op === 'call' && source.value === 'tvm_sdskipfirst') {
              skips.push(source);
              source = source.args[0];
            }
            let cursor: Expr;
            if (
              source.op === 'local' &&
              reads.get(source.value) === 1 &&
              writes.get(source.value) === 1 &&
              !inLoop
            )
              cursor = resolve(source);
            else {
              cursor = remainder;
              out.push(statement('assign', [cursor, resolve(source)]));
            }
            for (const skipped of skips.reverse())
              out.push(
                statement('call', [
                  expr('modify', skipped.value, '()', [
                    cursor,
                    ...skipped.args.slice(1).map(resolve),
                  ]),
                ]),
              );
            const call = expr('modify', value.value, load ? target.args[0].type : '()', [
              cursor,
              ...value.args.slice(1).map(resolve),
            ]);
            if (load && reads.get(target.args[0].value))
              out.push(statement('assign', [target.args[0], call]));
            else out.push(statement('call', [call]));
            aliases.set(remainder.value, cursor);
            continue;
          }
          target = mapExpr(target, (e) =>
            e.op === 'local' && !reads.get(e.value) && writes.get(e.value) === 1
              ? expr('literal', '_', e.type)
              : e,
          );
          value = resolve(value);
          if (
            [...expressions(target)].filter((e) => e.op !== 'product').every((e) => e.value === '_')
          ) {
            if (['literal', 'local', 'arg'].includes(value.op)) continue;
            if (value.op !== 'call') {
              primitives.set('impure_touch', {
                name: 'impure_touch',
                inputs: ['X'],
                outputs: ['X'],
                assembly: 'NOP',
              });
              value = expr('call', 'impure_touch', value.type, [value]);
            }
            out.push(statement('call', [value]));
          } else out.push({ ...s, values: [target, value] });
          continue;
        }
        out.push({
          ...s,
          values: s.values.map(resolve),
          then: rewrite(s.then, aliases, inLoop || ['while', 'repeat', 'until'].includes(s.kind)),
          otherwise: rewrite(s.otherwise, aliases, inLoop),
        });
      }
      return out;
    }
    body = rewrite(body, new Map());
    const names = new Map<string, string>();
    const rename = (v: Expr) => {
      if (v.op === 'local') {
        if (!names.has(v.value)) names.set(v.value, `v${names.size}`);
        return { ...v, value: names.get(v.value)! };
      }
      return v;
    };
    body = body.map((s) => mapStatement(s, rename));
    function chains(s: Statement): Statement {
      const values = s.values.map((v) => mapExpr(v, builderChains));
      // A discarded builder operation must retain its effectful helper.
      if (s.kind === 'call' && values[0]?.op === 'chain')
        values[0] = {
          ...values[0],
          op: 'call',
          args: s.values[0].args.map((v) => mapExpr(v, builderChains)),
        };
      return { ...s, values, then: s.then.map(chains), otherwise: s.otherwise.map(chains) };
    }
    body = body.map(chains);
    f.returns = body.pop()!.values;
    f.statements = body;
  }
  result.primitives = [...primitives.values()];
  return result;
}

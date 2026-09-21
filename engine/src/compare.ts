import { parseAsm, normalized, walk } from './asm.js';
import { parseBoc } from './boc.js';
function overlap(a: string[], b: string[]): number {
  if (!a.length && !b.length) return 1;
  const counts = new Map<string, number>();
  for (const v of a) counts.set(v, (counts.get(v) ?? 0) + 1);
  let common = 0;
  for (const v of b) {
    const n = counts.get(v) ?? 0;
    if (n) {
      common++;
      counts.set(v, n - 1);
    }
  }
  return (2 * common) / (a.length + b.length);
}
export function compare(original: string, candidate: string) {
  const left = parseAsm(original),
    right = parseAsm(candidate),
    norm = (code: typeof left.instructions) => JSON.stringify(code.map(normalized));
  const exact = norm(left.instructions) === norm(right.instructions);
  const a = [...walk(left.instructions)].map((i) => JSON.stringify(normalized(i))),
    b = [...walk(right.instructions)].map((i) => JSON.stringify(normalized(i)));
  const pairs = (x: string[]) => x.slice(1).map((v, i) => JSON.stringify([x[i], v]));
  return {
    normalized_asm_match: exact,
    instruction_match: exact ? 1 : (overlap(a, b) + overlap(pairs(a), pairs(b))) / 2,
    mismatching_methods: [...new Set([...left.methods.keys(), ...right.methods.keys()])]
      .sort((a, b) => a - b)
      .filter((k) => norm(left.methods.get(k) ?? []) !== norm(right.methods.get(k) ?? [])),
  };
}
export function compareCells(original: Uint8Array, candidate: Uint8Array): number {
  const a = parseBoc(original),
    b = parseBoc(candidate);
  if (a.codeHash === b.codeHash) return 1;
  const payload = (x: typeof a) =>
    x.cells.map((c) => JSON.stringify([c.bits, c.data.toString('hex'), c.refs.length]));
  const topology = (x: typeof a) =>
    x.cells.map((c) =>
      JSON.stringify([c.bits, c.depth, c.refs.map((r) => [x.cells[r].bits, x.cells[r].depth])]),
    );
  return (overlap(payload(a), payload(b)) + overlap(topology(a), topology(b))) / 2;
}

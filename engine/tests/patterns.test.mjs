import test from 'node:test';
import { readFileSync } from 'node:fs';
import { pair, equivalent, int, slice } from './vm.mjs';
const examples = JSON.parse(
  readFileSync(new URL('./fixtures/ported-patterns.json', import.meta.url), 'utf8'),
);
for (const e of examples) {
  test(`TVM parity: ${e.origin}`, async () => {
    const p = await pair(e.source);
    if (e.origin.endsWith('vectors70.py:33')) {
      for (let id = 100; id <= 104; id++) await equivalent(p, id, []);
    } else if (e.origin.endsWith('vectors70.py:66')) await equivalent(p, 105, [], [1, 1]);
    else if (e.origin.endsWith('patterns70.py:27')) {
      for (const n of [0, 1, 3]) await equivalent(p, 100, [slice('abcd'), int(n)], [16]);
    } else if (e.origin.endsWith('patterns70.py:44')) {
      for (const n of [0, 1, 9]) await equivalent(p, 100, [slice('ab'), slice('abcd'), int(n)]);
    } else {
      const id = e.origin.endsWith('vectors70.py:90')
        ? 106
        : e.origin.endsWith('vectors70.py:123')
          ? 107
          : 100;
      for (const n of [0, 1, 3, 5]) await equivalent(p, id, [int(n)]);
    }
  });
}

for (const op of [
  '3 MULRSHIFT#',
  '3 MULRSHIFTR#',
  '3 MULRSHIFTC#',
  '3 RSHIFTR#',
  '3 RSHIFTC#',
  '9 MODPOW2#',
  'DIVC',
  'DIVR',
]) {
  test(`TVM rounding and exception parity: ${op}`, async () => {
    const binary = op.includes('MUL') || op.startsWith('DIV');
    const p = await pair(
      `int op(int x${binary ? ', int y' : ''}) impure asm "${op}"; () recv_internal() { } int example(int x${binary ? ', int y' : ''}) impure method_id(100) { return op(x${binary ? ', y' : ''}); }`,
    );
    for (const x of [-17, -4, 0, 3, 4, 17, 1n << 255n]) {
      for (const y of binary ? [-3, 0, 3] : [0])
        await equivalent(p, 100, binary ? [int(x), int(y)] : [int(x)]);
    }
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { pair, equivalent, int } from './vm.mjs';

for (const op of ['IFJMP', 'IFNOTJMP']) {
  test(`${op} inside CALLREF returns to caller and executes its tail`, async () => {
    const p = await pair(
      `int helper(int x) impure asm "<{ DUP 0 EQINT ${op}:<{ DROP 7 PUSHINT }> 1 PUSHINT ADD }>c CALLREF"; ` +
        '() recv_internal() { } int example(int x) impure method_id(100) { return helper(x) + 10; }',
    );
    for (const x of [0, -1, 1, 9, (1n << 256n) - 1n]) await equivalent(p, 100, [int(x)]);
    await equivalent(p, 100, [int(op === 'IFJMP' ? 0 : 1)], [17]);
    assert.doesNotMatch(p.readable.contract, /asm_method/);
  });
}

test('nested continuation returns and static dispatcher calls', async () => {
  const nested = await pair(
    'int op(int x) impure asm "DUP IF:<{ DUP IFJMP:<{ }> }> INC"; () recv_internal() { } int example(int x) impure method_id(100) { return op(x); }',
  );
  for (const x of [-1, 0, 1, 20]) await equivalent(nested, 100, [int(x)], [x + 1]);
  const dispatcher = await pair(
    'int dispatch(int x) impure asm "101 PUSHINT" "c3 PUSH" "EXECUTE"; () recv_internal() { } int example(int x) impure method_id(100) { return dispatch(x); } int target(int x) method_id(101) { return x + 1; }',
  );
  for (const x of [-1, 0, 17]) await equivalent(dispatcher, 100, [int(x)], [x + 1]);
});

test('alternate-return helpers do not collide with explicit low method IDs', async () => {
  const p = await pair(
    'int helper(int x) impure asm "<{ c2 SAVECTR SAMEALTSAVE DUP IFNOTRETALT INC }>c CALLREF"; () recv_internal() { } int example(int x) impure method_id(1) { return helper(x) + 10; }',
  );
  for (const x of [0, 1, -1]) await equivalent(p, 1, [int(x)], [x === 0 ? 10 : x + 11]);
});

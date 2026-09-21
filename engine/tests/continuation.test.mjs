import test from 'node:test';
import assert from 'node:assert/strict';
import { pair, equivalent, int } from './vm.mjs';
import { readFileSync } from 'node:fs';
import { Cell } from '@ton/core';
import { Toolchain } from '../dist/toolchain.js';
import { methodCells } from '../dist/boc.js';
import { reconstructReadable } from '../dist/core.js';
import { runWorker } from '../dist/api.js';

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

test('PREPAREDICT passes its method ID inside the CALLXARGS argument count', async () => {
  const p = await pair(
    '() dispatch(int x) impure asm "101 PREPAREDICT" "2 0 CALLXARGS"; ' +
    '() recv_internal() { } () target(int x) impure method_id(101) { throw_unless(333, x > 0); } ' +
    'int example(int x) impure method_id(100) { dispatch(x); return 17; }',
  );
  for (const x of [-1, 0, 1, 100]) await equivalent(p, 100, [int(x)]);
  await equivalent(p, 100, [int(1)], [17]);
});

test('BLESS executes runtime-supplied code with a bounded signature', async () => {
  const p = await pair(
    '() invoke(int x, slice code) impure asm "BLESS" "1 0 CALLXARGS"; ' +
    '() recv_internal() { } int example(int x, slice code) impure method_id(100) { invoke(x, code); return 17; }',
  );
  const target = await new Toolchain().compile(
    '() recv_internal() { } () target(int x) impure method_id(101) { throw_unless(333, x > 0); }',
  );
  const code = { type: 'slice', cell: Cell.fromBoc(methodCells(target.boc).get(101))[0] };
  for (const x of [-1, 0, 1, 100]) await equivalent(p, 100, [int(x), code]);
  await equivalent(p, 100, [int(1), code], [17]);
});

test('PREPAREDICT uses c3 replaced by runtime code', async () => {
  const p = await pair(
    '() invoke(int x, slice code) impure asm "BLESS" "c3 POP" "101 PREPAREDICT" "2 0 CALLXARGS"; ' +
    '() recv_internal() { } int example(int x, slice code) impure method_id(100) { invoke(x, code); return 17; }',
  );
  const target = await new Toolchain().compile(
    '() recv_internal() { } () target(int x, int id) impure method_id(101) { throw_unless(334, id == 101); throw_unless(333, x > 0); }',
  );
  const code = { type: 'slice', cell: Cell.fromBoc(methodCells(target.boc).get(101))[0] };
  for (const x of [-1, 0, 1, 100]) await equivalent(p, 100, [int(x), code]);
  await equivalent(p, 100, [int(1), code], [17]);
});

test('unknown continuation return signatures stay opaque', async () => {
  const original = await new Toolchain().compile(
    'int invoke(slice code) impure asm "BLESS" "0 1 CALLXARGS"; ' +
    '() recv_internal() { } int example(slice code) impure method_id(100) { return invoke(code); }',
  );
  const result = reconstructReadable(original.boc);
  assert.equal(result.decompilation.reconstruction_mode, 'hybrid');
  assert.match(result.diagnostics.join('\n'), /unresolved return signature/);
  assert.match(result.display_contract, /0 1 CALLXARGS/);
});

test('user dynamic contract keeps readable prefixes and exact executable bytecode', async () => {
  const code = readFileSync(new URL('./fixtures/user-contract-2.b64', import.meta.url), 'utf8').trim();
  const result = reconstructReadable(Buffer.from(code, 'base64'));
  assert.equal(result.decompilation.method_count, 18);
  assert.equal(result.decompilation.structured_method_count, 14);
  assert.equal(result.decompilation.partial_method_count, 4);
  assert.equal((result.display_contract.match(/Partial reconstruction only/g) ?? []).length, 4);
  assert.match(result.display_contract, /runtime code and stack signature are unknown/);
  assert.match(result.display_contract, /tvm_bless/);
  assert.match(result.display_contract, /SETCONTCTR/);
  assert.match(result.display_stdlib, /138 PREPAREDICT 4 0 CALLXARGS/);
  assert.doesNotMatch(result.func, /Partial reconstruction|\.\.\.stack|fift \{/);
  const { status, response } = await runWorker({ code, verify: true, max_search_time_ms: 30000 });
  assert.equal(status, 200);
  assert.equal(response.decompilation.exact_hash_match, true);
  assert.match((response.readable ?? response).display_contract, /Partial reconstruction only/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pair, equivalent, int } from './vm.mjs';
import { analyze } from '../dist/ir.js';
import { instruction } from '../dist/asm.js';
import { reconstructReadable } from '../dist/core.js';
import { runWorker } from '../dist/api.js';

test('later callers supply tuple shapes to previously unresolved methods', async () => {
  const p = await pair(
    'cell empty() asm "NEWC" "ENDC"; () recv_internal() { } ' +
    'int target([cell, int] value) method_id(10) { var [c, n] = value; return n + 1; } ' +
    'int example(int x) method_id(100) { return target([empty(), x + 1]); }',
  );
  for (const x of [-1, 0, 100, (1n << 256n) - 1n]) await equivalent(p, 100, [int(x)]);
});

test('global type discovery retries methods analyzed before initialization', async () => {
  const p = await pair(
    'int read_global() impure asm "1 GETGLOB"; () write_global(int x) impure asm "1 SETGLOB"; ' +
    '() recv_internal() { } int target() impure method_id(10) { return read_global() + 1; } ' +
    'int example(int x) impure method_id(100) { write_global(x + 1); return target(); }',
  );
  for (const x of [-10, 0, 19]) await equivalent(p, 100, [int(x)], [x + 2]);
});

test('tuple compatibility accepts nullable fields but rejects conflicting concrete types', () => {
  const assign = [instruction('SETGLOB', ['1'])];
  const globals = new Map([[1, '[cell, [slice, int]]']]);
  assert.doesNotThrow(() => analyze(assign, {
    arguments: 1, hints: ['[null, [null, int]]'], globalTypes: globals,
  }));
  assert.throws(() => analyze(assign, {
    arguments: 1, hints: ['[int, [slice, int]]'], globalTypes: globals,
  }), /Conflicting stack types/);
  assert.throws(() => analyze(assign, {
    arguments: 1, hints: ['[cell, int]'], globalTypes: globals,
  }), /Conflicting stack types/);
});

test('terminal throw does not emit out-of-scope early-return locals', async () => {
  const p = await pair(
    'int helper(int x) impure asm "c2 SAVECTR SAMEALTSAVE DUP IF:<{ INC RETALT }> DROP 333 THROW"; ' +
    '() recv_internal() { } int example(int x) impure method_id(100) { return helper(x); }',
  );
  for (const x of [-1, 0, 100]) await equivalent(p, 100, [int(x)]);
});

test('user contract 3 recovers 23 methods with a compilable readable view and exact fallback', async () => {
  const code = readFileSync(new URL('./fixtures/user-contract-3.b64', import.meta.url), 'utf8').trim();
  const result = reconstructReadable(Buffer.from(code, 'base64'));
  assert.equal(result.decompilation.method_count, 26);
  assert.equal(result.decompilation.structured_method_count, 23);
  assert.equal(result.decompilation.partial_method_count, 1);
  assert.deepEqual(result.decompilation.unsupported_instructions, ['SETCONTCTR', 'type']);
  const { status, response } = await runWorker({ code, verify: true, max_search_time_ms: 30000 });
  assert.equal(status, 200);
  assert.equal(response.decompilation.exact_hash_match, true);
  assert.equal(response.readable.decompilation.structured_method_count, 23);
  assert.equal(response.readable.decompilation.recompiles, true);
});

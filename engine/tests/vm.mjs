import assert from 'node:assert/strict';
import { Executor, defaultConfig } from '@ton/sandbox';
import { Address, Cell, beginCell, parseTuple } from '@ton/core';
import { Toolchain } from '../dist/toolchain.js';
import { reconstructReadable } from '../dist/core.js';

const toolchain = new Toolchain();
let executor;
export const int = (value) => ({ type: 'int', value: BigInt(value) });
export const slice = (hex) => ({
  type: 'slice',
  cell: beginCell().storeBuffer(Buffer.from(hex, 'hex')).endCell(),
});
export const cell = (hex) => ({
  type: 'cell',
  cell: beginCell().storeBuffer(Buffer.from(hex, 'hex')).endCell(),
});
export async function run(boc, methodId, stack) {
  executor ??= await Executor.create();
  const result = await executor.runGetMethod({
    code: Cell.fromBoc(boc)[0],
    data: beginCell().endCell(),
    methodId,
    stack,
    config: defaultConfig,
    verbosity: 'short',
    address: new Address(0, Buffer.alloc(32)),
    unixTime: 1700000000,
    balance: 1000000000n,
    randomSeed: Buffer.alloc(32, 1),
    gasLimit: 1000000n,
    debugEnabled: false,
  });
  assert.equal(result.output.success, true, result.output.error);
  return {
    exit: result.output.vm_exit_code,
    stack: parseTuple(Cell.fromBase64(result.output.stack)),
  };
}
export async function pair(source) {
  const original = await toolchain.compile(source);
  const readable = reconstructReadable(original.boc);
  assert.equal(
    readable.decompilation.reconstruction_mode,
    'structured',
    readable.diagnostics.join('\n'),
  );
  const candidate = await toolchain.compile(readable.func);
  return { original: original.boc, candidate: candidate.boc, readable };
}
function value(item) {
  if (item.type === 'tuple') return { type: item.type, items: item.items.map(value) };
  if ('cell' in item) return { type: item.type, hash: item.cell.hash().toString('hex') };
  return item;
}
export async function equivalent(compiled, methodId, stack, expected) {
  const a = await run(compiled.original, methodId, stack),
    b = await run(compiled.candidate, methodId, stack);
  assert.equal(b.exit, a.exit, `VM exit mismatch for method ${methodId}`);
  // Exception stack contents are not a return-value contract.
  if (a.exit === 0 || a.exit === 1) assert.deepEqual(b.stack.map(value), a.stack.map(value));
  if (expected !== undefined) {
    assert.equal(a.exit, 0);
    assert.deepEqual(b.stack, expected.map(int));
  }
  return a;
}

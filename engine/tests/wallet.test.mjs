import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { Executor, defaultConfig, createShardAccount } from '@ton/sandbox';
import {
  Address,
  Cell,
  beginCell,
  Dictionary,
  external,
  internal,
  storeMessage,
  storeShardAccount,
  loadShardAccount,
  loadTransaction,
} from '@ton/core';
import { keyPairFromSeed, sign } from '@ton/crypto';
import { Toolchain } from '../dist/toolchain.js';
import { reconstructReadable } from '../dist/core.js';
import { decompile } from '../dist/service.js';

const original = Buffer.from(
  readFileSync(new URL('./fixtures/wallet_v5.b64', import.meta.url), 'utf8').trim(),
  'base64',
);
const address = new Address(0, Buffer.alloc(32));
const key = keyPairFromSeed(Buffer.alloc(32, 1));
const tools = new Toolchain();
let executor;
async function transaction(
  boc,
  {
    externalMessage = true,
    valid = true,
    seqno = 1,
    wallet = 42,
    until = 1800000000,
    action,
    extension = false,
  } = {},
) {
  executor ??= await Executor.create();
  const extensions = Dictionary.empty(Dictionary.Keys.BigUint(256), Dictionary.Values.Bool());
  if (extension) extensions.set(0n, true);
  const data = beginCell()
    .storeInt(-1, 1)
    .storeUint(1, 32)
    .storeUint(42, 32)
    .storeBuffer(key.publicKey)
    .storeDict(extensions)
    .endCell();
  const actions = action ?? beginCell().storeUint(0, 2).endCell();
  const unsigned = extension
    ? beginCell()
        .storeUint(0x6578746e, 32)
        .storeUint(0, 64)
        .storeSlice(actions.beginParse())
        .endCell()
    : beginCell()
        .storeUint(externalMessage ? 0x7369676e : 0x73696e74, 32)
        .storeUint(wallet, 32)
        .storeUint(until, 32)
        .storeUint(seqno, 32)
        .storeSlice(actions.beginParse())
        .endCell();
  const body = extension
    ? unsigned
    : beginCell()
        .storeSlice(unsigned.beginParse())
        .storeBuffer(valid ? sign(unsigned.hash(), key.secretKey) : Buffer.alloc(64))
        .endCell();
  const message =
    externalMessage && !extension
      ? external({ to: address, body })
      : {
          ...internal({ to: address, value: 100000000n, body, bounce: false }),
          info: {
            ...internal({ to: address, value: 100000000n, bounce: false }).info,
            src: address,
          },
        };
  const account = createShardAccount({
    code: Cell.fromBoc(boc)[0],
    data,
    address,
    balance: 1000000000n,
  });
  const result = await executor.runTransaction({
    config: defaultConfig,
    libs: null,
    verbosity: 'short',
    shardAccount: beginCell()
      .store(storeShardAccount(account))
      .endCell()
      .toBoc()
      .toString('base64'),
    message: beginCell().store(storeMessage(message)).endCell(),
    now: 1700000000,
    lt: 1000000n,
    randomSeed: Buffer.alloc(32, 1),
    ignoreChksig: false,
    debugEnabled: false,
  });
  if (!result.result.success) {
    assert.ok(result.result.vmResults, result.result.error);
    return { exit: result.result.vmResults.vmExitCode, accepted: false };
  }
  const tx = loadTransaction(Cell.fromBase64(result.result.transaction).beginParse());
  const after = loadShardAccount(Cell.fromBase64(result.result.shardAccount).beginParse());
  return {
    exit: tx.description.computePhase.exitCode,
    accepted: true,
    data: after.account.storage.state.state.data.hash().toString('hex'),
    actions: result.result.actions
      ? Cell.fromBase64(result.result.actions).hash().toString('hex')
      : null,
    actionResult: tx.description.actionPhase?.resultCode,
  };
}

test('Wallet V5 recovers all 7 methods and preserves signature checks, state and actions', async () => {
  const readable = reconstructReadable(original);
  assert.equal(readable.decompilation.structured_method_count, 7);
  assert.equal(readable.decompilation.method_count, 7);
  assert.doesNotMatch(readable.contract, /asm_method/);
  const compiled = await tools.compile(readable.func);
  const action = (op, next) => {
    const b = beginCell().storeUint(0, 1).storeUint(1, 1).storeUint(op, 8);
    if (op === 2 || op === 3) b.storeAddress(address);
    if (op === 4) b.storeUint(0, 1);
    if (next) b.storeRef(next);
    return b.endCell();
  };
  const cases = [
    [{}, 0],
    [{ externalMessage: false }, 0],
    [{ valid: false }, 135],
    [{ externalMessage: false, valid: false }, 0],
    [{ seqno: 2 }, 133],
    [{ wallet: 43 }, 134],
    [{ until: 1600000000 }, 136],
    [{ action: action(0) }, 141],
    [{ action: action(2) }, 0],
    [{ action: action(3) }, 140],
    [{ action: action(4) }, 146],
    [{ action: action(2, beginCell().storeUint(3, 8).storeAddress(address).endCell()) }, 0],
    [
      {
        action: beginCell()
          .storeBit(true)
          .storeRef(
            beginCell()
              .storeUint(0x0ec3c86d, 32)
              .storeUint(2, 8)
              .storeRef(beginCell().endCell())
              .storeRef(beginCell().endCell())
              .endCell(),
          )
          .storeBit(false)
          .endCell(),
      },
      0,
    ],
    [
      {
        action: beginCell()
          .storeBit(true)
          .storeRef(
            beginCell()
              .storeUint(0x0ec3c86d, 32)
              .storeUint(0, 8)
              .storeRef(beginCell().endCell())
              .storeRef(beginCell().endCell())
              .endCell(),
          )
          .storeBit(false)
          .endCell(),
      },
      137,
    ],
    [{ extension: true }, 0],
    [{ extension: true, action: action(4) }, 0],
    [{ extension: true, action: action(3) }, 0],
    [{ extension: true, action: action(2) }, 139],
    [
      {
        extension: true,
        action: action(4, beginCell().storeUint(3, 8).storeAddress(address).endCell()),
      },
      144,
    ],
  ];
  for (const [input, exit] of cases) {
    const a = await transaction(original, input),
      b = await transaction(compiled.boc, input);
    assert.equal(a.exit, exit, JSON.stringify(input));
    assert.deepEqual(b, a, JSON.stringify(input));
  }
  const response = await decompile(original, { toolchain: tools });
  assert.equal(response.success, true);
  assert.equal(response.decompilation.exact_hash_match, true);
  const view = response.readable ?? response;
  assert.equal(view.decompilation.structured_method_count, 7);
  assert.equal(view.decompilation.method_count, 7);
});

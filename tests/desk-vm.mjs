// Optional differential execution against the original BOC. Uses temporary/local
// dependencies only: TOLK_COMPILER and TVM_SANDBOX point at installed packages.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { reconstructReadable } from '../src/decompiler/core.ts';
const require = createRequire(import.meta.url);
if (!process.env.TVM_SANDBOX || !process.env.TOLK_COMPILER) throw new Error('Set TVM_SANDBOX and TOLK_COMPILER package directories.');
const sandboxPath = resolve(process.env.TVM_SANDBOX);
const { Blockchain, SmartContract } = require(sandboxPath);
const core = createRequire(sandboxPath + '/package.json')('@ton/core');
const { Address, Cell, beginCell, serializeTuple } = core;
const { runTolkCompiler } = require(resolve(process.env.TOLK_COMPILER));
const fixture = JSON.parse(readFileSync(new URL('./fixtures/modern/DeskCollection.json', import.meta.url)));
const original = Cell.fromBase64(fixture.boc);
const output = reconstructReadable(Buffer.from(fixture.boc, 'base64'), 'tolk');
assert.equal(output.decompilation.structured_method_count, 6);
const compiled = await runTolkCompiler({entrypointFileName:'reconstructed.tolk', fsReadCallback: () => output.source});
assert.equal(compiled.status, 'ok', compiled.message);
const reconstructed = Cell.fromBase64(compiled.codeBoc64);
const blockchain = await Blockchain.create();
const address = Address.parse('EQBKCClSs3RhzCXqQrLf8uyUPUBuCmU4P4YGY51tJyNMYgMe');
const empty = beginCell().endCell();
function snake(parts) {
  let cell;
  for (const part of [...parts].reverse()) {
    const b = beginCell().storeBuffer(Buffer.from(part));
    if (cell) b.storeRef(cell);
    cell = b.endCell();
  }
  return cell;
}
function text(cell) {
  const s = cell.beginParse();
  const head = s.loadBuffer(s.remainingBits / 8).toString();
  return head + (s.remainingRefs ? text(s.loadRef()) : '');
}
async function run(contract, method, stack) {
  try {
    const result = await contract.get(method, stack, { now: 1700000000 });
    return {exit:result.exitCode, hash:serializeTuple(result.stack).hash().toString('hex'), result};
  } catch (e) {
    if (typeof e.exitCode !== 'number') throw e;
    return {exit:e.exitCode};
  }
}
let checks = 0;
for (const parts of [['https://example.test/'], ['https://', 'example.test/', 'desks/'], [''], ['a'.repeat(120), 'b'.repeat(120), 'tail/']]) {
  const common = snake(parts);
  const content = beginCell().storeRef(empty).storeRef(common).endCell();
  const royalty = beginCell().storeUint(1,16).storeUint(100,16).storeAddress(address).endCell();
  const data = beginCell().storeAddress(address).storeAddress(address).storeAddress(address)
    .storeUint(42,32).storeUint(1000,32).storeRef(content).storeRef(empty).storeRef(royalty).endCell();
  const contracts = [original,reconstructed].map(code => SmartContract.create(blockchain,{address,code,data,balance:10_000_000_000n}));
  for (const number of [0n,1n,9n,10n,42n,999n,-1n,-10n,-42n,(1n<<256n)-1n,-((1n<<256n)-1n),-(1n<<256n)]) {
    const args = [{type:'int',value:number},{type:'cell',cell:empty}];
    const [a,b] = await Promise.all(contracts.map(c=>run(c,68445,args)));
    assert.equal(b.exit,a.exit,`exit for ${number}`);
    assert.equal(b.hash,a.hash,`output cell structure for ${number}, ${parts.length} chunks`);
    if(a.result) {
      const root=a.result.stackReader.readCell().beginParse();
      assert.equal(root.loadUint(8),1);
      assert.equal(text(root.loadRef()),parts.join('')+number+'.json');
    }
    checks++;
  }
  for (const [method,args] of [[85719,[]],[92067,[{type:'int',value:7n}]],[97144,[]],[102491,[]]]) {
    const [a,b] = await Promise.all(contracts.map(c=>run(c,method,args)));
    assert.equal(a.exit,0,`original getter ${method}`);
    assert.equal(b.exit,a.exit);
    assert.equal(b.hash,a.hash,`getter ${method}`);
    checks++;
  }
}
console.log(`${checks} differential getter cases passed (including exact cell hashes and overflow exit). Gas equivalence and internal-message paths were not checked.`);

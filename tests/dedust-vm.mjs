// Compare the recovered initializer, including its storage, actions and globals.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {Cell as TasmCell,runtime} from '@ton/tasm';
import {reconstructReadable} from '../src/decompiler/core.ts';
const require=createRequire(import.meta.url);
const {compileFunc}=require(resolve(process.env.FUNC_COMPILER));
const {runTolkCompiler}=require(resolve(process.env.TOLK_COMPILER));
const sandbox=resolve(process.env.TVM_SANDBOX);
const {Blockchain,SmartContract}=require(sandbox);
const {Cell,Address,beginCell,serializeTuple}=createRequire(sandbox+'/package.json')('@ton/core');
const f=JSON.parse(readFileSync(new URL('./fixtures/dedust-jetton-vault-v2.json',import.meta.url)));
const codes=[Cell.fromBase64(f.boc)];
for(const lang of ['func','tolk']) {
 const r=reconstructReadable(Buffer.from(f.boc,'base64'),lang);
 // The Tolk hybrid deliberately omits unsupported methods. A test-only empty
 // entrypoint permits running its recovered exported initializer directly.
 const source=r.source+(lang==='tolk'?'\nfun onInternalMessage() {}\n':'');
 const c=lang==='func'?await compileFunc({targets:['test.fc'],sources:{'test.fc':source}})
 :await runTolkCompiler({entrypointFileName:'test.tolk',fsReadCallback:()=>source});
 assert.equal(c.status,'ok',c.message);
 codes.push(Cell.fromBase64(c.codeBoc??c.codeBoc64));
}
const capture=await compileFunc({targets:['capture.fc'],sources:{'capture.fc':
 '() raw() impure asm "58662 PUSHINT c3 PUSH EXECUTE c4 PUSH c5 PUSH 2 GETGLOB 3 GETGLOB 6 GETGLOB 7 GETGLOB 8 GETGLOB"; () recv_internal() { raw(); }'}});
assert.equal(capture.status,'ok',capture.message);
const captureCode=runtime.decompileCell(TasmCell.fromBase64(capture.codeBoc));
const captureMethod=captureCode.find(i=>i.$==='DICTPUSHCONST').arg1.methods.find(m=>m.id===0);
function instrument(cell) {
 const code=runtime.decompileCell(TasmCell.fromBase64(cell.toBoc().toString('base64')));
 const dict=code.find(i=>i.$==='DICTPUSHCONST').arg1;
 assert.ok(dict.methods.some(m=>m.id===58662));
 dict.methods.push({...captureMethod,id:100000});
 return Cell.fromBoc(runtime.compileCell(code).toBoc())[0];
}
const blockchain=await Blockchain.create();
const empty=beginCell().endCell(), address=new Address(0,Buffer.alloc(32,1));
const factory=beginCell().storeAddress(new Address(0,Buffer.alloc(32,2))).endCell();
const minter=beginCell().storeAddress(new Address(-1,Buffer.alloc(32,3))).endCell();
const data=beginCell().storeUint(42,8).endCell();
const contracts=codes.map(code=>SmartContract.create(blockchain,{address,code:instrument(code),data,balance:10_000_000_000n}));
const int=x=>({type:'int',value:BigInt(x)}),slice=cell=>({type:'slice',cell});
let checks=0;
for(const wc of [-1,0]) for(const version of [0,1,65535]) for(const explicit of [false,true]) {
 const asset=beginCell().storeUint(1,4).storeInt(wc,8).storeUint(99,256).endCell();
 const args=[slice(factory),int(7),slice(asset),{type:'cell',cell:empty},int(version),{type:'null'},slice(explicit?minter:empty)];
 const results=[];
 for(const c of contracts) {
  const r=await c.get(100000,args,{now:1700000000});
  assert.equal(r.exitCode,0);assert.equal(r.stack.length,7);
  assert.equal(r.stack[3].value,BigInt(version));
  results.push(serializeTuple(r.stack).hash().toString('hex'));
 }
 assert.ok(results.every(r=>r===results[0]),`initializer wc=${wc}, version=${version}, explicit=${explicit}`);
 checks++;
}
console.log(`${checks} DeDust initializer cases match in both languages: return stack, c4, c5 and globals 2/3/6/7/8.`);

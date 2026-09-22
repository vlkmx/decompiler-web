// Optional: compile both output languages and compare TVM results to the fixture.
// FUNC_COMPILER, TOLK_COMPILER, TVM_SANDBOX are installed package directories.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {reconstructReadable} from '../src/decompiler/core.ts';
import {legacyTry} from './legacy-try.mjs';
const require=createRequire(import.meta.url);
const {compileFunc}=require(resolve(process.env.FUNC_COMPILER));
const {runTolkCompiler}=require(resolve(process.env.TOLK_COMPILER));
const sandbox=resolve(process.env.TVM_SANDBOX);
const {Blockchain,SmartContract,internal}=require(sandbox);
const {storeOutListExt}=require(sandbox+'/dist/blockchain/SmartContract.js');
const {Cell,Address,beginCell,Dictionary,serializeTuple}=createRequire(sandbox+'/package.json')('@ton/core');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/try-catch.json',import.meta.url)));
const original=Cell.fromBase64(fixture.boc);
const recompiled=await compileFunc({targets:['fixture.fc'],sources:{'fixture.fc':fixture.source}});
assert.equal(recompiled.status,'ok',recompiled.message);
assert.equal(Cell.fromBase64(recompiled.codeBoc).hash().toString('hex'),original.hash().toString('hex'));
const codes=[original];
const legacy=legacyTry(fixture.boc);
codes.push(Cell.fromBase64(legacy));
for(const boc of [fixture.boc,legacy]) for(const lang of ['func','tolk']){
 const output=reconstructReadable(Buffer.from(boc,'base64'),lang);
 assert.equal(output.decompilation.structured_method_count,7);
 const c=lang==='func'
  ? await compileFunc({targets:['restored.fc'],sources:{'restored.fc':output.source}})
  : await runTolkCompiler({entrypointFileName:'restored.tolk',fsReadCallback:()=>output.source});
 assert.equal(c.status,'ok',c.message);
 codes.push(Cell.fromBase64(c.codeBoc??c.codeBoc64));
}
const blockchain=await Blockchain.create();
blockchain.recordStorage=true;
const empty=beginCell().endCell();
const address=new Address(0,Buffer.alloc(32,1));
const contracts=codes.map(code=>SmartContract.create(blockchain,{address,code,data:empty,balance:10_000_000_000n}));
let checks=0;
async function compare(method,args,expectedExit=0,expectedInt){
 const results=await Promise.all(contracts.map(async c=>{
  try{const r=await c.get(method,args,{now:1700000000});return {exit:r.exitCode,hash:serializeTuple(r.stack).hash().toString('hex'),stack:r.stack};}
  catch(e){if(typeof e.exitCode!=='number')throw e;return {exit:e.exitCode};}
 }));
 assert.equal(results[0].exit,expectedExit,`original ${method}`);
 if(expectedInt!==undefined)assert.equal(results[0].stack[0].value,BigInt(expectedInt));
 for(const result of results.slice(1))assert.deepEqual({exit:result.exit,hash:result.hash},{exit:results[0].exit,hash:results[0].hash},`method ${method}, args ${args.map(a=>a.value??a.type)}`);
 checks++;
}
const int=value=>({type:'int',value:BigInt(value)});
for(const x of [-100,-1,0,1,100]) for(const y of [-3,0,1,7]) {
 for(const method of [100001,100002,100003]) await compare(method,[int(x),int(y)]);
 await compare(100006,[int(x),int(y)],y===0?88:0);
 for(const z of [0,2]) await compare(100005,[int(x),int(y),int(z)]);
}
for(const fail of [0,1,-1]) await compare(100004,[int(fail)]);
for(const fail of [0,1,255]) {
 const results=[];
 for(const code of codes) {
  const c=SmartContract.create(blockchain,{address,code,data:empty,balance:10_000_000_000n});
  const tx=await c.receiveMessage(internal({from:new Address(0,Buffer.alloc(32,2)),to:address,value:1_000_000_000n,
   body:beginCell().storeUint(fail,8).endCell()}),{now:1700000000});
  assert.equal(tx.description.type,'generic');
  const d=tx.description;
  assert.equal(d.computePhase.type,'vm');
  assert.equal(d.computePhase.exitCode,0);
  assert.equal(d.aborted,false);
  assert.equal(tx.outActions?.length,fail?0:1);
  assert.equal(tx.newStorage?.hash().toString('hex'),
   (fail?empty:beginCell().storeUint(123,8).endCell()).hash().toString('hex'));
  results.push({data:tx.newStorage?.hash().toString('hex'),
   actions:beginCell().store(storeOutListExt(tx.outActions??[])).endCell().hash().toString('hex')});
 }
 for(const result of results.slice(1)) assert.deepEqual(result,results[0],`transaction fail=${fail}`);
 checks++;
}
console.log(`${checks} try/catch differential cases passed for both snapshot formats and both FunC and Tolk.`);

// Optional: compile both output languages and compare TVM results to the fixture.
// FUNC_COMPILER, TOLK_COMPILER, TVM_SANDBOX are installed package directories.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {reconstructReadable} from '../src/decompiler/core.ts';
const require=createRequire(import.meta.url);
const {compileFunc}=require(resolve(process.env.FUNC_COMPILER));
const {runTolkCompiler}=require(resolve(process.env.TOLK_COMPILER));
const sandbox=resolve(process.env.TVM_SANDBOX);
const {Blockchain,SmartContract}=require(sandbox);
const {Cell,Address,beginCell,Dictionary,serializeTuple}=createRequire(sandbox+'/package.json')('@ton/core');
const fixture=JSON.parse(readFileSync(new URL('./fixtures/signature-inference.json',import.meta.url)));
const original=Cell.fromBase64(fixture.boc);
const recompiled=await compileFunc({targets:['fixture.fc'],sources:{'fixture.fc':fixture.source}});
assert.equal(recompiled.status,'ok',recompiled.message);
assert.equal(Cell.fromBase64(recompiled.codeBoc).hash().toString('hex'),original.hash().toString('hex'));
const codes=[original];
for(const lang of ['func','tolk']){
 const output=reconstructReadable(Buffer.from(fixture.boc,'base64'),lang);
 assert.equal(output.decompilation.structured_method_count,19);
 const c=lang==='func'
  ? await compileFunc({targets:['restored.fc'],sources:{'restored.fc':output.source}})
  : await runTolkCompiler({entrypointFileName:'restored.tolk',fsReadCallback:()=>output.source});
 assert.equal(c.status,'ok',c.message);
 codes.push(Cell.fromBase64(c.codeBoc??c.codeBoc64));
}
const blockchain=await Blockchain.create();
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
const nullValue={type:'null'};
const sample=beginCell().storeUint(173,8).storeRef(empty).endCell();
const cell={type:'cell',cell:sample}, slice={type:'slice',cell:sample};
const values=[int(0),int(-123),int(2n**200n),cell,slice,nullValue,{type:'tuple',items:[int(7),cell]}];
for(const value of values) {
 for(const method of [1,2]) await compare(method,[value]);
 for(const n of [-2,0,1,2,10]) {
  await compare(4,[value,int(n)]);
  await compare(100012,[value,int(n)]);
  await compare(100013,[value,int(n)]);
 }
 for(const f of [0,1,-1]) {
  await compare(3,[value,nullValue,int(f)]);
  await compare(5,[value,int(f)]);
 }
}
// Exported polymorphic slots must also retain legal heterogeneous TVM inputs.
for(const f of [0,1,-1]) await compare(3,[cell,int(9),int(f)]);
for(const value of [cell,nullValue]) await compare(100001,[value]);
for(const value of [slice,nullValue]) await compare(100002,[value]);
for(const n of [-1,0,1,2n**200n]) await compare(100003,[int(n)]);
for(const f of [0,1,-1]) {
 await compare(100004,[cell,nullValue,int(f)]);
 await compare(100005,[slice,nullValue,int(f)]);
 await compare(100009,[slice,int(f)]);
 await compare(100010,[slice,int(f)]);
 await compare(100011,[cell,int(f)]);
}
for(const n of [-2,0,1,3,10]) {
 await compare(100006,[cell,int(n)]);
 await compare(100007,[slice,int(n)]);
}
await compare(100008,[cell],0,16);
await compare(100008,[nullValue],7);
console.log(`${checks} polymorphic signature differential cases passed for both FunC and Tolk.`);

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
const fixture=JSON.parse(readFileSync(new URL('./fixtures/dictionary-loops.json',import.meta.url)));
const original=Cell.fromBase64(fixture.boc);
const recompiled=await compileFunc({targets:['fixture.fc'],sources:{'fixture.fc':fixture.source}});
assert.equal(recompiled.status,'ok',recompiled.message);
assert.equal(Cell.fromBase64(recompiled.codeBoc).hash().toString('hex'),original.hash().toString('hex'));
const codes=[original];
for(const lang of ['func','tolk']){
 const output=reconstructReadable(Buffer.from(fixture.boc,'base64'),lang);
 assert.equal(output.decompilation.structured_method_count,9);
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
for(const keys of [[],[0],[255],[1,3,127,255],Array.from({length:32},(_,i)=>i*7)]){
 const dict=Dictionary.empty(Dictionary.Keys.Uint(8),Dictionary.Values.Uint(16));
 for(const key of keys)dict.set(key,key+1000);
 const root=keys.length?{type:'cell',cell:beginCell().storeDictDirect(dict).endCell()}:{type:'null'};
 await compare(100001,[root],0,keys.reduce((a,b)=>a+b,0));
 for(const key of [0,1,3,127,254,255])await compare(100002,[int(key),root],keys.includes(key)?0:41);
}
for(const n of [-5,0,1,2,3,10,100]){
 await compare(100004,[int(n)],0,Math.min(n,0));
 await compare(100005,[int(n)],0,Math.max(n+1,3));
}
for(const x of [-100,-1,0,1,127,1000])for(const y of [-7,-1,1,3,128,256])await compare(100003,[int(x),int(y)]);
await compare(100003,[int(1),int(0)],4);
const sample=beginCell().storeUint(0xabcd,16).storeRef(beginCell().storeUint(1,8).endCell()).storeRef(beginCell().storeUint(2,8).endCell()).endCell();
for(const b of [0,1,8,16,17])for(const r of [0,1,2,3]){
 const args=[{type:'slice',cell:sample},int(b),int(r)];
 for(const method of [100006,100007])await compare(method,args,b>16||r>2?9:0);
 await compare(100008,[...args,int(0),int(0)],b>16||r>2?9:0);
}
await compare(100008,[{type:'slice',cell:sample},int(4),int(1),int(8),int(1)]);
console.log(`${checks} differential cases passed for both FunC and Tolk (outputs and exit codes).`);

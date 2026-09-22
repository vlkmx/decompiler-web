// Dynamic terminal calls: compare complete incoming stacks, storage, actions and exits.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {reconstructReadable} from '../src/decompiler/core.ts';
const require=createRequire(import.meta.url);
const {compileFunc}=require(resolve(process.env.FUNC_COMPILER));
const {runTolkCompiler}=require(resolve(process.env.TOLK_COMPILER));
const sandbox=resolve(process.env.TVM_SANDBOX);
const {Blockchain,SmartContract,internal}=require(sandbox);
const {storeOutListExt}=require(sandbox+'/dist/blockchain/SmartContract.js');
const {Cell,Address,beginCell}=createRequire(sandbox+'/package.json')('@ton/core');
async function compile(source,lang='func') {
 const c=lang==='func'?await compileFunc({targets:['test.fc'],sources:{'test.fc':source}})
  :await runTolkCompiler({entrypointFileName:'test.tolk',fsReadCallback:()=>source});
 assert.equal(c.status,'ok',c.message+'\n'+source);
 return Cell.fromBase64(c.codeBoc??c.codeBoc64);
}
const empty=beginCell().endCell();
const address=new Address(0,Buffer.alloc(32,1));
const blockchain=await Blockchain.create();blockchain.recordStorage=true;
const payloads=[
 '', 'DEPTH 3 EQINT 100 THROWIFNOT',
 '3 BLKDROP', '3 BLKDROP 10 PUSHINT 20 PUSHINT 30 PUSHINT 40 PUSHINT',
 '77 THROW', 'RETALT',
 'DEPTH NEWC 8 STU ENDC c4 POP',
 's2 PUSH NEWC 64 STU ENDC c4 POP',
 's1 PUSH NEWC 64 STU ENDC c4 POP',
 's0 PUSH HASHCU NEWC 256 STU ENDC c4 POP',
 '123 PUSHINT NEWC 8 STU ENDC c4 POP 100 PUSHINT 0 PUSHINT RAWRESERVE',
 '123 PUSHINT NEWC 8 STU ENDC c4 POP COMMIT 77 THROW',
 '<{ 90 THROW }>CONT c3 POP',
];
let checks=0;
for(const optional of [false,true]) for(const caught of [false,true]) for(const crowded of [false,true]) {
 const extra=crowded?Array.from({length:12},(_,i)=>`${i} PUSHINT SWAP`).join(' '):'';
 const assembly=optional?`LDOPTREF DROP ${extra} DUP ISNULL <{ DROP }>CONT <{ CTOS BLESS EXECUTE }>CONT IFELSE 1 THROW`
  :`LDREF DROP ${extra} CTOS BLESS EXECUTE 1 THROW`;
 const original=await compile(`() raw(int balance,int value,cell message,slice body) impure asm ${JSON.stringify(assembly)};
() save(int code,int value) impure asm "NEWC" "64 STU" "32 STU" "ENDC" "c4 POP";
() recv_internal(int balance,int value,cell message,slice body) {
 ${caught ? 'try { raw(balance,value,message,body); } catch(arg,code) { save(code,value); }' : 'raw(balance,value,message,body);'}
 }`);
 const codes=[original];
 for(const lang of ['func','tolk']) {
  const r=reconstructReadable(original.toBoc(),lang);
  assert.equal(r.decompilation.structured_method_count,1);
  codes.push(await compile(r.source,lang));
 }
 for(const payload of [...payloads,...(optional?[null]:[])]) {
  const code=payload===null?null:await compile(`() raw() impure asm ${JSON.stringify(payload||'NOP')}; () recv_internal() { raw(); }`);
  // Extract the actual method instructions, without its entry dispatcher.
  let method;
  if(code) {
   const {methodCells}=await import('../src/decompiler/boc.ts');
   method=Cell.fromBoc(methodCells(code.toBoc()).get(0))[0];
  }
  const body=optional?beginCell().storeMaybeRef(method??null).endCell():beginCell().storeRef(method).endCell();
  const results=[];
  for(const compiled of codes) {
   const c=SmartContract.create(blockchain,{address,code:compiled,data:empty,balance:10_000_000_000n});
   const tx=await c.receiveMessage(internal({from:new Address(0,Buffer.alloc(32,2)),to:address,value:1_000_000_000n,body}),{now:1700000000});
   const d=tx.description;assert.equal(d.type,'generic');assert.equal(d.computePhase.type,'vm');
   results.push({exit:d.computePhase.exitCode,aborted:d.aborted,
    data:tx.newStorage?.hash().toString('hex'),
    actions:beginCell().store(storeOutListExt(tx.outActions??[])).endCell().hash().toString('hex')});
  }
  for(const result of results.slice(1))assert.deepEqual(result,results[0],`${optional?'optional':'direct'} caught=${caught} crowded=${crowded} payload ${payload}`);
  checks++;
 }
}
const pool=JSON.parse(readFileSync(new URL('./fixtures/legacy-try-pool.json',import.meta.url)));
const poolCodes=[Cell.fromBase64(pool.boc)];
for(const lang of ['func','tolk']) {
 const r=reconstructReadable(Buffer.from(pool.boc,'base64'),lang);
 assert.equal(r.decompilation.structured_method_count,26);
 poolCodes.push(await compile(r.source,lang));
}
const sender=new Address(0,Buffer.alloc(32,2));
const round=beginCell().storeBit(0).storeUint(0,32).storeUint(0,32)
 .storeCoins(0).storeCoins(0).storeCoins(0).storeBit(0).storeCoins(0).endCell();
const roles=beginCell().storeAddress(sender).storeUint(0,48).storeAddress(sender).storeUint(0,48).storeAddress(sender)
 .storeRef(beginCell().storeAddress(sender).storeAddress(sender).endCell()).endCell();
const data=beginCell().storeUint(0,8).storeBit(0).storeCoins(1000000000)
 .storeRef(beginCell().storeAddress(sender).storeCoins(1000000000).storeBit(0).storeBit(0).endCell())
 .storeUint(0,24).storeBit(0).storeBit(1).storeUint(0,256)
 .storeRef(beginCell().storeRef(round).storeRef(round).endCell())
 .storeCoins(0).storeCoins(0).storeUint(0,24).storeRef(roles)
 .storeRef(beginCell().storeRef(empty).storeRef(empty).storeRef(empty).endCell()).endCell();
for(const payload of [null,'NOP','DEPTH NEWC 8 STU ENDC c4 POP',
 '123 PUSHINT NEWC 8 STU ENDC c4 POP 100 PUSHINT 0 PUSHINT RAWRESERVE',
 '123 PUSHINT NEWC 8 STU ENDC c4 POP COMMIT 77 THROW','77 THROW','RETALT',
 '10 PUSHINT 20 PUSHINT 30 PUSHINT','<{ 90 THROW }>CONT c3 POP']) {
 let method=null;
 if(payload!==null) {
  const c=await compile(`() raw() impure asm ${JSON.stringify(payload)}; () recv_internal() { raw(); }`);
  const {methodCells}=await import('../src/decompiler/boc.ts');
  method=Cell.fromBoc(methodCells(c.toBoc()).get(0))[0];
 }
 const body=beginCell().storeUint(0x96e7f528,32).storeUint(1,64)
  .storeMaybeRef(null).storeMaybeRef(null).storeMaybeRef(method).endCell();
 const results=[];
 for(const code of poolCodes) {
  const c=SmartContract.create(blockchain,{address,code,data,balance:10_000_000_000n});
  const tx=await c.receiveMessage(internal({from:sender,to:address,value:1_000_000_000n,body}),{now:1700000000});
  const d=tx.description;assert.equal(d.type,'generic');assert.equal(d.computePhase.type,'vm');
  results.push({exit:d.computePhase.exitCode,aborted:d.aborted,data:tx.newStorage?.hash().toString('hex'),
   actions:beginCell().store(storeOutListExt(tx.outActions??[])).endCell().hash().toString('hex')});
 }
 if(payload===null || payload==='NOP') assert.equal(results[0].exit,1,'upgrade branch must execute');
 for(const result of results.slice(1))assert.deepEqual(result,results[0],`pool payload ${payload}`);
 checks++;
}
console.log(`${checks} dynamic-call transaction cases passed in FunC and Tolk; reported pool reconstructs 26/26 and recompiles in both languages.`);

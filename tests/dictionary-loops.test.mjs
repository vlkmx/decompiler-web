import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze} from '../src/decompiler/ir.ts';
import {instruction as i} from '../src/decompiler/asm.ts';
import {reconstructReadable} from '../src/decompiler/core.ts';
const ir=(ops,hints)=>analyze(ops,{arguments:hints.length,hints});
test('lookup failure is padded or terminated by the original assertion',()=>{
 for(const op of ['DICTGET','DICTGETREF','DICTUGET','DICTIGETREF']){
  const hints=[op==='DICTGET'||op==='DICTGETREF'?'slice':'int','cell','int'];
  const r=ir([i(op),i('THROWIFNOT',['41'])],hints);
  assert.equal(r.returns.length,1);
  assert.equal(r.primitives[0].assembly,`${op} 41 THROWIFNOT`);
  assert.equal(ir([i(op),i('NULLSWAPIFNOT')],hints).returns.length,2);
  assert.throws(()=>ir([i(op)],hints),/needs padding/);
 }
});
test('dictionary iteration preserves slice keys and reference values',()=>{
 for(const [op,key,value,remove] of [['DICTMIN','slice','slice',false],['DICTUMINREF','int','cell',false],['DICTUREMMIN','int','slice',true],['DICTGETNEXT','slice','slice',false]]){
  const hints=op.includes('GET')?[key,'cell','int']:['cell','int'];
  const r=ir([i(op),i('NULLSWAPIFNOT2')],hints);
  assert.deepEqual(r.returns.map(v=>v.type),[...(remove?['cell']:[]),value,key,'int']);
  assert.throws(()=>ir([i(op)],hints),/needs padded/);
 }
});
test('builder dictionary updates require explicit null padding',()=>{
 for(const op of ['DICTUSETGETB','DICTIADDGETB','DICTSETGETB']){
  const hints=['builder',op==='DICTSETGETB'?'slice':'int','cell','int'];
  assert.deepEqual(ir([i(op),i('NULLSWAPIFNOT')],hints).returns.map(v=>v.type),['cell','slice','int']);
  assert.throws(()=>ir([i(op)],hints),/needs padded/);
 }
});
test('immediate shifted division uses the correct assembler spelling',()=>{
 for(const [op,asm] of [['LSHIFT_DIV','LSHIFT#DIV'],['LSHIFT_DIVR','LSHIFT#DIVR'],['LSHIFT_DIVC','LSHIFT#DIVC']]){
  assert.equal(ir([i(op,['128'])],['int','int']).primitives[0].assembly,`128 ${asm}`);
  assert.throws(()=>ir([i(op,['0'])],['int','int']),/Invalid shift/);
 }
});
test('dictionary and transforming WHILE fixture recovers in both languages',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/dictionary-loops.json',import.meta.url)));
 for(const lang of ['func','tolk']){
  const d=reconstructReadable(Buffer.from(fixture.boc,'base64'),lang).decompilation;
  assert.equal(d.method_count,9);
  assert.equal(d.structured_method_count,9);
  assert.deepEqual(d.unsupported_instructions,[]);
 }
});

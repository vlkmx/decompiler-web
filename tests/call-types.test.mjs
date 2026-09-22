import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze} from '../src/decompiler/ir.ts';
import {instruction as i} from '../src/decompiler/asm.ts';
import {reconstruct} from '../src/decompiler/func.ts';
import {reconstructReadable} from '../src/decompiler/core.ts';
const dispatcher = [i('SETCP0'), i('DICTPUSHCONST',['19']), i('DICTIGETJMPZ'), i('THROWARG',['11'])];
test('concrete caller types reach helper returns before stand-alone inference', () => {
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/call-types.json',import.meta.url)));
 for(const language of ['func','tolk']) {
  const r=reconstructReadable(Buffer.from(fixture.boc,'base64'),language);
  assert.equal(r.decompilation.method_count,9);
  assert.equal(r.decompilation.structured_method_count,9);
  assert.deepEqual(r.decompilation.unsupported_instructions,[]);
 }
});
test('a polymorphic helper accepts independent concrete call instantiations', () => {
 const methods=new Map([
  [1,[i('DUP')]],
  [100001,[i('NEWC'),i('ENDC'),i('CALLDICT',['1'])]],
  [100002,[i('PUSHINT',['7']),i('CALLDICT',['1'])]],
 ]);
 const module=reconstruct({instructions:dispatcher,methods});
 assert.deepEqual(module.functions.find(f=>f.id===1).args,[['X0','arg0']]);
 assert.deepEqual(module.functions.find(f=>f.id===100001).returns.map(v=>v.type),['cell','cell']);
 assert.deepEqual(module.functions.find(f=>f.id===100002).returns.map(v=>v.type),['int','int']);
 methods.set(1,[i('INC')]);
 assert.throws(()=>reconstruct({instructions:dispatcher,methods}),/Conflicting stack types/);
});
test('caller hints do not limit stack depth and null does not overwrite concrete types', () => {
 const r=analyze([i('SWAP')],{argumentHints:['slice']});
 assert.equal(r.arguments,2);
 assert.equal(r.argumentTypes[1],'slice');
 const callee=analyze([i('DUP')],{argumentHints:['cell']});
 const caller=analyze([i('PUSHNULL'),i('CALLDICT',['1'])],{methods:new Map([[1,callee]])});
 assert.deepEqual(caller.returns.map(v=>v.type),['cell','cell']);
});
test('run-length loads preserve count then remainder stack order', () => {
 for(const op of ['LDONES','LDZEROES','LDSAME']) {
  const hints=op==='LDSAME'?['slice','int']:['slice'];
  const r=analyze([i(op)],{arguments:hints.length,hints});
  assert.deepEqual(r.returns.map(v=>v.type),['int','slice']);
  assert.throws(()=>analyze([i(op)],{arguments:hints.length,hints:['cell',...hints.slice(1)]}),/Conflicting stack types/);
 }
});

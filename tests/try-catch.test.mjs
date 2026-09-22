import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {instruction as i} from '../src/decompiler/asm.ts';
import {analyze} from '../src/decompiler/ir.ts';
import {matchTryCatch} from '../src/decompiler/patterns.ts';
import {reconstructReadable} from '../src/decompiler/core.ts';
import {legacyTry} from './legacy-try.mjs';
const fixture=JSON.parse(readFileSync(new URL('./fixtures/try-catch.json',import.meta.url)));
const pattern=(regs=[4,5,7],body=[i('PUSHINT',['1'])])=>[
 ...regs.map(r=>i('PUSH',[`c${r}`])),i('PUSHCONT',[],[[i('NIP')]]),
 ...[...regs].reverse().map(r=>i('SETCONTCTR',[`c${r}`])),
 i('PUSHCONT',[],[body]),i('PUSH',['c1']),i('BOOLOR'),i('SWAP'),i('TRY')];
test('compiler try/catch snapshots lift in both supported register formats',()=>{
 for(const regs of [[4,5,7],[1,3,4,5,7]]) {
  const code=pattern(regs),match=matchTryCatch(code,0);
  assert.equal(match.length,code.length);
  assert.equal(match.savesC3,regs.includes(3));
  assert.deepEqual(analyze(code).returns.map(v=>v.type),['int']);
 }
});
test('near-matching continuation operations remain unsupported',()=>{
 for(const mutate of [c=>c[4].operands=['c4'],c=>c.splice(-2,1),c=>c[3].operands=['1'],c=>c.splice(-3,1,i('COMPOS'))]) {
  const code=pattern();mutate(code);
  assert.equal(matchTryCatch(code,0),undefined);
  assert.throws(()=>analyze(code));
 }
});
test('capture operands are bounded and the handler must remain variadic',()=>{
 for(const args of [[i('SETCONTARGS',['5','-1'])],
  [i('PUSHINT',['5']),i('PUSHINT',['-1']),i('SETCONTVARARGS')]]) {
  const code=pattern();code.splice(7,0,...args);
  assert.equal(matchTryCatch(code,0).captured,5);
 }
 for(const args of [['256','-1'],['-1','-1'],['1','0']]) {
  const code=pattern();code.splice(7,0,i('SETCONTARGS',args));
  assert.equal(matchTryCatch(code,0),undefined);
 }
});
test('legacy catch snapshots reject direct, indirect and dynamic c3 changes',()=>{
 const change=[i('PUSH',['c3']),i('POP',['c3']),i('PUSHINT',['1'])];
 assert.throws(()=>analyze(pattern(undefined,change)),/c3/);
 assert.equal(analyze(pattern([1,3,4,5,7],change)).changesC3,true);
 const callee=analyze(change);
 assert.throws(()=>analyze(pattern(undefined,[i('CALLDICT',['1'])]),{methods:new Map([[1,callee]])}),/c3/);
 assert.throws(()=>analyze(pattern(undefined,[i('PREPAREDICT',['1']),i('CALLXARGS',['1','0']),i('PUSHINT',['1'])])),/c3/);
});
test('fixture reconstructs nested catches, captures, early returns and register rollback',()=>{
 for(const boc of [fixture.boc,legacyTry(fixture.boc)]) for(const lang of ['func','tolk']) {
  const result=reconstructReadable(Buffer.from(boc,'base64'),lang);
  assert.equal(result.decompilation.structured_method_count,7);
  assert.equal(result.decompilation.unsupported_instructions.length,0);
  assert.match(result.source,/try \{/);
  assert.match(result.source,/catch \(/);
 }
});
test('the reported pool reconstructs its catches and terminal dynamic upgrade',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/legacy-try-pool.json',import.meta.url)));
 for(const lang of ['func','tolk']) {
  const r=reconstructReadable(Buffer.from(f.boc,'base64'),lang);
  assert.equal(r.decompilation.original_code_hash,f.hash);
  assert.equal(r.decompilation.method_count,26);
  assert.equal(r.decompilation.structured_method_count,26);
  assert.deepEqual(r.decompilation.unsupported_instructions,[]);
  assert.match(r.source,/tvm_execute_terminal_optional/);
 }
});

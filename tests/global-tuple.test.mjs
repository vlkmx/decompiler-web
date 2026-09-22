import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze} from '../src/decompiler/ir.ts';
import {instruction as i} from '../src/decompiler/asm.ts';
import {reconstructReadable} from '../src/decompiler/core.ts';
const code=[i('TUPLE',['2']),i('SETGLOB',['2'])];
test('global tuple shape constrains directly assigned input slots',()=>{
 const globalTypes=new Map([[2,'[slice, cell]']]);
 const r=analyze(code,{globalTypes});
 assert.deepEqual(r.argumentTypes,['slice','cell']);
 assert.deepEqual(r.returns,[]);
});
test('unknown or conflicting global tuple shapes are not guessed',()=>{
 assert.throws(()=>analyze(code),/Unknown tuple element types/);
 assert.throws(()=>analyze(code,{globalTypes:new Map([[2,'[slice]']])}),/arity differs/);
 assert.throws(()=>analyze([i('PUSHINT',['1']),i('PUSHINT',['2']),...code],
  {globalTypes:new Map([[2,'[slice, cell]']])}),/Conflicting stack types/);
});
test('DeDust initializer reconstructs while mutable dispatcher calls remain preserved',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/dedust-jetton-vault-v2.json',import.meta.url)));
 for(const lang of ['func','tolk']) {
  const r=reconstructReadable(Buffer.from(f.boc,'base64'),lang);
  assert.equal(r.decompilation.original_code_hash,f.hash);
  assert.equal(r.decompilation.method_count,18);
  assert.equal(r.decompilation.structured_method_count,16);
  assert.deepEqual(r.decompilation.unsupported_instructions,['EXECUTE']);
  assert.deepEqual(r.diagnostics.filter(s=>s.startsWith('Method ')).map(s=>s.split(':')[0]),['Method 0','Method 134']);
  assert.ok(r.diagnostics.filter(s=>s.startsWith('Method ')).every(s=>s.includes('Method 43092 runs in runtime-supplied code')));
 }
});

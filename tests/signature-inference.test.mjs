import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {analyze} from '../src/decompiler/ir.ts';
import {instruction as i} from '../src/decompiler/asm.ts';
import {reconstruct,render} from '../src/decompiler/func.ts';
import {renderTolk} from '../src/decompiler/tolk.ts';
import {disassembleProgram} from '../src/decompiler/disassembler.ts';
import {methodCells} from '../src/decompiler/boc.ts';
const dispatcher=[i('SETCP0'),i('DICTPUSHCONST',['19']),i('DICTIGETJMPZ'),i('THROWARG',['11'])];
const program=methods=>({instructions:dispatcher,methods:new Map(methods)});
test('generic call results propagate downstream constraints to the original input',()=>{
 const duplicate=analyze([i('DUP')]);
 const forward=analyze([i('CALLDICT',['1'])],{methods:new Map([[1,duplicate]])});
 assert.deepEqual(forward.argumentTypes,['X0']);
 assert.deepEqual(forward.returns.map(v=>v.type),['X0','X0']);
 const caller=analyze([i('CALLDICT',['2']),i('DROP'),i('CTOS')],{methods:new Map([[2,forward]])});
 assert.deepEqual(caller.argumentTypes,['cell']);
 assert.deepEqual(caller.returns.map(v=>v.type),['slice']);
 assert.deepEqual(duplicate.argumentTypes,['X0'],'callee must remain immutable across callers');
});
test('branches join generic input types and reject inconsistent concrete arguments',()=>{
 const choose=analyze([i('IFELSE',[],[[i('DROP')],[i('NIP')]])]);
 assert.deepEqual(choose.argumentTypes,['X0','X0','int']);
 assert.deepEqual(choose.returns.map(v=>v.type),['X0']);
 const options={arguments:3,hints:['cell','slice','int'],methods:new Map([[1,choose]])};
 assert.throws(()=>analyze([i('CALLDICT',['1'])],options),/Conflicting stack types/);
});
test('a null branch retains the type relation of the non-null branch',()=>{
 const optional=analyze([i('IFELSE',[],[[i('DROP'),i('PUSHNULL')],[]])]);
 assert.deepEqual(optional.argumentTypes,['X0','int']);
 assert.deepEqual(optional.returns.map(v=>v.type),['X0']);
});
test('loop-carried generic slots do not default to integers',()=>{
 const duplicate=analyze([i('DUP')]);
 const loop=analyze([i('REPEAT',[],[[i('CALLDICT',['1']),i('DROP')]])],{methods:new Map([[1,duplicate]])});
 assert.deepEqual(loop.argumentTypes,['X0','int']);
 assert.deepEqual(loop.returns.map(v=>v.type),['X0']);
 const loopWhile=analyze([i('WHILE',[],[[i('DUP')],[i('DEC'),i('SWAP'),i('CALLDICT',['1']),i('DROP'),i('SWAP')]])],{methods:new Map([[1,duplicate]])});
 assert.deepEqual(loopWhile.argumentTypes,['X0','int']);
 assert.deepEqual(loopWhile.returns.map(v=>v.type),['X0','int']);
});
test('late global constraints are revisited until signatures stabilize',()=>{
 const module=reconstruct(program([
  [1,[i('GETGLOB',['1']),i('SBITS')]],
  [2,[i('NEWC'),i('ENDC'),i('CTOS'),i('SETGLOB',['1'])]],
 ]));
 assert.deepEqual(module.functions.find(f=>f.id===1).returns.map(v=>v.type),['int']);
});
test('recursive calls without established stack arity remain unresolved',()=>{
 assert.throws(()=>reconstruct(program([[1,[i('CALLDICT',['1'])]]])),/Recursive method signature/);
});
test('method map permutations preserve signatures, output and original method IDs',()=>{
 const fixture=JSON.parse(readFileSync(new URL('./fixtures/signature-inference.json',import.meta.url)));
 const boc=Buffer.from(fixture.boc,'base64'), base=disassembleProgram(boc), cells=methodCells(boc);
 const entries=[...base.methods];
 let expected;
 for(const ordering of [entries,[...entries].reverse(),[...entries.slice(8),...entries.slice(0,8)]]) {
  const p={...base,methods:new Map(ordering)};
  const module=reconstruct(p,cells);
  assert.equal(module.functions.filter(f=>!f.helper&&!f.assembly).length,19);
  const output={func:render(module),tolk:renderTolk(module,p).source};
  if(expected) assert.deepEqual(output,expected); else expected=output;
  const ids=[...output.tolk.matchAll(/@method_id\((-?\d+)\)/g)].map(m=>Number(m[1])).sort((a,b)=>a-b);
  assert.deepEqual(ids,entries.map(([id])=>id).filter(id=>id>0).sort((a,b)=>a-b));
  assert.match(output.tolk,/method_2\(arg0\) as \(cell, cell\)/);
 }
});

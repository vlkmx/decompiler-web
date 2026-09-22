import test from 'node:test';
import assert from 'node:assert/strict';
import {instruction as i} from '../src/decompiler/asm.ts';
import {analyze} from '../src/decompiler/ir.ts';
import {matchTerminalExecute} from '../src/decompiler/patterns.ts';
const tail=[i('EXECUTE'),i('THROW',['1'])];
const optional=[i('DUP'),i('ISNULL'),i('PUSHCONT',[],[[i('DROP')]]),
 i('PUSHCONT',[],[[i('CTOS'),i('BLESS'),i('EXECUTE')]]),i('IFELSE'),i('THROW',['1'])];
test('terminal EXECUTE supplies the complete entrypoint stack without guessing return arity',()=>{
 const r=analyze(tail,{hints:['int','cell','cont']});
 assert.equal(r.arguments,3);
 assert.equal(r.changesC3,true);
 assert.deepEqual(r.returns,[]);
 assert.deepEqual(r.primitives[0].inputs,['X0','X1','cont']);
 assert.equal(r.primitives[0].assembly,'3 PUSHINT TUPLEVAR DEPTH DEC <{ NIP }>CONT REPEAT 3 PUSHINT UNTUPLEVAR EXECUTE 1 THROW');
 assert.equal(r.statements.at(-1).kind,'throw');
});
test('nullable upgrade tail remains a single opaque operation',()=>{
 assert.deepEqual(matchTerminalExecute(optional,0),{length:6,nullable:true,exit:1});
 const r=analyze(optional,{hints:['int','cell']});
 assert.equal(r.arguments,2);
 assert.match(r.primitives[0].assembly,/CTOS BLESS EXECUTE/);
 assert.deepEqual(r.primitives[0].outputs,[]);
});
test('dynamic results and incomplete ambient stacks remain unsupported',()=>{
 assert.throws(()=>analyze(tail),/complete entrypoint stack/);
 assert.throws(()=>analyze([i('EXECUTE'),i('ADD')],{hints:['cont']}),/stack signature/);
 assert.throws(()=>analyze(tail,{hints:[...Array(16).fill('int'),'cont']}),/16-argument asm limit/);
 for(const code of [[i('EXECUTE'),i('THROWIF',['1'])],
  [...optional.slice(0,-1),i('THROWANY')],
  [...optional.slice(0,-1),i('THROW',['2048'])]])
  assert.equal(matchTerminalExecute(code,0),undefined);
 const wrong=structuredClone(optional);wrong[3].blocks[0].push(i('DROP'));
 assert.equal(matchTerminalExecute(wrong,0),undefined);
});
test('static EXECUTE still executes its known continuation normally',()=>{
 const r=analyze([i('PUSHCONT',[],[[i('PUSHINT',['123'])]]),i('EXECUTE')]);
 assert.deepEqual(r.returns.map(v=>v.value),['123']);
});

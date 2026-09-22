import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isDecimalConversion, isDecimalDigitLoop } from '../src/decompiler/patterns.ts';
import { disassembleProgram } from '../src/decompiler/disassembler.ts';
import { continuations, analyze } from '../src/decompiler/ir.ts';
import { instruction as i, walk } from '../src/decompiler/asm.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/modern/DeskCollection.json', import.meta.url)));
const program = disassembleProgram(Buffer.from(fixture.boc, 'base64'));
const decimal = [...walk(program.methods.get(68445))].filter(i=>i.opcode === 'CALL')
  .map(i=>continuations(i.blocks[0])).find(isDecimalConversion);

test('decimal idiom is found from bytecode without registry/source-map names', () => {
  assert.ok(decimal);
  assert.equal(isDecimalDigitLoop(decimal[8].blocks[0], decimal.slice(10,13)),true);
});
test('changed radix, digit width, sign handling, or consumer must not match', () => {
  for (const mutate of [
    c=>{c[8].blocks[0][0].operands=['16'];},
    c=>{c[11].blocks[0][0].operands=['7'];},
    c=>{c[4].blocks[0][3].opcode='NOP';},
    c=>{c[4].blocks[0][1].operands=['x{2b}'];},
    c=>{c[12].opcode='DROP';},
    c=>{c.push(i('SWAP'));},
  ]) {
    const changed=structuredClone(decimal); mutate(changed);
    assert.equal(isDecimalConversion(changed),false);
  }
  // A bare digit loop has no guarantee that its input is nonnegative.
  assert.equal(isDecimalConversion(decimal.slice(6)),false);
  const bare = [i('PUSHINT',['0']),i('PUSHINT',['42']), ...decimal.slice(8,13)];
  assert.throws(()=>analyze(bare,{arguments:1,hints:['builder']}),/Loop changes stack height/);
});
test('vector LAST and fixed INDEX preserve element types and tuple operations', () => {
  const vector=[i('TUPLE',['0']),i('NEWC'),i('ENDC'),i('TPUSH')];
  for(const op of [i('LAST'),i('INDEX',['0'])]) {
    const result=analyze([...vector,op],{arguments:0});
    assert.equal(result.returns[0].type,'cell');
    assert.ok(result.primitives.some(p=>p.assembly===(op.opcode==='LAST'?'LAST':'0 INDEX')));
  }
  assert.throws(()=>analyze([i('TUPLE',['0']),i('LAST')],{arguments:0}),/Unknown vector element type/);
});

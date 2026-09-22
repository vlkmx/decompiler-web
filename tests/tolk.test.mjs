import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconstructReadable } from '../src/decompiler/core.ts';
import { renderTolk } from '../src/decompiler/tolk.ts';
import { expr, literal, statement } from '../src/decompiler/ir.ts';
import { instruction } from '../src/decompiler/asm.ts';

const fixture = name => JSON.parse(readFileSync(new URL(`fixtures/${name}.json`, import.meta.url)));
test('verified Tolk jetton minter: BOC → IR → Tolk, all four methods', () => {
  const f = fixture('modern/JettonMinter');
  const r = reconstructReadable(Buffer.from(f.boc, 'base64'), 'tolk');
  assert.equal(r.language, 'tolk');
  assert.equal(r.decompilation.original_code_hash, f.hash);
  assert.equal(r.decompilation.structured_method_count, 4);
  assert.equal(r.decompilation.method_count, 4);
  assert.match(r.contract, /fun onInternalMessage\(/);
  assert.match(r.contract, /@method_id\(\d+\)/);
  assert.match(r.stdlib, /asm "32 LDU";/);
  assert.equal(r.source, r.tolk);
  assert.equal(r.func, undefined);
  assert.equal(r.decompilation.verification_performed, false);
  assert.equal(r.decompilation.source_language, 'unknown');
});
test('FunC remains the default, independent of Tolk rendering', () => {
  const boc = Buffer.from(fixture('modern/JettonMinter').boc, 'base64');
  const before = reconstructReadable(boc);
  reconstructReadable(boc, 'tolk');
  assert.deepEqual(reconstructReadable(boc, 'func'), before);
  assert.equal(before.source, before.func);
  assert.match(before.contract, /recv_internal/);
});
test('compiled Tolk branches and repeat loops are recovered', () => {
  const r = reconstructReadable(Buffer.from(fixture('control-flow').boc, 'base64'), 'tolk');
  assert.equal(r.decompilation.structured_method_count, r.decompilation.method_count);
  assert.match(r.contract, /throw 42/);
  assert.match(r.contract, /repeat \(/);
  assert.match(r.contract, /\? -1 : 0/);
  assert.doesNotMatch(r.contract, /\bimpure\b|\bforall\b/);
});
test('TVM integer flags, until loops and conditional throws keep their polarity', () => {
  const arg = expr('arg', 'arg0');
  const module = { primitives: [], diagnostics: [], unsupported: [], functions: [{
    id: 123, name: 'method_123', args: [['int', 'arg0']], returns: [],
    statements: [statement('assign', [expr('local', 'flag'), expr('binary', '<', 'int', [arg, literal(2)])]),
      statement('until', [arg], [statement('throwifnot', [literal(9), arg])])],
  }] };
  const r = renderTolk(module, {instructions: [], methods: new Map()});
  assert.match(r.contract, /\(\(arg0 < 2\) \? -1 : 0\)/);
  assert.match(r.contract, /if \(arg0 == 0\) \{ throw 9; \}/);
  assert.match(r.contract, /while \(arg0 == 0\)/);
});
test('unresolved methods retain assembly and bytes without fake executable stubs', () => {
  const r = renderTolk({primitives: [], diagnostics: [], unsupported: ['MYSTERY'], functions: [{
    id: 0, name: 'recv_internal', args: [], returns: [], statements: [],
    diagnostic: 'Unknown instruction', assembly: ['B{abcd} B>boc <s s,'],
    partial: {args: [], stack: [literal(42)], statements: [statement('throw', [literal(7)])], primitives: [], remaining: [instruction('MYSTERY')]},
  }]}, {instructions: [], methods: new Map([[0, [instruction('MYSTERY')]]])});
  assert.match(r.contract, /UNRESOLVED/);
  assert.match(r.contract, /\/\/ MYSTERY/);
  assert.match(r.contract, /B\{abcd\}/);
  assert.match(r.contract, /Stack at boundary: 42/);
  assert.doesNotMatch(r.contract, /^fun /m);
});
test('invalid BOCs still fail validation', () => {
  assert.throws(() => reconstructReadable(Buffer.from('bad'), 'tolk'), /BOC/);
});

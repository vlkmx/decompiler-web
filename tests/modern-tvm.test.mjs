import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { analyze } from '../src/decompiler/ir.ts';
import { instruction as i } from '../src/decompiler/asm.ts';
import { reconstructReadable } from '../src/decompiler/core.ts';
const ir = (ops, hints = []) => analyze(ops, { arguments: hints.length, hints });

test('address loads return address then remaining slice; stores keep stack order', () => {
  for (const op of ['LDSTDADDR', 'LDOPTSTDADDR']) {
    const r = ir([i(op)], ['slice']);
    assert.deepEqual(r.returns.map(e => e.type), ['slice', 'slice']);
    assert.deepEqual(r.statements[0].values[1].args.map(e => e.value), ['arg0']);
  }
  for (const op of ['STSTDADDR', 'STOPTSTDADDR']) {
    const r = ir([i(op)], ['slice', 'builder']);
    assert.deepEqual(r.returns.map(e => e.type), ['builder']);
    assert.throws(() => ir([i(op)], ['builder', 'slice']), /Conflicting stack types/);
  }
  const r = ir([i('PUSHNULL'), i('NEWC'), i('STOPTSTDADDR')]);
  assert.equal(r.returns[0].type, 'builder');
});
test('reversed integer stores consume builder before integer and retain width', () => {
  for (const op of ['STUR', 'STIR']) {
    const r = ir([i(op, ['32'])], ['builder', 'int']);
    assert.equal(r.primitives[0].assembly, `32 ${op}`);
    assert.equal(r.returns[0].type, 'builder');
    assert.throws(() => ir([i(op, ['32'])], ['int', 'builder']), /Conflicting stack types/);
  }
});
test('conditional selection preserves operands and rejects incompatible branches', () => {
  const r = ir([i('CONDSEL')], ['slice', 'slice', 'int']);
  assert.equal(r.returns[0].type, 'slice');
  assert.deepEqual(r.statements[0].values[1].args.map(e => e.value), ['arg0', 'arg1', 'arg2']);
  assert.equal(r.primitives[0].assembly, 'CONDSEL');
  assert.throws(() => ir([i('CONDSEL')], ['slice', 'cell', 'int']), /Conflicting stack types/);
});
test('quiet data-size operations require padding on the failure path', () => {
  const r = ir([i('CDATASIZEQ'), i('NULLSWAPIFNOT2'), i('NULLSWAPIFNOT')], ['cell', 'int']);
  assert.equal(r.returns.length, 4);
  assert.equal(r.primitives[0].assembly, 'CDATASIZEQ NULLSWAPIFNOT2 NULLSWAPIFNOT');
  assert.throws(() => ir([i('CDATASIZEQ')], ['cell', 'int']), /needs padded results/);
  assert.throws(() => ir([i('LDSTDADDRQ')], ['slice']), /LDSTDADDRQ/);
});
test('modern message and builder instructions infer useful downstream types', () => {
  const r = ir([i('INMSG_SRC'), i('NEWC'), i('STSTDADDR'), i('HASHBU')]);
  assert.equal(r.arguments, 0);
  assert.equal(r.returns[0].type, 'int');
  const b = ir([i('INMSG_BOUNCED'), i('INMSG_VALUE'), i('ADD')]);
  assert.equal(b.returns[0].type, 'int');
  const s = ir([i('NEWC'), i('BTOS')]);
  assert.equal(s.returns[0].type, 'slice');
});
for (const name of readdirSync(new URL('./fixtures/modern/', import.meta.url))) {
  const fixture = JSON.parse(readFileSync(new URL(`./fixtures/modern/${name}`, import.meta.url)));
  test(`Tolk ${fixture.compiler} ${fixture.name}: ${fixture.methods}/${fixture.methods}`, () => {
    const r = reconstructReadable(Buffer.from(fixture.boc, 'base64'), 'tolk');
    assert.equal(r.decompilation.original_code_hash, fixture.hash);
    assert.equal(r.decompilation.structured_method_count, fixture.methods);
    assert.equal(r.decompilation.method_count, fixture.methods);
    assert.deepEqual(r.decompilation.unsupported_instructions, []);
    assert.equal(r.decompilation.verification_performed, false);
    assert.doesNotMatch(r.contract, /fun method_\d+</);
    // Same lifted instructions must also remain renderable in the FunC mode.
    const func = reconstructReadable(Buffer.from(fixture.boc, 'base64'), 'func');
    assert.equal(func.decompilation.structured_method_count, fixture.methods);
  });
}

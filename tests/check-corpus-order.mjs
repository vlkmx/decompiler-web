// Compare complete IR and rendered output under reversed method-map traversal.
// node --import ./tests/register.mjs tests/check-corpus-order.mjs ../tolk-benchmark ../func-benchmark
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {disassembleProgram} from '../src/decompiler/disassembler.ts';
import {methodCells} from '../src/decompiler/boc.ts';
import {reconstruct,render} from '../src/decompiler/func.ts';
import {renderTolk} from '../src/decompiler/tolk.ts';
for(const root of process.argv.slice(2)) {
 let checked=0;
 const rows=JSON.parse(fs.readFileSync(path.join(root,'after.json')));
 for(const row of rows) {
  if(row.error || row.total===undefined) continue;
  const boc=Buffer.from(fs.readFileSync(path.join(root,'boc',row.hash+'.b64'),'utf8'),'base64');
  const base=disassembleProgram(boc), cells=methodCells(boc);
  const reverse={...base,methods:new Map([...base.methods].reverse())};
  const a=reconstruct(base,cells),b=reconstruct(reverse,cells);
  assert.deepEqual(b,a,`IR order dependence: ${row.name} (${row.hash})`);
  assert.equal(render(b),render(a),`FunC order dependence: ${row.hash}`);
  assert.equal(renderTolk(b,reverse).source,renderTolk(a,base).source,`Tolk order dependence: ${row.hash}`);
  checked++;
 }
 console.log(`${root}: ${checked} contracts preserve IR, signatures, diagnostics and both outputs under reversed method order.`);
}

// Recompile every fully structured contract from a saved corpus.
// FUNC_COMPILER or TOLK_COMPILER points to the exact compiler package directory.
// node --import ./tests/register.mjs tests/compile-corpus.mjs ../tolk-benchmark tolk
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {reconstructReadable} from '../src/decompiler/core.ts';
const [root,language]=process.argv.slice(2);
assert.ok(root && ['func','tolk'].includes(language));
const require=createRequire(import.meta.url);
const compiler=require(path.resolve(process.env[language==='func'?'FUNC_COMPILER':'TOLK_COMPILER']));
const rows=JSON.parse(fs.readFileSync(path.join(root,'after.json')));
let checked=0, failed=0;
for(const row of rows) {
 if(!row.total || row.error || row.structured!==row.total) continue;
 const result=reconstructReadable(Buffer.from(fs.readFileSync(path.join(root,'boc',row.hash+'.b64'),'utf8'),'base64'),language);
 assert.equal(result.decompilation.original_code_hash,row.hash);
 assert.equal(result.decompilation.structured_method_count,row.total);
 const source=result.source;
 const output=language==='func'
  ? await compiler.compileFunc({targets:['restored.fc'],sources:{'restored.fc':source}})
  : await compiler.runTolkCompiler({entrypointFileName:'restored.tolk',fsReadCallback:p=>{
    assert.equal(p,'restored.tolk'); return source;
  }});
 row.recompiled=output.status==='ok';
 delete row.compileError;
 if(!row.recompiled) { row.compileError=output.message; failed++; console.error(row.name,output.message); }
 checked++;
}
fs.writeFileSync(path.join(root,'compiled.json'),JSON.stringify(rows,null,2)+'\n');
console.log(JSON.stringify({language,checked,passed:checked-failed,failed}));
assert.equal(failed,0,'Some fully structured contracts failed recompilation');

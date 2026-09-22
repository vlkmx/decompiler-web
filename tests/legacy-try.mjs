// Test-only conversion of compiler snapshots to the older c4/c5/c7 format.
import {Cell,runtime} from '@ton/tasm';
import assert from 'node:assert/strict';
export function legacyTry(boc) {
 let changed=0;
 function visit(code) {
  const result=[];
  for(let n=0;n<code.length;n++) {
   const ins={...code[n]};
   if([1,3,4,5,7].every((r,k)=>code[n+k]?.$==='PUSHCTR' && code[n+k].arg0===r)) {
    assert.ok(code[n+5].$.startsWith('PUSHCONT'));
    assert.ok([7,5,4,3,1].every((r,k)=>code[n+6+k]?.$==='SETCONTCTR' && code[n+6+k].arg0===r));
    result.push(...visit(code.slice(n+2,n+9)));
    n+=10;changed++;continue;
   }
   for(const key of ['arg0','arg1']) {
    const arg=ins[key];
    if(arg?.$==='DecompiledDict') ins[key]={...arg,methods:arg.methods.map(m=>({...m,instructions:visit(m.instructions)}))};
    if(arg?.$==='Instructions') ins[key]={...arg,instructions:visit(arg.instructions)};
    if(arg?.$==='Raw' && ins.$.startsWith('PUSHCONT'))
     ins[key]={$:'Instructions',instructions:visit(runtime.decompileCell(arg.slice.asCell()))};
   }
   result.push(ins);
  }
  return result;
 }
 const code=visit(runtime.decompileCell(Cell.fromBase64(boc)));
 assert.ok(changed>=7,'all fixture snapshots visited');
 return runtime.compileCell(code).toBoc().toString('base64');
}

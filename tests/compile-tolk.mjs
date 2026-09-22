// Optional compiler smoke test. The runtime/browser has no compiler dependency.
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { reconstructReadable } from '../src/decompiler/core.ts';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const compiler = process.env.TOLK_COMPILER;
if (!compiler) throw new Error('Set TOLK_COMPILER to an installed @ton/tolk-js package directory (tested: 0.12.0).');
const { runTolkCompiler, getTolkCompilerVersion } = require(resolve(compiler));
const fixtures = ['./fixtures/control-flow.json'];
if ((await getTolkCompilerVersion()).startsWith('1.4.'))
  fixtures.push(...readdirSync(new URL('./fixtures/modern/', import.meta.url)).map(n => './fixtures/modern/' + n));
for (const fixture of fixtures) {
  const input = JSON.parse(readFileSync(new URL(fixture, import.meta.url)));
  const output = reconstructReadable(Buffer.from(input.boc, 'base64'), 'tolk');
  const compiled = await runTolkCompiler({ entrypointFileName: 'reconstructed.tolk',
    fsReadCallback: filename => {
      if (filename !== 'reconstructed.tolk') throw new Error(`Unexpected import: ${filename}`);
      return output.source;
    },
  });
  assert.equal(compiled.status, 'ok', compiled.message);
  console.log(`${fixture}: generated Tolk compiles; equivalence has not been checked`);
}

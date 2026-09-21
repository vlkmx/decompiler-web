import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { reconstructReadable } from '../dist/core.js';
import { runWorker } from '../dist/api.js';

for (const [name, count] of [
  ['nft-item', 6],
  ['user_wallet', 7],
  ['user_jetton', 5],
  ['stdlib_contract', 15],
]) {
  test(`${name}: complete static recovery and compiled API result`, async () => {
    const code = readFileSync(new URL(`./fixtures/${name}.b64`, import.meta.url), 'utf8').trim();
    const result = reconstructReadable(Buffer.from(code, 'base64'));
    assert.equal(result.decompilation.structured_method_count, count);
    assert.equal(result.decompilation.method_count, count);
    assert.deepEqual(result.decompilation.unsupported_instructions, []);
    if (name === 'nft-item')
      assert.equal(
        result.decompilation.original_code_hash,
        '90b16c83fea5e569181eff3ee890e1ae32f28839c75bb71c6a5e44dd91eb9c6f',
      );
    const { status, response } = await runWorker({ code, verify: true, max_search_time_ms: 30000 });
    assert.equal(status, 200);
    assert.equal(response.decompilation.exact_hash_match, true);
    const readable = response.readable ?? response;
    assert.equal(readable.decompilation.structured_method_count, count);
    assert.equal(readable.decompilation.recompiles, true);
  });
}

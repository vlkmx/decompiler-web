# TON Decompiler

Browser-based reconstruction of TON contract bytecode into readable FunC or experimental Tolk.

## Development

Requires Node.js 22+.

```sh
npm ci
npm run dev
```

## Production

```sh
npm run build
npm start
```

Next.js builds the application and browser worker together. No separate decompiler build or API is required.

## Structure

- `src/pages/index.tsx` — input, source preview, copying and downloads.
- `src/decompiler/` — static TypeScript reconstruction logic.
- `src/lib/decompiler.worker.ts` — browser worker and input validation.
- `src/styles/` — page styles.

Paste a base64 code-cell BOC (up to 1 MiB decoded). Processing stays in the browser;
results are cached in memory until the page is reloaded. Cancel, navigation,
errors, and the 30-second timeout terminate the worker.

Results are unverified static reconstructions. Unsupported methods retain assembly
or partial TVM pseudocode; the interface shows how many methods were recovered.
The contract download includes helper definitions and preserved bytecode.
No compiler, TVM execution, server processing, or persistent storage is used.

## Experimental Tolk output

Paste a contract code BOC, select **Tolk (experimental)**, then **Decompile**.
Downloads use `.tolk` and include the assembly helper definitions. Everything still
runs inside the browser worker; no source registry or compiler is needed at runtime.

The Tolk renderer consumes the TVM stack IR directly. It emits typed functions,
method IDs, entrypoints, integer-preserving comparisons, branches, loops, throws,
and typed assembly helpers. The output uses low-level Tolk syntax tested with
Tolk 0.12.0 and 1.4.2, including legacy message-handler signatures. This is not recovery
of original structs, names, imports, or modern `InMessage` source abstractions.
Output language is a user choice, not detection of the original compiler.

Unsupported methods are commented assembly with preserved method-cell bytes and,
when available, a recovered prefix. Such output is incomplete and must not be
used as an executable replacement. Other unsupported stack types or compiler
versions may also require manual edits. No behavioral equivalence or identical
bytecode is promised, even when output compiles.

### Validation

```sh
npm test
npm run build
# Optional: point at an installed @ton/tolk-js compiler (tested with 0.12.0).
TOLK_COMPILER=/absolute/path/to/tolk-js node --import ./tests/register.mjs tests/compile-tolk.mjs
```

Tests require Node 22.15+ (or Node 24+) for module hooks. Fixtures cover a real
Tolk jetton minter, control flow, integer flags, partial recovery and FunC
regression. The jetton test fixture in `tests/fixtures/modern/JettonMinter.json`
covers all four methods of a Tolk 1.4.2 contract. The control-flow fixture
includes its original source and compiler version.

Tolk emitter syntax follows the official [assembler function documentation](https://docs.ton.org/blockchain-basics/tolk/features/asm-functions).

### Modern TVM coverage

The shared stack analyzer supports inbound message parameters, standard/optional
addresses, builder hashing and conversion, reversed stores, conditional selection,
variable shifts, prefix checks and padded quiet data-size queries. Quiet operations
with unresolved stack shape still fall back to assembly.

On the unchanged set of 39 hash-verified Tolk 1.4.2 contracts, structured recovery
improved from 101/427 to 363/427 methods across 38 parseable contracts. Multisig
still fails on exotic cells. These counts describe recovered IR, not equivalence.
The 28 fully recovered contracts also compile back with Tolk 1.4.2.

The test suite includes seven modern registry BOCs, plus stack-order, failure-path
and output checks. Optional compiler checks include them when TOLK_COMPILER points
to 1.4.x. Re-run coverage against the saved corpus with:

```sh
node --import ./tests/register.mjs tests/benchmark-tolk.mjs ../tolk-benchmark
```

Instruction semantics follow the upstream [TVM version specification](https://github.com/ton-blockchain/ton/blob/master/doc/GlobalVersions.md)
and the bundled Tolk standard library. No compiler is shipped to the browser.

### DeskCollection: decimal strings and snake content

The DeskCollection fixture (Tolk 1.4.1, hash
`2c78609d8d102635e9056364a588e30892b57a5c65b9d2b48011dd2eae0861e5`)
now recovers 6/6 methods, up from 5/6. `get_nft_content` uses the standard-library
decimal conversion's stack-growing UNTIL loop. Its exact signed conversion and
consuming REPEAT pattern are recognized from instructions, with the digits
represented as a typed tuple in the reconstructed loops. Unmatched dynamic-stack
loops still fall back. Typed-vector LAST and constant INDEX are also supported.
Source maps and original names are not used for recognition.

Optional differential getter checks compile the reconstructed output and execute
both versions in TVM. The 64 cases cover all five getters, zero, positive and
negative indices, extreme TVM integers (including matching overflow failure),
and flat/multi-cell content strings. Successful cases compare exact result stack
cell hashes. Gas usage, internal messages and arbitrary inputs are not proven
equivalent.

```sh
TVM_SANDBOX=/absolute/path/to/@ton/sandbox TOLK_COMPILER=/absolute/path/to/tolk-js \
  node --import ./tests/register.mjs tests/desk-vm.mjs
```

### Shared FunC / Tolk coverage audit

See [coverage details and remaining method IDs](docs/coverage.md). On 192 parseable,
hash-verified FunC 0.4.6 contracts, this audit increases recovery from 1792/3187 to
1919/3187 methods. All 142 fully recovered outputs compile with FunC 0.4.6.
The shared analyzer now handles transforming WHILE conditions, more dictionary
operations, slice extraction and immediate shifted division. Unresolved dynamic
calls, tuples and type conflicts still retain assembly fallback.

```sh
node --import ./tests/register.mjs tests/benchmark-corpus.mjs ../func-benchmark func
FUNC_COMPILER=/absolute/path/to/@ton-community/func-js \
TOLK_COMPILER=/absolute/path/to/tolk-js \
TVM_SANDBOX=/absolute/path/to/@ton/sandbox \
  node --import ./tests/register.mjs tests/corpus-vm.mjs
```

The differential fixture includes its original FunC source and BOC; 147 input cases
compare both reconstructed languages with the original bytecode, including errors.

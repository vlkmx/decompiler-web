# Python-to-TypeScript reconstruction parity

The missing reconstruction features identified by the audit have been ported into the web engine. All Python-supported instruction snippets and contract examples in the current suite now recover successfully. Python is used only as a development reference; the application remains a standalone TypeScript implementation.

## Results

- **266/266** Python-supported instruction snippets have matching inferred argument and return types.
- **54/57** compiled examples and BOC fixtures are fully recovered in TypeScript. The remaining three are deliberate unsupported-control-register tests that also remain unsupported in Python.
- **Zero** Python-only fully recovered contracts and **zero** compilation failures in complete TypeScript reconstructions.
- The user-provided NFT contract recovers **6/6** methods; Wallet V5 recovers **7/7** methods. Private continuation helpers do not inflate these counts.
- **308 sampled VM comparisons** match, including successful result stacks and exception exit codes.
- **25 standalone regression tests** pass. These include boundary/rounding cases, vectors and record lists, continuation return targets, API verification, and **19 Wallet V5 transaction scenarios** checking signatures, errors, persistent data and action lists.
- The production Next.js build passes.

See [the generated report](parity/REPORT.md) and [machine-readable results](parity/results.json) for individual cases and diagnostics. The source examples are harvested from Python tests; two incomplete or incompatible source-string fragments are excluded with their compiler errors recorded.

## What was ported

| Area | Implementation |
| --- | --- |
| Global state | `GETGLOB` / `SETGLOB` type inference, null checks and call-site ordering |
| Collections | Empty and homogeneous vectors, `TPUSH` / `TPOP` / `TLEN` / `INDEXVAR`, nested tuple types, linked lists and lists of records; helper names distinguish different element types |
| Loops | Types inferred from condition and body, invariant arguments, null/empty seeds, effectful conditions, body-produced flags, `AGAINEND` and scoped alternate returns |
| Continuations | Local early returns skip only the current continuation's tail; stable `c3` dispatcher calls; private helpers for scoped alternate returns; collision handling for explicit low method IDs |
| Dictionaries | Add, delete-and-get, minimum reference and prefix lookup, with padded optional outputs |
| Primitives | Rounded division and immediate shifts, multiply-shift variants, modulus, slice prefix/substrings, constant stores, builder capacity, random/gas/environment and Ristretto operations |
| Decoder | Immediate-opcode aliases and control-register notation normalized for the analyzer |
| Output and service | Callees emitted before callers, typed private helper handling, original-method-only counts and exact-bytecode repair |

## Correctness fixes verified in TVM

A helper-local early return previously could become a return from the entire caller: `helper(0) + 10` produced 7 instead of 17. Both conditional-jump variants now preserve the caller's remaining instructions and are exercised with normal and overflowing inputs.

Wallet V5 exposed a second issue that successful compilation did not detect: an effectful private function declared after its caller could disappear from the compiled code. Functions are now emitted in dependency order. Transaction tests compare error codes, persistent data and actions, including paths after `COMMIT`, extension changes and linked action continuations.

## Repeating the checks

```sh
npm test
npm run build
PYTHON=python3.12 npm run test:parity
```

The parity audit requires Python 3.12+ and the reference checkout at `../decompiler` (override with `PYTHON_DECOMPILER_ROOT`). Standalone tests include their fixtures and require neither neighboring project.

`test:parity` fails on any Python-only recovery, instruction-signature gap, compilation failure, sampled VM mismatch or loss of previously recovered methods. After reviewing a successful run, update the baseline with:

```sh
PYTHON=python3.12 npm run audit:parity -- --check --update-baseline
```

## Limits of the result

This is parity on the available test suite, not universal decompilation or a proof of semantic equivalence for every possible input. The audit shares decoded instructions between the two analyzers; end-to-end BOC and VM tests additionally exercise the web decoder. Tests compare behavior, not gas costs, and recompilation can produce a different code hash. The API continues to publish exact-bytecode preservation separately from the readable view.

The original large development corpus and historical compiler matrix are not present in these checkouts. Dynamic control-register manipulation, recursive/unknown signatures and nonstandard dispatchers remain outside the supported reconstruction subset, as in the Python implementation.

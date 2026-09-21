# TON Decompiler · Next.js

A web interface and API for recovering readable FunC from a base64-encoded TON contract code-cell BOC.

## Getting started

Requires Node.js 22+.

```sh
npm ci
npm run dev
```

Open http://localhost:3000. The TypeScript engine builds automatically before `dev` and `build`.

```sh
npm run build
npm start
```

`engine/` is a standalone copy of the TypeScript decompiler, installed as a local package. The neighboring `decompiler` and `decompiler-node` projects are not required. After changing the engine, run `npm run build:engine` and restart the server.

## API

```sh
curl http://localhost:3000/api/decompile \
  -H 'Content-Type: application/json' \
  -d '{"code":"<base64 BOC>","verify":true,"max_search_time_ms":30000}'
```

- `code` — a code-cell BOC (not an account or StateInit), up to 1 MiB after decoding.
- `verify` — recompile using FunC/Fift WASM; defaults to `true`. When `false`, uses static TypeScript reconstruction without a compiler.
- `max_search_time_ms` — a time budget of 1–30000 ms; defaults to 30000.
- `readable.contract` — the readable contract; `readable.stdlib` — helper definitions; `readable.func` — the complete source. If `readable` is absent, use the top-level fields.
- With verification enabled, the top-level `func` preserves the exact code hash and may contain assembly. The readable version is checked separately; compilation with a different hash does not establish behavioral equivalence.
- With `verify: false`, the top-level fields contain the readable, unverified result.
- Hybrid results also provide `display_contract` and `display_stdlib`: a non-compilable FunC/TVM preview with recovered prefixes, the stack at each unresolved boundary, and the remaining instructions. The web page shows this preview; downloading the contract still saves the complete executable FunC source with original method cells preserved.

Compilation requires the complete `.func`, not just `.contract`. The download button on the readable FunC tab saves the complete source, including helpers.

Errors: 400 — invalid input; 405 — method not allowed; 413 — payload too large; 415 — unsupported Content-Type; 422 — decompilation failed; 503 — all worker slots are busy; 504 — timeout.

## Execution and limitations

The API starts a separate Node.js process for each request, with up to four concurrent processes per server instance. The process is terminated if the client disconnects or the deadline is exceeded. The compiler runs in a Worker Thread. Production decompilation does not execute contracts in TVM or use Python or Go. Development tests use a TVM emulator.

Deployment requires Node.js with child-process support and a request timeout of at least 40 seconds. Static export and the Edge runtime are not supported. Deploying a prebuilt application requires `engine/dist`, `engine/package.json`, and installed dependencies. Next.js file tracing is configured for the API and WASM compiler. The per-process heap limit does not replace external limits on total memory usage.

High-level reconstruction covers all Python-supported cases in the current parity suite, including typed global state, vectors and lists, dictionaries, loops, nested continuation returns, and Wallet V5. This is measured coverage, not a guarantee for arbitrary TVM programs. Unsupported methods remain in assembly; the interface shows how many original methods were recovered. Private continuation helpers are excluded from method counts.

Runtime continuations support `BLESS`, reading/writing `c3`, and explicit `CALLXARGS p,0` calls through typed assembly helpers. `PREPAREDICT` calls retain the runtime dispatcher, including a replaced `c3`. Calls with unknown return signatures (`EXECUTE`) and captured exception handlers (`SETCONTCTR` / `TRY`) remain unresolved; their readable prefixes appear in the preview and do not count as fully recovered methods. The dynamic contract fixture currently recovers 14 of 18 methods fully and previews the remaining four.

`GETGLOB` / `SETGLOB` are supported with type inference from assignments, including assignments before calls to other methods. `GETGLOB ISNULL` checks work without a previously established type. Run `npm test` for standalone regression tests, including recovery and API compilation of all six methods in the NFT contract fixture, TVM comparisons for collections and control flow, and Wallet V5 transactions that check signatures, persistent data and actions.

## Request data

The API does not fetch contracts from the network or save the input BOC or result to files, databases, logs, or caches. Processing takes place in memory in a separate process that terminates after the response. HTTP responses include `Cache-Control: no-store`. On the page, data is held only in React state, without localStorage or sessionStorage. Files are downloaded only when the user clicks Download.

## Python parity audit

Run the development audit to find missing features without checking contracts manually:

```sh
PYTHON=python3.12 npm run audit:parity
PYTHON=python3.12 npm run test:parity
```

The audit requires Python 3.12+ and the reference repository at `../decompiler`; override its location with `PYTHON_DECOMPILER_ROOT`. Five BOC fixtures are included in `engine/tests/fixtures`, so the neighboring Node project is not needed. These dependencies are used only by the development audit, never by the web application.

The audit extracts Python-supported instruction snippets and compilable FunC examples from the reference tests, adds parameterized probes, and compares reconstruction, compilation and sampled TVM execution. Successful return stacks and exception codes are compared for getter samples. Results are written to `reports/parity/REPORT.md` and `results.json`; set `PARITY_OUTPUT` to change the output directory. See [the porting results and limitations](reports/PARITY.md).

`test:parity` fails on any Python-supported instruction or contract that the web engine cannot recover, sampled TVM mismatches, compilation failures, or regressions against `scripts/parity-baseline.json`. After reviewing intentional changes, update the baseline explicitly with `npm run audit:parity -- --update-baseline`. Keep the same reference checkout when comparing against a baseline. Baseline updates are refused if any parity check fails.

The VM checks cover specific inputs and transactions; they are not a proof of equivalence for every input. Matching stack signatures or successful compilation alone cannot establish correctness. Historical compiler fingerprinting and the complete original development corpus are outside this suite.

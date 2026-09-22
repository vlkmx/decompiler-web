# Coverage audit — 2026-09-22

These are structured-reconstruction counts, not a proof of semantic equivalence. Method counts include entrypoints and helper methods present in the bytecode; inlined source functions are not separate methods. Duplicate code families remain separate corpus entries.

| Source corpus | Hash-verified BOCs | Parsed contracts | Structured methods | Fully structured contracts |
|---|---:|---:|---:|---:|
| Tolk 1.4.2 | 39 | 38 | 378 / 427 (88.5%) | 29 |
| FunC 0.4.6 | 193 | 192 | 1950 / 3187 (61.2%) | 145 |

Tolk originally had 101/427 in the saved baseline; the previous reported checkpoint was 330/427. FunC had 1792/3187 immediately before this audit. The opcode/caller-hint pass added 14 Tolk methods and 26 FunC methods relative to the 363/1919 checkpoint. The signature-inference pass adds one more Tolk method (Doom: 10/24), with FunC unchanged at 1945/3187. No per-contract coverage regression against the saved baselines or the 363/1919 and 377/1945 checkpoints; parsed-contract and method denominators are unchanged.

Scope: the registry contains 322 Tolk and 1192 FunC packages. This audit is a compiler-version subset, not every registry contract. Of 209 FunC 0.4.6 source packages attempted, 193 compiled to the exact registry hash and 16 failed source compilation (including incomplete bundles / helper-only entrypoints). One BOC in each language corpus could not be disassembled; these are excluded from method denominators, not counted as recovered.

## Implemented

- Dynamic `EXECUTE` followed immediately by `THROW`, including the exact nullable-cell upgrade idiom, can be emitted as one terminal asm helper. Analysis requires the complete entrypoint stack (up to the compiler’s 16-argument asm limit), preserves its order and strips compiler temporaries before execution. No dynamic return signature is invented. Arbitrary result-consuming calls, incomplete caller stacks and legacy catch snapshots that cannot restore c3 still use bytecode fallback. Tolk represents continuation values as opaque `unknown` slots.

- Exact compiler-generated `SETCONTCTR`/`TRY` sequences reconstruct as native FunC and Tolk `try/catch`, including captured stack values, nested handlers and early returns. Both legacy c4/c5/c7 and newer c1/c3/c4/c5/c7 snapshots are recognized. Legacy snapshots with a possible c3 mutation inside the protected block remain assembly. Arbitrary continuation save lists and unresolved exception argument types are not guessed.

- Parametric one-slot signatures preserve input/output type relationships through chains of calls, branches, nullable returns and loop state. Each call instantiates its own type variables; downstream uses constrain the corresponding caller inputs without mutating the callee. Conflicting concrete constraints are still rejected.
- Method discovery rebuilds successful and failed IR until signatures, global constraints and structural tuple hints stabilize. Method/helper discovery uses canonical ID order. Unknown recursive arities are never guessed; non-convergence retains bytecode fallbacks.
- Tolk keeps original exported method IDs and represents parametric slots as `unknown`; statically inferred call result types are restored with casts. Local type declarations are normalized consistently, without introducing private functions that could collide with method IDs.
- LDONES, LDZEROES and LDSAME preserve TVM output order (count, remaining slice), including references and range exceptions.
- WHILE conditions may transform the carried stack; false exits retain the stack produced by the final condition evaluation.
- Slice/integer-key dictionary iteration, reference values, padded builder updates and immediate throwing lookups.
- Immediate shifted division in floor/nearest/ceiling modes.
- Bit/reference slice operations, including SCUTFIRST, SSKIPFIRST, SCUTLAST, SSKIPLAST and SUBSLICE.
- STONES, SENDMSG, RANDSEED, DICTSET and DICTSETREF.

## Validation

- 117 dynamic-call transaction cases compare exit codes, stored data and action lists in the original and reconstructed FunC/Tolk: direct/nullable calls, full register catch snapshots, 16-slot incoming stacks, argument order and depth, arbitrary return-stack sizes, exceptions, RETALT, c3 updates, RAWRESERVE and COMMIT. Nine cases use the reported pool bytecode and its actual upgrade message/storage format. Gas and bytecode-introspection equivalence are not claimed.

- 126 try/catch differential cases pass for both snapshot formats and both reconstructed languages: 123 getter cases compare stacks and exit codes; three internal-message cases compare persistent data and action lists on success and caught failure.

- 47 unit/regression tests pass.
- 147 differential input cases each run against original FunC bytecode and reconstructed FunC and Tolk: empty/populated dictionaries, missing-key exceptions, WHILE zero/multiple iterations and transformed exit stacks, signed shifted division, division by zero, slices with references and underflow errors. Compare serialized result-stack hashes and exit codes.
- 73 additional differential cases for typed helper calls, both branches, nullable cells, repeat loops with zero/multiple iterations, slice run lengths from empty through 1023 bits, retained references, invalid bit arguments and null-to-slice exceptions. Both output languages match original bytecode.
- 199 additional differential cases cover shared polymorphic helpers, transitive calls, branch selection, nullable returns, repeat/while zero-iteration paths, until loops, cell/slice/tuple/integer arguments, downstream type constraints and exception codes. Original bytecode is compared with both reconstructed languages, including direct calls to generic method IDs with heterogeneous TVM values.
- All 230 parsed contracts (38 Tolk + 192 FunC) preserve identical IR, signatures, diagnostics and both rendered outputs when the method map is reversed. The regression fixture also checks rotated method order.
- Existing DeskCollection test: 64 differential getter cases.
- All 29 fully structured Tolk contracts recompile with Tolk 1.4.2; all 145 fully structured FunC contracts recompile with FunC 0.4.6.
- Compilation does not prove arbitrary-input equivalence. Gas, internal-message paths and full-contract behavior have not been differentially verified across the corpus.

## Remaining work

The reported pool (`192535677eed65c20ac387efe4dd7415ad9ebb9349103e87c60e592538c9dcf3`) now reconstructs 26/26 methods and recompiles in both FunC and Tolk. Its dynamic upgrade tail remains an explicit asm helper; the runtime-supplied payload itself is not statically reconstructed. Recovering method 0 also establishes the tuple types needed by methods 71/72. This fixture is additional to the saved corpus counts above.

Parametric signatures handle one-slot polymorphism, but type conflicts still need better inference for structural tuples, globals and recursive calls; they are analyzer limitations, not evidence of invalid original contracts. Dynamic continuations (EXECUTE/CALLXARGS), recursive/unknown-signature CALLDICT calls, generic tuples and variable indexes need deeper control-flow/type analysis. Quiet dictionary operations without explicit padding need path-sensitive stack shapes. Debug operations and remaining fixed-signature opcodes are smaller additions, but must preserve their unusual stack behavior. Exotic cells need disassembler support.

The try/catch pass adds five FunC methods and three fully structured contracts relative to 1945/3187 and 142. Tolk coverage is unchanged.

## Tolk remaining gaps

Counts below are contracts encountering each first blocking instruction/category; a method can conceal further unsupported instructions after that point.

| Blocker | Contracts |
|---|---:|
| `type` | 7 |
| `CALLDICT` | 1 |
| `DICTUADDGETB` | 1 |
| `EXECUTE` | 1 |
| `GETGLOB` | 1 |
| `PREVKEYBLOCK` | 1 |
| `SETINDEXVAR` | 1 |

### ListedRouterTon.tolk — 32/39

Code hash: `01fa723e24115bccc2bf641292ba852fe356c6ee20d8276d5303807a99100b54`

- Method 0: Conflicting stack types: slice and int
- Method 3: Conflicting stack types: slice and int
- Method 4: Conflicting stack types: slice and int
- Method 7: Conflicting stack types: slice and int
- Method 8: Conflicting stack types: slice and int
- Method 9: Conflicting stack types: slice and int
- Method 16: Conflicting stack types: slice and int

### contracts/validator-registry.tolk — 3/4

Code hash: `10b3b24d2f21600f24e6dabb9df6368a544893752170f4c4e34ecfd267d24cac`

- Method -1: Unsupported instruction: PREVKEYBLOCK

### config/contracts/Config.tolk — 8/12

Code hash: `3108dfa1aa72aef76eb89c28e1e7fae3295cb067e79f32b04b22fcfcbef5a505`

- Method -2: Conflicting stack types: cell and int
- Method -1: Conflicting stack types: cell and int
- Method 0: Conflicting stack types: cell and int
- Method 10: Conflicting stack types: cell and int

- Unparsed `multisig-v2.1/contracts/Multisig.tolk` (`329f7515947bb36f1ea704980286ffbedfecd41c0ca64c733b3a245b9b28ab49`): Error: Exotic and levelled cells are unsupported

### jetton_minter.tolk — 3/4

Code hash: `44e5c23b0a864ac484b3cde7b8a6ded1c8b62f37e1602f003c015260390f155d`

- Method 0: Conflicting stack types: slice and int

### contracts/emoji_nft_collection.tolk — 13/14

Code hash: `5906aec77f285718fd8bc64dc7df86976b00653ec6362736f10f7df7fb0715bb`

- Method 0: Conflicting stack types: cell and int

### ListedRouterTon.tolk — 31/38

Code hash: `6869c401ed2bc8611ff59d697f907b7c724d297a0ef38b596f0e8bf16a87540f`

- Method 0: Conflicting stack types: slice and int
- Method 3: Conflicting stack types: slice and int
- Method 4: Conflicting stack types: slice and int
- Method 7: Conflicting stack types: slice and int
- Method 8: Conflicting stack types: slice and int
- Method 9: Conflicting stack types: slice and int
- Method 15: Conflicting stack types: slice and int

### contracts/Doom.tolk — 10/24

Code hash: `d0fe7201fee9e45af2da5b5f7cf90d0feac8a63a8e05818c67aae2fbb43c17d3`

- Method -1: Unsupported instruction: SETINDEXVAR
- Method 0: Unsupported instruction: SETINDEXVAR
- Method 3: Global value type is not established
- Method 4: Global value type is not established
- Method 5: Global value type is not established
- Method 6: Global value type is not established
- Method 7: Global value type is not established
- Method 9: Global value type is not established
- Method 10: Global value type is not established
- Method 13: Recursive method signature
- Method 14: Recursive method signature
- Method 15: Recursive method signature
- Method 17: Unsupported instruction: SETINDEXVAR
- Method 19: Unsupported instruction: SETINDEXVAR

### ListedRouterTon.tolk — 31/38

Code hash: `e135e0b428f4b5ffc267d28ea2ea6a9b287df8dbfbb806b52a73e3097f073ee3`

- Method 0: Conflicting stack types: slice and int
- Method 3: Conflicting stack types: slice and int
- Method 4: Conflicting stack types: slice and int
- Method 7: Conflicting stack types: slice and int
- Method 8: Conflicting stack types: slice and int
- Method 9: Conflicting stack types: slice and int
- Method 15: Conflicting stack types: slice and int

### elector/contracts/Elector.tolk — 25/32

Code hash: `ee3acc6b734f62dc05a8f55f167fccea0045713582ac4dc39d9fbee8acbaadfa`

- Method -2: Conflicting stack types: slice and int
- Method 0: Dictionary update needs padded results
- Method 5: Dictionary update needs padded results
- Method 13: Conflicting stack types: slice and int
- Method 14: Conflicting stack types: slice and int
- Method 70210: Dynamic continuation: runtime code and stack signature are unknown
- Method 77853: Dynamic continuation: runtime code and stack signature are unknown

## FunC remaining gaps

Counts below are contracts encountering each first blocking instruction/category; a method can conceal further unsupported instructions after that point.

| Blocker | Contracts |
|---|---:|
| `INDEXVAR` | 20 |
| `CALLDICT` | 19 |
| `TUPLE` | 18 |
| `CALLXARGS_1` | 16 |
| `EXECUTE` | 16 |
| `STRDUMP` | 16 |
| `type` | 16 |
| `return` | 15 |
| `CALLXARGS` | 14 |
| `HASHEXT` | 12 |
| `TPUSH` | 10 |
| `DICTGET` | 7 |
| `DUMP` | 4 |
| `GETGLOB` | 4 |
| `CONFIGPARAM` | 3 |
| `SETINDEXVAR` | 2 |
| `DEPTH` | 1 |
| `ECRECOVER` | 1 |
| `EXPLODEVAR` | 1 |

### src/main.fc — 67/168

Code hash: `02ded725b7946d2a20b9f53d0cec736daece9d285911e78d82e24b4e5c566889`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 5: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Dynamic continuation: runtime code and stack signature are unknown
- Method 12: Recursive method signature
- Method 61: Unsupported instruction: STRDUMP
- Method 62: Unsupported instruction: STRDUMP
- Method 63: Unsupported instruction: STRDUMP
- Method 64: Unsupported instruction: STRDUMP
- Method 65: Unsupported instruction: STRDUMP
- Method 67: Unsupported instruction: STRDUMP
- Method 79: Early and final return types differ
- Method 84: Unsupported instruction: CALLXARGS_1
- Method 106: Unknown tuple element types
- Method 199: Unknown vector element type
- Method 207: Unknown vector element type
- Method 216: Unknown tuple element types
- Method 222: Unknown tuple element types
- Method 227: Unknown tuple element types
- Method 241: Dynamic continuation: runtime code and stack signature are unknown
- Method 242: Conflicting stack types: int and cell
- Method 270: Conflicting stack types: int and cell
- Method 271: Conflicting stack types: cell and int
- Method 322: Vector element type differs
- Method 323: Unsupported instruction: CALLXARGS
- Method 324: Vector element type differs
- Method 325: Unsupported instruction: SETINDEXVAR
- Method 326: Vector element type differs
- Method 327: Vector element type differs
- Method 328: Vector element type differs
- Method 330: Vector element type differs
- Method 331: Vector element type differs
- Method 332: Conflicting stack types: int and cell
- Method 333: Conflicting stack types: int and cell
- Method 334: Unknown vector element type
- Method 335: Unknown vector element type
- Method 336: Conflicting stack types: int and cell
- Method 337: Vector element type differs
- Method 338: Unknown vector element type
- Method 339: Vector element type differs
- Method 66399: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68315: Unknown tuple element types
- Method 70212: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74000: Unknown tuple element types
- Method 74016: Dynamic continuation: runtime code and stack signature are unknown
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 77914: Unknown tuple element types
- Method 78643: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 82960: Unknown tuple element types
- Method 83314: Unknown tuple element types
- Method 83641: Unknown tuple element types
- Method 84502: Unknown vector element type
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 86718: Unknown tuple element types
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 89534: Unknown tuple element types
- Method 90537: Vector element type differs
- Method 91153: Unknown vector element type
- Method 92336: Unknown vector element type
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97232: Unsupported instruction: CALLXARGS_1
- Method 97692: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 98908: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99335: Unknown tuple element types
- Method 99943: Vector element type differs
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102643: Unknown tuple element types
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 102950: Unknown tuple element types
- Method 104309: Unknown vector element type
- Method 105039: Vector element type differs
- Method 105225: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 109785: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 110712: Vector element type differs
- Method 114194: Unsupported instruction: HASHEXT
- Method 115216: Unknown tuple element types
- Method 116187: Unknown tuple element types
- Method 117111: Unknown tuple element types
- Method 118232: Vector element type differs
- Method 118444: Unknown tuple element types
- Method 121586: Unknown tuple element types
- Method 124063: Unknown tuple element types
- Method 125605: Unknown tuple element types
- Method 128989: Unknown tuple element types
- Method 129027: Unknown vector element type
- Method 129212: Unknown tuple element types
- Method 130676: Unknown tuple element types

### contracts/jetton_wallet.fc — 3/4

Code hash: `0a58bd7c9eac3a867100523a27523d25d8d04a2dff1d165e7084671626539121`

- Method 0: Unsupported instruction: CALLXARGS

### minter_flat.fc — 2/3

Code hash: `200d04d89429d56334190a285369cebefe7815117dfa450280de43756b8f688b`

- Method 0: Unsupported instruction: SETINDEXVAR

### collection.fc — 18/21

Code hash: `224e2b1d0f037e45fa3ac3558d96504d8050166f7fd34c6a891b0287fdfcc0d6`

- Method 5: Unknown vector element type
- Method 6: Unknown vector element type
- Method 68445: Unknown vector element type

### main.fc — 2/14

Code hash: `278305009817507812564d9c24680464e63300e88cd77eba976ff69bad9fe35d`

- Method -1: Dictionary lookup needs padding or immediate success assertion
- Method 0: Dictionary lookup needs padding or immediate success assertion
- Method 12: Dictionary lookup needs padding or immediate success assertion
- Method 82442: Dictionary lookup needs padding or immediate success assertion
- Method 89180: Dictionary lookup needs padding or immediate success assertion
- Method 98814: Dictionary lookup needs padding or immediate success assertion
- Method 101209: Dictionary lookup needs padding or immediate success assertion
- Method 102879: Dictionary lookup needs padding or immediate success assertion
- Method 111005: Dictionary lookup needs padding or immediate success assertion
- Method 119491: Dictionary lookup needs padding or immediate success assertion
- Method 124317: Dictionary lookup needs padding or immediate success assertion
- Method 130054: Dictionary lookup needs padding or immediate success assertion

### fluida.fc — 7/9

Code hash: `27f4b37fa64afa058cdfc9bedfdb8905c0012371393573d522f7fb1f3e935728`

- Method 0: Unsupported instruction: CALLXARGS
- Method 10: Unsupported instruction: CALLXARGS

### src/protocol/msglibs/ultralightnode/uln/main.fc — 47/117

Code hash: `286721003d6720596ebe5b78c19ac76a72d03dcf1518ea19158be71dd92c6bdb`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Recursive method signature
- Method 8: Unsupported instruction: CONFIGPARAM
- Method 52: Unsupported instruction: STRDUMP
- Method 53: Unsupported instruction: STRDUMP
- Method 54: Unsupported instruction: STRDUMP
- Method 55: Unsupported instruction: STRDUMP
- Method 56: Unsupported instruction: STRDUMP
- Method 58: Unsupported instruction: STRDUMP
- Method 70: Early and final return types differ
- Method 75: Unsupported instruction: CALLXARGS_1
- Method 102: Unknown tuple element types
- Method 167: Dynamic continuation: runtime code and stack signature are unknown
- Method 187: Dynamic continuation: runtime code and stack signature are unknown
- Method 209: Conflicting stack types: cell and int
- Method 210: Conflicting stack types: cell and int
- Method 23432: Unknown tuple element types
- Method 66848: Unsupported instruction: CALLXARGS_1
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 69476: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74096: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 76773: Unsupported instruction: CONFIGPARAM
- Method 77303: Dynamic continuation: runtime code and stack signature are unknown
- Method 77914: Unknown tuple element types
- Method 78563: Unknown tuple element types
- Method 79569: Unknown tuple element types
- Method 79881: Unknown tuple element types
- Method 81682: Conflicting stack types: int and cell
- Method 84761: Unknown tuple element types
- Method 85009: Unknown tuple element types
- Method 85012: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 85317: Unknown tuple element types
- Method 85777: Unknown tuple element types
- Method 85911: Unknown tuple element types
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89503: Dynamic continuation: runtime code and stack signature are unknown
- Method 91722: Unknown tuple element types
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 94410: Unknown tuple element types
- Method 95680: Vector element type differs
- Method 95936: Vector element type differs
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 98028: Unknown tuple element types
- Method 98231: Unknown tuple element types
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99226: Unknown tuple element types
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 103343: Unknown tuple element types
- Method 110709: Unknown tuple element types
- Method 111773: Conflicting stack types: int and cell
- Method 113397: Dynamic continuation: runtime code and stack signature are unknown
- Method 114194: Unsupported instruction: HASHEXT
- Method 116975: Unsupported instruction: DEPTH
- Method 120340: Vector element type differs
- Method 123124: Conflicting stack types: int and cell
- Method 123477: Unknown tuple element types
- Method 123553: Vector element type differs
- Method 124063: Unknown tuple element types
- Method 124210: Unsupported instruction: DEPTH
- Method 127258: Conflicting stack types: int and cell
- Method 131060: Dynamic continuation: runtime code and stack signature are unknown

### contracts/eth_usdt_treasury.fc — 27/48

Code hash: `3d4a481fa20e76e31de7466fc06dc5c0658bcaabdff1688aa9bf7fdc425d3c24`

- Method 0: Unknown vector element type
- Method 6: Recursive method signature
- Method 35: Unsupported instruction: STRDUMP
- Method 36: Unsupported instruction: STRDUMP
- Method 37: Unsupported instruction: STRDUMP
- Method 38: Unsupported instruction: STRDUMP
- Method 39: Unsupported instruction: STRDUMP
- Method 41: Unsupported instruction: STRDUMP
- Method 53: Early and final return types differ
- Method 58: Unsupported instruction: CALLXARGS_1
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 130676: Unknown tuple element types

### src/protocol/channel/main.fc — 52/123

Code hash: `460c1c62fd4d98ba683bd25552ab0d830eb761de06ef1858a3ec3948429220ec`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Recursive method signature
- Method 52: Unsupported instruction: STRDUMP
- Method 53: Unsupported instruction: STRDUMP
- Method 54: Unsupported instruction: STRDUMP
- Method 55: Unsupported instruction: STRDUMP
- Method 56: Unsupported instruction: STRDUMP
- Method 58: Unsupported instruction: STRDUMP
- Method 70: Early and final return types differ
- Method 75: Unsupported instruction: CALLXARGS_1
- Method 102: Unknown tuple element types
- Method 130: Conflicting stack types: cell and int
- Method 131: Dynamic continuation: runtime code and stack signature are unknown
- Method 135: Unknown vector element type
- Method 162: Unknown vector element type
- Method 167: Unknown vector element type
- Method 171: Unknown vector element type
- Method 200: Unknown vector element type
- Method 202: Recursive method signature
- Method 66209: Unknown vector element type
- Method 66399: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68405: Unknown vector element type
- Method 69717: Unsupported instruction: HASHEXT
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74000: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 78643: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 79889: Unknown vector element type
- Method 79921: Unknown tuple element types
- Method 81775: Unknown vector element type
- Method 82960: Unknown tuple element types
- Method 83622: Unknown vector element type
- Method 83641: Unknown tuple element types
- Method 84751: Unknown tuple element types
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 85911: Unknown tuple element types
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 91153: Unknown vector element type
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 94636: Unknown tuple element types
- Method 96090: Recursive method signature
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97802: Unknown tuple element types
- Method 98028: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99809: Unknown vector element type
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 102950: Unknown tuple element types
- Method 103604: Unknown tuple element types
- Method 105225: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 112518: Vector element type differs
- Method 114194: Unsupported instruction: HASHEXT
- Method 115734: Vector element type differs
- Method 117791: Unknown vector element type
- Method 118232: Vector element type differs
- Method 120188: Unknown tuple element types
- Method 121942: Unknown tuple element types
- Method 124063: Unknown tuple element types
- Method 129027: Conflicting stack types: cell and int

### contracts/test.fc — 0/1

Code hash: `4a0bc64962e12f0b05d643d47275b25784ce8d8e6eeb137ec08deb6418689fda`

- Method 0: Unsupported instruction: DUMP

### src/BamOFT/main.fc — 63/155

Code hash: `4fe72f93136d6c2868c58136ceeb0e52d9c9fb180e50b57ddf686e903f5b02e6`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 5: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Dynamic continuation: runtime code and stack signature are unknown
- Method 12: Recursive method signature
- Method 61: Unsupported instruction: STRDUMP
- Method 62: Unsupported instruction: STRDUMP
- Method 63: Unsupported instruction: STRDUMP
- Method 64: Unsupported instruction: STRDUMP
- Method 65: Unsupported instruction: STRDUMP
- Method 67: Unsupported instruction: STRDUMP
- Method 79: Early and final return types differ
- Method 84: Unsupported instruction: CALLXARGS_1
- Method 106: Unknown tuple element types
- Method 122: Unknown vector element type
- Method 194: Unknown vector element type
- Method 202: Unknown vector element type
- Method 209: Unknown tuple element types
- Method 215: Unknown tuple element types
- Method 220: Unknown tuple element types
- Method 234: Dynamic continuation: runtime code and stack signature are unknown
- Method 235: Conflicting stack types: int and cell
- Method 264: Conflicting stack types: int and cell
- Method 265: Conflicting stack types: cell and int
- Method 286: Vector element type differs
- Method 287: Unsupported instruction: CALLXARGS
- Method 288: Vector element type differs
- Method 289: Unknown vector element type
- Method 290: Unknown vector element type
- Method 291: Unknown vector element type
- Method 292: Conflicting stack types: int and cell
- Method 293: Conflicting stack types: int and cell
- Method 294: Conflicting stack types: int and cell
- Method 66399: Unknown tuple element types
- Method 66537: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68315: Unknown tuple element types
- Method 70212: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74000: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 77914: Unknown tuple element types
- Method 78643: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 82960: Unknown tuple element types
- Method 83314: Unknown tuple element types
- Method 83641: Unknown tuple element types
- Method 84502: Unknown vector element type
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 89534: Unknown tuple element types
- Method 90537: Vector element type differs
- Method 91153: Unknown vector element type
- Method 92336: Conflicting stack types: int and cell
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97232: Unsupported instruction: CALLXARGS_1
- Method 97692: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 98908: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99335: Unknown tuple element types
- Method 99943: Conflicting stack types: int and cell
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102643: Unknown tuple element types
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 102950: Unknown tuple element types
- Method 104309: Unknown vector element type
- Method 105039: Vector element type differs
- Method 105225: Unknown tuple element types
- Method 105852: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 109785: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 110712: Vector element type differs
- Method 114194: Unsupported instruction: HASHEXT
- Method 115216: Unknown tuple element types
- Method 116187: Unknown tuple element types
- Method 118232: Vector element type differs
- Method 118444: Unknown tuple element types
- Method 120815: Dynamic continuation: runtime code and stack signature are unknown
- Method 124063: Unknown tuple element types
- Method 128989: Unknown tuple element types
- Method 129027: Conflicting stack types: int and cell
- Method 129212: Unknown tuple element types
- Method 130676: Unknown tuple element types

### src/protocol/controller/main.fc — 39/96

Code hash: `5d1913984d2010b0fa1a45808f3c2a2b7f94fba571da200dcbe119ff515b12d8`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Recursive method signature
- Method 52: Unsupported instruction: STRDUMP
- Method 53: Unsupported instruction: STRDUMP
- Method 54: Unsupported instruction: STRDUMP
- Method 55: Unsupported instruction: STRDUMP
- Method 56: Unsupported instruction: STRDUMP
- Method 58: Unsupported instruction: STRDUMP
- Method 70: Early and final return types differ
- Method 75: Unsupported instruction: CALLXARGS_1
- Method 102: Unknown tuple element types
- Method 119: Unknown vector element type
- Method 130: Conflicting stack types: cell and int
- Method 140: Unknown vector element type
- Method 141: Unknown vector element type
- Method 156: Unknown vector element type
- Method 199: Unknown vector element type
- Method 200: Conflicting stack types: int and cell
- Method 66399: Unknown tuple element types
- Method 66537: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68405: Unknown vector element type
- Method 69125: Unknown vector element type
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 76066: Unknown vector element type
- Method 77739: Unknown vector element type
- Method 77914: Unknown tuple element types
- Method 79569: Unknown tuple element types
- Method 79889: Unknown vector element type
- Method 82960: Unknown tuple element types
- Method 84130: Unknown vector element type
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 94636: Unknown tuple element types
- Method 95463: Unknown vector element type
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97692: Unknown tuple element types
- Method 98028: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99117: Unknown tuple element types
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 104309: Unknown vector element type
- Method 106645: Unknown tuple element types
- Method 108070: Unknown tuple element types
- Method 114433: Unknown tuple element types
- Method 119441: Unknown tuple element types
- Method 124063: Unknown tuple element types
- Method 125672: Unknown vector element type
- Method 129212: Unknown tuple element types
- Method 130187: Unknown vector element type

### bridge.fc — 18/19

Code hash: `5f414e67f980c50d97588b000ffa0f6657d9b55a15935354c36d47a8160887ef`

- Method 0: Unsupported instruction: CALLXARGS

### contracts_build/router.fc — 5/8

Code hash: `626d4f74c9f711c423e384598cfb116285d8254153a163f626d210aa48858d74`

- Method 0: Unsupported instruction: CALLXARGS
- Method 76: Recursive method signature
- Method 88: Recursive method signature

### pow.fc — 3/5

Code hash: `6cb8d8ab5d95fb424c23c5a8d170bfd99235ba52468416a0b2b7b73af6301019`

- Method -1: Global value type is not established
- Method 0: Global value type is not established

### ton_flip.fc — 3/5

Code hash: `6d456903c694bef806e85c7edf0c2c0337408c2048113a778de1d1e34dc9ee63`

- Method 0: Recursive method signature
- Method 5: Recursive method signature

### src/BamOFT/main.fc — 63/155

Code hash: `70b701cde0711d5ef843676a9540b1fff3600e75d9595c5c23b8963f443daeae`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 5: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Dynamic continuation: runtime code and stack signature are unknown
- Method 12: Recursive method signature
- Method 61: Unsupported instruction: STRDUMP
- Method 62: Unsupported instruction: STRDUMP
- Method 63: Unsupported instruction: STRDUMP
- Method 64: Unsupported instruction: STRDUMP
- Method 65: Unsupported instruction: STRDUMP
- Method 67: Unsupported instruction: STRDUMP
- Method 79: Early and final return types differ
- Method 84: Unsupported instruction: CALLXARGS_1
- Method 106: Unknown tuple element types
- Method 122: Unknown vector element type
- Method 194: Unknown vector element type
- Method 202: Unknown vector element type
- Method 209: Unknown tuple element types
- Method 215: Unknown tuple element types
- Method 220: Unknown tuple element types
- Method 234: Dynamic continuation: runtime code and stack signature are unknown
- Method 235: Conflicting stack types: int and cell
- Method 264: Conflicting stack types: int and cell
- Method 265: Conflicting stack types: cell and int
- Method 286: Vector element type differs
- Method 287: Unsupported instruction: CALLXARGS
- Method 288: Vector element type differs
- Method 289: Unknown vector element type
- Method 290: Unknown vector element type
- Method 291: Unknown vector element type
- Method 292: Conflicting stack types: int and cell
- Method 293: Conflicting stack types: int and cell
- Method 294: Conflicting stack types: int and cell
- Method 66399: Unknown tuple element types
- Method 66537: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68315: Unknown tuple element types
- Method 70212: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74000: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 77914: Unknown tuple element types
- Method 78643: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 82960: Unknown tuple element types
- Method 83314: Unknown tuple element types
- Method 83641: Unknown tuple element types
- Method 84502: Unknown vector element type
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 89534: Unknown tuple element types
- Method 90537: Vector element type differs
- Method 91153: Unknown vector element type
- Method 92336: Conflicting stack types: int and cell
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97232: Unsupported instruction: CALLXARGS_1
- Method 97692: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 98908: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99335: Unknown tuple element types
- Method 99943: Conflicting stack types: int and cell
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102643: Unknown tuple element types
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 102950: Unknown tuple element types
- Method 104309: Unknown vector element type
- Method 105039: Vector element type differs
- Method 105225: Unknown tuple element types
- Method 105852: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 109785: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 110712: Vector element type differs
- Method 114194: Unsupported instruction: HASHEXT
- Method 115216: Unknown tuple element types
- Method 116187: Unknown tuple element types
- Method 118232: Vector element type differs
- Method 118444: Unknown tuple element types
- Method 120815: Dynamic continuation: runtime code and stack signature are unknown
- Method 124063: Unknown tuple element types
- Method 128989: Unknown tuple element types
- Method 129027: Conflicting stack types: int and cell
- Method 129212: Unknown tuple element types
- Method 130676: Unknown tuple element types

### collection.fc — 20/23

Code hash: `7de4a30bc4f4072b84a4a383238ae49fecc3a3d455fe7c9898578f8080ea0527`

- Method 5: Unknown vector element type
- Method 6: Unknown tuple element types
- Method 68445: Unknown tuple element types

### main.fc — 2/10

Code hash: `830de6f33492a4d5e5099880a622f08461dd7aaac221b13609fd0ce379a329e9`

- Method -1: Dictionary lookup needs padding or immediate success assertion
- Method 0: Dictionary lookup needs padding or immediate success assertion
- Method 11: Dictionary lookup needs padding or immediate success assertion
- Method 82442: Dictionary lookup needs padding or immediate success assertion
- Method 89180: Dictionary lookup needs padding or immediate success assertion
- Method 121420: Dictionary lookup needs padding or immediate success assertion
- Method 124317: Dictionary lookup needs padding or immediate success assertion
- Method 130054: Dictionary lookup needs padding or immediate success assertion

### main.fc — 2/10

Code hash: `86fbff0bc031a2681940dfc6a1449dd0c7955dbbda8c8d48a1080da8fe8b4a1c`

- Method -1: Dictionary lookup needs padding or immediate success assertion
- Method 0: Dictionary lookup needs padding or immediate success assertion
- Method 11: Dictionary lookup needs padding or immediate success assertion
- Method 12: Dictionary lookup needs padding or immediate success assertion
- Method 82442: Dictionary lookup needs padding or immediate success assertion
- Method 89180: Dictionary lookup needs padding or immediate success assertion
- Method 121420: Dictionary lookup needs padding or immediate success assertion
- Method 124317: Dictionary lookup needs padding or immediate success assertion

### contracts/src/main.fc — 64/156

Code hash: `8afca36b343ca2286a9dac298487cdf7d473024fd4949c81532b876cf598fbb1`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 5: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Dynamic continuation: runtime code and stack signature are unknown
- Method 12: Recursive method signature
- Method 61: Unsupported instruction: STRDUMP
- Method 62: Unsupported instruction: STRDUMP
- Method 63: Unsupported instruction: STRDUMP
- Method 64: Unsupported instruction: STRDUMP
- Method 65: Unsupported instruction: STRDUMP
- Method 67: Unsupported instruction: STRDUMP
- Method 79: Early and final return types differ
- Method 84: Unsupported instruction: CALLXARGS_1
- Method 106: Unknown tuple element types
- Method 190: Unknown vector element type
- Method 198: Unknown vector element type
- Method 205: Unknown tuple element types
- Method 211: Unknown tuple element types
- Method 216: Unknown tuple element types
- Method 230: Dynamic continuation: runtime code and stack signature are unknown
- Method 231: Conflicting stack types: int and cell
- Method 260: Conflicting stack types: int and cell
- Method 261: Conflicting stack types: cell and int
- Method 275: Unknown vector element type
- Method 286: Vector element type differs
- Method 287: Unsupported instruction: CALLXARGS
- Method 288: Vector element type differs
- Method 289: Unknown vector element type
- Method 290: Unknown vector element type
- Method 291: Unknown vector element type
- Method 292: Conflicting stack types: int and cell
- Method 293: Conflicting stack types: int and cell
- Method 294: Conflicting stack types: int and cell
- Method 66399: Unknown tuple element types
- Method 66537: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68315: Unknown tuple element types
- Method 70212: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74000: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 77914: Unknown tuple element types
- Method 78643: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 82960: Unknown tuple element types
- Method 83314: Unknown tuple element types
- Method 83641: Unknown tuple element types
- Method 84502: Unknown vector element type
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 89534: Unknown tuple element types
- Method 90537: Vector element type differs
- Method 91153: Unknown vector element type
- Method 92336: Conflicting stack types: int and cell
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97232: Unsupported instruction: CALLXARGS_1
- Method 97692: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 98908: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99335: Unknown tuple element types
- Method 99943: Conflicting stack types: int and cell
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102643: Unknown tuple element types
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 102950: Unknown tuple element types
- Method 104309: Unknown vector element type
- Method 105039: Vector element type differs
- Method 105225: Unknown tuple element types
- Method 105852: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 109785: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 110649: Dynamic continuation: runtime code and stack signature are unknown
- Method 110712: Vector element type differs
- Method 114194: Unsupported instruction: HASHEXT
- Method 115216: Unknown tuple element types
- Method 116187: Unknown tuple element types
- Method 118232: Vector element type differs
- Method 118444: Unknown tuple element types
- Method 124063: Unknown tuple element types
- Method 128989: Unknown tuple element types
- Method 129027: Conflicting stack types: int and cell
- Method 129212: Unknown tuple element types
- Method 130676: Unknown tuple element types

### src/protocol/msglibs/ultralightnode/ulnManager/main.fc — 44/131

Code hash: `8e06ead88295e9d33713e18f88579ff3ec241e36d3250240026f2b69d35b2ebc`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Unknown vector element type
- Method 12: Recursive method signature
- Method 14: Unsupported instruction: CONFIGPARAM
- Method 59: Unsupported instruction: STRDUMP
- Method 60: Unsupported instruction: STRDUMP
- Method 61: Unsupported instruction: STRDUMP
- Method 62: Unsupported instruction: STRDUMP
- Method 63: Unsupported instruction: STRDUMP
- Method 65: Unsupported instruction: STRDUMP
- Method 77: Early and final return types differ
- Method 82: Unsupported instruction: CALLXARGS_1
- Method 123: Conflicting stack types: cell and int
- Method 124: Conflicting stack types: cell and int
- Method 141: Dynamic continuation: runtime code and stack signature are unknown
- Method 143: Dynamic continuation: runtime code and stack signature are unknown
- Method 208: Unknown vector element type
- Method 212: Unknown vector element type
- Method 214: Dynamic continuation: runtime code and stack signature are unknown
- Method 224: Unknown vector element type
- Method 225: Unknown vector element type
- Method 231: Unknown vector element type
- Method 232: Unknown vector element type
- Method 233: Dynamic continuation: runtime code and stack signature are unknown
- Method 236: Unknown vector element type
- Method 244: Unknown tuple element types
- Method 66131: Unknown tuple element types
- Method 66399: Unknown tuple element types
- Method 66537: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 69476: Unknown tuple element types
- Method 70399: Unknown vector element type
- Method 70901: Unknown tuple element types
- Method 72608: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 72751: Unknown tuple element types
- Method 74096: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 76773: Unsupported instruction: CONFIGPARAM
- Method 77303: Dynamic continuation: runtime code and stack signature are unknown
- Method 77914: Unknown tuple element types
- Method 78563: Unknown tuple element types
- Method 79444: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 79782: Unknown tuple element types
- Method 80686: Unknown vector element type
- Method 80704: Dynamic continuation: runtime code and stack signature are unknown
- Method 82960: Unknown tuple element types
- Method 84595: Unknown vector element type
- Method 84761: Unknown tuple element types
- Method 85009: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 85317: Unknown tuple element types
- Method 85777: Unknown tuple element types
- Method 85860: Unknown vector element type
- Method 86136: Dynamic continuation: runtime code and stack signature are unknown
- Method 87518: Unknown vector element type
- Method 87722: Unknown vector element type
- Method 88345: Unknown tuple element types
- Method 89313: Unknown vector element type
- Method 89455: Unknown tuple element types
- Method 89503: Dynamic continuation: runtime code and stack signature are unknown
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 94636: Unknown tuple element types
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97692: Unknown tuple element types
- Method 98847: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99117: Unknown tuple element types
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 103343: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 110709: Unknown tuple element types
- Method 113397: Unknown vector element type
- Method 115927: Unknown tuple element types
- Method 116289: Dynamic continuation: runtime code and stack signature are unknown
- Method 117344: Dynamic continuation: runtime code and stack signature are unknown
- Method 123474: Unknown vector element type
- Method 124063: Unknown tuple element types
- Method 129212: Unknown tuple element types
- Method 130187: Unknown vector element type
- Method 131060: Unknown vector element type

### main.fc — 3/17

Code hash: `8e878e53541d58e15fd862f4b935880d97b402d63e01b7c35d01a60bbc5fdca8`

- Method -1: Conflicting stack types: int and cell
- Method 0: Dictionary lookup needs padding or immediate success assertion
- Method 13: Dictionary lookup needs padding or immediate success assertion
- Method 14: Conflicting stack types: int and cell
- Method 15: Conflicting stack types: int and cell
- Method 82442: Dictionary lookup needs padding or immediate success assertion
- Method 89180: Dictionary lookup needs padding or immediate success assertion
- Method 98814: Dictionary lookup needs padding or immediate success assertion
- Method 101209: Dictionary lookup needs padding or immediate success assertion
- Method 102879: Dictionary lookup needs padding or immediate success assertion
- Method 111005: Dictionary lookup needs padding or immediate success assertion
- Method 119491: Dictionary lookup needs padding or immediate success assertion
- Method 124317: Dictionary lookup needs padding or immediate success assertion
- Method 130054: Dictionary lookup needs padding or immediate success assertion

### main.fc — 3/4

Code hash: `9038799a39d97900e6ec9548d7e8b80ba919052de0b164d701afcd251185209a`

- Method 0: Unsupported instruction: CALLXARGS_1

### src/BamOFT/main.fc — 63/155

Code hash: `9bbbf539fed4d953a814d58d438b810302216e643a72025f63dbe12c0844cbbe`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 5: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Dynamic continuation: runtime code and stack signature are unknown
- Method 12: Recursive method signature
- Method 61: Unsupported instruction: STRDUMP
- Method 62: Unsupported instruction: STRDUMP
- Method 63: Unsupported instruction: STRDUMP
- Method 64: Unsupported instruction: STRDUMP
- Method 65: Unsupported instruction: STRDUMP
- Method 67: Unsupported instruction: STRDUMP
- Method 79: Early and final return types differ
- Method 84: Unsupported instruction: CALLXARGS_1
- Method 106: Unknown tuple element types
- Method 122: Unknown vector element type
- Method 194: Unknown vector element type
- Method 202: Unknown vector element type
- Method 209: Unknown tuple element types
- Method 215: Unknown tuple element types
- Method 220: Unknown tuple element types
- Method 234: Dynamic continuation: runtime code and stack signature are unknown
- Method 235: Conflicting stack types: int and cell
- Method 264: Conflicting stack types: int and cell
- Method 265: Conflicting stack types: cell and int
- Method 286: Vector element type differs
- Method 287: Unsupported instruction: CALLXARGS
- Method 288: Vector element type differs
- Method 289: Unknown vector element type
- Method 290: Unknown vector element type
- Method 291: Unknown vector element type
- Method 292: Conflicting stack types: int and cell
- Method 293: Conflicting stack types: int and cell
- Method 294: Conflicting stack types: int and cell
- Method 66399: Unknown tuple element types
- Method 66537: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68315: Unknown tuple element types
- Method 70212: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74000: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 77914: Unknown tuple element types
- Method 78643: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 82960: Unknown tuple element types
- Method 83314: Unknown tuple element types
- Method 83641: Unknown tuple element types
- Method 84502: Unknown vector element type
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 89534: Unknown tuple element types
- Method 90537: Vector element type differs
- Method 91153: Unknown vector element type
- Method 92336: Conflicting stack types: int and cell
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97232: Unsupported instruction: CALLXARGS_1
- Method 97692: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 98908: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99335: Unknown tuple element types
- Method 99943: Conflicting stack types: int and cell
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102643: Unknown tuple element types
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 102950: Unknown tuple element types
- Method 104309: Unknown vector element type
- Method 105039: Vector element type differs
- Method 105225: Unknown tuple element types
- Method 105852: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 109785: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 110712: Vector element type differs
- Method 114194: Unsupported instruction: HASHEXT
- Method 115216: Unknown tuple element types
- Method 116187: Unknown tuple element types
- Method 118232: Vector element type differs
- Method 118444: Unknown tuple element types
- Method 120815: Dynamic continuation: runtime code and stack signature are unknown
- Method 124063: Unknown tuple element types
- Method 128989: Unknown tuple element types
- Method 129027: Conflicting stack types: int and cell
- Method 129212: Unknown tuple element types
- Method 130676: Unknown tuple element types

### ton_flip.fc — 2/4

Code hash: `9e2a43eba062ffe17099f6f8ced2fa97945d114a75ad5002cd291823d83bce95`

- Method 0: Recursive method signature
- Method 5: Recursive method signature

### src/BamOFT/main.fc — 63/155

Code hash: `a9c2abd57f171972ad66b62d42931ab1a97e57659b9b2b28003a03bc0c2b8ffb`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 5: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Dynamic continuation: runtime code and stack signature are unknown
- Method 12: Recursive method signature
- Method 61: Unsupported instruction: STRDUMP
- Method 62: Unsupported instruction: STRDUMP
- Method 63: Unsupported instruction: STRDUMP
- Method 64: Unsupported instruction: STRDUMP
- Method 65: Unsupported instruction: STRDUMP
- Method 67: Unsupported instruction: STRDUMP
- Method 79: Early and final return types differ
- Method 84: Unsupported instruction: CALLXARGS_1
- Method 106: Unknown tuple element types
- Method 122: Unknown vector element type
- Method 194: Unknown vector element type
- Method 202: Unknown vector element type
- Method 209: Unknown tuple element types
- Method 215: Unknown tuple element types
- Method 220: Unknown tuple element types
- Method 234: Dynamic continuation: runtime code and stack signature are unknown
- Method 235: Conflicting stack types: int and cell
- Method 264: Conflicting stack types: int and cell
- Method 265: Conflicting stack types: cell and int
- Method 286: Vector element type differs
- Method 287: Unsupported instruction: CALLXARGS
- Method 288: Vector element type differs
- Method 289: Unknown vector element type
- Method 290: Unknown vector element type
- Method 291: Unknown vector element type
- Method 292: Conflicting stack types: int and cell
- Method 293: Conflicting stack types: int and cell
- Method 294: Conflicting stack types: int and cell
- Method 66399: Unknown tuple element types
- Method 66537: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68315: Unknown tuple element types
- Method 70212: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74000: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 77914: Unknown tuple element types
- Method 78643: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 82960: Unknown tuple element types
- Method 83314: Unknown tuple element types
- Method 83641: Unknown tuple element types
- Method 84502: Unknown vector element type
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 89534: Unknown tuple element types
- Method 90537: Vector element type differs
- Method 91153: Unknown vector element type
- Method 92336: Conflicting stack types: int and cell
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97232: Unsupported instruction: CALLXARGS_1
- Method 97692: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 98908: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99335: Unknown tuple element types
- Method 99943: Conflicting stack types: int and cell
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102643: Unknown tuple element types
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 102950: Unknown tuple element types
- Method 104309: Unknown vector element type
- Method 105039: Vector element type differs
- Method 105225: Unknown tuple element types
- Method 105852: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 109785: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 110712: Vector element type differs
- Method 114194: Unsupported instruction: HASHEXT
- Method 115216: Unknown tuple element types
- Method 116187: Unknown tuple element types
- Method 118232: Vector element type differs
- Method 118444: Unknown tuple element types
- Method 120815: Dynamic continuation: runtime code and stack signature are unknown
- Method 124063: Unknown tuple element types
- Method 128989: Unknown tuple element types
- Method 129027: Conflicting stack types: int and cell
- Method 129212: Unknown tuple element types
- Method 130676: Unknown tuple element types

### Main.fc — 32/53

Code hash: `ab2a8a04a1bbaf97c8cabf0884d12b553eea79b0dc1194dd3792b30440456834`

- Method 0: Unsupported instruction: EXPLODEVAR
- Method 7: Unsupported instruction: HASHEXT
- Method 10: Unsupported instruction: ECRECOVER
- Method 11: Unsupported instruction: EXPLODEVAR
- Method 13: Unsupported instruction: EXPLODEVAR
- Method 14: Unsupported instruction: EXPLODEVAR
- Method 15: Unsupported instruction: EXPLODEVAR
- Method 16: Unsupported instruction: EXPLODEVAR
- Method 19: Unsupported instruction: EXPLODEVAR
- Method 24: Unknown vector element type
- Method 25: Unsupported instruction: EXPLODEVAR
- Method 26: Unknown vector element type
- Method 27: Unknown vector element type
- Method 28: Unsupported instruction: EXPLODEVAR
- Method 29: Unsupported instruction: EXPLODEVAR
- Method 30: Unsupported instruction: EXPLODEVAR
- Method 36: Unsupported instruction: EXPLODEVAR
- Method 39: Unsupported instruction: EXPLODEVAR
- Method 40: Unsupported instruction: EXPLODEVAR
- Method 72490: Dynamic continuation: runtime code and stack signature are unknown
- Method 72563: Dynamic continuation: runtime code and stack signature are unknown

### main.fc — 0/6

Code hash: `adca613e6e8a79d9fa5792d89cde1ef75d6f0df2df5320f20fbf33b1c11103c3`

- Method -1: Dictionary lookup needs padding or immediate success assertion
- Method 0: Dictionary lookup needs padding or immediate success assertion
- Method 9: Dictionary lookup needs padding or immediate success assertion
- Method 10: Dictionary lookup needs padding or immediate success assertion
- Method 67140: Dictionary lookup needs padding or immediate success assertion
- Method 86571: Dictionary lookup needs padding or immediate success assertion

### contracts/test.fc — 0/1

Code hash: `b18c5fa6450ac5240f84b1cfe5c434175a5c5386dd351e4f744955945a595808`

- Method 0: Unsupported instruction: DUMP

### fluida.fc — 7/10

Code hash: `ba30cd7b928696f9bf0a194a9e1befe13fc3e44d56bc643214fd24ac22ccf42d`

- Method 0: Unsupported instruction: CALLXARGS
- Method 9: Unsupported instruction: CALLXARGS
- Method 11: Unsupported instruction: CALLXARGS

### contract.fc — 0/4

Code hash: `bae47baa9e15a6890cf3cd3124754e5aca66a9b1c0b6f287f24f74abed23f47e`

- Method 0: Global value type is not established
- Method 2: Global value type is not established
- Method 3: Global value type is not established
- Method 4: Global value type is not established

### src/protocol/endpoint/main.fc — 47/107

Code hash: `bae7f3ace142da22b8b38b6ddb1a0e0be3b2ae0f0f867757b210719149f0930a`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Recursive method signature
- Method 52: Unsupported instruction: STRDUMP
- Method 53: Unsupported instruction: STRDUMP
- Method 54: Unsupported instruction: STRDUMP
- Method 55: Unsupported instruction: STRDUMP
- Method 56: Unsupported instruction: STRDUMP
- Method 58: Unsupported instruction: STRDUMP
- Method 70: Early and final return types differ
- Method 75: Unsupported instruction: CALLXARGS_1
- Method 102: Unknown tuple element types
- Method 119: Dynamic continuation: runtime code and stack signature are unknown
- Method 130: Conflicting stack types: cell and int
- Method 131: Conflicting stack types: cell and int
- Method 137: Unknown vector element type
- Method 141: Unknown tuple element types
- Method 148: Unknown vector element type
- Method 66168: Conflicting stack types: cell and int
- Method 66399: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68405: Unknown vector element type
- Method 69074: Conflicting stack types: cell and int
- Method 69414: Conflicting stack types: cell and int
- Method 71017: Unknown vector element type
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 72751: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 74724: Conflicting stack types: cell and int
- Method 76066: Unknown vector element type
- Method 77739: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 79921: Unknown tuple element types
- Method 82960: Unknown tuple element types
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 86145: Conflicting stack types: cell and int
- Method 87476: Conflicting stack types: cell and int
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97802: Unknown tuple element types
- Method 98028: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99117: Unknown tuple element types
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 106645: Unknown tuple element types
- Method 108070: Unknown tuple element types
- Method 110549: Conflicting stack types: cell and int
- Method 114194: Unsupported instruction: HASHEXT
- Method 119441: Unknown tuple element types
- Method 124063: Unknown tuple element types
- Method 125672: Unknown vector element type
- Method 130536: Conflicting stack types: cell and int

### collection_exotic_sbt.fc — 17/20

Code hash: `bbac2f6d5904eb04d3d78f17de7a5e26a19dd8eef5fda44103c964e9e190f9f4`

- Method 0: Recursive method signature
- Method 13: Recursive method signature
- Method 14: Recursive method signature

### src/protocol/msglibs/ultralightnode/ulnConnection/main.fc — 52/115

Code hash: `bd92119e381f1d107068f77e916238c488466014a2bcdf68389d372ef287dcba`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Recursive method signature
- Method 8: Unsupported instruction: CONFIGPARAM
- Method 52: Unsupported instruction: STRDUMP
- Method 53: Unsupported instruction: STRDUMP
- Method 54: Unsupported instruction: STRDUMP
- Method 55: Unsupported instruction: STRDUMP
- Method 56: Unsupported instruction: STRDUMP
- Method 58: Unsupported instruction: STRDUMP
- Method 70: Early and final return types differ
- Method 75: Unsupported instruction: CALLXARGS_1
- Method 102: Unknown tuple element types
- Method 130: Conflicting stack types: cell and int
- Method 131: Conflicting stack types: cell and int
- Method 139: Dynamic continuation: runtime code and stack signature are unknown
- Method 150: Dynamic continuation: runtime code and stack signature are unknown
- Method 189: Unknown vector element type
- Method 197: Unknown vector element type
- Method 66131: Unknown tuple element types
- Method 66782: Vector element type differs
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 67840: Unknown vector element type
- Method 71044: Unknown vector element type
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 75224: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 76773: Unsupported instruction: CONFIGPARAM
- Method 77303: Dynamic continuation: runtime code and stack signature are unknown
- Method 77914: Unknown tuple element types
- Method 78563: Unknown tuple element types
- Method 79569: Unknown tuple element types
- Method 84761: Unknown tuple element types
- Method 85009: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 85777: Unknown tuple element types
- Method 85860: Dynamic continuation: runtime code and stack signature are unknown
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89313: Dynamic continuation: runtime code and stack signature are unknown
- Method 89503: Dynamic continuation: runtime code and stack signature are unknown
- Method 91722: Unknown tuple element types
- Method 93134: Unknown tuple element types
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97752: Unsupported instruction: CALLXARGS_1
- Method 98028: Unknown tuple element types
- Method 98663: Unsupported instruction: CALLXARGS_1
- Method 98876: Vector element type differs
- Method 99078: Unknown tuple element types
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 103343: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 114194: Unsupported instruction: HASHEXT
- Method 115927: Unknown tuple element types
- Method 120188: Unknown tuple element types
- Method 120340: Unknown vector element type
- Method 121518: Unknown tuple element types
- Method 124063: Unknown tuple element types

### src/BamOFT/main.fc — 63/155

Code hash: `c4e6f180c26e54ed7b597ae0b3eee5826aab7deaf13c3b2dd751ec898d3fd00a`

- Method 0: Dynamic continuation: runtime code and stack signature are unknown
- Method 5: Dynamic continuation: runtime code and stack signature are unknown
- Method 6: Dynamic continuation: runtime code and stack signature are unknown
- Method 12: Recursive method signature
- Method 61: Unsupported instruction: STRDUMP
- Method 62: Unsupported instruction: STRDUMP
- Method 63: Unsupported instruction: STRDUMP
- Method 64: Unsupported instruction: STRDUMP
- Method 65: Unsupported instruction: STRDUMP
- Method 67: Unsupported instruction: STRDUMP
- Method 79: Early and final return types differ
- Method 84: Unsupported instruction: CALLXARGS_1
- Method 106: Unknown tuple element types
- Method 122: Unknown vector element type
- Method 194: Unknown vector element type
- Method 202: Unknown vector element type
- Method 209: Unknown tuple element types
- Method 215: Unknown tuple element types
- Method 220: Unknown tuple element types
- Method 234: Dynamic continuation: runtime code and stack signature are unknown
- Method 235: Conflicting stack types: int and cell
- Method 264: Conflicting stack types: int and cell
- Method 265: Conflicting stack types: cell and int
- Method 286: Vector element type differs
- Method 287: Unsupported instruction: CALLXARGS
- Method 288: Vector element type differs
- Method 289: Unknown vector element type
- Method 290: Unknown vector element type
- Method 291: Unknown vector element type
- Method 292: Conflicting stack types: int and cell
- Method 293: Conflicting stack types: int and cell
- Method 294: Conflicting stack types: int and cell
- Method 66399: Unknown tuple element types
- Method 66537: Unknown tuple element types
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 67373: Unknown tuple element types
- Method 68315: Unknown tuple element types
- Method 70212: Unknown tuple element types
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 74000: Unknown tuple element types
- Method 74274: Unknown tuple element types
- Method 76066: Unknown vector element type
- Method 77914: Unknown tuple element types
- Method 78643: Unknown vector element type
- Method 79569: Unknown tuple element types
- Method 82960: Unknown tuple element types
- Method 83314: Unknown tuple element types
- Method 83641: Unknown tuple element types
- Method 84502: Unknown vector element type
- Method 84761: Unknown tuple element types
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 88187: Unknown tuple element types
- Method 88345: Unknown tuple element types
- Method 89455: Unknown tuple element types
- Method 89534: Unknown tuple element types
- Method 90537: Vector element type differs
- Method 91153: Unknown vector element type
- Method 92336: Conflicting stack types: int and cell
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 97232: Unsupported instruction: CALLXARGS_1
- Method 97692: Unknown tuple element types
- Method 98878: Unknown vector element type
- Method 98908: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 99335: Unknown tuple element types
- Method 99943: Conflicting stack types: int and cell
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102643: Unknown tuple element types
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 102950: Unknown tuple element types
- Method 104309: Unknown vector element type
- Method 105039: Vector element type differs
- Method 105225: Unknown tuple element types
- Method 105852: Unknown tuple element types
- Method 106645: Unknown tuple element types
- Method 109785: Unknown tuple element types
- Method 110004: Unknown tuple element types
- Method 110712: Vector element type differs
- Method 114194: Unsupported instruction: HASHEXT
- Method 115216: Unknown tuple element types
- Method 116187: Unknown tuple element types
- Method 118232: Vector element type differs
- Method 118444: Unknown tuple element types
- Method 120815: Dynamic continuation: runtime code and stack signature are unknown
- Method 124063: Unknown tuple element types
- Method 128989: Unknown tuple element types
- Method 129027: Conflicting stack types: int and cell
- Method 129212: Unknown tuple element types
- Method 130676: Unknown tuple element types

### main.fc — 2/8

Code hash: `d2752443e677bb667da22cd29ff1160dd9010062c9b5141f4c19fb7f84e386b6`

- Method -1: Dictionary lookup needs padding or immediate success assertion
- Method 0: Dictionary lookup needs padding or immediate success assertion
- Method 11: Dictionary lookup needs padding or immediate success assertion
- Method 12: Dictionary lookup needs padding or immediate success assertion
- Method 82442: Dictionary lookup needs padding or immediate success assertion
- Method 121420: Dictionary lookup needs padding or immediate success assertion

### collection.fc — 18/21

Code hash: `d4038ab95b1b24c4fb3da62f2facfc35367fa85e71e85e4a3bb2266713164276`

- Method 5: Unknown vector element type
- Method 6: Unknown tuple element types
- Method 68445: Unknown tuple element types

### bridge_pool.fc — 18/19

Code hash: `d46e6044dac9902cd0d92197933aa658ee9b5b646e8062841edb77ff9a437c61`

- Method 0: Unsupported instruction: CALLXARGS

### main.fc — 2/8

Code hash: `d988b6e67b177fcf610d86e1e8f054b7248f358989b3c35bd3aab5d733684ad5`

- Method -1: Dictionary lookup needs padding or immediate success assertion
- Method 0: Dictionary lookup needs padding or immediate success assertion
- Method 11: Dictionary lookup needs padding or immediate success assertion
- Method 12: Dictionary lookup needs padding or immediate success assertion
- Method 82442: Dictionary lookup needs padding or immediate success assertion
- Method 121420: Dictionary lookup needs padding or immediate success assertion

### contracts/eth_usdt_treasury.fc — 27/48

Code hash: `db72972a0485126746f42f91d55e7f299f3bd2a15c43c942e85cfb0a02da7733`

- Method 0: Unknown vector element type
- Method 6: Recursive method signature
- Method 35: Unsupported instruction: STRDUMP
- Method 36: Unsupported instruction: STRDUMP
- Method 37: Unsupported instruction: STRDUMP
- Method 38: Unsupported instruction: STRDUMP
- Method 39: Unsupported instruction: STRDUMP
- Method 41: Unsupported instruction: STRDUMP
- Method 53: Early and final return types differ
- Method 58: Unsupported instruction: CALLXARGS_1
- Method 66977: Dynamic continuation: runtime code and stack signature are unknown
- Method 72737: Dynamic continuation: runtime code and stack signature are unknown
- Method 85239: Dynamic continuation: runtime code and stack signature are unknown
- Method 93729: Dynamic continuation: runtime code and stack signature are unknown
- Method 96161: Dynamic continuation: runtime code and stack signature are unknown
- Method 97013: Conflicting stack types: cell and int
- Method 99093: Dynamic continuation: runtime code and stack signature are unknown
- Method 101620: Early and final return types differ
- Method 102611: Dynamic continuation: runtime code and stack signature are unknown
- Method 102705: Dynamic continuation: runtime code and stack signature are unknown
- Method 130676: Unknown tuple element types

- Unparsed `verification/GramPadTokenMaster.combined.fc` (`dc0d14ea4b40b834e2e5b1bd81bb7c8a73b63040274f143078091a2372837285`): Error: Nonstandard dispatcher: cannot preserve method cells

### contracts/cross_chain_layer.fc — 4/5

Code hash: `dd9d90b9fe0a05e31eb8d1b650e06e262804f84360282a8b4498f1edde108a2d`

- Method 0: Unsupported instruction: CALLXARGS

### collection.fc — 18/21

Code hash: `de35e57303804901b49cd3d6d58a717ceca79ab87616c80032a74c97c322201d`

- Method 5: Unknown vector element type
- Method 6: Unknown tuple element types
- Method 68445: Unknown tuple element types

### contracts/ton_reg_new.fc — 5/7

Code hash: `de7ecfd1b0e3939cc0cb776c61eb58948079f3fa01d60ea8468969b45a05e3e7`

- Method 0: Global value type is not established
- Method 26: Global value type is not established

### contracts/ton_reg_new.fc — 7/9

Code hash: `dec3bc83557407ad9307800680a008fec8f37dfe95129ea53ed0c7a2e05c6bae`

- Method 0: Global value type is not established
- Method 28: Global value type is not established

### contracts/test.fc — 0/1

Code hash: `e7a7c6e050e3eace6a5c4d0195153c804dcaa6f90ee637bfbc932d5eff53e9f5`

- Method 0: Unsupported instruction: DUMP

### fluida.fc — 2/9

Code hash: `fc201950ad58364391567519ec9715d04364b044912ca03a5b50b461ca71e111`

- Method 0: Unsupported instruction: STRDUMP
- Method 8: Unsupported instruction: STRDUMP
- Method 10: Unsupported instruction: DUMP
- Method 11: Unsupported instruction: STRDUMP
- Method 12: Unsupported instruction: STRDUMP
- Method 79059: Unsupported instruction: DUMP
- Method 94550: Unsupported instruction: STRDUMP

## Reproduction

Saved corpora are sibling folders `tolk-benchmark/` and `func-benchmark/`; each contains hash-verified `boc/`, baseline JSON and current `after.json`. Run from decompiler-web:

```sh
node --import ./tests/register.mjs tests/benchmark-corpus.mjs ../tolk-benchmark tolk
node --import ./tests/register.mjs tests/benchmark-corpus.mjs ../func-benchmark func
```

The benchmark also checks the previous `after.json` checkpoint before replacing it. Recompile all fully recovered contracts with the pinned compiler packages:

```sh
FUNC_COMPILER=/tmp/tolk-corpus-check/node_modules/@ton-community/func-js node --import ./tests/register.mjs tests/compile-corpus.mjs ../func-benchmark func
TOLK_COMPILER=/tmp/tolk-corpus-check/node_modules/tolk-1.4.2 node --import ./tests/register.mjs tests/compile-corpus.mjs ../tolk-benchmark tolk
FUNC_COMPILER=/tmp/tolk-corpus-check/node_modules/@ton-community/func-js TOLK_COMPILER=/tmp/tolk-corpus-check/node_modules/tolk-1.4.2 TVM_SANDBOX=/tmp/tolk-corpus-check/node_modules/@ton/sandbox node --import ./tests/register.mjs tests/call-types-vm.mjs
```

Signature inference and traversal-order checks:

```sh
FUNC_COMPILER=/tmp/tolk-corpus-check/node_modules/@ton-community/func-js TOLK_COMPILER=/tmp/tolk-corpus-check/node_modules/tolk-1.4.2 TVM_SANDBOX=/tmp/tolk-corpus-check/node_modules/@ton/sandbox node --import ./tests/register.mjs tests/signature-inference-vm.mjs
node --import ./tests/register.mjs tests/check-corpus-order.mjs ../tolk-benchmark ../func-benchmark
```

Opcode signatures were checked against the [official TVM specification](https://docs.ton.org/tvm.pdf) and [upstream assembler definitions](https://github.com/ton-blockchain/ton/blob/master/crypto/fift/lib/Asm.fif).

Try/catch regression with both compiler snapshot formats:

```sh
FUNC_COMPILER=/tmp/tolk-corpus-check/node_modules/@ton-community/func-js TOLK_COMPILER=/tmp/tolk-corpus-check/node_modules/tolk-1.4.2 TVM_SANDBOX=/tmp/tolk-corpus-check/node_modules/@ton/sandbox node --import ./tests/register.mjs tests/try-catch-vm.mjs
```

Terminal dynamic execution regression, including the reported pool:

```sh
FUNC_COMPILER=/tmp/tolk-corpus-check/node_modules/@ton-community/func-js TOLK_COMPILER=/tmp/tolk-corpus-check/node_modules/tolk-1.4.2 TVM_SANDBOX=/tmp/tolk-corpus-check/node_modules/@ton/sandbox node --import ./tests/register.mjs tests/dynamic-execute-vm.mjs
```

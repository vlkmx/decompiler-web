# Python / TypeScript parity audit

Static reconstruction, compilation, and sampled TVM execution (successful return stacks and exception codes). These samples do not prove equivalence for every input or transaction. Source strings are harvested from Python tests; incomplete/uncompilable strings are skipped. Both engines receive the same TS-decoded BOC instructions, with lossless slice and referenced-branch notation adaptation for Python. Matching signatures do not establish behavioral equivalence; some snippet gaps are textual aliases rather than BOC-path failures.

```json
{
  "snippets": 266,
  "matches": 266,
  "unsupported": 0,
  "signatureDifferences": 0,
  "contracts": 57,
  "pythonSupportedContracts": 53,
  "tsFullyRecoveredContracts": 54,
  "pythonOnlyContracts": 0,
  "tsCompileFailures": 0,
  "vmChecks": 308,
  "vmSuccesses": 202,
  "vmFailures": 0,
  "skippedSourceStrings": 2
}
```

## Instruction gaps

| Python test/source | Assembly | TS result |
| --- | --- | --- |

## Contract examples

| Source | Python lifts | TS methods | TS compiles | VM samples / mismatches | Missing / error |
| --- | --- | --- | --- | --- | --- |
| tests/test_difficult_cases.py:29 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_difficult_cases.py:41 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_difficult_cases.py:57 | yes | 2/2 | true | 1 / 0 |  |
| tests/test_difficult_cases.py:64 | yes | 2/2 | true | 1 / 0 |  |
| tests/test_difficult_cases.py:76 | yes | 3/3 | true | 10 / 0 |  |
| tests/test_difficult_cases.py:93 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_difficult_cases.py:98 | yes | 3/3 | true | 10 / 0 |  |
| tests/test_hard_patterns70.py:32 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_hard_patterns70.py:50 | yes | 2/2 | true | 1 / 0 |  |
| tests/test_hard_patterns70.py:15 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_hard_patterns70.py:21 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_hard_patterns70.py:27 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_hard_patterns70.py:44 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_hard_patterns70.py:73 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_hard_patterns70.py:82 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_ir.py:164 | no | 1/2 | not checked (partial) | 0 / 0 | Method 0: Unsupported instruction: register |
| tests/test_ir.py:174 | no | 2/4 | not checked (partial) | 0 / 0 | Method 1: Unsupported instruction: register; Method 100: Unsupported instruction: register |
| tests/test_patterns100.py:104 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns100.py:86 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns100.py:165 | yes | 5/5 | true | 4 / 0 |  |
| tests/test_patterns100.py:179 | yes | 3/3 | true | 2 / 0 |  |
| tests/test_patterns100.py:189 | yes | 3/3 | true | 2 / 0 |  |
| tests/test_patterns70.py:42 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:76 | yes | 2/2 | true | 1 / 0 |  |
| tests/test_patterns70.py:116 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:120 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:124 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:128 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:153 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:155 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:157 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:159 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:183 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:186 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:190 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:194 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:197 | yes | 2/2 | true | 1 / 0 |  |
| tests/test_patterns70.py:48 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:51 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:55 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_patterns70.py:60 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_service.py:64 | yes | 3/3 | true | 6 / 0 |  |
| tests/test_service.py:112 | no | 1/2 | not checked (partial) | 0 / 0 | Method 0: Unsupported instruction: register |
| tests/test_service.py:40 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_service.py:55 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_service.py:95 | yes | 4/4 | true | 15 / 0 |  |
| tests/test_stdlib_ir.py:67 | yes | 2/2 | true | 1 / 0 |  |
| tests/test_vectors70.py:33 | yes | 6/6 | true | 5 / 0 |  |
| tests/test_vectors70.py:66 | yes | 2/2 | true | 1 / 0 |  |
| tests/test_vectors70.py:90 | yes | 2/2 | true | 5 / 0 |  |
| tests/test_vectors70.py:123 | yes | 2/2 | true | 5 / 0 |  |
| continuation return with caller tail | yes | 2/2 | true | 5 / 0 |  |
| stdlib_contract | no | 15/15 | true | 42 / 0 |  |
| wallet_v5 | yes | 7/7 | true | 5 / 0 |  |
| user_wallet | yes | 7/7 | true | 9 / 0 |  |
| user_jetton | yes | 5/5 | true | 12 / 0 |  |
| nft-item | yes | 6/6 | true | 9 / 0 |  |

Detailed signatures, original source examples, Python failures and skipped source strings are in results.json.

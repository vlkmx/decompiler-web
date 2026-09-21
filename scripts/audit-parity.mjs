// Development audit: compare the web engine with the neighboring Python reference.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beginCell, BitString, Cell } from '@ton/core';
import { equivalent, int, slice, cell as sampleCell } from '../engine/tests/vm.mjs';
import { analyze, tupleTypes } from '../engine/dist/ir.js';
import { reconstruct, readableModule, render } from '../engine/dist/func.js';
import { disassembleProgram } from '../engine/dist/disassembler.js';
import { codeHash, methodCells } from '../engine/dist/boc.js';
import { Toolchain } from '../engine/dist/toolchain.js';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = resolve(process.env.PYTHON_DECOMPILER_ROOT ?? resolve(project, '../decompiler'));
const output = resolve(process.env.PARITY_OUTPUT ?? resolve(project, 'reports/parity'));
function python(mode, input) {
  const result = spawnSync(
    process.env.PYTHON ?? 'python3',
    [resolve(project, 'scripts/parity-reference.py'), root, mode],
    {
      input: input && JSON.stringify(input),
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
      timeout: 60000,
    },
  );
  if (result.status !== 0) throw new Error(result.stderr || String(result.error));
  return JSON.parse(result.stdout);
}
function adapt(i) {
  const result = { ...i, blocks: i.blocks.map((b) => b.map(adapt)) };
  if (i.opcode === 'PUSHSLICE' && /^x\{[\da-f]*_?\}$/i.test(i.operands[0])) {
    let hex = i.operands[0].slice(2, -1),
      padded = hex.endsWith('_');
    hex = hex.replace(/_$/, '');
    let bits = hex.length * 4;
    const bytes = Buffer.from(hex + (hex.length % 2 ? '0' : ''), 'hex');
    if (padded) {
      while (bits > 0 && !(bytes[(bits - 1) >> 3] & (1 << (7 - ((bits - 1) % 8))))) bits--;
      bits--;
    }
    result.operands = [
      beginCell()
        .storeBits(new BitString(bytes, 0, bits))
        .endCell()
        .toBoc()
        .toString('hex'),
    ];
  }
  return result;
}
// Normalize decoder notation for the Python reference, without changing the
// instruction semantics. Report unsupported reference formats separately.
function referenceCode(code) {
  const out = [];
  for (const original of code) {
    const i = { ...original, blocks: original.blocks.map(referenceCode) };
    if (
      ['PUSHSLICE', 'STSLICECONST', 'SDBEGINS', 'SDBEGINSQ'].includes(i.opcode) &&
      /^[a-f0-9]+$/i.test(i.operands[0] ?? '')
    ) {
      const cell = Cell.fromBoc(Buffer.from(i.operands[0], 'hex'))[0];
      if (cell.refs.length === 0) i.operands = ['x{' + cell.bits.toString() + '}'];
    }
    if (['IFREFELSE', 'IFELSEREF'].includes(i.opcode) && out.at(-1)?.opcode === 'PUSHCONT') {
      const previous = out.pop();
      i.blocks =
        i.opcode === 'IFREFELSE'
          ? [i.blocks[0], previous.blocks[0]]
          : [previous.blocks[0], i.blocks[0]];
      i.opcode = 'IFELSE';
    }
    out.push(i);
  }
  return out;
}
const harvested = python('harvest');
const cases = harvested.cases.map((c) => {
  try {
    const ir = analyze(c.instructions.map(adapt));
    const actual = { arguments: ir.argumentTypes, returns: ir.returns.map((v) => v.type) };
    return {
      ...c,
      instructions: undefined,
      ts: actual,
      status:
        JSON.stringify(actual) === JSON.stringify(c.python) ? 'match' : 'signature_difference',
    };
  } catch (e) {
    return {
      ...c,
      instructions: undefined,
      status: 'unsupported',
      opcode: e.opcode,
      error: e.message,
    };
  }
});
console.log(`Analyzed ${cases.length} Python-supported instruction snippets.`);
const tools = new Toolchain();
const programs = [],
  skipped = [];
for (const source of harvested.sources) {
  try {
    const compiled = await tools.compile(source.source, { timeout: 3000 });
    programs.push({
      origin: source.origin,
      source: source.source,
      boc: compiled.boc,
      program: disassembleProgram(compiled.boc),
    });
  } catch (e) {
    skipped.push({ origin: source.origin, error: e.message });
  }
  if ((programs.length + skipped.length) % 20 === 0)
    console.log(
      `Compiled ${programs.length} source examples; ${skipped.length} skipped (incomplete literals or compiler incompatibility).`,
    );
}
for (const name of ['stdlib_contract', 'wallet_v5', 'user_wallet', 'user_jetton', 'nft-item']) {
  const localPath = resolve(project, `engine/tests/fixtures/${name}.b64`);
  const path = existsSync(localPath)
    ? localPath
    : resolve(project, `../decompiler-node/test/data/${name}.b64`);
  if (existsSync(path)) {
    const boc = Buffer.from(readFileSync(path, 'utf8').trim(), 'base64');
    programs.push({ origin: name, boc, program: disassembleProgram(boc) });
  }
}
const references = python(
  'evaluate',
  programs.map((p) => ({
    instructions: referenceCode(p.program.instructions),
    methods: Object.fromEntries(
      [...p.program.methods].map(([id, body]) => [id, referenceCode(body)]),
    ),
  })),
);
const contracts = [];
for (let index = 0; index < programs.length; index++) {
  const p = programs[index],
    reference = references[index];
  const module = readableModule(reconstruct(p.program, methodCells(p.boc)));
  const row = {
    origin: p.origin,
    source: p.source,
    recoveredMethods: module.functions.filter((f) => !f.helper && !f.assembly).map((f) => f.id),
    pythonSupported: reference.supported,
    pythonError: reference.error,
    methods: module.functions.filter((f) => !f.helper).length,
    recovered: module.functions.filter((f) => !f.helper && !f.assembly).length,
    diagnostics: module.diagnostics,
    unsupported: module.unsupported,
  };
  // A syntactically valid readable result is a separate metric from lifting.
  if (row.recovered === row.methods) {
    try {
      const compiled = await tools.compile(render(module), { timeout: 3000 });
      row.recompiles = true;
      row.exactHash = compiled.codeHash === codeHash(p.boc);
      row.vmChecks = 0;
      row.vmSuccesses = 0;
      row.vmFailures = [];
      function argument(type, seed) {
        if (type === 'cell') return sampleCell('0000000000000000');
        if (type === 'slice') return slice(seed === 0 ? '' : '0000000000000000');
        if (type === 'builder') return { type: 'builder', cell: beginCell().endCell() };
        if (type.startsWith('['))
          return { type: 'tuple', items: tupleTypes(type).map((t) => argument(t, seed)) };
        if (type.startsWith('list_')) return { type: 'null' };
        if (type === 'tuple' || type.startsWith('vector_')) return { type: 'tuple', items: [] };
        return int(seed);
      }
      for (const f of module.functions.filter((f) => !f.helper && f.id > 0)) {
        for (const seed of f.args.length ? [0, 1, -1, 3, 255] : [0]) {
          const args = f.args.map(([type]) => argument(type, seed));
          try {
            const result = await equivalent(
              { original: p.boc, candidate: compiled.boc },
              f.id,
              args,
            );
            row.vmChecks++;
            if (result.exit === 0 || result.exit === 1) row.vmSuccesses++;
          } catch (error) {
            row.vmFailures.push({ method: f.id, seed, error: error.message });
          }
        }
      }
    } catch (e) {
      row.recompiles = false;
      row.compileError = e.message;
    }
  }
  if (reference.supported && reference.source) {
    try {
      await tools.compile(reference.source, { timeout: 3000 });
      row.pythonRecompiles = true;
    } catch (e) {
      row.pythonRecompiles = false;
      row.pythonCompileError = e.message;
    }
  }
  contracts.push(row);
  if ((index + 1) % 20 === 0)
    console.log(
      `Checked reconstruction and compilation for ${index + 1}/${programs.length} contracts.`,
    );
}
const gaps = cases.filter((c) => c.status !== 'match');
const report = {
  scope:
    'Static reconstruction, compilation, and sampled TVM execution (successful return stacks and exception codes). These samples do not prove equivalence for every input or transaction. Source strings are harvested from Python tests; incomplete/uncompilable strings are skipped. Both engines receive the same TS-decoded BOC instructions, with lossless slice and referenced-branch notation adaptation for Python. Matching signatures do not establish behavioral equivalence; some snippet gaps are textual aliases rather than BOC-path failures.',
  summary: {
    snippets: cases.length,
    matches: cases.length - gaps.length,
    unsupported: cases.filter((c) => c.status === 'unsupported').length,
    signatureDifferences: cases.filter((c) => c.status === 'signature_difference').length,
    contracts: contracts.length,
    pythonSupportedContracts: contracts.filter((c) => c.pythonSupported).length,
    tsFullyRecoveredContracts: contracts.filter((c) => c.recovered === c.methods).length,
    pythonOnlyContracts: contracts.filter((c) => c.pythonSupported && c.recovered < c.methods)
      .length,
    tsCompileFailures: contracts.filter((c) => c.recompiles === false).length,
    vmChecks: contracts.reduce((n, c) => n + (c.vmChecks ?? 0), 0),
    vmSuccesses: contracts.reduce((n, c) => n + (c.vmSuccesses ?? 0), 0),
    vmFailures: contracts.flatMap((c) => c.vmFailures ?? []).length,
    skippedSourceStrings: skipped.length,
  },
  cases,
  contracts,
  skipped,
};
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
const cell = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
const lines = [
  '# Python / TypeScript parity audit',
  '',
  report.scope,
  '',
  '```json',
  JSON.stringify(report.summary, null, 2),
  '```',
  '',
  '## Instruction gaps',
  '',
  '| Python test/source | Assembly | TS result |',
  '| --- | --- | --- |',
  ...gaps.map(
    (c) => `| ${cell(c.origin)} | \`${cell(c.asm)}\` | ${cell(c.error ?? JSON.stringify(c.ts))} |`,
  ),
  '',
  '## Contract examples',
  '',
  '| Source | Python lifts | TS methods | TS compiles | VM samples / mismatches | Missing / error |',
  '| --- | --- | --- | --- | --- | --- |',
  ...contracts.map(
    (c) =>
      `| ${cell(c.origin)} | ${c.pythonSupported ? 'yes' : 'no'} | ${c.recovered}/${c.methods} | ${c.recompiles ?? 'not checked (partial)'} | ${c.vmChecks ?? 0} / ${c.vmFailures?.length ?? 0} | ${cell(c.compileError ?? c.diagnostics.join('; '))} |`,
  ),
  '',
  'Detailed signatures, original source examples, Python failures and skipped source strings are in results.json.',
  '',
];
writeFileSync(resolve(output, 'REPORT.md'), lines.join('\n'));
console.log(JSON.stringify(report.summary, null, 2));
console.log(`Report: ${resolve(output, 'REPORT.md')}`);

const baselinePath = resolve(project, 'scripts/parity-baseline.json');
if (process.argv.includes('--check')) {
  const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
  const regressions = [
    ...gaps.map((c) => `Python/TS instruction gap: ${c.asm}`),
    ...contracts
      .filter((c) => c.pythonSupported && c.recovered < c.methods)
      .map((c) => `Python-only recovery: ${c.origin}`),
    ...contracts
      .filter((c) => c.recompiles === false)
      .map((c) => `Compilation failure: ${c.origin}`),
  ];
  regressions.push(
    ...contracts.flatMap((c) =>
      (c.vmFailures ?? []).map(
        (f) => `VM mismatch: ${c.origin}, method ${f.method}, seed ${f.seed}: ${f.error}`,
      ),
    ),
  );
  for (const expected of baseline.snippets) {
    const current = cases.find((c) => c.asm === expected.asm);
    if (
      !current ||
      current.status !== 'match' ||
      JSON.stringify(current.ts) !== JSON.stringify(expected.signature)
    )
      regressions.push(`Instruction regression: ${expected.asm}`);
  }
  for (const expected of baseline.contracts) {
    const current = contracts.find((c) => c.origin === expected.origin);
    if (
      !current ||
      expected.recoveredMethods.some((id) => !current.recoveredMethods.includes(id)) ||
      (expected.recompiles && !current.recompiles)
    )
      regressions.push(`Contract regression: ${expected.origin}`);
  }
  if (regressions.length) {
    console.error(regressions.join('\n'));
    process.exitCode = 1;
  } else console.log('No regressions against the saved parity baseline.');
}

if (process.argv.includes('--update-baseline') && !process.exitCode) {
  if (
    report.summary.vmFailures ||
    report.summary.tsCompileFailures ||
    report.summary.pythonOnlyContracts ||
    gaps.length
  )
    throw new Error('Refusing to save a baseline with parity failures.');
  writeFileSync(
    baselinePath,
    JSON.stringify(
      {
        snippets: cases
          .filter((c) => c.status === 'match')
          .map((c) => ({ asm: c.asm, signature: c.ts })),
        contracts: contracts.map((c) => ({
          origin: c.origin,
          recoveredMethods: c.recoveredMethods,
          recompiles: c.recompiles,
        })),
      },
      null,
      2,
    ) + '\n',
  );
  console.log('Updated the parity regression baseline.');
}

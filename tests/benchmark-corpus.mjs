// Re-run saved, hash-verified BOCs without a compiler or network.
// node --import ./tests/register.mjs tests/benchmark-corpus.mjs /path/to/benchmark [tolk|func]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { reconstructReadable } from '../src/decompiler/core.ts';
const root = process.argv[2];
const language = process.argv[3] ?? 'tolk';
assert.ok(['func', 'tolk'].includes(language));
const report = language === 'func' ? 'baseline.json' : 'report.json';
if (!root) throw new Error('Pass the benchmark directory containing report.json and boc/.');
const baseline = JSON.parse(fs.readFileSync(path.join(root, report)));
const currentPath = path.join(root, 'after.json');
const checkpoint = new Map((fs.existsSync(currentPath)
  ? JSON.parse(fs.readFileSync(currentPath)) : []).map(row => [row.hash, row]));
const rows = baseline.map(previous => {
  if (language === 'func' && !previous.hashMatch) return previous;
  const row = { ...previous, before: { structured: previous.structured, total: previous.total, partial: previous.partial, error: previous.error } };
  delete row.error;
  try {
    const result = reconstructReadable(Buffer.from(fs.readFileSync(path.join(root, 'boc', previous.hash + '.b64'), 'utf8'), 'base64'), language);
    const d = result.decompilation;
    assert.equal(d.original_code_hash, previous.hash);
    Object.assign(row, { structured: d.structured_method_count, total: d.method_count, partial: d.partial_method_count, unsupported: d.unsupported_instructions, diagnostics: result.diagnostics });
    if (previous.total !== undefined) {
      assert.equal(row.total, previous.total, 'Method denominator changed');
      assert.ok(row.structured >= previous.structured, `Coverage regression: ${row.name}`);
    }
    const current = checkpoint.get(previous.hash);
    if (current?.total !== undefined && !current.error) {
      assert.equal(row.total, current.total, 'Method denominator changed since last run');
      assert.ok(row.structured >= current.structured, `Coverage regression since last run: ${row.name}`);
    }
  } catch (e) {
    if (previous.total !== undefined || checkpoint.get(previous.hash)?.total !== undefined) throw e;
    row.error = String(e);
  }
  return row;
});
fs.writeFileSync(path.join(root, 'after.json'), JSON.stringify(rows, null, 2) + '\n');
const completed = rows.filter(r => r.total !== undefined && !r.error);
console.log(JSON.stringify({ contracts: rows.length, processed: completed.length,
  before: completed.reduce((n, r) => n + r.before.structured, 0),
  structured: completed.reduce((n, r) => n + r.structured, 0),
  total: completed.reduce((n, r) => n + r.total, 0),
  partial: completed.reduce((n, r) => n + r.partial, 0),
  fullyRecoveredContracts: completed.filter(r => r.structured === r.total).length,
}, null, 2));

import { performance } from 'node:perf_hooks';
import { codeHash, methodCells } from './boc.js';
import { disassembleProgram } from './disassembler.js';
import { formatAsm } from './asm.js';
import {
  reconstruct,
  fallbackCells,
  render,
  renderParts,
  readableModule,
  type Module,
} from './func.js';
import { Toolchain, type Compilation } from './toolchain.js';
import { DecompilerError, BocError } from './errors.js';
import { compare, compareCells } from './compare.js';
export interface DecompileOptions {
  maxSearchTimeMs?: number;
  toolchain?: Toolchain;
  debug?: boolean;
}
export async function decompile(boc: Uint8Array, options: DecompileOptions = {}) {
  const budget = options.maxSearchTimeMs ?? 30000;
  if (!Number.isInteger(budget) || budget < 1 || budget > 30000)
    throw new DecompilerError('INVALID_REQUEST', 'Search budget must be 1..30000 ms', 'input', 400);
  const start = performance.now(),
    deadline = start + budget,
    remaining = () => Math.max(0, deadline - performance.now());
  let originalHash: string;
  try {
    originalHash = codeHash(boc);
  } catch (e) {
    if (e instanceof BocError) throw new DecompilerError('INVALID_BOC', e.message, 'boc', 400);
    throw e;
  }
  const toolchain = options.toolchain ?? new Toolchain();
  let program: ReturnType<typeof disassembleProgram>;
  try {
    program = disassembleProgram(boc);
  } catch (e) {
    throw new DecompilerError(
      'UNSUPPORTED_DISPATCHER',
      e instanceof Error ? e.message : String(e),
      'disassembly',
    );
  }
  const asm = formatAsm(program.instructions),
    cells = methodCells(boc),
    fallback = fallbackCells(program, cells),
    structured = reconstruct(program, cells);
  const configs = await toolchain.configs(remaining()),
    ranked = configs.flatMap((c) =>
      c.flags.map((flag) => ({
        version: c.version,
        flags: [flag],
        weight: 1 / (configs.length * c.flags.length),
      })),
    );
  const diagnostics = [...structured.diagnostics],
    seen = new Set<string>();
  let attempts = 0;
  type Candidate = { module: Module; compiled: Compilation; exact: boolean; source: string };
  let best: Candidate | undefined, readable: Candidate | undefined;
  const exactConfigs: Array<{ version: string; flags: string[] }> = [];
  const queue: Module[] = [structured];
  const clean = readableModule(structured);
  if (render(clean) !== render(structured)) queue.push(clean);
  queue.push(fallback);
  const evaluate = async (module: Module, config: (typeof ranked)[number]) => {
    attempts++;
    const source = render(module),
      compiled = await toolchain.compile(source, {
        version: config.version,
        flags: config.flags,
        timeout: remaining(),
      });
    return { module, compiled, source, exact: compiled.codeHash === originalHash };
  };
  for (let index = 0; index < queue.length && remaining() > 0 && attempts < 64; index++) {
    const module = queue[index],
      source = render(module);
    if (seen.has(source)) continue;
    seen.add(source);
    for (const config of ranked) {
      if (remaining() <= 0 || attempts >= 64) break;
      try {
        const candidate = await evaluate(module, config),
          lifted = module.functions.filter((f) => !f.assembly).length;
        if (
          lifted &&
          (!readable || lifted > readable.module.functions.filter((f) => !f.assembly).length)
        )
          readable = candidate;
        if (candidate.exact) {
          best = candidate;
          exactConfigs.push({ version: config.version, flags: config.flags });
          break;
        }
        // Keep typed signatures while restoring only bodies whose hashes changed.
        if (lifted) {
          const rebuilt = methodCells(candidate.compiled.boc);
          const repaired = {
            ...module,
            functions: module.functions.map((f) =>
              !rebuilt.has(f.id) || codeHash(rebuilt.get(f.id)!) !== codeHash(cells.get(f.id)!)
                ? {
                    ...f,
                    assembly: fallback.functions.find((x) => x.id === f.id)!.assembly,
                    statements: [],
                    diagnostic: 'Method assembly preserved to reproduce its exact hash.',
                  }
                : f,
            ),
          };
          if (repaired.functions.some((f) => !f.assembly)) queue.splice(index + 1, 0, repaired);
        }
      } catch (e) {
        if (diagnostics.length < 20)
          diagnostics.push(
            `Candidate failed: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`,
          );
      }
      // Reserve the budget for method-cell preservation; one attempt per structured source.
      if (module !== fallback) break;
    }
    if (best) break;
  }
  if (!best)
    return {
      ...new DecompilerError(
        'DECOMPILATION_FAILED',
        'No hash-verified reconstruction within the search budget',
        'recompilation',
        422,
        diagnostics,
      ).response(),
      search: { candidate_count: attempts, runtime_ms: performance.now() - start },
    };
  // Every published source view gets an independent compiler/hash check.
  const cleaned = readableModule(readable?.module ?? best.module);
  if (remaining() > 0 && attempts < 64 && render(cleaned) !== best.source) {
    try {
      readable = await evaluate(cleaned, {
        version: best.compiled.version,
        flags: best.compiled.flags,
        weight: 1,
      });
    } catch {
      /* Keep the already compiled presentation. */
    }
  }
  const view = (c: Candidate) => {
    const lifted = c.module.functions.filter((f) => !f.assembly).length,
      mode =
        lifted === c.module.functions.length ? 'structured' : lifted ? 'hybrid' : 'cell_assembly';
    return {
      func: c.source,
      ...renderParts(c.module),
      ...(mode !== 'structured'
        ? {
            display_contract: renderParts(c.module, program).contract,
            display_format: 'func-fift-pseudocode',
          }
        : {}),
      decompilation: {
        quality: c.exact ? 'exact' : 'unverified',
        confidence: c.exact ? 1 : 0,
        recompiles: true,
        exact_hash_match: c.exact,
        original_code_hash: originalHash,
        candidate_code_hash: c.compiled.codeHash,
        reconstruction_mode: mode,
        stack_analysis_complete: mode === 'structured',
        structured_method_count: lifted,
        method_count: c.module.functions.length,
        unsupported_instructions: structured.unsupported,
        ...compare(asm, c.compiled.asm),
        cell_match: compareCells(boc, c.compiled.boc),
      },
    };
  };
  diagnostics.push(
    'Recompilation verifies cell hashes; it does not identify the historical compiler. This port currently ships one WASM compiler version.',
  );
  if (best.module.functions.some((f) => f.assembly))
    diagnostics.push(
      'Some methods retain original TVM assembly. Exactness measures bytecode preservation, not high-level recovery.',
    );
  return {
    success: true as const,
    ...view(best),
    compiler: {
      version: null,
      confidence: 0,
      selected_version: best.compiled.version,
      flags: best.compiled.flags,
      compatible_versions: [...new Set(exactConfigs.map((c) => c.version))],
      compatible_configurations: exactConfigs,
      candidates: ranked,
    },
    diagnostics,
    ...(readable && readable.source !== best.source
      ? {
          readable: {
            ...view(readable),
            compiler: {
              version: null,
              selected_version: readable.compiled.version,
              flags: readable.compiled.flags,
            },
            diagnostics: readable.exact
              ? []
              : [
                  'This source compiles but its code hash differs. Semantic equivalence has not been established.',
                ],
          },
        }
      : {}),
    search: { candidate_count: attempts, runtime_ms: performance.now() - start },
    ...(options.debug ? { debug: { asm, ast: best.module, compiler_candidates: ranked } } : {}),
  };
}
export async function verify(
  boc: Uint8Array,
  source: string,
  options: { toolchain?: Toolchain; version?: string; flags?: string[]; timeout?: number } = {},
) {
  const original = codeHash(boc),
    tools = options.toolchain ?? new Toolchain(),
    compiled = await tools.compile(source, options);
  return {
    recompiles: true,
    exact_hash_match: compiled.codeHash === original,
    original_code_hash: original,
    candidate_code_hash: compiled.codeHash,
    ...compare(tools.disassemble(boc), compiled.asm),
    cell_match: compareCells(boc, compiled.boc),
  };
}
export async function detectCompiler(boc: Uint8Array, toolchain = new Toolchain()) {
  codeHash(boc);
  const configs = await toolchain.configs();
  return {
    version: null,
    confidence: 0,
    candidates: configs,
    diagnostics: [
      'Installed compiler configurations are experiment candidates. Historical compiler fingerprint ranking has not been ported.',
    ],
  };
}

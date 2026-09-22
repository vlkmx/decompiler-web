/** Pure TypeScript reconstruction. No compiler, VM, subprocess, or WASM is used here. */
import { BocError, DecompilerError } from './errors';
import { codeHash, methodCells } from './boc';
import { disassembleProgram } from './disassembler';
import { reconstruct, readableModule, render, renderParts } from './func';
export function reconstructReadable(boc: Uint8Array) {
  let originalHash: string;
  try {
    originalHash = codeHash(boc);
  } catch (e) {
    if (e instanceof BocError) throw new DecompilerError('INVALID_BOC', e.message, 'boc', 400);
    throw e;
  }
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
  const module = readableModule(reconstruct(program, methodCells(boc)));
  const methods = module.functions.filter((f) => !f.helper);
  const lifted = methods.filter((f) => !f.assembly).length;
  return {
    success: true as const,
    func: render(module),
    ...renderParts(module),
    ...(lifted < methods.length
      ? {
          display_contract: renderParts(module, program).contract,
          display_stdlib: renderParts(module, program).stdlib,
          display_format: 'func-fift-pseudocode',
        }
      : {}),
    decompilation: {
      quality: 'unverified',
      recompiles: false,
      exact_hash_match: false,
      verification_performed: false,
      original_code_hash: originalHash,
      reconstruction_mode:
        lifted === methods.length ? 'structured' : lifted ? 'hybrid' : 'cell_assembly',
      structured_method_count: lifted,
      partial_method_count: methods.filter((f) => f.assembly && f.partial).length,
      method_count: methods.length,
      unsupported_instructions: module.unsupported,
    },
    diagnostics: [
      ...module.diagnostics,
      'Static TypeScript reconstruction only. Compilation and semantic equivalence have not been checked.',
    ],
  };
}

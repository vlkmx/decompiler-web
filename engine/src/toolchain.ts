import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { codeHash } from './boc.js';
import { disassemble } from './disassembler.js';
import { DecompilerError } from './errors.js';
export interface Compilation {
  boc: Buffer;
  asm: string;
  codeHash: string;
  version: string;
  flags: string[];
}
export interface CompileOptions {
  version?: string;
  flags?: string[];
  entrypoints?: string[];
  timeout?: number;
}
export class ToolchainError extends DecompilerError {
  constructor(code: string, message: string) {
    super(
      code,
      message,
      'toolchain',
      code === 'TOOLCHAIN_TIMEOUT' ? 504 : code === 'TOOLCHAIN_FAILED' ? 422 : 503,
    );
  }
}
async function job(data: unknown, timeout: number): Promise<Record<string, unknown>> {
  if (timeout <= 0) throw new ToolchainError('TOOLCHAIN_TIMEOUT', 'Compiler deadline exceeded');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./compiler-worker.js', import.meta.url), {
      execArgv: [],
      workerData: data,
      resourceLimits: { maxOldGenerationSizeMb: 256 },
      stdout: true,
      stderr: true,
    });
    let settled = false;
    let output = 0;
    const finish = (error?: Error, value?: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve(value!);
    };
    const timer = setTimeout(
      () => finish(new ToolchainError('TOOLCHAIN_TIMEOUT', 'Compiler deadline exceeded')),
      timeout,
    );
    worker.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.length;
      if (output > 4 * 1024 * 1024)
        finish(new ToolchainError('TOOLCHAIN_FAILED', 'Compiler output limit'));
    });
    worker.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.length;
      if (output > 4 * 1024 * 1024)
        finish(new ToolchainError('TOOLCHAIN_FAILED', 'Compiler output limit'));
    });
    worker.once('message', (v) => finish(undefined, v));
    worker.once('error', (e) => finish(e instanceof Error ? e : new Error(String(e))));
    worker.once('exit', (code) => {
      if (!settled)
        finish(new ToolchainError('TOOLCHAIN_FAILED', `Compiler worker exited ${code}`));
    });
  });
}
export class Toolchain {
  private version?: string;
  async versions(timeout = 10000): Promise<string[]> {
    if (!this.version) {
      const v = await job({ action: 'version' }, timeout);
      if (typeof v.funcVersion !== 'string')
        throw new ToolchainError('TOOLCHAIN_UNAVAILABLE', 'Cannot identify WASM compiler');
      this.version = v.funcVersion;
    }
    return [this.version];
  }
  async configs(timeout = 10000) {
    return (await this.versions(timeout)).map((version) => ({
      id: 'func-js-wasm-' + version,
      version,
      flags: ['-O2', '-O0', '-O1', '-O3'],
    }));
  }
  disassemble(boc: Uint8Array): string {
    return disassemble(boc);
  }
  async compile(
    source: string | Record<string, string>,
    options: CompileOptions = {},
  ): Promise<Compilation> {
    const deadline = performance.now() + (options.timeout ?? 10000),
      remaining = () => Math.max(0, deadline - performance.now());
    const [version] = await this.versions(remaining());
    if (options.version && options.version !== version)
      throw new ToolchainError(
        'COMPILER_UNAVAILABLE',
        `WASM compiler ${version} installed; requested ${options.version}`,
      );
    const flags = options.flags ?? ['-O2'];
    if (flags.length !== 1 || !/^\-O[0-3]$/.test(flags[0]))
      throw new ToolchainError('INVALID_FLAGS', 'Specify one optimizer level -O0..-O3');
    const sources = typeof source === 'string' ? { 'candidate.fc': source } : { ...source };
    if (
      !Object.keys(sources).length ||
      Object.values(sources).some((s) => typeof s !== 'string') ||
      Object.values(sources).reduce((n, s) => n + Buffer.byteLength(s), 0) > 8 * 1024 * 1024
    )
      throw new ToolchainError('INVALID_SOURCE', 'Source set is empty or larger than 8 MiB');
    for (const name of Object.keys(sources))
      if (
        name.startsWith('/') ||
        name.split('/').some((p) => p === '..' || p === '.') ||
        /[\\\x00]/.test(name) ||
        !name.endsWith('.fc')
      )
        throw new ToolchainError('INVALID_SOURCE_PATH', 'Source paths must be relative .fc paths');
    const targets = options.entrypoints ?? [Object.keys(sources)[0]];
    if (!targets.length || targets.some((t) => !Object.hasOwn(sources, t)))
      throw new ToolchainError('INVALID_SOURCE_PATH', 'Entrypoints must belong to sources');
    const result = await job(
      { action: 'compile', config: { sources, targets, optLevel: Number(flags[0].slice(2)) } },
      remaining(),
    );
    if (result.status !== 'ok' || typeof result.codeBoc !== 'string')
      throw new ToolchainError(
        'TOOLCHAIN_FAILED',
        String(result.message ?? 'Compilation failed').slice(0, 4000),
      );
    const boc = Buffer.from(result.codeBoc, 'base64'),
      compiled = {
        boc,
        asm: this.disassemble(boc),
        codeHash: codeHash(boc),
        version,
        flags: [...flags],
      };
    return compiled;
  }
}

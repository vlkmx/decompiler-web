import { parentPort, workerData } from 'node:worker_threads';
import { compileFunc, compilerVersion } from '@ton-community/func-js';
try {
  if (workerData.action === 'version') parentPort!.postMessage(await compilerVersion());
  else parentPort!.postMessage(await compileFunc(workerData.config));
} catch (e) {
  parentPort!.postMessage({ status: 'error', message: e instanceof Error ? e.message : String(e) });
}

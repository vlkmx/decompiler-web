import { reconstructReadable } from './core.js';
import { validateRequest } from './request.js';
import { decompile } from './service.js';
import { DecompilerError } from './errors.js';
process.once('message', async (request) => {
  let envelope;
  try {
    const { boc, milliseconds, verify } = validateRequest(request);
    const response = verify
      ? await decompile(boc, { maxSearchTimeMs: milliseconds })
      : reconstructReadable(boc);
    envelope = { status: response.success ? 200 : 422, response };
  } catch (e) {
    const error =
      e instanceof DecompilerError
        ? e
        : new DecompilerError('WORKER_FAILED', 'Internal worker failure', 'worker', 500);
    envelope = { status: error.status, response: error.response() };
  }
  if (process.send) process.send(envelope, () => process.disconnect?.());
});

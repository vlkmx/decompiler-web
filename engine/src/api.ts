import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateRequest } from "./request.js";
import { DecompilerError } from "./errors.js";
export { validateRequest } from "./request.js";
export async function runWorker(
  request: unknown,
  signal?: AbortSignal,
  workerFile?: string,
): Promise<{ status: number; response: unknown }> {
  const { milliseconds } = validateRequest(request);
  return new Promise((resolve, reject) => {
    const process = fork(
      workerFile ?? fileURLToPath(new URL("./worker.js", import.meta.url)),
      [],
      {
        execArgv: ["--max-old-space-size=384"],
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    let settled = false;
    const stop = (
      error?: Error,
      value?: { status: number; response: unknown },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      process.kill("SIGKILL");
      if (error) reject(error);
      else resolve(value!);
    };
    const abort = () =>
      stop(
        new DecompilerError(
          "RESOURCE_LIMIT",
          "Request cancelled",
          "search",
          504,
        ),
      );
    const timer = setTimeout(
      () =>
        stop(
          new DecompilerError(
            "RESOURCE_LIMIT",
            "Request exceeded its execution deadline",
            "search",
            504,
          ),
        ),
      milliseconds + 1500,
    );
    signal?.addEventListener("abort", abort, { once: true });
    process.once("message", (message: unknown) => {
      if (
        !message ||
        typeof message !== "object" ||
        !("status" in message) ||
        !("response" in message) ||
        JSON.stringify(message).length > 8 * 1024 * 1024
      ) {
        stop(
          new DecompilerError(
            "WORKER_FAILED",
            "Invalid or oversized worker response",
            "worker",
            500,
          ),
        );
        return;
      }
      stop(undefined, message as { status: number; response: unknown });
    });
    process.once("error", (e) => stop(e));
    process.once("exit", () => {
      if (!settled)
        stop(
          new DecompilerError(
            "WORKER_FAILED",
            "Worker exited without a response",
            "worker",
            500,
          ),
        );
    });
    if (signal?.aborted) {
      abort();
      return;
    }
    process.send(request as Record<string, string | number>);
  });
}

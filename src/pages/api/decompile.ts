import type { NextApiRequest, NextApiResponse } from "next";
import { runWorker } from "@local/ton-decompiler/api";
import { DecompilerError } from "@local/ton-decompiler/errors";
import { join } from "node:path";

export const config = {
  api: { bodyParser: { sizeLimit: "1400kb" }, responseLimit: "8mb" },
  maxDuration: 40,
};
const state = globalThis as typeof globalThis & { decompilerActive?: number };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res
      .status(405)
      .json({
        success: false,
        error: {
          code: "METHOD_NOT_ALLOWED",
          message: "Use POST /api/decompile",
        },
      });
  }
  if (
    req.headers["content-type"]?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    return res
      .status(415)
      .json({
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "Content-Type must be application/json",
        },
      });
  }
  if ((state.decompilerActive ?? 0) >= 4) {
    res.setHeader("Retry-After", "2");
    return res
      .status(503)
      .json({
        success: false,
        error: {
          code: "BUSY",
          message: "Server is busy. Try again in a few seconds.",
        },
      });
  }
  state.decompilerActive = (state.decompilerActive ?? 0) + 1;
  const controller = new AbortController();
  const cancel = () => {
    if (!res.writableFinished) controller.abort();
  };
  res.once("close", cancel);
  try {
    // Keep the complete ESM worker beside its imports, outside Next's asset bundling.
    const result = await runWorker(
      req.body,
      controller.signal,
      join(process.cwd(), "engine/dist/worker.js"),
    );
    if (!res.destroyed) res.status(result.status).json(result.response);
  } catch (error) {
    if (!res.destroyed) {
      if (error instanceof DecompilerError)
        res.status(error.status).json(error.response());
      else {
        res
          .status(500)
          .json({
            success: false,
            error: {
              code: "INTERNAL_ERROR",
              message: "Decompilation failed.",
            },
          });
      }
    }
  } finally {
    state.decompilerActive!--;
    res.removeListener("close", cancel);
  }
}

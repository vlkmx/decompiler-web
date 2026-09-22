import "./browserPolyfills";
import { reconstructReadable } from "@/decompiler/core";
import { decodeBase64 } from "@/decompiler/input";

export type DecompilationResult = ReturnType<typeof reconstructReadable>;
export type DecompilationResponse =
  | { result: DecompilationResult }
  | { error: string };

self.onmessage = (event: MessageEvent<string>) => {
  try {
    self.postMessage({
      result: reconstructReadable(decodeBase64(event.data)),
    } satisfies DecompilationResponse);
  } catch (cause) {
    self.postMessage({
      error:
        cause instanceof Error
          ? cause.message
          : "Unable to decompile contract code.",
    } satisfies DecompilationResponse);
  }
};

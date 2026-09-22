import "./browserPolyfills";
import { reconstructReadable, type OutputLanguage } from "@/decompiler/core";
import { decodeBase64 } from "@/decompiler/input";

export type DecompilationResult = ReturnType<typeof reconstructReadable>;
export type DecompilationResponse =
  | { result: DecompilationResult }
  | { error: string };

export type DecompilationRequest = { code: string; language: OutputLanguage };

self.onmessage = (event: MessageEvent<string | DecompilationRequest>) => {
  try {
    const input = typeof event.data === "string" ? { code: event.data, language: "func" as const } : event.data;
    if (input.language !== "func" && input.language !== "tolk") throw new Error("Unknown output language");
    self.postMessage({
      result: reconstructReadable(decodeBase64(input.code), input.language),
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

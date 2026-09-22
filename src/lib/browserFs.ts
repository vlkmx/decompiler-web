// TASM imports an optional file-based stack-signature loader. Static browser
// reconstruction never uses it. Fail explicitly if that ever changes.
export function readFileSync(): never {
  throw new Error(
    "Filesystem access is unavailable in the browser decompiler.",
  );
}

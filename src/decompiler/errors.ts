export class DecompilerError extends Error {
  constructor(
    public code: string,
    message: string,
    public stage = 'reconstruction',
    public status = 422,
    public diagnostics: string[] = [],
  ) {
    super(message);
  }
  response() {
    return {
      success: false as const,
      error: { code: this.code, message: this.message, stage: this.stage },
      diagnostics: this.diagnostics,
    };
  }
}
export class BocError extends Error {}
export class AsmError extends Error {}
export class UnsupportedInstruction extends Error {
  constructor(
    public opcode: string,
    message = `Unsupported instruction: ${opcode}`,
  ) {
    super(message);
  }
}

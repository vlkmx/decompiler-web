import { AsmError } from './errors';
export { AsmError } from './errors';
export interface Instruction {
  opcode: string;
  operands: string[];
  blocks: Instruction[][];
  source: string;
}
export interface Program {
  instructions: Instruction[];
  methods: Map<number, Instruction[]>;
}
export const instruction = (
  opcode: string,
  operands: string[] = [],
  blocks: Instruction[][] = [],
  source = '',
): Instruction => ({ opcode, operands, blocks, source });
export const normalized = (i: Instruction): unknown[] => [
  i.opcode,
  i.operands,
  i.blocks.map((b) => b.map(normalized)),
];
export function* walk(code: Instruction[]): Generator<Instruction> {
  for (const i of code) {
    yield i;
    for (const child of i.blocks) yield* walk(child);
  }
}
function lines(text: string): string[][] {
  if (text.length > 8_000_000) throw new AsmError('ASM exceeds size limit');
  const result: string[][] = [];
  let tokens: string[] = [],
    token = '',
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      token += c;
      if (c === '"' && !escaped) quoted = false;
      escaped = c === '\\' && !escaped;
      continue;
    }
    if (c === '"') {
      quoted = true;
      token += c;
    } else if (text.slice(i, i + 2) === '//' || c === ';') {
      while (i < text.length && text[i] !== '\n') i++;
      i--;
    } else if (/\s/.test(c)) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      if (c === '\n' && tokens.length) {
        result.push(tokens);
        tokens = [];
      }
    } else token += c;
  }
  if (quoted) throw new AsmError('Unterminated string');
  if (token) tokens.push(token);
  if (tokens.length) result.push(tokens);
  return result;
}
const opcodePattern = /^(?:-?[0-9]*[A-Z][A-Z0-9_#?+\-]*|DUMPs[0-9]+)$/;
export function parseAsm(text: string): Program {
  const input = lines(text),
    methods = new Map<number, Instruction[]>();
  let position = 0;
  function block(depth = 0, closing = false): [Instruction[], string | undefined] {
    if (depth > 128) throw new AsmError('Continuation nesting exceeds limit');
    const result: Instruction[] = [];
    while (position < input.length) {
      const words = input[position++],
        source = words.join(' ');
      if (['}>', '}', ']', '}>ELSE<{', '}>DO<{'].includes(words[0])) {
        if (!closing || words.length !== 1)
          throw new AsmError('Unexpected continuation closing delimiter');
        return [result, words[0]];
      }
      if (words[0] === 'Cannot')
        throw new AsmError('TON could not disassemble the entire code cell');
      if (words.length === 2 && words[1] === '{' && words[0].startsWith('DICT')) {
        const ids: string[] = [],
          bodies: Instruction[][] = [];
        while (position < input.length && input[position].join(' ') !== '}') {
          const entry = input[position++];
          if (
            entry.length !== 3 ||
            entry[1] !== '=>' ||
            entry[2] !== '<{' ||
            !/^-?(?:\d+|0x[\da-fA-F]+)$/.test(entry[0])
          )
            throw new AsmError('Malformed method dictionary entry');
          const id = Number(entry[0]);
          if (!Number.isSafeInteger(id) || ids.includes(String(id)))
            throw new AsmError('Invalid or duplicate method id');
          const [body, end] = block(depth + 1, true);
          if (end !== '}>') throw new AsmError('Invalid method continuation');
          if (depth === 0) methods.set(id, body);
          ids.push(String(id));
          bodies.push(body);
        }
        if (position === input.length) throw new AsmError('Unclosed method dictionary');
        position++;
        result.push(instruction(words[0], ids, bodies, source));
        continue;
      }
      const last = words.at(-1)!,
        attached = last.endsWith(':<{');
      if (attached || ['<{', '{', '['].includes(last)) {
        const head = [...words.slice(0, -1), ...(attached ? [last.slice(0, -3)] : [])];
        let opcode = head.at(-1) ?? 'CONT';
        const [first, end] = block(depth + 1, true),
          bodies = [first];
        if (end === '}>ELSE<{' || end === '}>DO<{') {
          const [second, ending] = block(depth + 1, true);
          if (ending !== '}>') throw new AsmError('Invalid second continuation');
          if (end === '}>ELSE<{' && opcode === 'IF') opcode = 'IFELSE';
          else if (end !== '}>DO<{' || opcode !== 'WHILE')
            throw new AsmError('Unexpected continuation alternative');
          bodies.push(second);
        } else if (!['}>', '}', ']'].includes(end ?? ''))
          throw new AsmError('Invalid continuation ending');
        result.push(instruction(opcode, head.slice(0, -1), bodies, source));
        continue;
      }
      let opcode: string, operands: string[];
      if (opcodePattern.test(last)) {
        opcode = last;
        operands = words.slice(0, -1);
      } else if (opcodePattern.test(words[0])) {
        opcode = words[0];
        operands = words.slice(1);
      } else throw new AsmError(`Malformed instruction: ${source.slice(0, 160)}`);
      result.push(
        instruction(
          opcode,
          operands.map((w) => w.replace(/,+$/, '')),
          [],
          source,
        ),
      );
    }
    if (closing) throw new AsmError('Unclosed continuation');
    return [result, undefined];
  }
  return { instructions: block()[0], methods };
}
export const normalizeAsm = (text: string): string =>
  JSON.stringify(parseAsm(text).instructions.map(normalized));
export function formatAsm(code: Instruction[], indent = ''): string {
  return code
    .map((i) => {
      const op = [...i.operands, i.opcode].join(' ');
      if (!i.blocks.length) return indent + op;
      if (i.opcode === 'DICTIGETJMPZ')
        return `${indent}${i.opcode} {\n${i.blocks.map((b, k) => `${indent}  ${i.operands[k]} => <{\n${formatAsm(b, indent + '    ')}\n${indent}  }>`).join('\n')}\n${indent}}`;
      return `${indent}${op === 'IFELSE' ? 'IF' : op}:<{\n${i.blocks.map((b) => formatAsm(b, indent + '  ')).join(`\n${indent}${i.opcode === 'WHILE' ? '}>DO<{' : '}>ELSE<{'}\n`)}\n${indent}}>`;
    })
    .join('\n');
}

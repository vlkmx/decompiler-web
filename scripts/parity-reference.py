"""Development-only Python reference bridge; never imported by the web server."""
import ast
from dataclasses import asdict
import json
from pathlib import Path
import re
import sys

if sys.version_info < (3, 12):
    raise SystemExit('Python 3.12+ is required. Set PYTHON to a compatible interpreter.')

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root))
from decompiler.asm import Instruction, Program, parse_asm
from decompiler.ir import analyze
from decompiler.func import reconstruct, render


def signature(ir):
    return {'arguments': list(ir.argument_types), 'returns': [v.type for v in ir.returns]}


def harvest():
    cases, sources, seen, seen_sources = [], [], set(), set()
    paths = [root / 'decompiler/ir.py', *sorted((root / 'tests').glob('test_*.py'))]
    for path in paths:
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
                continue
            text = node.value.strip()
            origin = f'{path.relative_to(root)}:{node.lineno}'
            if 'recv_internal' in text and 'method_id(' in text and text not in seen_sources:
                seen_sources.add(text)
                sources.append({'origin': origin, 'source': text})
            # Only retain snippets actually accepted by the Python analyzer.
            if not text or len(text) > 4000 or text in seen or not re.search(r'\b[A-Z][A-Z0-9]{2,}\b', text):
                continue
            seen.add(text)
            try:
                program = parse_asm(text)
                if program.methods or not program.instructions:
                    continue
                ir = analyze(program.instructions)
            except (ValueError, IndexError, TypeError):
                continue
            cases.append({'origin': origin, 'asm': text, 'instructions': [asdict(i) for i in program.instructions], 'python': signature(ir)})
    # Parameterized patterns are not captured by literal-string harvesting.
    probes = [
        '3 MULRSHIFT#', '3 MULRSHIFTR#', '3 MULRSHIFTC#',
        '3 RSHIFTR#', '3 RSHIFTC#', '9 MODPOW2#',
        'PFXDICTGETQ\nNULLSWAPIFNOT2',
        '0 TUPLE\n7 PUSHINT\nTPUSH',
        '0 TUPLE\n7 PUSHINT\nTPUSH\nTPOP',
        '0 TUPLE\n7 PUSHINT\nTPUSH\n0 PUSHINT\nINDEXVAR',
        'NEWC\nx{ab} STSLICECONST',
        'x{ab} PUSHSLICE\nx{a} SDBEGINS',
        'x{ab} PUSHSLICE\nx{a} SDBEGINSQ',
        '1 PUSHINT\nRIST255_VALIDATE', '1 PUSHINT\nRIST255_MULBASE',
    ]
    for text in probes:
        if text in seen:
            continue
        ir = analyze(parse_asm(text).instructions)
        cases.append({'origin': 'parameterized probe', 'asm': text,
                      'instructions': [asdict(i) for i in parse_asm(text).instructions], 'python': signature(ir)})
    sources.append({'origin': 'continuation return with caller tail', 'source':
        'int helper(int x) impure asm "<{ DUP 0 EQINT IFJMP:<{ DROP 7 PUSHINT }> 1 PUSHINT ADD }>c CALLREF"; '
        '() recv_internal() { } int example(int x) impure method_id(100) { return helper(x) + 10; }'})
    return {'cases': cases, 'sources': sources}


def instruction(data):
    op, operands = data['opcode'], tuple(data['operands'])
    # The TS decoder preserves inline slices as serialized cells. Python's
    # equivalent literal-cell operation accepts this lossless representation.
    if op == 'PUSHSLICE' and operands and not operands[0].startswith('x{'):
        op = 'PUSHREFSLICE'
    return Instruction(op, operands, tuple(tuple(instruction(i) for i in b) for b in data['blocks']))


def evaluate(rows):
    results = []
    for row in rows:
        try:
            program = Program(tuple(instruction(i) for i in row['instructions']),
                              {int(k): tuple(instruction(i) for i in v) for k, v in row['methods'].items()})
            module = reconstruct(program)
            results.append({'supported': True, 'source': render(module, readable=True)})
        except (ValueError, IndexError, TypeError) as error:
            results.append({'supported': False, 'error': str(error)})
    return results

print(json.dumps(harvest() if sys.argv[2] == 'harvest' else evaluate(json.load(sys.stdin))))

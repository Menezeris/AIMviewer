"""Check that a Python file differs from its base only in comments and docstrings.
Usage: python verify_py.py <base-ref> <file>...   (run from the repo root)"""
import ast, io, subprocess, sys, tokenize

def strip_docstrings(tree):
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            b = node.body
            if b and isinstance(b[0], ast.Expr) and isinstance(getattr(b[0], 'value', None), ast.Constant) and isinstance(b[0].value.value, str):
                node.body = b[1:] or [ast.Pass()]
    return ast.dump(tree, include_attributes=False)

def code_tokens(src):
    out = []
    for t in tokenize.generate_tokens(io.StringIO(src).readline):
        if t.type in (tokenize.COMMENT, tokenize.NL, tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT, tokenize.ENCODING):
            continue
        out.append((t.type, t.string))
    return out

def docstring_positions(src):
    tree = ast.parse(src); pos = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            b = node.body
            if b and isinstance(b[0], ast.Expr) and isinstance(getattr(b[0], 'value', None), ast.Constant) and isinstance(b[0].value.value, str):
                pos.add(b[0].value.value)
    return pos

base = sys.argv[1]; bad = 0
for f in sys.argv[2:]:
    old = subprocess.run(['git', 'show', f'{base}:{f}'], capture_output=True, text=True).stdout
    new = open(f, encoding='utf-8').read()
    if strip_docstrings(ast.parse(old)) != strip_docstrings(ast.parse(new)):
        print('CODE CHANGED (ast):', f); bad += 1; continue
    od, nd = docstring_positions(old), docstring_positions(new)
    ot = [t for t in code_tokens(old) if not (t[0] == tokenize.STRING and any(t[1].strip('rbuRBU').strip('"\'') == d or d in t[1] for d in od))]
    nt = [t for t in code_tokens(new) if not (t[0] == tokenize.STRING and any(d in t[1] for d in nd))]
    if ot != nt:
        print('CODE CHANGED (tokens):', f); bad += 1
    else:
        print('ok', f)
sys.exit(1 if bad else 0)

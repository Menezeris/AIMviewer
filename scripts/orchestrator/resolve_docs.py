"""Resolve append-only doc conflicts after merging origin/main into a PR branch: keep both sides."""
import json, re, subprocess, sys

def sub(path, fn):
    s = open(path, encoding='utf-8').read()
    s, n = re.subn(r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> origin/main\n', fn, s, flags=re.S)
    open(path, 'w', encoding='utf-8').write(s)
    print(path, n)

def questions():
    sh = lambda r: subprocess.check_output(['git', 'show', f'{r}:eval/questions.json']).decode()
    o, t = sh('HEAD'), sh('origin/main')
    tid = {q.get('id') for q in json.loads(t)['questions']}
    new = [q['id'] for q in json.loads(o)['questions'] if q.get('id') and q['id'] not in tid]
    lines = o.split('\n'); blocks = []
    for i_ in new:
        idx = next(i for i, l in enumerate(lines) if l.strip() == f'"id": "{i_}",')
        s = idx
        while lines[s].strip() != '{': s -= 1
        e = idx
        while not lines[e].startswith('    }'): e += 1
        blocks.append('\n'.join(lines[s:e + 1]).rstrip(','))
    end = t.rstrip().rfind('\n  ]')
    out = (t[:end].rstrip() + ',\n' + ',\n'.join(blocks) + t[end:]) if blocks else t
    json.loads(out)
    open('eval/questions.json', 'w', encoding='utf-8').write(out)
    print('questions added', new)

for f in sys.argv[1:]:
    if f == 'DECISIONS.md':
        sub(f, lambda m: m.group(2).rstrip('\n') + '\n\n---\n\n' + m.group(1))
    elif f == 'ROADMAP.md':
        sub(f, lambda m: m.group(2) + m.group(1))
    elif f == 'eval/questions.json':
        questions()
    else:
        print('UNHANDLED', f)

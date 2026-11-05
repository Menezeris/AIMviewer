"""D-194 verifier: SQL files must be identical outside comments.

Usage: python scripts/d194_verify_sql.py <base-ref> <file>...
Strips -- line comments and /* */ block comments (outside string literals,
quoted identifiers and dollar-quoted bodies) from the base and the working
copy, normalizes comment-only whitespace, and compares the rest.
Comment text inside dollar-quoted bodies is NOT stripped (it is part of
the stored function body), so it must stay byte-identical.
"""
import re
import subprocess
import sys


def strip(sql: str) -> str:
    out = []
    i, n = 0, len(sql)
    while i < n:
        c = sql[i]
        two = sql[i:i + 2]
        if two == "--":
            j = sql.find("\n", i)
            i = n if j < 0 else j
            continue
        if two == "/*":
            depth, i = 1, i + 2
            while i < n and depth:
                if sql[i:i + 2] == "/*":
                    depth += 1
                    i += 2
                elif sql[i:i + 2] == "*/":
                    depth -= 1
                    i += 2
                else:
                    i += 1
            continue
        if c in "'\"":
            j = i + 1
            while j < n:
                if sql[j] == c:
                    if sql[j + 1:j + 2] == c:
                        j += 2
                        continue
                    break
                j += 1
            out.append(sql[i:j + 1])
            i = j + 1
            continue
        if c == "$":
            m = re.match(r"\$[A-Za-z_0-9]*\$", sql[i:])
            if m:
                tag = m.group(0)
                j = sql.find(tag, i + len(tag))
                j = n if j < 0 else j + len(tag)
                out.append(sql[i:j])
                i = j
                continue
        out.append(c)
        i += 1
    return re.sub(r"\s+", " ", "".join(out)).strip()


def main() -> int:
    base, files = sys.argv[1], sys.argv[2:]
    bad = 0
    for f in files:
        old = subprocess.run(["git", "show", f"{base}:{f}"], capture_output=True, text=True, check=True).stdout
        new = open(f, encoding="utf-8").read()
        if strip(old) != strip(new):
            print(f"DIFF in executable SQL: {f}")
            bad += 1
        else:
            print(f"ok {f}")
    return 1 if bad else 0


sys.exit(main())

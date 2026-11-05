// D-194: checks that TS/TSX/JS/MJS files differ from a base ref only in comments.
// Usage: node scripts/d194-verify-ts.mjs <base-ref> <file>...   (from the repo root)
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";

const [base, ...files] = process.argv.slice(2);
let bad = 0;
const emit = (src, name) =>
  ts.transpileModule(src, {
    fileName: name,
    reportDiagnostics: false,
    compilerOptions: { removeComments: true, target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext },
  }).outputText;
for (const f of files) {
  let old;
  try {
    old = execFileSync("git", ["show", `${base}:${f}`], { encoding: "utf8", maxBuffer: 1 << 28 });
  } catch {
    console.log("skip (new file)", f);
    continue;
  }
  const next = readFileSync(f, "utf8");
  if (emit(old, f) === emit(next, f)) console.log("ok", f);
  else {
    console.log("CODE CHANGED:", f);
    bad++;
  }
}
process.exit(bad ? 1 : 0);

// ESLint only on files changed against the base (D-187). main has old lint errors, so CI
// does not block the whole repo, but it does not allow a new error in a changed file: the error
// count of each changed file is compared with its version in the base (new file = 0 errors). Warnings do not block.
//
// Usage: node scripts/ci/lint-changed.mjs <base ref or SHA>
import { execFileSync } from "node:child_process";
import { ESLint } from "eslint";

const base = process.argv[2];
if (!base) {
  console.error("Použitie: node scripts/ci/lint-changed.mjs <základ>");
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "pipe"] });
const mergeBase = git("merge-base", base, "HEAD").trim();
const files = git("diff", "--name-only", "--diff-filter=ACMR", `${mergeBase}...HEAD`)
  .split("\n")
  .filter((f) => /\.(m?[jt]sx?|cjs|cts)$/.test(f));

const eslint = new ESLint();
const linted = [];
for (const f of files) if (!(await eslint.isPathIgnored(f))) linted.push(f);
if (linted.length === 0) {
  console.log("Lint: žiadny zmenený súbor na kontrolu.");
  process.exit(0);
}

const head = await eslint.lintFiles(linted);
const formatter = await eslint.loadFormatter("stylish");
const worseResults = [];
for (const r of head) {
  const file = r.filePath.slice(process.cwd().length + 1);
  let before = 0;
  try {
    const text = git("show", `${mergeBase}:${file}`);
    const [b] = await eslint.lintText(text, { filePath: r.filePath });
    before = b.errorCount;
  } catch {
    before = 0; // file is not in the base
  }
  const tag = r.errorCount > before ? "PRIBUDLO" : "ok";
  if (r.errorCount + r.warningCount + before > 0)
    console.log(`${tag.padEnd(8)} ${file}: chyby ${before} -> ${r.errorCount}, varovania ${r.warningCount}`);
  if (r.errorCount > before) worseResults.push(r);
}
if (worseResults.length) {
  console.log(formatter.format(worseResults));
  console.error(`Lint: v ${worseResults.length} zmenených súboroch pribudli chyby (pozri vyššie).`);
  process.exit(1);
}
console.log(`Lint: ${linted.length} zmenených súborov bez nových chýb.`);

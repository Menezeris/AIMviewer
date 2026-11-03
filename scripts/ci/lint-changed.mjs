// ESLint len na súboroch zmenených voči základu (D-187). V main sú staré chyby lintu, preto CI
// neblokuje celé repo, ale nedovolí, aby v zmenenom súbore pribudla chyba: počet chýb každého
// zmeneného súboru sa porovná s jeho verziou v základe (nový súbor = 0 chýb). Varovania neblokujú.
//
// Použitie: node scripts/ci/lint-changed.mjs <základný ref alebo SHA>
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
    before = 0; // súbor v základe nie je
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

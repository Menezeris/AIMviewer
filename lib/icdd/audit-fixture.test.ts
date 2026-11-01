import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { describe, expect, it } from "vitest";

import { importRequestFromContents } from "./import";
import { DEFAULT_AIM_NAMESPACE } from "./model";
import { sha256 } from "./sha256";
import { buildFixture, FIXTURE, FIXTURE_LINKS } from "./test-fixture";
import { validateIcdd } from "./validate";

/**
 * Testovací kontajner pre audit v Pythone (`etl/icdd_audit.py`, `etl/tests/test_icdd_audit.py`) a väzby, ako ich číta
 * import (`aim-small.links.json`, pytest porovná s vlastným čítaním: import roundtrip naprieč implementáciami).
 * Súbory sú v repe, aby pytest nepotreboval Node; tento test stráži, že zodpovedajú aktuálnemu builderu.
 * Obnova po zmene exportu: `ICDD_FIXTURE_UPDATE=1 npx vitest run lib/icdd/audit-fixture.test.ts`.
 */
describe("testovací kontajner pre etl/icdd_audit.py", () => {
  it("prejde kontrolou exportu a zodpovedá súboru v etl/tests/fixtures", () => {
    const zip = buildFixture();
    const report = validateIcdd(zip);
    expect(report.issues.filter((i) => i.level === "error")).toEqual([]);
    const req = importRequestFromContents(report.contents!, report, sha256(zip), "aim-small.icdd", DEFAULT_AIM_NAMESPACE, null);
    const links = `${JSON.stringify({ linksets: req.linksets, links: req.links }, null, 2)}\n`;
    if (process.env.ICDD_FIXTURE_UPDATE || !existsSync(FIXTURE)) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, zip);
      writeFileSync(FIXTURE_LINKS, links);
    }
    expect(sha256(new Uint8Array(readFileSync(FIXTURE)))).toBe(sha256(zip));
    expect(readFileSync(FIXTURE_LINKS, "utf8")).toBe(links);
  });
});

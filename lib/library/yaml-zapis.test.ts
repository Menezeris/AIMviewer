import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { dumpYaml, dumpZoznam } from "./yaml-zapis";

const orakulum = JSON.parse(readFileSync(join(process.cwd(), "lib", "library", "__fixtures__", "yaml-vypis.json"), "utf8")) as {
  pripady: Record<string, { vstup: unknown; ocakavane: string }>;
};

describe("výpis YAML = ruamel (dump_yaml(_do_ruamel(x)), orákulum)", () => {
  for (const [nazov, p] of Object.entries(orakulum.pripady)) {
    it(nazov, () => {
      const out = nazov.startsWith("seq:") ? dumpZoznam(p.vstup as unknown[]) : dumpYaml(p.vstup as Record<string, unknown>);
      expect(out).toBe(p.ocakavane);
    });
  }
});

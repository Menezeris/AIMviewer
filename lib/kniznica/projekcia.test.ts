import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { projekcia } from "./projekcia";

const vzor = JSON.parse(readFileSync(join(process.cwd(), "library", "korpus", "stromy", "vzor", "subory.json"), "utf8")) as Record<string, string>;
const orakulum = JSON.parse(readFileSync(join(process.cwd(), "lib", "kniznica", "__fixtures__", "projekcia-vzor.json"), "utf8")) as {
  ocakavane: Record<string, unknown>;
};

describe("projekcia súboru = Python sklad_db.projekcia (strom vzor)", () => {
  for (const [rel, text] of Object.entries(vzor)) {
    it(rel, () => {
      expect(JSON.parse(JSON.stringify(projekcia(rel, text)))).toEqual(orakulum.ocakavane[rel]);
    });
  }
});

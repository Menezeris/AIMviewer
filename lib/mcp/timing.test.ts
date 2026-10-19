import { describe, expect, it } from "vitest";

import { startTimer } from "./timing";

describe("startTimer (D-100)", () => {
  it("meria celok aj fázy, opakovaná fáza sa sčíta, pridaný čas sa pripočíta", async () => {
    let t = 0;
    const timer = startTimer(() => t);
    await timer.phase("exec", async () => {
      t += 120.4;
    });
    await timer.phase("exec", async () => {
      t += 30;
    });
    await timer.phase("broadcast", async () => {
      t += 50;
    });
    timer.add("engine_load", 2100.6);
    expect(timer.done()).toEqual({ ms: 200, phases: { exec: 150, broadcast: 50, engine_load: 2101 } });
  });

  it("fáza, ktorá zlyhá, sa aj tak zapíše a chyba ide ďalej", async () => {
    let t = 0;
    const timer = startTimer(() => t);
    await expect(
      timer.phase("exec", async () => {
        t += 10;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(timer.done().phases).toEqual({ exec: 10 });
  });
});

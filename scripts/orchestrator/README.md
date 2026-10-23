# Nástroje orchestrátora AIM

Pomocné skripty orchestrátora (odovzdanie Menezeris/AIMviewer#203 a nasledujúce). Spúšťa ich len orchestrátor, nie pracovné session.

- `land.sh <PR> [<PR>...]` - zlúči hostové PR v poradí. Keď je PR v konflikte s main (`dirty`), zlúči doňho `origin/main`, konflikty v `DECISIONS.md`, `ROADMAP.md`, `eval/questions.json` vyrieši cez `resolve_docs.py` (oboje strany), `MCP-TOOLS.md` vygeneruje nanovo (`npx vitest run lib/mcp/tool-registry.test.ts -u`), spustí `tsc` a `vitest`, pushne, počká na Vercel a zlúči merge commitom. Konflikt v kóde = STOP, rieš ručne. Pozor: pri stave `clean`/`unstable` zlučuje hneď, nečaká na Vercel; skontroluj nasadenie main.
- `resolve_docs.py <súbory>` - append-only konflikty dokumentov po merge `origin/main`: DECISIONS (najprv main, potom PR), ROADMAP, nové otázky evalov z PR.

Poučenia pri balíkoch forku (Menezeris/ifc-lite):
- pri skladaní `release/aim-*` vetvy vždy over `git merge-base --is-ancestor origin/<vetva> HEAD`; `git fetch origin <vetva>` bez refspec nevytvorí `origin/<vetva>` a merge potichu zlyhá;
- typecheck `apps/viewer-embed` (TS4058, nepomenovateľné typy v návratovej hodnote `queryViewState`) a `check-source-text-assertions`, `check-isolate-expansion-routing`, `mobile-sheet-coverage` lokálne nevidno, chytí ich až plné CI.

## Co
Issue Menezeris/AIMviewer#94 (znovu otvorene): oranzove zvyraznenie z `FOCUS` (show_in_3d) sa v UI nedalo zrusit. Zvyraznenie nie je vyber, takze klik do prazdna pri prazdnom vybere ani Esc nic nezmenili v store a `clearFocus` sa volal len z mostovych prikazov.

- `aim/focus-dismiss.ts` (cista logika + test): klik do sceny bez tahania (do 5 px) a Esc mimo textoveho pola.
- `visibility-commands.ts`: `installFocusDismiss` zrusi len zvyraznenie z FOCUS (ostatne farby ostanu); `AimBridge` ho pripoji po nacitani lazy modulu a pri odpojeni mosta odpoji.
- FOCUS na `IfcSpace` a `IfcSpatialZone` sa vykresli priesvitne (alfa 0,3, ako Lens v D-125), aby neprekryl prvky vnutri (bod 3 z issue).

MCP cast (show_in_3d clear=true, view_state.focus) uz existuje od D-101; host sa nemeni.

## Ako vyskusat
1. Spusti viewer v iframe na malom testovacom modeli (AC20-FZK-Haus, nie produkcne IFC, D-135), posli `FOCUS` na IfcSpace: miestnost je priesvitna oranzova, prvky vnutri su vidno.
2. Klikni do prazdna (bez tahania) alebo stlac Esc: oranzova zmizne, farby z `COLORIZE` ostanu.
3. Tahanie kamerou zvyraznenie nezrusi.

## Poznamky
- Test pure logiky prebehol (3/3). `tsc`, zdrojove kontroly, perf ratchet a zivy test v cloud session nebezali (bez node_modules a bez Playwright behu): pred zlucenim dobehnut kroky 2 az 5 skillu aim-feature.

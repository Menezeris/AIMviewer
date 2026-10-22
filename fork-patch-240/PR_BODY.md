# Lišta záložiek: zoznam pretečených záložiek namiesto posuvníka (D-132, #240)

Vo forku `apps/viewer/src/aim/` (len AIM súbory, žiadny upstream súbor, preto aj žiadny AIM-FORK blok):
- `viewTabsFit.ts` + test: čistá funkcia `fitTabs`, ktorá záložky rozdelí na viditeľné a skryté.
- `AimViewTabsBar.tsx`: bez posuvníka; pri nedostatku miesta tlačidlo "+N" s rozbaľovacím zoznamom ostatných záložiek.

Správanie: 3D vždy pripnutá prvá; aktívna záložka a záložka "Vedľa" sú vždy viditeľné (poradie na lište sa nemení,
`view_state.tabs` ostáva rovnaký); menovka má pevnú šírku (w-32), text sa orezáva a celý názov je v tooltipe;
zoznam sa zatvára Esc, klikom mimo a výberom; položka zoznamu záložku prepne (aktívna sa zviditeľní), má aj "Zavrieť".
Šírku merá `ResizeObserver`. Host sa nemení (most ani `view_state`), D-0xx sa nezapisuje; je to doplnok D-132.

## Ako vyskúšať
Odkaz: `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` (po otvorení fork PR).
1. Otvor model, otvor 8 a viac záložiek (pôdorysy cez "+ Pôdorys", dokumenty z karty Dokumenty).
2. Lišta nemá posuvník; na konci je "+N". Klikni: zoznam skrytých záložiek.
3. Vyber skrytú: prepne sa a objaví sa medzi viditeľnými (3D ostane prvá).
4. Zúž okno: záložky sa presúvajú do zoznamu; rozšír: vrátia sa.

## Kontroly
- unit test viewTabsFit.test.ts: 7/7 (node --test).
- oxlint apps/viewer/src/aim: 0 chýb, 0 nálezov v zmenených súboroch; check-jsx-a11y OK (bez nárastu); check-module-size OK (exit 0); check-type-scale OK (text-2xs).
- Tlačidlá min-h-6, ikonové tlačidlo s aria-label, žiadne role="status".
- NEPOBEŽALO (v cloud session nie sú nainštalované závislosti): tsc, vite build a bundle meranie, živé overenie. Bundle: nové súbory sú v lenivom chunku lišty (importuje ich len `AimViewTabsBar`), vstup by sa nemal meniť; over v CI aim-fast.
- Revert oracle: nový modul, test je pre `main` INCONCLUSIVE; podľa skillu aim-feature treba mutačné dôkazy a štítok revert-oracle-exempt pri otvorení PR.

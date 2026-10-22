## Co
PDF karta (DocumentPane) sa da posuvat tahanim lavym tlacidlom mysi po prazdnej ploche strany, nielen kolieskom a stredným tlacidlom. Upstream karta ruku/tahanie nema (len natívny scroll a Ctrl+koliesko), preto novy maly modul `apps/viewer/src/aim/docPan.ts`, zapojeny jednym riadkom v `useAimDocRegion` (`aim/docRegion.ts`). Upstream subory sa nemenia (rezim aim-only).

Tahanie nezacne na texte pdf.js (vyber textu funguje) ani na klikatelnych prvkoch (popisky D-130, tlacidla). Pod 4 px je to klik. Dotyk sa nemeni. Kurzor je `grab` nad stranou, pocas tahania `grabbing`.

## Ako vyskusat
1. Spusti viewer s mostom na malom testovacom modeli (nie produkcne IFC, D-135) a otvor PDF vo vyseku Documents.
2. Priblíz vykres (Ctrl+koliesko), chyt lavym tlacidlom prazdne miesto strany a tahaj: vykres sa posuva s mysou.
3. Tahaj od textu: oznacuje sa text, nic sa neposuva. Klikni na podciarknuty popisok (D-130): vyber prvku funguje ako predtym.
4. Koliesko a stredne tlacidlo funguju ako predtym.

## Overenie
- `tsx --test src/aim/docPan.test.ts`: 7/7. Mutacne dokazy: 6 patchov, vsetky OBSERVED (`docs/architecture/evidence/aim-213-doc-pan/mutations/`), na PR treba stitok `revert-oracle-exempt` hned pri otvoreni.
- Zivy test v Chromiu so skompilovanym modulom nad atrapou (posuvna plocha, text pdf.js, role=button): tahanie z prazdna posuva, z odkazu nie a klik prejde, z textu sa oznaci text, malý posun neposuva, koliesko funguje.
- tsc strict nad `docPan.ts` bez chyby. Plny `tsc` viewera, build a bundle ratchet sa v cloud session nespustili (bez node_modules): CI rychla linka ich spusti; modul je maly (~3 kB), strop sa neocakava.

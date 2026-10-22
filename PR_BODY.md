## AIM D-140 (#187): X-ray kontext len pre zvolené podlažie

`style_in_3d action=xray` so `storey` filtrom nechával ako kontext celú budovu (všetky podlažia, ASR aj VZT), takže pôdorys 1NP zhora bol nečitateľný. Správa `APPLY_LENS` dostane pri `xray: true` voliteľné pole `xrayStoreys: string[]` (štítky podlaží, 1 až 8, napr. `["1NP"]`). Viewer v tom prípade:

- nechá plné prvky X-ray (ako doteraz, kanál ghost),
- skryje prvky ostatných podlaží všetkých modelov (kanál `hiddenEntities`); podlažia sa porovnávajú podľa normalizovaného štítku (`1.NP_VZT` = `1NP`), takže ASR a VZT podlažie toho istého poschodia ostanú spolu,
- prvky mimo podlaží (terén, budova) ostanú v ghost kontexte,
- pri zrušení (`unisolate` z `clear_isolation` / `show_all`, `clear`, nový X-ray bez kontextu) vráti len to, čo skryl chat; ručné skrytie používateľa ostane,
- `mode=add` kontext rozšíri (zjednotenie podlaží), nezúži.

`APPLIED.state.lens.isolation` nesie navyše `storeys` a `hidden` (počet skrytých prvkov). Starší fork pole ignoruje, starší host ho neposiela; bez poľa sa správanie nemení.

Logika je v `aim/aimXrayStoreysPlan.ts` (čistá, test), store lepidlo v `aim/aimXrayStoreys.ts` (lenivo z `aimLens.ts`). Žiadny upstream súbor.

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom (nie produkčným; napr. `AC20-FZK-Haus.ifc`, má viac podlaží).
2. Z hostu pošli `APPLY_LENS` s `xray: true`, `rules` (napr. `IfcCovering`) a `xrayStoreys: ["1NP"]` (alebo v Claude s konektorom po zlúčení hostu: `style_in_3d action=xray ifc_type=IfcCovering storey=1NP context_storey=1NP`).
3. Očakávané: chip "X-ray context" ukazuje len prvky zvoleného podlažia a ostatné podlažia nie sú vidieť. `style_in_3d action=clear_isolation` (alebo `APPLY_LENS mode=unisolate`) ich vráti. Bez `xrayStoreys`: celý model priesvitný ako doteraz.

### Overenie
Prešlo: `tsx --test aim/aimXrayStoreysPlan.test.ts aim/aimLensPlan.test.ts aim/aimListPlan.test.ts` (29/29), `npx oxlint apps/viewer/src/aim` (0 chýb), `check-module-size.mjs`, `check-jsx-a11y.mjs`, `check-type-scale.mjs`, `check-aim-fork-only.mjs` (aim-only), 4 mutačné skúšky zachytené testom.
Neurobené (cloud session): bundle ratchet (build viewera nejde bez súkromného design-kit), živé overenie store lepidla, mutačné dôkazy do `docs/architecture/evidence` (pridať štítok `revert-oracle-exempt`).

Host: Menezeris/AIMviewer#187. Poradie: najprv tento PR, potom host.

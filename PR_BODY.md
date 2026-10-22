## Co
Tlacidlo "Ukazat v 3D" pri otvorenom PDF (AimDocumentShow3d) uz pri dokumente viazanom na podlazie (`storeyGuid` z DOCUMENTS_LOAD, D-072) neprepne 3D len do X-ray kontextu. Izoluje podlazie dokumentu (Solo, `applyLevelDisplayMode('solo', ...)`, vo vsetkych modeloch federacie) a otvori nastroj Section (`setActiveTool('section')`), kde su rezove roviny Add a plane: Down, Front, Side, Face. Su to existujuce funkcie viewera (D-098), nic nove sa nevymyslalo. Dokument bez podlazia (alebo s nenacitanym podlazim) ostava pri doterajsom spravani: DOCUMENT_SHOW_3D a X-ray lens hosta (D-104/D-105). Fork patch je len v `apps/viewer/src/aim/` (aim-only), AIMviewer sa nemeni.

Vyber podlazia je cista funkcia `soloRefs` v `show3dSoloPlan.ts` s testom. Subory z balika #108-#115 (docBridge, docRegion, useAimViewCommands) sa nemenia.

## Ako vyskusat
1. Spusti viewer s mostom na malom testovacom modeli (nie produkcne IFC, D-135), v Documents otvor PDF pôdorysu viazaný na podlazie.
2. Klikni "Ukazat v 3D": zostane len podlazie dokumentu (Solo), napravo sa otvori nastroj Section.
3. V paneli Section pridaj rovinu (Add a plane: Down, Front, Side, Face) a posuvaj rez. Solo vypnes v strome podlazi (Stacked).
4. Dokument bez podlazia (napr. textova priloha): "Ukazat v 3D" funguje ako predtym, X-ray lens.

## Overenie
- `node --test` nad `show3dSoloPlan.test.ts`: 2/2; 2 mutacne dokazy OBSERVED (`docs/architecture/evidence/aim-d145-show3d-solo/mutations/`), treba stitok `revert-oracle-exempt` pri otvoreni PR.
- Bez node_modules (privatna zavislost `design-kit` vracia 403): plny `tsc`, build, bundle ratchet a live test v Chromiu sa v cloud session nespustili, spusti ich rychla linka CI. Ocakavany dopad na bundle je maly (AimDocumentShow3d je uz v zavode; pribudol import `useFloorplanView`, ktory vieweri uz nacitava).
- Nezistene: ci `setActiveTool('section')` pri prazdnom rezu vzdy ukaze menu Add a plane (v kode je prazdny stav `useAddSectionPlane`); over na zivom modeli.

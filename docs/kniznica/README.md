# Knižnica požiadaviek - dokumentácia (D-186 krok 7, archivácia)

Dokumenty knižnice požiadaviek (IDM -> LOIN -> EIR) žijú od 2. 11. 2026 tu, v repe AIMviewer (assetin-library DECISIONS V30, odpoveď (b): "všetko vrátane MODEL/DECISIONS/SCHEMA odteraz v repe AIMviewer"). Súbory sú prenesené **bez zmeny obsahu** z assetin-library `docs/` @ `f7c103c28a224abfe15be6d153d427c312e818a7` (ten istý commit ako korpus, `library/KORPUS_COMMIT`); sha256 nižšie.

**Druhá dávka (4. 11. 2026, archivácia assetin-library):** súbory od `PLAN.md` ďalej sú prenesené bez zmeny obsahu z assetin-library `main` @ `868f92f56a50b1d6fd0d64f6f689853983ef9777` (posledný commit pred archiváciou; adresár `docs/` sa od f7c103c nezmenil, šesť prvých súborov má rovnaké sha256 aj na 868f92f). Sú to historické a pomocné podklady, nie záväzná schéma.

| Súbor | Čo je | sha256 pri prenose |
|---|---|---|
| `MODEL.md` | konceptuálny model (*prečo*); ak kód a MODEL nesúhlasia, kód je chyba | `6f34a8bf94b64948c662407ecf4f1ac7057ff7837be0d7b54310e3594128eb86` |
| `DECISIONS.md` | register rozhodnutí knižnice V1-V30, U1-U20, C1-C4, Z1-Z5 | `59322ce19606cf1ed6725d1d216c74c00f0fa525d492483a9e7918a7bb48990e` |
| `SCHEMA-v1.md` | záväzný textový popis schémy (v1.5) | `f62339468d13576ab4b8db187b0a6e2ba379981f03344a4b03e029b072c6883c` |
| `SCHEMA-v1.2 zmeny.md` | odôvodnenie zmien v1.1 -> v1.2 (nie samostatná pravda) | `f7eabb65f76cf4e36c1421b416fc2e1931e54015a2058f7b0684c2b2eac21168` |
| `NORMS-GAP.md` | model voči normám (z LOIN-00...09, klauzuly z druhej ruky) | `bb2ebe749501b6817d3fc8b2725931c8b6b38a65320dd054dbfd73b4fc662e4d` |
| `QUESTIONS.md` | otázky a ich uzavretie (Q1-Q70) | `b47a063de6670854bd4887b96169e1ba09dc3825310c39db9da88e90484018ec` |
| `VALIDATION-RULES.md` | register pravidiel validátora (kódy A-H) | `f06e90cef008010244bc6ef4ce0571cc799329caa6b3cc0e527244c879dca9cc` |
| `PLAN.md` | plán portu a fáz knižnice (historický, stav k F2a/F3) | `3a1c14232c3cbd3dcf34b95ec717d8b835ef4b765618f63378ebd0b71b77315f` |
| `DATA-MODEL.md` | dátový model (ER) knižnice | `bffc35eb25c11aa2ddc548ecfcbbbe180f91af7f1f02eba37a50d93d5f089a77` |
| `PROMPT-plan.md` | zadanie pre plánovaciu session (archív) | `698325beb04a239bf0367a166248b9d3fafb561afe228f00309ef92379d7f153` |
| `PROMPT-review.md` | zadanie pre revíznu session (archív) | `b00d8a41c121adcd82604c5a074af2cd84aaa05ef58c8b9297af9b7a6c641eb3` |
| `PROMPT-ui.md` | zadanie pre UI session (archív) | `4826363f429a982ef664caa9237d2cc0d14b12802a94288f5449548f1b64a581` |
| `REVIEW-2026-09-11.md` | revízia 11. 9. 2026 (archív) | `0bc224e7aeebfb66bdb786af7b5dca0e9d4b06be4eb5892526a0365529d02364` |
| `REVIEW-2026-09-14.md` | revízia 14. 9. 2026 (archív) | `ec51390976d039026f2503cad08f14ee9097d175389d73c60fe522fcc12b5283` |
| `POLIA.md` | prehľad polí schémy v1.5, **zmrazený snapshot** (generoval `assetin schema export` z pydantic; v AIM ho nič nevyrába) | `f612dcc6531f87a942a92f8802ee690903d9378a6cd432e7f99d4fd6c713d14a` |
| `normy/README.md` | čo patrí do `normy/` (placeholder; texty noriem sa necommitujú) | `9b80c29493d44b6a565e0fe1926a223c6d430b603cce2e6882751fb1700a61a1` |
| `vault/README.md` | pôvod série LOIN (kópia z ObsidianPKM@284123f) | `baee81049d074fd64f4cebe2665d4d6c23d341e51f8cf824c16e0471e336ceee` |
| `vault/LOIN-00 Index.md` | LOIN-00 | `46c858d1d21a3b03dd9cec8d4f0acc03f010470ef8dbfcdf27960d9822512fdd` |
| `vault/LOIN-01 Polia požiadaviek (predpoklady a LOIN).md` | LOIN-01 | `90aa743f990112d4d1b3a9a167602cb29011313e327bda4821d09797bf33e1b8` |
| `vault/LOIN-02 Gap analýza IDM-EIR-BEP.md` | LOIN-02 | `c1381e7080419d410b47b88907db4caf8ce03e0afab5f3a29a05c206cba3e8b1` |
| `vault/LOIN-03 ISO 29481-3 schéma.md` | LOIN-03 | `7be910ed1cccf306066d27bffbdc245234521f05db74e6d020562d354691e691` |
| `vault/LOIN-04 ISO 7817-3 schéma a šev.md` | LOIN-04 | `ed2958b50385ba04c41a739beb03cd25509c092ed722ea059d3d60900ee95cac` |
| `vault/LOIN-05 Kontajnery a ukotvenie.md` | LOIN-05 | `abfecaef7c19f0a5c199c3328efafb8b556c2b52b993b47fee40028e5ee1fe2c` |
| `vault/LOIN-06 Typológia požiadaviek a overiteľnosť.md` | LOIN-06 | `aa20003f31e1d0f517247fe37f824c916ec7b550e1f36c47a7a8148ed4a1a7ca` |
| `vault/LOIN-07 Konsolidácia voči normám.md` | LOIN-07 | `eae107de45d29278a923849d5c5b4f100a936f8c4028dbb5ad49d6f0cc81c141` |
| `vault/LOIN-08 Obmedzenia, geometria, IMS vs DiMS.md` | LOIN-08 | `127ed43fa608b57435cf4b529219ce7c0a0b4c1c494c5348fa46b54cdb141dcf` |
| `vault/LOIN-09 Rozhodnutia a terminológia.md` | LOIN-09 | `282951b851f0c84a16ae699c68169e2a37590c579c32e61c08b506dc6d442f26` |

## Ako čítať odkazy v textoch

- `docs/X.md` v texte = `docs/kniznica/X.md` tu. Dokumenty z druhej dávky (`PLAN.md`, `DATA-MODEL.md`, `PROMPT-*.md`, `REVIEW-*.md`, `POLIA.md`, `vault/`, `normy/`) sú tu tiež; repo assetin-library sa archivuje.
- Nepresunuté zámerne: `docs/schema/*.json` (JSON Schema je už v `library/korpus/schema/`, v TS sa generuje zo zod), `docs/editor.html` a `docs/graf.html` (generované výstupy, editor žije vendorovaný v `library/editor/`) a `zadanie/` (vzor, 19 súborov; je v `library/korpus/stromy/vzor/subory.json` bajtovo, overené 4. 11., nekopíruje sa dvakrát).
- `assetin/...` je Python engine z assetin-library, ktorý bol do konca portu **orákulom**; po archivácii sa už nespúšťa (viď Korpus nižšie). Jeho TS náprotivky:

| Python (assetin-library) | TS (AIMviewer) |
|---|---|
| `assetin/schema/*` (pydantic) | `lib/kniznica/schema/` (zod, JSON Schema v tvare pydantic) |
| `assetin/engine/dokument.py` | `lib/kniznica/bloky.ts` |
| `assetin/engine/loader.py`, `schema/cesty.py` | `lib/kniznica/loader.ts`, `cesty.ts` |
| `assetin/engine/writer.py`, `zapis.py` | `lib/kniznica/writer.ts`, `yaml-zapis.ts`, `zapis.ts`, `kontrola.ts` |
| `assetin/db/sklad_db.py` | `lib/kniznica/sklad-db.ts`, `projekcia.ts` |
| `assetin/engine/graf.py`, `graf_json.py` | `lib/kniznica/graf.ts`, `graf-json.ts` |
| `assetin/engine/retazec.py`, `priradenie.py` | `lib/kniznica/retazec.ts` |
| `assetin/engine/inspektor.py` | `lib/kniznica/inspektor.ts` |
| `assetin/schema/ui.py`, `pasma.py`, `engine/app_json.py` | `lib/kniznica/ui.ts`, `app-json.ts` |
| `assetin/engine/validator/` | `lib/kniznica/validator/` |
| `assetin/engine/nahlad/`, `assetin/server/` | `library/editor/` (vendorovaná stránka), `lib/kniznica/nahlad.ts`, `editor-api.ts`, `/kniznica/editor/<kód>` |
| `assetin/generate/ids.py`, `db/vydanie.py` | `lib/kniznica/ids/`, `vydanie.ts`, `vydanie-db.ts` |

## Korpus je zmrazený (krok 7: archivácia, 4. 11. 2026)

- `library/korpus/` je odteraz **zmrazený orákulom** pri commite `library/KORPUS_COMMIT` (f7c103c). Python engine (`assetin ...`, `assetin korpus export`) sa **už nespúšťa**, korpus sa z neho nepregeneruje.
- Testy zhody (vitest) ostávajú a bežia v CI ako regresná sieť: TS engine musí dávať to, čo Python dával k f7c103c.
- **Zmeny schémy sa robia v TS** (`lib/kniznica/schema/`, zod) a `SCHEMA-v1.md` tu. Ak zmena rozhodne mení výstup (JSON Schema, loader, writer, graf, validátor, IDS), korpus sa aktualizuje **ručne** a každá úprava korpusového súboru sa v PR odôvodní (čo, prečo, ktoré pravidlo/pole; kto ju schválil). Po úprave sa prepočíta sha256 v `library/korpus/MANIFEST.json`. `KORPUS_COMMIT` ostáva ako pôvod; ručné odchýlky sa zapisujú do dodatkov D-186, aby bolo jasné, v čom sa korpus od f7c103c líši.
- Korpus sa pritom nikdy neupravuje len preto, aby test prešiel; rozdiel najprv vysvetli (chyba v TS, alebo vedomá zmena schémy).

## Pravidlá

- Zmeny týchto dokumentov sa robia **tu**. assetin-library je archivované (len na čítanie) a odkazuje sem.
- Nové rozhodnutia knižnice pribúdajú do `DECISIONS.md` tu (ďalšie číslo V31...) až po Samuelovom slove; staré sa neprepisujú. Rozhodnutia AIM (D-0xx) ostávajú v koreňovom `DECISIONS.md`; port je D-186.
- Licencie a normy: v týchto dokumentoch nie sú plné texty noriem (ISO/CD 7817-3, ISO 29481, IDS), len vlastné poznámky a stručné odkazy na klauzuly z druhej ruky. Texty noriem sa necommitujú (`normy/README.md`). Repo assetin-library je MIT (`pyproject.toml`); `vault/` je vlastná kópia poznámok z ObsidianPKM (AssetinSpace).

# Knižnica požiadaviek - dokumentácia (D-186 krok 7)

Dokumenty knižnice požiadaviek (IDM -> LOIN -> EIR) žijú od 2. 11. 2026 tu, v repe AIMviewer (assetin-library DECISIONS V30, odpoveď (b): "všetko vrátane MODEL/DECISIONS/SCHEMA odteraz v repe AIMviewer"). Súbory sú prenesené **bez zmeny obsahu** z assetin-library `docs/` @ `f7c103c28a224abfe15be6d153d427c312e818a7` (ten istý commit ako korpus, `library/KORPUS_COMMIT`); sha256 nižšie.

| Súbor | Čo je | sha256 pri prenose |
|---|---|---|
| `MODEL.md` | konceptuálny model (*prečo*); ak kód a MODEL nesúhlasia, kód je chyba | `6f34a8bf94b64948c662407ecf4f1ac7057ff7837be0d7b54310e3594128eb86` |
| `DECISIONS.md` | register rozhodnutí knižnice V1-V30, U1-U20, C1-C4, Z1-Z5 | `59322ce19606cf1ed6725d1d216c74c00f0fa525d492483a9e7918a7bb48990e` |
| `SCHEMA-v1.md` | záväzný textový popis schémy (v1.5) | `f62339468d13576ab4b8db187b0a6e2ba379981f03344a4b03e029b072c6883c` |
| `SCHEMA-v1.2 zmeny.md` | odôvodnenie zmien v1.1 -> v1.2 (nie samostatná pravda) | `f7eabb65f76cf4e36c1421b416fc2e1931e54015a2058f7b0684c2b2eac21168` |
| `NORMS-GAP.md` | model voči normám (z LOIN-00...09, klauzuly z druhej ruky) | `bb2ebe749501b6817d3fc8b2725931c8b6b38a65320dd054dbfd73b4fc662e4d` |
| `QUESTIONS.md` | otázky a ich uzavretie (Q1-Q70) | `b47a063de6670854bd4887b96169e1ba09dc3825310c39db9da88e90484018ec` |
| `VALIDATION-RULES.md` | register pravidiel validátora (kódy A-H) | `f06e90cef008010244bc6ef4ce0571cc799329caa6b3cc0e527244c879dca9cc` |

## Ako čítať odkazy v textoch

- `docs/X.md` v texte = `docs/kniznica/X.md` tu. Dokumenty, ktoré sa nepresúvali (`PLAN.md`, `DATA-MODEL.md`, `PROMPT-*.md`, `REVIEW-*.md`, `POLIA.md`, `vault/`, `normy/`), ostávajú v assetin-library do jeho archivácie.
- `assetin/...` je Python engine, ktorý je do konca portu **orákulom** (korpus `library/korpus/`, kontrola zhody v CI). Jeho TS náprotivky:

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

## Pravidlá

- Zmeny týchto dokumentov sa robia **tu**, nie v assetin-library. Kým port trvá, zmena schémy ide naraz do oboch enginov (assetin-library CLAUDE.md, V30) a korpus sa pregeneruje v assetin-library.
- Nové rozhodnutia knižnice pribúdajú do `DECISIONS.md` tu (ďalšie číslo V31...) až po Samuelovom slove; staré sa neprepisujú. Rozhodnutia AIM (D-0xx) ostávajú v koreňovom `DECISIONS.md`; port je D-186.
- assetin-library sa archivuje až na Samuelovo slovo; do vtedy README a CLAUDE.md v ňom odkazujú sem.

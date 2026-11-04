# Normatívne podklady — čo sem patrí

Súbory pod copyrightom **necommitovať** do verejného repa. Ak je repo privátne, rozhodnutie je Samuelovo; inak drž tento priečinok v `.gitignore` a maj ho len lokálne.

| Súbor | Kam | Načo |
|---|---|---|
| ISO/CD 7817-3 Annex B (XSD) | `docs/normy/7817-3/` | export Specification, názvy polí a enumy geometrie |
| ISO/CD 7817-3 Annex C (príklady XML) | `docs/normy/7817-3/` | referenčný tvar výstupu |
| ISO 29481-1 Annex B (vzorový IDM balík) | `docs/normy/29481/` | tvar `uc`, `er`, `informationUnit` |
| 29481-3 idmXSD | `docs/normy/29481/` | export IDM |
| DSS `Configurations.ids` (CZ, 326 špecifikácií) | `tests/fixtures/ids/dss/` — **už v repe** (2026-09-10) | reálny IDS ako referencia a regresný vzor |

Stiahnuteľné (nech si stiahne Claude Code, necommitovať binárne kópie):
- IDS 1.0 XSD + oficiálne testcases — github.com/buildingSMART/IDS
- IFC 4.3 ADD2 schéma — cez IfcOpenShell (`ifcopenshell.ifcopenshell_wrapper.schema_by_name`)
- bSDD API — dokumentácia k `uri` poliam

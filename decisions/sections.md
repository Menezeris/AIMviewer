<!-- Non-record text of the old DECISIONS.md (title, section headings and their intro text), in file order. -->

# DECISIONS.md — Architektonické rozhodnutia AIM Platform

> Tento dokument je živý log rozhodnutí prijatých počas brainstormu.
> Každé rozhodnutie má kontext a dôvod — nie len výsledok.
> Pred akýmkoľvek návrhom schémy alebo feature — prečítaj celý dokument.

---

## 1. Produkt a stratégia

## 2. Technický stack

## 3. Databázová architektúra

## 4. Ontológia a štandardy

## 5. Vývojový proces

## 6. Schéma AIM Viewer (návrh dátového modelu)

## 7. Otvorené otázky (ešte neriešené)

- **IFC model diplomky** — doladiť property sety, klasifikácie, priestorovú hierarchiu (prerekvizita ETL)
- **LLM interface** — konkrétne queries ktoré demo ukáže (schéma to zvládne); parkované do S-LLM (D-026)
- **Verejné spustenie** — termín a forma (LinkedIn, standalone URL)
- **Ďalší rozvoj po AIM Vieweri** — procesy, MIDP/TIDP generovanie
- **property_set_templates** — voliteľná referenčná tabuľka pre bSDD validáciu psetov (až pri validácii handoveru)
- **Actor model C** — org-hierarchia, štruktúrované adresy, intrinsic roly (plánované aditívne, viď D-024)
- **Multi-projekt scoping** — dnes 1 Supabase = 1 budova; pre platformu pridať `project`
  entitu + coding-scheme config per projekt (D-033/D-034). Aditívne, rieši sa pri 2. projekte.
- **IDS-driven import scope** — strojové odvodenie rozsahu importu z IDS applicability
  (D-034); teraz config-driven default v `scheme.py`, plné parsovanie IDS až s platformou.
- **`rel_supersedes`** — explicitná väzba revízií dokumentov (D-032); zatiaľ implicitne
  cez name + `valid_from`.
- **Instance-level INST padding** — šírka číselných polí (`Mark` `03` vs generický `001`)
  potvrdiť per pole podľa toho, čo je vytlačené na výkrese (D-033 `format.pad`).
- **AI/LLM matching dokumentov** — content-based párovanie PDF↔prvok keď naming/scan
  nestačí (D-033); až s reálnymi dátami z viacerých projektov.

**Vyriešené počas návrhu schémy:** dátový model AIM Viewer (D-018–D-024), type vs occurrence (D-021), actor granularita (D-024).
**Vyriešené v dokumentovom brainstorme:** úložisko + model + export PDF (D-032), coding scheme + object_ref + linking (D-033). Z otvorených odstránené „dokument-element linking" a spresnený zdroj `object_ref`.

---

## 7b. Dokumentová identita (E3)

## 7c. Meta-model vzťahov a program dema (D-051+)

> Rozhodnutia z plánovacieho kola 2026-07-07 (nové inputy k demu). D-051 je architektonický
> základ (revízia D-048); D-052–D-056 sú **záznamy so zvoleným smerom** — detail sa dopĺňa
> pri štarte príslušného sprintu (kadencia re-checku, viď `AGENTS.md`).

## 8. Budúce rozhodnutia (D-037+)

> Brainstorm smerov, ešte **nerozhodnuté** — sú to kandidáti, nie záväzky.
> Číslovanie rezervované; finálne rozhodnutie sa zapíše až keď príde na rad
> (najskôr post-S4, po funkčnom ETL s reálnym IFC z diplomky).

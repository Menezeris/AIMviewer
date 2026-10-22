# Orchestrácia sessions z konektora (D-134)

Požiadavka z konektora (`feedback`, D-090) spustí cloud session cez jednu z dvoch routines. Model je
vlastnosť routine, preto sú dve.

| Náročnosť | Routine | Model | ID | Env na Verceli |
|---|---|---|---|---|
| HARD | AIM: Hard Issues | Opus | `trig_01HfMX6dt9uNSkd2zZ8HHPST` | `CLAUDE_ROUTINE_FIRE_URL`, `CLAUDE_ROUTINE_TOKEN` |
| STANDARD | AIM: Standard Issues | Sonnet | `trig_01PS9ewHPFXUPmz1btypLF1h` | `CLAUDE_ROUTINE_STANDARD_FIRE_URL`, `CLAUDE_ROUTINE_STANDARD_TOKEN` |

## Triedenie
Rozhoduje Claude v konektore (`narocnost` + `narocnost_dovod` v `feedback`, pri `start_session` tiež).
- **STANDARD:** jasné a lokálne - reprodukovateľná chyba, malá zmena, test, opis toolu.
- **HARD:** nejasné zadanie, architektúra, naprieč modulmi, DB schéma alebo migrácia, fork (ifc-lite), nový tool.
- Pri pochybnosti: nejasné zadanie -> HARD, inak STANDARD.
- Bez parametra alebo bez nastavenej STANDARD routine ide všetko na HARD (ako pred D-134).

## Eskalácia
STANDARD session, ktorá zistí, že úloha je náročná, napíše do issue komentár "Eskalácia na HARD: <dôvod>"
a skončí. Orchestrátor spustí HARD po eskalácii alebo po 2 neúspechoch STANDARD.

## Meranie
Komentár k odkazu na session nesie riadok `triedenie: STANDARD - <dôvod>` (skrytá značka
`aim-mcp-triage`; `level` = použitá routine, `requested` = návrh Claude). Počty STANDARD / HARD a
eskalácie sa spočítajú z komentárov issues so štítkom `mcp`. Komentár fronty ("Fronta: triedenie...")
sa nepočíta.

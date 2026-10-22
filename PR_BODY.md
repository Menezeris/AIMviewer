## Co
Hlavicka malej karty legendy (`legend: compact`) ukazovala technicky nazov lensu "AIM chat". Teraz ukazuje `t('aimFork.legend.title')` = "Legend" (kluc v `aim-fork.en.ts`; ine jazyky v strome nie su, chybajuci preklad padne na anglictinu). Nazov lensu "AIM chat" v paneli Lens sa nemeni.

## Ako vyskusat
1. Spusti viewer s mostom na malom testovacom modeli (nie produkcne IFC, D-135).
2. Z chatu zavolaj `style_in_3d action=isolate` so 2 skupinami a `legend_size=compact`.
3. Karta vpravo dole ma v hlavicke "LEGEND", farbu, nazov skupiny a pocet; panel Lens ukazuje lens "AIM chat".

## Poznamky
- Volitelny vlastny nazov ("Legenda: Privod a odvod") vyzaduje nove pole v wire (`APPLY_LENS`) aj v hoste; tu zamerne nie.
- tsc a testy sa v cloud session nespustili (bez node_modules).

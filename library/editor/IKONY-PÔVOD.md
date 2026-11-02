# ikony.svg — pôvod a postup aktualizácie

`ikony.svg` je vendorovaná podmnožina **Tabler Icons** (outline), vložená do stránky ako skrytý
`<symbol>` sprite. Appka je jeden súbor bez siete, takže ikony sa nesťahujú z CDN ani sa nelinkujú
ako webfont — kreslia sa cez `<use href="#ti-…">` a ťah, zaoblenie aj farbu dedia z CSS.

| | |
|---|---|
| Pôvod | [tabler/tabler-icons](https://github.com/tabler/tabler-icons), **MIT** |
| Prevzaté cez | PyPI balík `tabler-icons` 0.5.0 (repackaging, Alex Oleshkevich, **MIT**) — len ako zdroj SVG pri autorstve, **nie je závislosťou balíka** |
| Dátum | 2026-09-10 |
| Sada | outline; `-filled` varianty sa nepoužívajú (§5 zadania UI) |

## Ktoré ikony a načo
Ikonu typu poznámky určuje schéma (`IKONA` na modeli typu, `assetin/schema/pasma.py`), nie stránka.
Nástroje (diagnostika, hľadanie) a ovládacie prvky majú ikonu v šablóne.

`ti-target` `ti-route` `ti-bolt` `ti-arrows-exchange` `ti-box` `ti-file` `ti-ruler`
`ti-ruler-measure` `ti-users` `ti-tag` `ti-file-text` `ti-briefcase` — typy poznámok
`ti-stethoscope` `ti-search` `ti-chevron-right` `ti-alert-triangle` — nástroje a ovládanie
`ti-layout-sidebar-right-collapse` `ti-layout-sidebar-right-expand` — zbalenie inšpektora (kolo 3 §5)

## Aktualizácia / pridanie ikony
1. `pip download tabler-icons` (alebo klon `tabler/tabler-icons`) do dočasného priečinka.
2. Zo `tabler_icons/archive.zip` vybrať `<meno>.svg`, odstrániť obal `<svg …>` a priehľadný
   `<path d="M0 0h24v24H0z" fill="none"/>`, zvyšok vložiť ako `<symbol id="ti-<meno>" viewBox="0 0 24 24">`.
3. Doplniť meno do tabuľky vyššie a — ak ide o typ poznámky — do `IKONA` na modeli typu.
4. Nikdy nepridávať `-filled` variant ani ikonu, ktorú nič nepoužíva.

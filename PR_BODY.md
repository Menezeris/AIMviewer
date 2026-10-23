## AIM D-160: zóny a ručná oprava odkazov popiskov na výkrese

Názvy zón (požiarne úseky a iné IfcZone, IfcSpatialZone) sú vo výkrese klikateľné ako čísla miestností a značky typov (Menezeris/AIMviewer#268). Párovanie robí host; fork len kreslí a navrhuje opravy.

- `DOCUMENT_LINKS`: cieľ môže niesť `members` (GUIDy miestností zóny bez geometrie, najviac 40), odkaz `manual: true` (ručne priradený z chatu). Klik na zónu, ktorú viewer nenájde, vyberie prvú jej miestnosť, ktorá v modeli je. Popis odkazu rozlišuje "ručne priradené" a "odvodené z popisku".
- Alt+klik alebo pravé tlačidlo nad odkazom: menu "Priradiť k vybranému prvku v 3D", "Zrušiť odkaz", "Vrátiť automatiku". Alt+ťah nad textom bez odkazu: "Priradiť k vybranému prvku" (text pod oblasťou určí host z riadkov strany).
- Z toho vznikne len návrh, `view_state.link_draft` = `{document_id, page, text | null, bbox v %, action}`; viewer nemá token, preto ho uloží chat (`open_drawing link={from_draft: true}`), cieľ je prvok vybraný v 3D. Nová správa `DOCUMENT_LINKS` od hosta návrh aj jeho značku zruší.
- Lenivý modul `docLinkDraft.ts` sa načíta pri prvom geste. Upstream sa nemení (`aim-only`).

Starší host `members` ani `manual` neposiela; starší fork ich ignoruje.

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom (nie produkčným) a otvor PDF pôdorys.
2. Z hostiteľskej stránky pošli `DOCUMENT_LINKS` s odkazom, ktorého cieľ má `members: [<GUID miestnosti>]` a `manual: true`; nad textom sa objaví zelená oblasť, klik vyberie miestnosť, tooltip hovorí "ručne priradené".
3. Alt+klik na odkaz, "Zrušiť odkaz"; `get_viewer_state` (alebo `QUERY view_state`) vráti `link_draft` s `action: "clear"`. Alt+ťah nad iným textom, "Priradiť k vybranému prvku", `link_draft.text` je null a `bbox` v %. Po novej `DOCUMENT_LINKS` je `link_draft` null.
4. Po zlúčení hostu D-160: v Claude s konektorom vyber v 3D zónu, označ na výkrese jej názov a povedz "ulož odkaz z výkresu".

### Overenie
- `docLinks.test.ts` 15/15 a `docLinkDraftStore.test.ts` 4/4 (esbuild bundle so stubmi zustand a react: pnpm install vráti 403 na `Menezeris/design-kit`), `oxlint apps/viewer/src/aim` 0 chýb, `check-module-size` exit 0 (`docLinks.ts` 345 riadkov), `check-type-scale`, `check-isolate-expansion-routing` (nevolá isolate/hide/show/colors, výber ako doteraz), `check-aim-fork-only` (aim-only).
- Neurobené: `tsc --noEmit` viewera, `check-jsx-a11y` (bez závislostí nebežia; nové súbory nemajú JSX), živé overenie v iframe a plné CI.

Host: Menezeris/AIMviewer#268 (D-160). Poradie: najprv tento PR, potom host.

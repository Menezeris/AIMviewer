### D-136 - Dlaždicové rozloženie viewera: krok 1 je pôvodný 2D výkres rezu, viac 3D pohľadov je otázka renderera
**Status:** krok 1 rozhodnutý (2026-10-22, session z konektora, číslo rezervované v registri #60); krok 2
(dlaždice s viacerými 3D pohľadmi) čaká na Samuela. Issue #210. Nadväzuje na D-072 (pôdorys s podkladom),
D-087 (most forku), D-098 (najprv existujúce funkcie), D-114 (najprv napasuj), D-127 (panely z chatu),
D-132 (záložky; bod "Otvorené" o pôdoryse bez podkladu).

**Kontext:** Samuel chcel v rozhovore "vľavo 3D, vpravo pôdorys 1NP" a ako v Revite (Tile Windows) až štyri
pohľady naraz. `set_view_mode(beside=1NP)` bez kalibrovaného podkladu vráti odmietnutie, dva 3D pohľady
nejdú a viac než dve dlaždice tiež nie. Príčina je vo vieweri: má jeden 3D canvas (WebGPU, nikdy sa
neremountuje) a jednu kameru; 3D, pôdorys bez podkladu (model zhora s rezom) a uložený pohľad sa v ňom len
striedajú. Vedľa 3D dnes môže stáť len niečo, čo nie je 3D: PDF dokument alebo PDF podklad (D-072 split).

**Rozhodnutie (krok 1):**
1. Originál ifc-lite má panel **Drawing** (`section2d`, upstream #5493): 2D výkres aktuálneho rezu
   generovaný z modelu (vektor, šrafy, bez podkladu), domov v spodnom páse, dá sa nechať plávať alebo
   vytiahnuť do okna. Je na čítanie (generovanie beží v `DrawingRuntimeHost`), nie v režime úprav modelu,
   takže rieši bod "Otvorené" z D-132.
2. **Bez nového toolu (D-114):** `set_view_mode panels` pozná `drawing` (open | close | toggle). Pôdorys
   podlažia bez podkladu pri 3D = `set_section(action=set, floor)` + `set_view_mode(panels={drawing: 'open'})`:
   hore voľné 3D (rezané na tom podlaží), dole pôdorys z modelu. Stav panela (`open`, `where`) vráti výsledok
   aj `get_viewer_state` ako pri ostatných paneloch.
3. **Most (fork, len `apps/viewer/src/aim/`):** `PANEL_KEYS` + `drawing`, mapovanie na upstream panel
   `drawing`, zatvorenie cez `setDrawing2DPanelVisible(false)`, stav zo `drawing2DPanelVisible`. Odmietnutie
   `VIEW_TABS beside` pôdorysu bez podkladu ukáže túto cestu.

**Zavrhnuté rozšírenie:**
- *Nový tool na rozloženie (návrh z issue):* rozloženie plochy je zobrazenie, to robí `set_view_mode`;
  `layout`/`tiles` by dnes nemali čo zobraziť, kým viewer nemá viac 3D pohľadov.
- *`set_view_mode layout=split_h|split_v|grid4, tiles=[...]` hneď:* parameter bez schopnosti vo vieweri by
  vracal chyby; pribudne až s krokom 2.
- *`set_camera` alebo `set_section` s dlaždicou:* majú jeden canvas, dlaždica by bola len predstieraná.

**Krok 2 (otvorené, otázka v #210):** skutočné dlaždice (2 vedľa seba, 2 nad sebou, 2x2) s viacerými 3D
pohľadmi, každý s vlastnou kamerou, rezom a farbením. Možnosti: (a) viac viewportov v jednom canvase
(scissor, jedna GPU scéna, stav kamery, rezu a farieb na dlaždicu; veľký zásah do upstream renderera a
store, vlastný kód forku pri každom sync), (b) dlaždice ako snímky (živá je jedna, ostatné obrázok
posledného stavu, klik ju urobí živou; malý zásah, záložky D-132 už stav dlaždice ukladajú), (c) návrh
upstream ifc-lite. Odporúčanie: (b) ako medzikrok, (a) len ak je pre demo nutné. `layout`/`tiles` v
`set_view_mode` pribudnú až s krokom 2.

**Evaly D-057 nepobežali** (cloud session nemá Supabase kľúče); otázka `view-3d-and-plan-no-underlay` pridaná
bez overenej hodnoty.

---

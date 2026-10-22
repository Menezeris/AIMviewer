## AIM #170: PDF podklady v 3D zapnúť / vypnúť (`SET_UNDERLAYS_3D`)

Samuel chce v paneli Underlays (aj z chatu) vypnúť zobrazenie PDF podkladov v 3D; podklad ostane kalibrovaný a uložený, pôdorys v 2D ostáva. Nová správa mosta `SET_UNDERLAYS_3D { show }` a stav viewera "podklady v 3D" (`aim/aimUnderlays3d.ts`). Vypnuté = uložené podklady sa v 3D plátne nekreslia. Ostávajú: kalibrácia, ghost náhľad počas kalibrácie, pôdorys v 2D a split paneli a zamknutý pôdorysný pohľad (kamera zhora). `view_state` a `APPLIED` nesú `underlays_3d`.

Je to iný stav než `placement.visible` (oko pri výkrese v paneli): to sa ukladá do DB (`UNDERLAY_SAVE`) a skrýva podklad aj v 2D paneli pôdorysu. Preto vlastný stav viewera, do DB sa nezapisuje a po obnove stránky sú podklady v 3D zapnuté. Podklad vypnutý okom ostane vypnutý aj po zapnutí v 3D.

Prepínač "Show in 3D" je pod panelom Underlays (lenivý, `min-h-6`, `text-2xs`, `role="switch"`). Upstream súbory len v `AIM-FORK` blokoch: `useDrawingUnderlay.ts` a `renderPanelBody.tsx`. `bridge-protocol.ts` ostáva na 458 riadkoch.

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom a PDF podkladom s kalibráciou (nie produkčným modelom).
2. Otvor panel Underlays a prepni "Show in 3D" vypnúť: podklad v 3D zmizne, kalibrácia v zozname ostane, v režime Split ostane PDF pôdorys. Zapni: podklad sa vráti.
3. Po zlúčení hostu v Claude s konektorom: "vypni podklady v 3D" (`set_view_mode underlays_3d=false`); `get_viewer_state` ukáže `underlays_3d: false`. "Zapni podklady v 3D" ich vráti.
4. Očakávané: oko pri výkrese (trvalé `visible`) funguje ako doteraz a s týmto prepínačom sa nekríži.

### Overenie
Prešlo: `tsx --test aim/aimUnderlays3d.test.ts` (6/6) a súvisiace testy mosta (39/39), mutačné dôkazy, `oxlint apps/viewer/src/aim` (0 chýb), `check-module-size` (exit 0), `check-type-scale`, `check-jsx-a11y`, `check-i18n-literals`, `check-source-text-assertions` (exit 0), `check-aim-fork-only` (fork-blocks).
Neurobené (cloud session bez závislostí forku): `tsc --noEmit` viewera, bundle ratchet, živé overenie v iframe, revert oracle (treba štítok `revert-oracle-exempt` a mutačné patche, ak to chce CI).

Host: Menezeris/AIMviewer#170 (doplnok D-133). Poradie: najprv tento PR, potom host.

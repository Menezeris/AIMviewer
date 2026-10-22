## AIM D-154: plynulé otáčanie kamery dokola (`AUTO_ROTATE`)

Nová správa mosta `AUTO_ROTATE { action: start|stop, speedDegS?, direction?: left|right }`. `start` rozbehne snímkovú slučku, ktorá cez existujúci `cameraCallbacks.applyViewpoint` otáča pohľad okolo cieľa (`target`) aktuálnej kamery okolo zvislej osi; `up` sa otáča s kamerou, takže funguje aj pohľad zhora. Zastaví ju `stop`, ťah, koliesko alebo dotyk na plátne, Esc, odpojenie mosta a každý iný pohyb kamery (ViewCube, iný príkaz kamery): slučka porovnáva kameru s pózou, ktorú zapísala naposledy. Upstream má auto-rotate len v hero scéne landing stránky, vo vieweri nie, preto adaptér v `aim/`. Žiadny upstream súbor, bez `bridge-protocol.ts`. Starší host správu neposiela, starší fork ju zahodí.

### Ako vyskúšať
1. Otvor `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` s testovacím modelom (nie produkčným).
2. Po zlúčení hostu D-154 napíš v Claude s konektorom: "Potoč s modelom pomaličky dokola" (`set_camera auto_rotate=start speed_deg_s=5`). Model sa plynulo točí.
3. Chyť model myšou, zakrúť kolieskom alebo sa dotkni plátna: otáčanie sa zastaví. To isté Esc, ViewCube a príkaz "zastav otáčanie" (`auto_rotate=stop`).
4. Očakávané: `direction=left` (default) je kamera obiehajúca doľava, model sa zdanlivo točí doprava; `direction=right` opačne. Po zastavení sa kamera už sama nehýbe.

### Overenie
Prešlo: `tsx --test aim/autoRotatePlan.test.ts` (8/8), 4 mutačné dôkazy (každá mutácia zhodí test), `oxlint apps/viewer/src/aim` (0 chýb), `check-module-size.mjs`, `check-type-scale.mjs`, `check-aim-fork-only.mjs` (aim-only).
Neurobené (cloud session bez závislostí forku): `tsc --noEmit`, `check-jsx-a11y` (patch nemení JSX), bundle ratchet, živé overenie.

Host: Menezeris/AIMviewer#247. Poradie: najprv tento PR, potom host.

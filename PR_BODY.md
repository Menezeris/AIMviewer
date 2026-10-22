## Pripomienka na PDF ako BCF téma panela (AIM D-158, Menezeris/AIMviewer#199)

**Režim:** `fork-blocks` (`check-aim-fork-only.mjs`). Nové `aim/docIssueModel.ts` (+ test), `aim/docIssues.ts`, `aim/AimDocumentIssue.tsx`; úpravy `aim/aimBcf.ts`, `aim/bcf-protocol.ts` (+ test), `aim/viewQueries.ts`; v `components/documents/DocumentPane.tsx` len existujúci blok AIM-FORK (import a jeden riadok vedľa "Ukázať v 3D"); riadok v `docs/FORK_MAINTENANCE.md`. Súbory BCF panela (`BCFPanel.tsx`, `BCFCreateTopicForm.tsx`) sa nemenia.

### Čo robí
- **Tlačidlo "Pripomienka"** v lište karty dokumentu (len vo vložení v AIM a len pre dokumenty hosta). Ťah obdĺžnika nad stranou (klik = celá strana, Esc zruší) otvorí panel BCF a stlačí jeho upstream tlačidlo **New topic** (kotva `bcf-new-topic`). Téma, ktorú formulár založí, dostane BCF **DocumentReference** s adresou `<host>/drawing/<id>?page=N&region=x_y_w_h#page=N` a opisom (názov, strana, oblasť). Ak sa formulár zruší, pripomienka zanikne.
- **Rámiky** pripomienok nad stranou s číslom: `#N` = uložená v AIM, `N1...` = neuložená (čiarkovaná). Klik na rámik otvorí tému v paneli.
- **`view_state.bcf_local`** vypíše témy projektu AIM, ktoré host ešte nemá: polia, komentáre, pohľad v tvare BCF API bez snímky a odkazy. Počíta sa v lenivom module. Chat ich uloží cez `bcf_topic action=from_viewer` s tým istým guid.
- **AIM_BCF_LOAD** po ručnej téme projekt neodloží ako "vlastný". Témy hosta nahradí, lokálne neuložené nechá a uloženú lokálnu vráti ako kópiu hosta (rovnaký guid, bez duplicity). Témam s blokom "Dokumenty (AIM):" dočíta `document_references`. Projekt používateľa (súbor, iný server, iné `projectId`) sa nemení.
- **Export `.bcfzip`** (upstream `writeBCF`) nesie DocumentReference: v 2.1 ako `ReferencedDocument` (externý), v 3.0 ako `Url`. Test oba formáty zapíše a znova načíta.

### Balík
Merané oproti `c988e100`, rovnaký build: entry **-713 B (3 173 311 -> 3 172 598)**, eager **+774 B (19 378 299 -> 19 379 073)**. Ratchet: všetko v strope. Logika je v lenivom chunku karty dokumentu. `view_state` si model načíta dynamicky, takže vstup nerastie.

### Overenie
- `docIssueModel.test.ts` (ťah, adresa tam a späť, rámiky na strane, `bcf_local`, zlúčenie, nová téma, export 2.1 a 3.0 tam a späť) a `bcf-protocol.test.ts` (zlúčenie s lokálnymi témami, dočítanie odkazov): 11 testov zelených. Súvisiace testy viewera (6 súborov) spolu s `src/aim/*.test.ts`: 310/310.
- `tsc`, `npx oxlint apps/viewer/src/aim` (0 chýb, žiadne varovanie v nových súboroch), `check-module-size` (exit 0), `check-jsx-a11y`, `check-type-scale`, `check-i18n-literals`: všetko zelené. Tlačidlo má `min-h-6`.
- **Revert oracle:** test importuje nový modul (INCONCLUSIVE pri reverte), preto je tu 8 chirurgických mutácií. Všetky skončili OBSERVED s overenou obnovou, dôkazy sú v `docs/architecture/evidence/aim-d158-doc-issues/mutations/`. **Pri otvorení PR treba štítok `revert-oracle-exempt`.**
- **Naživo:** lokálny viewer vložený v testovacom hoste s falošným BCF API, Playwright, testovacie PDF, bez produkčných dát (D-135). Overený celý tok: ťah, upstream formulár, rámik N1, `bcf_local` s odkazom `page=1&region=50_10_20_20`, obnova z hosta (lokálna téma ostala), host vráti tú istú tému ako #2 (dve témy, rámik `#2`, klik otvorí tému). Snímky sú vo vetve patchu v AIMvieweri.

### Ako vyskúšať
Náhľad `https://ai-mviewer.vercel.app/ifc?viewer=pr-<číslo>` (s hostom z Menezeris/AIMviewer PR pre #199):
1. Otvor výkres (Dokumenty, napr. pôdorys 1NP) a v lište karty klikni **Pripomienka**.
2. Ťahaj obdĺžnik okolo miesta na strane. Otvorí sa panel BCF s formulárom New Topic: vyplň názov a potvrď.
3. Na strane je červený čiarkovaný rámik **N1**. Klik naň otvorí tému v paneli.
4. V chate (konektor AIM): "ulož moje pripomienky". `bcf_topic action=from_viewer` tému uloží, rámik sa zmení na plný **#N** a téma je v zozname len raz.
5. Export BCF z panela: `.bcfzip` obsahuje odkaz na dokument a stranu (DocumentReference).

Refs Menezeris/AIMviewer#199

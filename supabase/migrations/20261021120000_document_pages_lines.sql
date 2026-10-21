-- =============================================================================
-- D-133 - Čiary výkresu pre automatickú kalibráciu podkladov: `document_pages.lines`
-- =============================================================================
-- Kalibrácia podkladu (pôdorys, rez) dolaďuje polohu strany PDF na rez modelom
-- IFC. Potrebuje hrubé čiary výkresu (rezané konštrukcie); server parser PDF
-- nemá (D-123), preto ich vytiahne etl/pdf_text.py tým istým extraktorom ako
-- `blocks`:
--   lines = [[x1, y1, x2, y2, w]] v bodoch strany, počiatok vľavo dole (y hore,
--   rovnako ako `_georef`), w = hrúbka čiary; len čiary od 0,99 pt a len
--   vektorové výkresy (aspoň 200 takých úsečiek na strane), inak null.
--
-- Migrácie sú ADITÍVNE - tento súbor sa nikdy needituje.

begin;

alter table document_pages add column if not exists lines jsonb;

comment on column document_pages.lines is
  'D-133: hrubé úsečky strany [[x1, y1, x2, y2, w]] v bodoch strany (vľavo dole, y hore), len vektorové výkresy; etl/pdf_text.py.';

commit;

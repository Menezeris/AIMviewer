-- =============================================================================
-- D-133 - Drawing lines for automatic calibration of underlays: `document_pages.lines`
-- =============================================================================
-- Calibration of an underlay (floor plan, section) fine-tunes the position of the PDF page against a section of the
-- IFC model. It needs the coarse lines of the drawing (cut constructions); the server has no
-- PDF parser (D-123), so etl/pdf_text.py extracts them with the same extractor as
-- `blocks`:
--   lines = {size: [W, H], segs: [[x1, y1, x2, y2, w]]} in page points, origin
--   bottom left (y up, same as `_georef`), size = page size, w = line
--   width; only lines from 0.99 pt and only vector drawings (at least 200 such
--   segments on the page), otherwise null.
--
-- Migrations are ADDITIVE - this file is never edited.

begin;

alter table document_pages add column if not exists lines jsonb;

comment on column document_pages.lines is
  'D-133: hrubé úsečky strany {size: [W, H], segs: [[x1, y1, x2, y2, w]]} v bodoch strany (vľavo dole, y hore), len vektorové výkresy; etl/pdf_text.py.';

commit;

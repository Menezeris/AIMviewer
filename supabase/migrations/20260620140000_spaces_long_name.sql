-- =============================================================================
-- AIM Platform - migration: `spaces` extension (IfcSpace.LongName) - D-040
-- =============================================================================
-- Additive migration (CLAUDE.md: migrations are never deleted or edited).
--
-- `IfcSpace` has two text attributes: `Name` = room number (`2.04`,
-- → objects.name) and `LongName` = function description (`Serverovňa`, `WC Muži`,
-- `Openspace - Západ`). Until now LongName was not stored anywhere - spaces had
-- only a number without a name in the Viewer.
--
-- Per convention (CLAUDE.md): IFC attributes = columns; type-specific → thin
-- 1:1 extension with `id` as FK to objects(id) (like `floors`/`documents`/`persons`).
-- =============================================================================

create table if not exists spaces (   -- IfcSpace (D-040); objects.name = room number
  id        uuid primary key references objects(id) on delete cascade,
  long_name text                       -- IfcSpace.LongName - function description of the room
);

comment on table spaces is
  'Prípona priestoru — IfcSpace.LongName (popis funkcie). objects.name = číslo (D-040).';

-- v_spaces - analogous to v_floors (CLAUDE.md SCHEMA §2: "v_spaces... analogously").
create or replace view v_spaces as
  select o.*, s.long_name from objects o join spaces s using (id);

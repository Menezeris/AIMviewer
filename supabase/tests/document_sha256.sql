-- D-158 kroky 3 a 4: kotva revízie (sha256) a veľkosť strany pre snímku výrezu a viewrect.
-- Spustenie (na lokálnej DB s aplikovanými migráciami, nikdy na produkcii):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/document_sha256.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

insert into objects (id, object_type, object_ref, name) values
  ('00000000-0000-4000-8000-0000000000d1', 'document', 'TDOC.1NP', 'Pôdorys 1NP');
insert into documents (id, location, file_sha256) values
  ('00000000-0000-4000-8000-0000000000d1', 'https://x/storage/v1/object/public/documents/a.pdf', repeat('a', 64));
insert into document_pages (document_id, page, text, page_size) values
  ('00000000-0000-4000-8000-0000000000d1', 2, '1.01', '[842, 595]');
insert into model_tasks (id, title) values ('00000000-0000-4000-8000-0000000000f1', 'Pripomienka');
insert into model_task_documents (task_id, document_id, page, document_sha256) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 2, repeat('a', 64));

do $$
declare
  ok boolean;
begin
  -- 1) zlé sha256 (nie 64 malých hex znakov) DB odmietne
  begin
    update documents set file_sha256 = 'ABC' where id = '00000000-0000-4000-8000-0000000000d1';
    raise exception 'file_sha256 ''ABC'' prešlo';
  exception when check_violation then null;
  end;
  begin
    update model_task_documents set document_sha256 = repeat('A', 64);
    raise exception 'document_sha256 veľkými písmenami prešlo';
  exception when check_violation then null;
  end;
  -- 2) page_size je dvojica
  begin
    update document_pages set page_size = '[842]';
    raise exception 'page_size s jedným číslom prešlo';
  exception when check_violation then null;
  end;
  begin
    update document_pages set page_size = '{"w": 842}';
    raise exception 'page_size ako objekt prešlo';
  exception when check_violation then null;
  end;
  -- 3) revízia odkazu ostane po novej revízii súboru
  update documents set file_sha256 = repeat('b', 64);
  select document_sha256 = repeat('a', 64) into ok from model_task_documents;
  if not ok then raise exception 'odkaz stratil revíziu zo založenia'; end if;
  -- 4) práva: anon/authenticated nové stĺpce nečítajú (tabuľky bez práv, migrácia 20261016120000)
  if has_column_privilege('anon', 'documents', 'file_sha256', 'select') then raise exception 'anon číta file_sha256'; end if;
  if has_column_privilege('authenticated', 'model_task_documents', 'document_sha256', 'select') then
    raise exception 'authenticated číta document_sha256';
  end if;
end $$;

rollback;

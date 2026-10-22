-- D-158: model_task_documents (odkaz BCF témy na dokument, stranu a oblasť strany).
-- Spustenie (na lokálnej DB s aplikovanými migráciami, nikdy na produkcii):
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/bcf_topic_documents.sql
-- Všetko beží v transakcii a končí ROLLBACK; zlyhanie = výnimka s popisom.
begin;

insert into objects (id, object_type, object_ref, name) values
  ('00000000-0000-4000-8000-0000000000d1', 'document', 'TDOC.1NP', 'Pôdorys 1NP');
insert into model_tasks (id, title) values
  ('00000000-0000-4000-8000-0000000000f1', 'Pripomienka na výkrese'),
  ('00000000-0000-4000-8000-0000000000f2', 'Druhá téma');

insert into model_task_documents (task_id, document_id, document_ref, document_revision, page, region, description, author) values
  ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000d1', 'TDOC.1NP', 'B', 2,
   '{"x": 50, "y": 0, "width": 50, "height": 50}', 'pri šachte', 'test'),
  ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000d1', 'TDOC.1NP', 'B', 1, null, null, 'test');
insert into model_task_documents (task_id, url, description) values
  ('00000000-0000-4000-8000-0000000000f2', 'https://cde.example/D-11.pdf#page=4', 'z importu');

do $$
declare
  n int;
begin
  -- 1) témy na dokumente a strane (filter bcf_topic_list document + page)
  select count(distinct task_id) into n from model_task_documents
   where document_id = '00000000-0000-4000-8000-0000000000d1';
  if n <> 2 then raise exception 'témy na dokumente: čakal som 2, je %', n; end if;
  select count(*) into n from model_task_documents
   where document_id = '00000000-0000-4000-8000-0000000000d1' and page = 2;
  if n <> 1 then raise exception 'odkazy na stranu 2: čakal som 1, je %', n; end if;

  -- 2) odkaz bez dokumentu, kódu aj url sa odmietne
  begin
    insert into model_task_documents (task_id, page) values ('00000000-0000-4000-8000-0000000000f1', 1);
    raise exception 'odkaz bez cieľa mal byť odmietnutý';
  exception when check_violation then null;
  end;

  -- 3) strana od 1, oblasť je objekt, markup pole
  begin
    insert into model_task_documents (task_id, url, page) values ('00000000-0000-4000-8000-0000000000f1', 'u', 0);
    raise exception 'strana 0 mala byť odmietnutá';
  exception when check_violation then null;
  end;
  begin
    insert into model_task_documents (task_id, url, region) values ('00000000-0000-4000-8000-0000000000f1', 'u', '[1, 2]');
    raise exception 'oblasť ako pole mala byť odmietnutá';
  exception when check_violation then null;
  end;
  begin
    insert into model_task_documents (task_id, url, markup) values ('00000000-0000-4000-8000-0000000000f1', 'u', '{}');
    raise exception 'markup ako objekt mal byť odmietnutý';
  exception when check_violation then null;
  end;

  -- 4) zánik dokumentu: odkaz ostáva so snímkou kódu, bez document_id
  delete from objects where id = '00000000-0000-4000-8000-0000000000d1';
  select count(*) into n from model_task_documents
   where task_id = '00000000-0000-4000-8000-0000000000f1' and document_id is null and document_ref = 'TDOC.1NP' and page = 2;
  if n <> 1 then raise exception 'odkaz po zmazaní dokumentu: čakal som 1 so snímkou, je %', n; end if;

  -- 5) zmazanie témy zmaže jej odkazy
  delete from model_tasks where id = '00000000-0000-4000-8000-0000000000f2';
  select count(*) into n from model_task_documents where task_id = '00000000-0000-4000-8000-0000000000f2';
  if n <> 0 then raise exception 'odkazy zmazanej témy ostali: %', n; end if;

  -- 6) anon a authenticated nemajú na tabuľku žiadne právo (D-079, SCHEMA 2.12)
  if has_table_privilege('anon', 'model_task_documents', 'select')
     or has_table_privilege('authenticated', 'model_task_documents', 'select') then
    raise exception 'anon/authenticated nesmú čítať model_task_documents';
  end if;
  if not has_table_privilege('service_role', 'model_task_documents', 'insert') then
    raise exception 'service_role musí zapisovať model_task_documents';
  end if;
end $$;

rollback;

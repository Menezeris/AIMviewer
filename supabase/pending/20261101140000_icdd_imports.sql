-- D-181 (ICDD, #350), dodatok "import" (1. 11.): záznam importu kontajnera ICDD a zápis väzieb prvok -> dokument.
-- PRIPRAVENÉ, na produkciu len na Samuelovo slovo (spúšťa orchestrátor).
-- Náhľad (dry-run) počíta host (`lib/icdd/import.ts`) a uloží riadok `checked` s nálezmi a zmenami. Zápis (`applied`) robí
-- RPC `icdd_apply_import` v jednej transakcii: vloží nové väzby AIM vrstvy `rel_associates_document` so
-- `source = 'icdd:<version_id>'` a uzavrie (`valid_until`) väzby, ktoré cudzí nástroj zmenil (AIM vrstva sa neprepisuje,
-- D-183). Väzba, ktorá v kontajneri chýba, sa neuzatvára (len nález). Prijatý kontajner sa nemení (D-183 bod 2): ukladá sa
-- len jeho sha256 a čo sme v ňom našli; obsah do DB nejde.
-- Aditívne, bez FK a bez zmeny existujúcich objektov.
-- Rollback: drop function if exists icdd_apply_import(uuid, text, jsonb); drop table if exists icdd_imports;

create table if not exists icdd_imports (
  id uuid primary key default gen_random_uuid(),
  version_id text not null,                                     -- ct:versionID z index.rdf
  container_sha256 text not null check (container_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text,
  status text not null default 'checked' check (status in ('checked', 'applied', 'rejected', 'failed')),
  same_as_aim boolean,                                          -- vrstvy len na export: true = 0 rozdielov voči AIM
  payloads jsonb not null default '{}'::jsonb check (jsonb_typeof(payloads) = 'object'),   -- {filename: sha256}
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),       -- linky, zmeny, nálezy po kódoch
  diff jsonb,                                                   -- RoundtripDiff vrstiev len na export (lib/icdd/roundtrip.ts)
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),       -- chyby kontroly ISO 21597
  findings jsonb not null default '[]'::jsonb check (jsonb_typeof(findings) = 'array'),   -- nálezy importu {code, level, key, detail}
  changes jsonb not null default '[]'::jsonb check (jsonb_typeof(changes) = 'array'),     -- náhľad zápisu {op: add|close, ...}
  model_revisions jsonb not null default '{}'::jsonb check (jsonb_typeof(model_revisions) = 'object'), -- {model: revízia} AIM pri importe
  aim_state_sha256 text not null check (aim_state_sha256 ~ '^[0-9a-f]{64}$'),           -- stav AIM pri náhľade (brána 409)
  written_ids uuid[] not null default '{}',                     -- relationships.id vložené pri zápise
  closed_ids uuid[] not null default '{}',                      -- relationships.id uzavreté pri zápise
  message text,                                                 -- dôvod rejected / failed
  imported_by text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  check ((status = 'applied') = (applied_at is not null))
);

create index if not exists idx_icdd_imports_version on icdd_imports (version_id, created_at desc);
create index if not exists idx_icdd_imports_sha on icdd_imports (container_sha256, created_at desc);

comment on table icdd_imports is
  'D-181: beh importu kontajnera ICDD (ISO 21597): náhľad (checked) s nálezmi a zmenami, zápis (applied) väzieb prvok-dokument so source icdd:<version_id>.';
comment on column icdd_imports.container_sha256 is 'D-181: sha256 celého .icdd, prijatý kontajner sa nemení (D-183 bod 2).';
comment on column icdd_imports.aim_state_sha256 is 'D-181: odtlačok aktuálnych revízií a živej AIM vrstvy prvok-dokument pri náhľade; iný pri zápise = rejected (409).';

revoke all on icdd_imports from anon, authenticated;

-- Zápis importu v jednej transakcii. p_changes = changes z náhľadu: {op: 'close', id} a {op: 'add', from_id, to_id}.
-- Stráže: riadok importu je checked a jeho aim_state_sha256 = p_aim_state; uzatvára sa len živá väzba AIM vrstvy
-- rel_associates_document; nová väzba nesmie mať živé dvojča. Porušenie = výnimka, nič sa nezapíše.
create or replace function icdd_apply_import(p_import uuid, p_aim_state text, p_changes jsonb)
returns icdd_imports
language plpgsql
security definer
set search_path = public
as $$
declare
  imp icdd_imports;
  ch jsonb;
  rid uuid;
  written uuid[] := '{}';
  closed uuid[] := '{}';
  src text;
begin
  select * into imp from icdd_imports where id = p_import for update;
  if not found then raise exception 'icdd_apply_import: import % neexistuje', p_import; end if;
  if imp.status <> 'checked' then raise exception 'icdd_apply_import: import % má stav %', p_import, imp.status; end if;
  if imp.aim_state_sha256 <> p_aim_state then raise exception 'icdd_apply_import: stav AIM sa od náhľadu zmenil'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'icdd_apply_import: changes nie je pole'; end if;
  if exists (select 1 from jsonb_array_elements(p_changes) where coalesce(value->>'op', '') not in ('add', 'close')) then
    raise exception 'icdd_apply_import: neznáma operácia';
  end if;
  src := 'icdd:' || imp.version_id;

  for ch in select * from jsonb_array_elements(p_changes) where value->>'op' = 'close' loop
    update relationships set valid_until = now()
     where id = (ch->>'id')::uuid and rel_type = 'rel_associates_document' and valid_until is null and rel_is_aim_layer(source)
     returning id into rid;
    if rid is null then raise exception 'icdd_apply_import: väzba % nie je živá väzba AIM vrstvy', ch->>'id'; end if;
    closed := closed || rid;
    rid := null;
  end loop;

  for ch in select * from jsonb_array_elements(p_changes) where value->>'op' = 'add' loop
    if exists (select 1 from relationships
                where rel_type = 'rel_associates_document' and valid_until is null
                  and from_id = (ch->>'from_id')::uuid and to_id = (ch->>'to_id')::uuid) then
      raise exception 'icdd_apply_import: väzba % -> % už existuje', ch->>'from_id', ch->>'to_id';
    end if;
    insert into relationships (rel_type, from_id, to_id, role, source)
    values ('rel_associates_document', (ch->>'from_id')::uuid, (ch->>'to_id')::uuid, 'document', src)
    returning id into rid;
    written := written || rid;
  end loop;

  update icdd_imports
     set status = 'applied', applied_at = now(), written_ids = written, closed_ids = closed
   where id = p_import
   returning * into imp;
  return imp;
end;
$$;

revoke all on function icdd_apply_import(uuid, text, jsonb) from public, anon, authenticated;

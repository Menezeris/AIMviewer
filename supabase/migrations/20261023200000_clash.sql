-- D-164 (#292): kontrola kolízií - testy, behy, kolízie a stav kolízie medzi behmi.
-- Aditívna migrácia. Kolízie nie sú `objects` (IFC ich nenesie; BCF je výmenný formát, nie úložisko).
-- `clash_tests` = pomenovaný test (pravidlo so sadami A/B + nastavenia), `clash_runs` = beh nad
-- revíziami modelov, `clash_results` = kolízie behu s kľúčom `clash_key` (upstream `clashReviewKey`:
-- id pravidla + dva prvky bez ohľadu na poradie), `clash_reviews` = stav kolízie naprieč behmi testu
-- (kľúč test + `clash_key`, nie beh), s odkazom na BCF tému (`model_tasks`, D-099).
-- Práva anon/authenticated nové objekty nedostanú (default privileges, migrácia 20261016120000).

begin;

create table clash_tests (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  name        text not null check (length(name) between 1 and 200),
  description text,
  origin      text not null check (origin in ('default', 'chat', 'viewer')),   -- default = pevný test z kódu hostu
  rules       jsonb not null check (jsonb_typeof(rules) = 'array' and jsonb_array_length(rules) >= 1),
  settings    jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table clash_runs (
  id             uuid primary key default gen_random_uuid(),
  test_id        uuid references clash_tests(id) on delete cascade,        -- null = ad hoc beh
  test_code      text,                                                     -- kód testu v čase behu (aj ad hoc: null)
  rules_snapshot jsonb not null,                                           -- pravidlo a nastavenia v čase behu
  models         jsonb not null default '{}'::jsonb,                       -- {model: revízia} (D-086)
  engine         text not null,                                            -- napr. @ifc-lite/clash@2.4.4 (ts)
  trigger        text not null check (trigger in ('chat', 'viewer')),
  completeness   jsonb not null default '{}'::jsonb,                       -- truncated (strop dvojíc)
  summary        jsonb not null default '{}'::jsonb,                       -- počty: total, stav, závažnosť, podlažie, dvojica tried
  coverage       jsonb,                                                    -- prvky, ktoré beh overil {a: [...], b: [...]|null}; null = neznáme
  created_by     text,
  created_at     timestamptz not null default now()
);
create index on clash_runs (test_id, created_at desc);

create table clash_results (
  id         bigint generated always as identity primary key,
  run_id     uuid not null references clash_runs(id) on delete cascade,
  clash_key  text not null,
  rule       text not null,
  status     text not null check (status in ('hard', 'clearance')),
  severity   text not null check (severity in ('critical', 'major', 'minor', 'info')),
  distance   real not null,                                                -- m; záporné = hĺbka prieniku
  a_guid     text not null,
  a_model    text not null,
  a_ifc_type text,
  a_name     text,
  b_guid     text not null,
  b_model    text not null,
  b_ifc_type text,
  b_name     text,
  storey     text,
  center     jsonb,                                                        -- [x, y, z] v IFC svete (m, Z hore)
  point      jsonb,                                                        -- [x, y, z] ako ho dal engine (Y hore); na obnovu behu
  bounds     jsonb                                                         -- [[x, y, z], [x, y, z]] ako ho dal engine
);
create index on clash_results (run_id);
create index on clash_results (clash_key);

create table clash_reviews (
  test_id      uuid not null references clash_tests(id) on delete cascade,
  clash_key    text not null,
  status       text not null default 'open' check (status in ('open', 'resolved', 'accepted')),
  comment      text,
  bcf_topic_id uuid references model_tasks(id) on delete set null,
  updated_by   text,
  updated_at   timestamptz not null default now(),
  primary key (test_id, clash_key)
);
create index on clash_reviews (bcf_topic_id) where bcf_topic_id is not null;

comment on table clash_tests is 'D-164: test kolízií (pravidlo so sadami A/B, nastavenia); origin default = pevný test z kódu hostu.';
comment on table clash_runs is 'D-164: beh testu nad revíziami modelov (rules_snapshot, models); test_id null = ad hoc.';
comment on table clash_results is 'D-164: kolízie behu; clash_key = upstream clashReviewKey (stabilný medzi behmi).';
comment on table clash_reviews is 'D-164: stav kolízie (open|resolved|accepted) naprieč behmi testu, odkaz na BCF tému.';

revoke all on clash_tests, clash_runs, clash_results, clash_reviews from anon, authenticated;
grant all on clash_tests, clash_runs, clash_results, clash_reviews to service_role;

-- Kolízie posledného behu každého testu so stavom (review), prvkami z grafu AIM (object_ref cez
-- aktívny GUID) a systémom prvku (`rel_assigns_to_group`, prvý podľa názvu). Ad hoc behy (bez testu)
-- tu nie sú, čítajú sa podľa `run_id` cez tool.
create or replace view v_clash_latest as
  with latest as (
    select distinct on (r.test_id) r.*
    from clash_runs r
    where r.test_id is not null
    order by r.test_id, r.created_at desc, r.id
  )
  select c.id, l.id as run_id, t.code as test_code, t.name as test_name, l.created_at as run_at,
         l.trigger, l.engine,
         c.clash_key, c.rule, c.status, c.severity, c.distance, c.storey, c.center,
         c.a_guid, c.a_model, c.a_ifc_type, c.a_name, oa.object_ref as a_object_ref, sa.name as a_system,
         c.b_guid, c.b_model, c.b_ifc_type, c.b_name, ob.object_ref as b_object_ref, sb.name as b_system,
         coalesce(rv.status, 'open') as review_status, rv.comment as review_comment,
         rv.bcf_topic_id, mt.number as bcf_topic_number
  from latest l
  join clash_tests t on t.id = l.test_id
  join clash_results c on c.run_id = l.id
  left join clash_reviews rv on rv.test_id = l.test_id and rv.clash_key = c.clash_key
  left join model_tasks mt on mt.id = rv.bcf_topic_id
  left join lateral (
    select o.id, o.object_ref from ifc_guid_history h join objects o on o.id = h.object_id
    where h.ifc_guid = c.a_guid and h.valid_until is null limit 1
  ) oa on true
  left join lateral (
    select o.id, o.object_ref from ifc_guid_history h join objects o on o.id = h.object_id
    where h.ifc_guid = c.b_guid and h.valid_until is null limit 1
  ) ob on true
  left join lateral (
    select s.name from rel_assigns_to_group g join objects s on s.id = g.to_id and s.object_type = 'system' and s.valid_until is null
    where g.from_id = oa.id and g.valid_until is null order by s.name limit 1
  ) sa on true
  left join lateral (
    select s.name from rel_assigns_to_group g join objects s on s.id = g.to_id and s.object_type = 'system' and s.valid_until is null
    where g.from_id = ob.id and g.valid_until is null order by s.name limit 1
  ) sb on true;

-- Súhrn posledného behu každého testu po pravidle, podlaží a stave kolízie (bez grafu AIM).
create or replace view v_clash_summary as
  with latest as (
    select distinct on (r.test_id) r.*
    from clash_runs r
    where r.test_id is not null
    order by r.test_id, r.created_at desc, r.id
  )
  select t.code as test_code, t.name as test_name, l.id as run_id, l.created_at as run_at,
         c.rule, c.storey, coalesce(rv.status, 'open') as review_status,
         count(*)                                           as clashes,
         count(*) filter (where c.status = 'hard')          as hard,
         count(*) filter (where c.status = 'clearance')     as clearance,
         count(*) filter (where c.severity = 'critical')    as critical,
         count(*) filter (where c.severity = 'major')       as major,
         count(*) filter (where c.severity = 'minor')       as minor,
         count(*) filter (where c.severity = 'info')        as info
  from latest l
  join clash_tests t on t.id = l.test_id
  join clash_results c on c.run_id = l.id
  left join clash_reviews rv on rv.test_id = l.test_id and rv.clash_key = c.clash_key
  group by t.code, t.name, l.id, l.created_at, c.rule, c.storey, coalesce(rv.status, 'open');

revoke all on v_clash_latest, v_clash_summary from anon, authenticated;
grant select on v_clash_latest, v_clash_summary to service_role;

commit;

-- D-181 (ICDD, #350): záznam importu kontajnera ICDD. PRIPRAVENÉ, na produkciu len na Samuelovo slovo.
-- MVP (D-181 bod 6) import do DB nezapisuje: prehliadač kontajner overí a porovná so stavom AIM (roundtrip).
-- Táto tabuľka je pre ďalší krok (bod 7): uloženie behu kontroly a, po potvrdení, zápis väzieb z cudzieho
-- kontajnera do `relationships` so `source = 'icdd:<version_id>'` (AIM vrstva podľa `rel_is_aim_layer`,
-- D-183 K3 krok 2b). Prijatý kontajner sa nemení (D-183 bod 2): ukladá sa len jeho sha256 a čo sme v ňom našli.
-- Aditívne, bez FK a bez zmeny existujúcich objektov. Rollback: drop table icdd_imports;

create table if not exists icdd_imports (
  id uuid primary key default gen_random_uuid(),
  version_id text not null,                                     -- ct:versionID z index.rdf
  container_sha256 text not null check (container_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text,
  status text not null default 'checked' check (status in ('checked', 'applied', 'failed')),
  same_as_aim boolean,                                          -- roundtrip: true = 0 rozdielov voči AIM
  payloads jsonb not null default '{}'::jsonb check (jsonb_typeof(payloads) = 'object'),   -- {filename: sha256}
  counts jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),       -- linky po vrstvách
  diff jsonb,                                                   -- RoundtripDiff (lib/icdd/roundtrip.ts)
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),       -- chyby kontroly ISO 21597
  model_revisions jsonb not null default '{}'::jsonb check (jsonb_typeof(model_revisions) = 'object'), -- {model: revízia} AIM pri importe
  imported_by text,
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  check ((status = 'applied') = (applied_at is not null))
);

create index if not exists idx_icdd_imports_version on icdd_imports (version_id, created_at desc);

comment on table icdd_imports is
  'D-181: beh importu kontajnera ICDD (ISO 21597): kontrola a porovnanie so stavom AIM; applied = väzby zapísané so source icdd:<version_id>.';
comment on column icdd_imports.container_sha256 is 'D-181: sha256 celého .icdd, prijatý kontajner sa nemení (D-183 bod 2).';

revoke all on icdd_imports from anon, authenticated;

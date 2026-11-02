-- Obrana do hĺbky (2. 11., Samuel "áno"): RLS zapnuté na všetkých tabuľkách public.
-- anon a authenticated už od 20261016120000 nemajú na tabuľkách ani pohľadoch žiadne granty; host, ETL a motor
-- pracujú cez service_role / postgres, ktoré majú BYPASSRLS, takže sa správanie nemení. Politiky sa nepridávajú:
-- keby niekto grant omylom vrátil, RLS bez politiky stále nič nepustí. Nové tabuľky: v migrácii aj
-- `alter table ... enable row level security` (pravidlo v AGENTS.md).
-- Rollback: alter table <t> disable row level security; pre každú tabuľku nižšie.
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

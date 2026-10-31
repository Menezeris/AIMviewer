-- D-183 K3 krok 3, SAMOSTATNÝ KROK NA SAMUELOVO SLOVO: ukončenie starých hrán ETL grafu, ktoré pohľady už čítajú
-- z kópie revízie. Súbor je zámerne v `supabase/pending/`, nie v `supabase/migrations/`: nasadenie ho nespustí.
-- Keď Samuel povie áno, presuň ho (git mv) do `supabase/migrations/` s aktuálnym časom v mene a nasaď.
--
-- Čo robí: hrany šiestich typov (rel_aggregates, rel_contained_in_spatial_structure, rel_defines_by_type,
-- rel_assigns_to_group, rel_associates_document, rel_associates_classification) so zdrojom ETL zo súboru
-- (`etl`, `etl:<model>`, presne podľa `rel_is_aim_layer`) dostanú `valid_until = now()`. Nič sa nemaže.
-- Pohľady ich nečítajú od migrácií 20261031120000 a 20261031150000 a ETL ich od 20261031180000 nepíše ani
-- neuzatvára (`etl/manifest.py`, `FROM_REVISION_COPY`), takže bez tohto kroku ostanú navždy "aktívne".
-- Hrany AIM vrstvy (pdf_link, doc_upload, seed, derive:*) a ostatné typy ETL (referenced, space_boundary,
-- aktori, strom a klasifikácia dokumentov) sa nemenia.
--
-- Počty na produkcii 31. 10. (aktívne, ktoré krok ukončí):
--   rel_aggregates                      etl:ASR   122
--   rel_contained_in_spatial_structure  etl:ASR   766, etl:VZT  166
--   rel_defines_by_type                 etl:ASR   735, etl:VZT 1 075
--   rel_assigns_to_group                etl:ASR   391, etl:VZT 1 084
--   rel_associates_document             etl:ASR   248, etl:VZT    9
--   rel_associates_classification       etl:ASR   608
--   spolu 5 204 (ASR 2 870, VZT 2 334). Už ukončených ETL hrán týchto typov je 1 747 (etl bez modelu 1 542, etl:ASR
--   dokumenty 178, etl:VZT 27); spolu by v tabuľke ostalo 6 951 neaktívnych riadkov ETL týchto typov.
--
-- Prečo ukončiť, nie zmazať (odporúčanie): relationships je časová tabuľka (valid_from/valid_until, D-010, D-086),
-- história re-ETL sa doteraz nikdy nemazala; ukončenie je vratné (valid_until = null) a uvoľní parciálne unique
-- indexy "jeden aktívny rodič" (uniq_active_aggregate/contained/defines_by_type), ktoré by inak blokovali hrany
-- AIM vrstvy tých typov. Zmazanie (variant nižšie) ušetrí len ~7 000 malých riadkov a je nevratné.
--
-- Spätne (vrátiť stav pred krokom): update relationships set valid_until = null
--   where valid_until = '<čas behu>' and rel_type in (...) and not rel_is_aim_layer(source);

begin;

do $$
declare n int; expected int := 5204;
begin
  update relationships set valid_until = now()
  where valid_until is null
    and not rel_is_aim_layer(source)
    and rel_type in ('rel_aggregates', 'rel_contained_in_spatial_structure', 'rel_defines_by_type',
                     'rel_assigns_to_group', 'rel_associates_document', 'rel_associates_classification');
  get diagnostics n = row_count;
  raise notice 'D-183 K3 krok 3: ukončených hrán ETL %, očakávané % (31. 10.; iný počet = medzitým re-ETL/nový prvok, skontrolovať)', n, expected;
end $$;

commit;

-- Variant ZMAZAŤ (len ak Samuel výslovne povie zmazať, namiesto bloku vyššie):
--   delete from relationships
--   where not rel_is_aim_layer(source)
--     and rel_type in ('rel_aggregates', 'rel_contained_in_spatial_structure', 'rel_defines_by_type',
--                      'rel_assigns_to_group', 'rel_associates_document', 'rel_associates_classification');
--   -- 6 951 riadkov (5 204 aktívnych + 1 747 ukončených) k 31. 10.

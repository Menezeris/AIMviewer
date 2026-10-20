# Evaly konektora aim-viewer (D-100, #97)

Merajú to, čo Samuel cíti v claude.ai: **koľko volaní a koľko sekúnd** trvá bežná úloha cez
MCP konektor. Dopĺňajú `npm run eval` (D-057), ktorý testuje len in-app chat `/api/ask` s iným
setom toolov.

Cieľ: bežná úloha najviac 2 volania a do 5 s; strop volaní a rozpočet času má každá úloha
v `eval/mcp-tasks.json`.

## Dva zdroje čísel
1. **Úlohy (agent):** počet volaní, celkový čas, splnené áno/nie.
2. **Server (`mcp_call_log`):** čas každého volania a jeho fáz (exec, broadcast, lens, readback,
   engine_load), studený štart, región. Dotaz na p50/p95:

```sql
select tool, action, count(*) n,
       percentile_cont(0.5) within group (order by ms) p50,
       percentile_cont(0.95) within group (order by ms) p95,
       round(avg((phases->>'engine_load')::numeric)) engine_load_avg,
       bool_or(cold) any_cold, min(region) region
from mcp_call_log
where created_at > now() - interval '1 hour'
group by 1, 2 order by p50 desc;
```

## Beh (Claude Code session s konektorom aim-viewer)
1. Pri úlohách `viewer: true` musí byť otvorený živý viewer (`/ifc?live=<LIVE_CHANNEL>`) a nikto
   iný ho počas behu nepoužíva, kanál je spoločný. Bez viewera pusti len `category: data`.
2. Každú úlohu dostane **čerstvý subagent** (nástroj Agent, typ general-purpose) s týmto zadaním:

   > Si asistent, ktorý odpovedá na otázky o budove a ovláda AIM viewer výlučne cez konektor
   > aim-viewer (tooly `mcp__aim-viewer__*`, načítaj ich cez ToolSearch). Nepoužívaj Bash,
   > súbory, web ani iné tooly. Používateľ píše: "<question>". Odpovedz stručne po slovensky.
   > Na koniec pridaj riadok `VOLANIA: <tooly aim-viewer v poradí, v akom si ich volal>`.

   Úloha so `setup` dostane setup ako predchádzajúcu správu toho istého agenta (SendMessage),
   meria sa až druhá správa.
3. Zapíš z notifikácie `duration_ms` a `tool_uses`, z odpovede riadok `VOLANIA` a over `expect`
   (regex nad odpoveďou, volané tooly, stav viewera cez `get_viewer_state`).
4. Výsledok ulož do `eval/results/mcp-<YYYY-MM-DD>-<label>.json`:
   `{ranAt, label, region, results: [{id, pass, calls, tools, tool_uses_total, duration_ms, over_cap, note}]}`
   a súhrn (pass, medián volaní, medián času, úlohy nad stropom) zapíš do #97 ako
   `feedback(action=comment)` s druhom `eval_round`.

Čas subagenta zahŕňa aj réžiu Claude Code (ToolSearch, spustenie agenta), preto sa porovnávajú
behy medzi sebou, nie s claude.ai. Pravdu o serveri hovorí `mcp_call_log`.

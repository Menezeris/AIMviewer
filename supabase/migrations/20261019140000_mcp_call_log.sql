-- D-100: log volaní MCP konektora - čas každého toolu a jeho fáz.
--
-- Meranie pre cieľ "bežný úkon do 5 s" (#97): z tabuľky sa počíta p50/p95 po tooloch a fázach
-- pred a po každom kole zmien. Riadok zapisuje `/api/mcp/<token>` až po odoslaní odpovede.
-- Argumenty sa neukladajú (môžu niesť stovky GUID), len `action`, ak ju tool má.
-- Práva anon/authenticated nové objekty nedostanú (default privileges, migrácia 20261016120000).

create table mcp_call_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  tool       text not null,
  action     text,                              -- args.action (style_in_3d, set_section...)
  ms         integer not null,                  -- celý callTool na serveri
  ok         boolean not null,                  -- false = tool vrátil isError
  cold       boolean not null default false,    -- prvé volanie v tejto inštancii funkcie
  phases     jsonb not null default '{}',       -- ms po fázach: exec, broadcast, lens, readback, engine_load
  region     text                               -- VERCEL_REGION inštancie
);

create index idx_mcp_call_log_created on mcp_call_log (created_at desc);
create index idx_mcp_call_log_tool_created on mcp_call_log (tool, created_at desc);

comment on table mcp_call_log is
  'D-100: čas volaní MCP konektora po tooloch a fázach (meranie latencie, #97).';

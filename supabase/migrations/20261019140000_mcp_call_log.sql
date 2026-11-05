-- D-100: log of MCP connector calls - the time of each tool and its phases.
--
-- Measurement for the goal "a typical operation within 5 s" (#97): p50/p95 per tool and phase are computed from the table
-- before and after each round of changes. The row is written by `/api/mcp/<token>` only after the response is sent.
-- Arguments are not stored (they may carry hundreds of GUIDs), only `action`, if the tool has one.
-- anon/authenticated privileges are not granted on new objects (default privileges, migration 20261016120000).

create table mcp_call_log (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  tool       text not null,
  action     text,                              -- args.action (style_in_3d, set_section...)
  ms         integer not null,                  -- the whole callTool on the server
  ok         boolean not null,                  -- false = the tool returned isError
  cold       boolean not null default false,    -- first call in this function instance
  phases     jsonb not null default '{}',       -- ms per phase: exec, broadcast, lens, readback, engine_load
  region     text                               -- VERCEL_REGION of the instance
);

create index idx_mcp_call_log_created on mcp_call_log (created_at desc);
create index idx_mcp_call_log_tool_created on mcp_call_log (tool, created_at desc);

comment on table mcp_call_log is
  'D-100: čas volaní MCP konektora po tooloch a fázach (meranie latencie, #97).';

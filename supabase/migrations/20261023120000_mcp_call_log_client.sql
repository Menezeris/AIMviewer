-- D-159: kto volal tool konektora. `client` = clientInfo.name z MCP initialize a rozhovor
-- (`claude-ai#<sid>`, `claude-code#<sid> (work)`, bez Mcp-Session-Id `ua:<User-Agent>`).
-- Podľa neho sa overí, či sa pracovné sessions rozoznajú a či chat drží jeden rozhovor.
-- Aditívne, nullable; staré riadky ostanú bez hodnoty.

alter table mcp_call_log add column if not exists client text;

comment on column mcp_call_log.client is
  'D-159: klient a rozhovor MCP konektora (clientInfo.name#sid, "(work)" = pracovná session na testovacom kanáli).';

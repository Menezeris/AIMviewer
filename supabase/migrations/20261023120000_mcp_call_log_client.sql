-- D-159: who called a connector tool. `client` = clientInfo.name from MCP initialize and the conversation
-- (`claude-ai#<sid>`, `claude-code#<sid> (work)`, without Mcp-Session-Id `ua:<User-Agent>`).
-- It is used to check whether work sessions are recognized and whether the chat keeps one conversation.
-- Additive, nullable; old rows stay without a value.

alter table mcp_call_log add column if not exists client text;

comment on column mcp_call_log.client is
  'D-159: klient a rozhovor MCP konektora (clientInfo.name#sid, "(work)" = pracovná session na testovacom kanáli).';

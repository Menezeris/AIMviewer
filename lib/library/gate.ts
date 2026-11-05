/**
 * Brána zápisu do knižnice (D-186 krok 3): `LIBRARY_WRITE_ENABLED=true` (predvolene vypnutá, zapína sa na Samuelovo
 * slovo). Origin guard a rate limit robí `editor-server.ts` pre všetky POST editora.
 */

export const writeAllowed = () => process.env.LIBRARY_WRITE_ENABLED === "true";

// Falošný PostgREST len pre `next build` v CI (D-187): stránky, ktoré sa predrenderujú pri builde
// (napr. /kniznica, /icdd), čítajú Supabase; build v CI nemá tajomstvá ani produkčnú DB.
// Každá požiadavka dostane prázdny zoznam, stránky sa vykreslia v prázdnom stave.
import http from "node:http";

const port = Number(process.env.STUB_PORT ?? 54321);
http
  .createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json", "content-range": "*/0" });
    res.end("[]");
  })
  .listen(port, "127.0.0.1", () => console.log(`postgrest-stub na 127.0.0.1:${port}`));

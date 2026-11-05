// Fake PostgREST only for `next build` in CI (D-187): pages that are prerendered at build time
// (e.g. /kniznica, /icdd) read Supabase; the CI build has no secrets and no production DB.
// Every request gets an empty list, the pages render in the empty state.
import http from "node:http";

const port = Number(process.env.STUB_PORT ?? 54321);
http
  .createServer((req, res) => {
    req.resume();
    res.writeHead(200, { "content-type": "application/json", "content-range": "*/0" });
    res.end("[]");
  })
  .listen(port, "127.0.0.1", () => console.log(`postgrest-stub na 127.0.0.1:${port}`));

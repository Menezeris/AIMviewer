"use client";

import { useEffect, useMemo, useState } from "react";

import { KniznicaEditor } from "@/components/kniznica-editor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Read-only prehliadač knižnice požiadaviek nad `library.hlava` (port do TS, krok 1, assetin-library V30).
 * Dáta z `GET /api/library` (server, service_role); súbor sa ukáže ako blokový model TS parsera.
 */

interface Riadok {
  kniznica: string;
  cesta: string;
  note_id: string | null;
  typ: string | null;
  rev: number;
  sha256: string;
  autor: string | null;
  vytvorena: string;
  zdroj: string | null;
  dlzka: number;
}
interface Blok {
  druh: string;
  raw: string;
  riadok: number;
  [k: string]: unknown;
}
interface Detail {
  subor: Omit<Riadok, "dlzka"> & { text: string };
  sha256_sedi: boolean;
  round_trip: boolean;
  bloky: { frontmatter: (Blok & { data: unknown; chyba: boolean }) | null; telo: Blok[] };
  zapis?: boolean;
  poznamka: {
    id: string | null;
    typ: string | null;
    data: Record<string, unknown>;
    verzia: string;
    model: unknown;
    zdroje: Record<string, string>;
    pod_zaznamy: Array<{ id: string; druh: string }>;
    diagnostiky: Array<{ json_pointer: string; uroven: string; kod: string; sprava: string; riadok: number | null }>;
  } | null;
}

const FARBA: Record<string, string> = {
  Frontmatter: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  Nadpis: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  InlinePole: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  YamlBlok: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  SurovyBlok: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  HtmlKomentar: "bg-zinc-500/15 text-zinc-500",
  Proza: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: "no-store" });
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error ?? `HTTP ${r.status}`);
  return body;
}

export function KniznicaPrehliadac({ initial }: { initial?: { kniznica?: string; cesta?: string } }) {
  const [rows, setRows] = useState<Riadok[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<{ kniznica: string; cesta: string } | null>(
    initial?.kniznica && initial.cesta ? { kniznica: initial.kniznica, cesta: initial.cesta } : null,
  );
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [raw, setRaw] = useState(false);
  const [obnova, setObnova] = useState(0);
  const [oznam, setOznam] = useState<string | null>(null);

  useEffect(() => {
    const q = initial?.kniznica ? `?kniznica=${encodeURIComponent(initial.kniznica)}` : "";
    getJson<{ subory: Riadok[] }>(`/api/library${q}`)
      .then((d) => setRows(d.subory))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [initial?.kniznica]);

  useEffect(() => {
    if (!sel) return;
    let live = true;
    getJson<Detail>(`/api/library?kniznica=${encodeURIComponent(sel.kniznica)}&cesta=${encodeURIComponent(sel.cesta)}`)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setDetailError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [sel, obnova]);

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const out = new Map<string, Riadok[]>();
    for (const r of rows ?? []) {
      if (f && !`${r.cesta} ${r.note_id ?? ""}`.toLowerCase().includes(f)) continue;
      const k = `${r.kniznica} · ${r.typ ?? "bez typu"}`;
      out.set(k, [...(out.get(k) ?? []), r]);
    }
    return [...out.entries()];
  }, [rows, filter]);

  const kniznice = useMemo(() => [...new Set((rows ?? []).map((r) => r.kniznica))].sort(), [rows]);

  const bloky = detail ? [...(detail.bloky.frontmatter ? [{ ...detail.bloky.frontmatter, druh: "Frontmatter" }] : []), ...detail.bloky.telo] : [];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(16rem,22rem)_1fr]" data-testid="kniznica-prehliadac">
      <Card className="min-h-0">
        <CardHeader>
          <CardTitle>Knižnica požiadaviek</CardTitle>
          <p className="text-xs text-muted-foreground">Hlava knižnice v DB. Celý editor (registre, reťazec, inšpektor, diagnostiky) je samostatná stránka.</p>
          {kniznice.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-2 text-xs" data-testid="kniznica-editor-odkazy">
              {kniznice.map((k) => (
                <a key={k} href={`/kniznica/editor/${encodeURIComponent(k)}`} className="text-primary underline underline-offset-2" data-testid="kniznica-editor-odkaz">
                  Otvoriť editor {k}
                </a>
              ))}
            </p>
          )}
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Hľadať cestu alebo ID"
            className="mt-2 h-8 w-full rounded border bg-background px-2 text-sm"
          />
        </CardHeader>
        <CardContent className="text-sm">
          {error && <p className="text-destructive">{error}</p>}
          {!rows && !error && <p className="text-muted-foreground">Načítavam...</p>}
          {rows && rows.length === 0 && <p className="text-muted-foreground">Knižnica je prázdna.</p>}
          {groups.map(([g, list]) => (
            <div key={g} className="mb-3">
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">{g} ({list.length})</h3>
              <ul className="space-y-0.5">
                {list.map((r) => {
                  const active = sel?.kniznica === r.kniznica && sel.cesta === r.cesta;
                  return (
                    <li key={r.kniznica + r.cesta}>
                      <button
                        type="button"
                        onClick={() => {
                          setOznam(null);
                          setDetail(null);
                          setDetailError(null);
                          setSel({ kniznica: r.kniznica, cesta: r.cesta });
                        }}
                        className={`w-full truncate rounded px-1 py-0.5 text-left hover:bg-muted ${active ? "bg-muted font-medium" : ""}`}
                        title={r.cesta}
                        data-testid="kniznica-subor"
                      >
                        {r.note_id ?? r.cesta.split("/").pop()}
                        <span className="ml-1 text-xs text-muted-foreground">r{r.rev}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="min-w-0">
        <CardHeader>
          <CardTitle className="break-words">{detail?.subor.note_id ?? sel?.cesta ?? "Vyber súbor"}</CardTitle>
          {detail && (
            <p className="text-xs text-muted-foreground" data-testid="kniznica-detail-meta">
              {detail.subor.cesta} · r{detail.subor.rev} · {detail.subor.autor ?? ""} {detail.subor.vytvorena.slice(0, 10)} · {detail.subor.zdroj ?? ""} · sha256{" "}
              {detail.subor.sha256.slice(0, 10)} {detail.sha256_sedi ? "sedí" : "NESEDÍ"} · round-trip {detail.round_trip ? "bajtovo" : "ZLYHAL"} · {bloky.length} blokov
            </p>
          )}
          {detail && (
            <label className="mt-1 flex items-center gap-1 text-xs">
              <input type="checkbox" checked={raw} onChange={(e) => setRaw(e.target.checked)} /> Celý text
            </label>
          )}
        </CardHeader>
        <CardContent className="text-sm">
          {detailError && <p className="text-destructive">{detailError}</p>}
          {sel && !detail && !detailError && <p className="text-muted-foreground">Načítavam...</p>}
          {oznam && (
            <output className="mb-2 block text-xs text-emerald-700 dark:text-emerald-400" data-testid="kniznica-oznam">
              {oznam}
            </output>
          )}
          {detail?.zapis && detail.poznamka?.model != null && sel && (
            <KniznicaEditor
              key={`${detail.subor.cesta}@${detail.poznamka.verzia}`}
              kniznica={sel.kniznica}
              poznamka={detail.poznamka}
              telo={detail.bloky.telo}
              onUlozene={(nova, text) => {
                setOznam(text);
                if (nova) setSel({ kniznica: sel.kniznica, cesta: nova });
                else setObnova((x) => x + 1);
              }}
            />
          )}
          {detail?.poznamka && (
            <div className="mb-3 space-y-1 text-xs" data-testid="kniznica-loader">
              <p>
                Model {detail.poznamka.typ ?? "?"}: {detail.poznamka.model ? "natypovaný" : "nenatypovaný"} · polia z frontmatter{" "}
                {Object.values(detail.poznamka.zdroje).filter((z) => z === "frontmatter").length}, inline{" "}
                {Object.values(detail.poznamka.zdroje).filter((z) => z === "inline").length}, blok{" "}
                {Object.values(detail.poznamka.zdroje).filter((z) => z === "blok").length}
                {detail.poznamka.pod_zaznamy.length > 0 && ` · pod-záznamy: ${detail.poznamka.pod_zaznamy.map((p) => p.id).join(", ")}`}
              </p>
              {detail.poznamka.diagnostiky.length === 0 ? (
                <p className="text-muted-foreground">Loader: bez diagnostík.</p>
              ) : (
                <ul className="space-y-0.5">
                  {detail.poznamka.diagnostiky.map((d, i) => (
                    <li key={i} className={d.uroven === "E" ? "text-destructive" : "text-amber-700 dark:text-amber-400"}>
                      {d.uroven} {d.kod} {d.json_pointer} {d.riadok ? `(riadok ${d.riadok})` : ""}: {d.sprava}
                    </li>
                  ))}
                </ul>
              )}
              {detail.poznamka.model != null && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">Typovaný model (JSON)</summary>
                  <pre className="overflow-auto whitespace-pre-wrap rounded border p-2">{JSON.stringify(detail.poznamka.model, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
          {detail && raw && <pre className="overflow-auto whitespace-pre-wrap rounded border p-2 text-xs">{detail.subor.text}</pre>}
          {detail && !raw && (
            <ol className="space-y-1">
              {bloky.map((b, i) => (
                <li key={i} className="rounded border" data-testid="kniznica-blok">
                  <div className="flex flex-wrap items-center gap-2 border-b px-2 py-0.5 text-xs">
                    <span className={`rounded px-1 ${FARBA[b.druh] ?? ""}`}>{b.druh}</span>
                    <span className="text-muted-foreground">riadok {b.riadok + 1}</span>
                    {typeof b.kluc === "string" && <code>{b.kluc}</code>}
                    {typeof b.uroven === "number" && <span>h{b.uroven}</span>}
                    {typeof b.jazyk === "string" && b.jazyk && <code>{b.jazyk}</code>}
                    {b.chyba === true && <span className="text-destructive">chyba YAML</span>}
                  </div>
                  <pre className="overflow-auto whitespace-pre-wrap px-2 py-1 text-xs">{b.raw}</pre>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

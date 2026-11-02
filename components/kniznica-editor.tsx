"use client";

import { useMemo, useState } from "react";

/**
 * Editor poznámky knižnice v AIM (D-186 krok 3): skalárne polia hlavičky a próza tela. Ukladá cez
 * `POST /api/library/zapis` s verziou textu, ktorú editor ukázal; súbeh (409) ukáže konflikt a nič neprepíše.
 * Autor = meno z editora. Celý editor zo schémy (zoznamy, odkazy, reťazec) príde v kroku 4.
 */

interface Blok {
  druh: string;
  raw: string;
}

export interface EditorPoznamka {
  id: string | null;
  data: Record<string, unknown>;
  zdroje: Record<string, string>;
  verzia: string;
}

interface Vysledok {
  ok: boolean;
  zapisane: string[];
  odmietnute: string[];
  premenovane: Array<[string, string]>;
  konflikt: boolean;
  diagnostiky: Array<{ json_pointer: string; kod: string; sprava: string }>;
  error?: string;
}

const NEMENITELNE = new Set(["id", "typ", "aliases"]);

export function KniznicaEditor({
  kniznica,
  poznamka,
  telo,
  onUlozene,
}: {
  kniznica: string;
  poznamka: EditorPoznamka;
  telo: Blok[];
  onUlozene: (novaCesta: string | null, oznam: string) => void;
}) {
  const polia = useMemo(
    () =>
      Object.entries(poznamka.zdroje)
        .filter(([k, z]) => z === "frontmatter" && !NEMENITELNE.has(k))
        .filter(([k]) => ["string", "number", "boolean"].includes(typeof poznamka.data[k]))
        .map(([k]) => k),
    [poznamka],
  );
  const prozy = useMemo(() => telo.map((b, i) => ({ i, b })).filter(({ b }) => b.druh === "Proza" && b.raw.trim()), [telo]);
  const [hodnoty, setHodnoty] = useState<Record<string, string>>(() => Object.fromEntries(polia.map((k) => [k, String(poznamka.data[k])])));
  const [proza, setProza] = useState<Record<number, string>>(() => Object.fromEntries(prozy.map(({ i, b }) => [i, b.raw.trim()])));
  const [autor, setAutor] = useState(() => {
    try {
      return localStorage.getItem("kniznica-autor") ?? "";
    } catch {
      return "";
    }
  });
  const [busy, setBusy] = useState(false);
  const [vysledok, setVysledok] = useState<Vysledok | null>(null);

  const zmeny = [
    ...polia
      .filter((k) => hodnoty[k] !== String(poznamka.data[k]))
      .map((k) => ({ id: poznamka.id, pointer: `/${k}`, hodnota: typeof poznamka.data[k] === "number" ? Number(hodnoty[k]) : typeof poznamka.data[k] === "boolean" ? hodnoty[k] === "true" : hodnoty[k] })),
    ...prozy.filter(({ i, b }) => proza[i] !== b.raw.trim()).map(({ i }) => ({ id: poznamka.id, pointer: `/__proza/${i}`, hodnota: proza[i] })),
  ];

  async function uloz() {
    setBusy(true);
    setVysledok(null);
    try {
      localStorage.setItem("kniznica-autor", autor);
    } catch {
      /* bez úložiska */
    }
    try {
      const r = await fetch("/api/library/zapis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kniznica, zmeny, verzie: { [poznamka.id ?? ""]: poznamka.verzia }, autor }),
      });
      const v = (await r.json().catch(() => ({ error: `HTTP ${r.status}` }))) as Vysledok;
      setVysledok(v);
      if (r.ok && v.ok) onUlozene(v.premenovane?.[0]?.[1] ?? null, `Uložené: ${v.zapisane.join(", ")} (autor ${autor.trim()})`);
    } catch (e) {
      setVysledok({ ok: false, zapisane: [], odmietnute: [], premenovane: [], konflikt: false, diagnostiky: [], error: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-3 space-y-2 rounded border p-2 text-xs" data-testid="kniznica-editor">
      <div className="flex flex-wrap items-center gap-2">
        <strong>Upraviť</strong>
        <label className="flex items-center gap-1">
          Meno
          <input value={autor} onChange={(e) => setAutor(e.target.value.slice(0, 120))} placeholder="kto ukladá" className="h-7 w-40 rounded border bg-background px-1" />
        </label>
        <button
          type="button"
          disabled={busy || !autor.trim() || zmeny.length === 0}
          onClick={() => void uloz()}
          className="h-7 rounded border px-2 font-medium hover:bg-muted disabled:opacity-50"
          data-testid="kniznica-ulozit"
        >
          {busy ? "Ukladám..." : `Uložiť (${zmeny.length})`}
        </button>
      </div>
      <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
        {polia.map((k) => (
          <label key={k} className="contents">
            <span className="text-muted-foreground">{k}</span>
            <input value={hodnoty[k] ?? ""} onChange={(e) => setHodnoty({ ...hodnoty, [k]: e.target.value })} className="h-7 rounded border bg-background px-1" data-testid={`pole-${k}`} />
          </label>
        ))}
      </div>
      {prozy.map(({ i }) => (
        <textarea key={i} value={proza[i] ?? ""} onChange={(e) => setProza({ ...proza, [i]: e.target.value })} rows={3} className="w-full rounded border bg-background p-1" data-testid={`proza-${i}`} />
      ))}
      {vysledok && (
        <output className={`block ${vysledok.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`} data-testid="kniznica-vysledok">
          {vysledok.error
            ? vysledok.error
            : vysledok.konflikt
              ? "Poznámku medzitým zmenil niekto iný; nič sa neprepísalo. Načítaj ju znova."
              : vysledok.ok
                ? `Uložené: ${vysledok.zapisane.join(", ")}`
                : `Neuložené: ${vysledok.diagnostiky.map((d) => `${d.json_pointer || ""} ${d.sprava}`).join("; ")}`}
        </output>
      )}
    </div>
  );
}

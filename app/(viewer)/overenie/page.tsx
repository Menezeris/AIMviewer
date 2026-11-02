import {
  FFH_ABSENT_RULE,
  NET_VOLUME_COVERINGS,
  NET_VOLUME_TOLERANCE,
  NON_CONSTANT_RULE,
  OPEN_MESH_RULE,
  REGISTRY_VERSION,
  SPACE_METHODS,
  TOLERANCES,
  recipeRank,
  targetRank,
  type QuantityMethod,
} from "@/lib/verify/quantity-methods";
import { specLink } from "@/lib/verify/wire";

export const metadata = { title: "Overenie výmer (D-185)" };

const DECISION_URL = "https://github.com/Menezeris/AIMviewer/blob/main/DECISIONS.md";

const STATUSES: Array<[string, string, string]> = [
  ["green", "bg-green-500", "hodnota zo súboru sedí s geometriou v tolerancii (alebo je správne neuvedená)"],
  ["yellow", "bg-yellow-400", "sedí iná známa metóda (NetVolume ako v Revite) alebo chýba hodnota, ktorú schéma žiada"],
  ["red", "bg-red-500", "hodnota nesedí, alebo vlastnosť nie je jednoznačná (miestnosť má viac výšok); nález ide autorovi cez BCF"],
  ["grey", "bg-neutral-400", "nedá sa overiť (prvok nemá teleso, chýba doska alebo krytina); dôvod je pri veličine"],
];

/**
 * "Ako to funguje?" pre fajočky overenia výmer vo vieweri (D-185 UI, `help_href`). Všetko sa číta z registra metód
 * `lib/verify/quantity-methods.ts`, stránka pravidlá nekopíruje.
 */
export default function OverenieVymerPage() {
  // Hlavný recept veličiny pred kontrolným (Height: zo súborových dosiek, potom vlastné teleso).
  const methods = (Object.values(SPACE_METHODS) as QuantityMethod[]).toSorted((a, b) => targetRank(a.target) - targetRank(b.target) || recipeRank(a.id) - recipeRank(b.id));
  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 overflow-auto p-4 text-sm">
      <header className="space-y-2">
        <h1 className="text-xl font-semibold">Overenie výmer miestností voči geometrii</h1>
        <p>
          Fajočka pri veličine Qto_SpaceBaseQuantities v paneli vlastností porovná hodnotu zo súboru IFC s hodnotou
          vypočítanou z geometrie tej istej revízie modelu. Do IFC sa nič nezapisuje; beh sa uloží k revízii a pri novej
          revízii je zastaraný. Pravidlá sú v registri metód (verzia {REGISTRY_VERSION}), rozhodnutie a jeho doplnky v{" "}
          <a className="underline" href={DECISION_URL} target="_blank" rel="noreferrer">
            DECISIONS.md, D-185
          </a>
          .
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Stavy</h2>
        <ul className="space-y-1">
          {STATUSES.map(([s, color, text]) => (
            <li key={s} className="flex items-start gap-2">
              <span className={`mt-1 inline-block h-3 w-3 shrink-0 rounded-full ${color}`} aria-hidden />
              <span>
                <b>{s}</b>: {text}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Recepty</h2>
        {methods.map((m) => {
          const spec = specLink(m.spec_ref);
          return (
            <article key={m.id} className="space-y-1 rounded border p-3">
              <h3 className="font-medium">
                {m.target.split(".")[1]} <span className="font-mono text-xs text-muted-foreground">{m.id}</span>
                {m.check ? <span className="ml-2 text-xs text-muted-foreground">(kontrolný výpočet)</span> : null}
              </h3>
              <p>{m.explanation}</p>
              <p className="text-xs text-muted-foreground">Metóda: {m.method}</p>
              <p className="text-xs text-muted-foreground">Tolerancia: {m === SPACE_METHODS.net_volume ? `${NET_VOLUME_TOLERANCE.rel_of_cut * 100} % z GrossVolume - NetVolume zo súboru` : TOLERANCES[m.kind].text}</p>
              <blockquote className="border-l-2 pl-2 text-xs italic">
                {m.definition}
                {spec ? (
                  <>
                    {" "}
                    (<a className="underline" href={spec.url} target="_blank" rel="noreferrer">{spec.label}</a>)
                  </>
                ) : null}
              </blockquote>
            </article>
          );
        })}
      </section>

      <section className="space-y-2">
        <h2 className="text-base font-semibold">Pravidlá</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>Konštantnosť: {NON_CONSTANT_RULE.text}</li>
          <li>FinishFloorHeight: {FFH_ABSENT_RULE.text} (žltá).</li>
          <li>NetVolume odčíta len krytiny {NET_VOLUME_COVERINGS.join(", ")}.</li>
          <li>Teleso z meshu: {OPEN_MESH_RULE.text}.</li>
        </ul>
      </section>
    </div>
  );
}

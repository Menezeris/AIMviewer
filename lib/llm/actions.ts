/**
 * UI akcie LLM vrstvy (D-056) — čisté funkcie bez server-only závislostí, aby
 * ich zdieľal server (`AskToolRuntime.finalActions`) aj klient živého kanála
 * (D-079), ktorý zlučuje dávku príkazov doručených tesne po sebe.
 */

/** UI akcia vyžiadaná modelom (show_in_3d…) — klient na ňu naviguje. */
export interface AskAction {
  type: "navigate";
  /** Interná cesta Viewera (server ju stavia z whitelistu — nikdy nie z modelu). */
  url: string;
  label: string;
}

const isIfc = (a: AskAction) => a.url.startsWith("/ifc?");

/**
 * Zlúči viac `/ifc` akcií do jednej navigácie: focus = zjednotenie GUIDov
 * v poradí, ops = všetky operácie v poradí. Dve navigácie po sebe by sa
 * prepísali (vyhrá posledná) a efekty prvej by sa stratili. Ostatné akcie
 * (karta, výkres) ostávajú za 3D akciou v pôvodnom poradí.
 */
export function mergeIfcActions(actions: AskAction[], nonce = Date.now().toString(36)): AskAction[] {
  const ifcActions = actions.filter(isIfc);
  if (ifcActions.length <= 1) return actions;

  const guids: string[] = [];
  const ops: string[] = [];
  for (const a of ifcActions) {
    const params = new URLSearchParams(a.url.slice(a.url.indexOf("?") + 1));
    for (const g of (params.get("focus") ?? "").split(",")) {
      if (g && !guids.includes(g)) guids.push(g);
    }
    const op = params.get("ops");
    if (op) ops.push(op);
  }
  const merged = new URLSearchParams();
  if (guids.length > 0) merged.set("focus", guids.join(","));
  if (ops.length > 0) merged.set("ops", ops.join(";"));
  merged.set("r", nonce);
  const label =
    ops.length > 0
      ? `3D: ${ifcActions.length} akcií`
      : `3D: ${guids.length} prvkov`;
  return [
    { type: "navigate", url: `/ifc?${merged.toString()}`, label },
    ...actions.filter((a) => !isIfc(a)),
  ];
}

/**
 * Akcia smie viesť len na internú cestu Viewera — obrana klienta živého
 * kanála (D-079), ktorý príkazy prijíma z verejného broadcastu.
 */
export function isSafeViewerUrl(url: unknown): url is string {
  return (
    typeof url === "string" &&
    url.length <= 16_000 &&
    /^\/(ifc|node|type|drawing)(\/|\?|$)/.test(url) &&
    !url.startsWith("//")
  );
}

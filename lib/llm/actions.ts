/**
 * UI actions of the LLM layer (D-056) - pure functions without server-only dependencies, so that
 * they are shared by the server (`AskToolRuntime.finalActions`) and the client of the live channel
 * (D-079), which merges a batch of commands delivered right after each other.
 */

/** UI action requested by the model (show_in_3d...) - the client navigates to it. */
export interface AskAction {
  type: "navigate";
  /** Internal Viewer path (the server builds it from a whitelist - never from the model). */
  url: string;
  label: string;
}

const isIfc = (a: AskAction) => a.url.startsWith("/ifc?");

/**
 * Merges several `/ifc` actions into one navigation: focus = union of GUIDs
 * in order, ops = all operations in order. Two navigations in a row would
 * overwrite each other (the last wins) and the effects of the first would be lost. Other actions
 * (card, drawing) stay after the 3D action in the original order.
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
 * An action may lead only to an internal Viewer path - defense of the live channel
 * client (D-079), which accepts commands from a public broadcast.
 */
export function isSafeViewerUrl(url: unknown): url is string {
  return (
    typeof url === "string" &&
    url.length <= 16_000 &&
    /^\/(ifc|node|type|drawing)(\/|\?|$)/.test(url) &&
    !url.startsWith("//")
  );
}

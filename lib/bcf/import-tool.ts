import { importBcfArchive, type ConflictPolicy } from "./import";
import { archiveFromArgs } from "./import-source";
import { BcfInputError, DEFAULT_AUTHOR, type BcfDeps } from "./tools";

/** `bcf_topic action=import` (D-158 krok 8): argumenty toolu -> import `.bcfzip`. */
export async function importFromArgs(args: Record<string, unknown>, deps: BcfDeps) {
  const conflict = args.conflict === undefined || args.conflict === "" ? "keep" : args.conflict;
  if (conflict !== "keep" && conflict !== "overwrite") throw new BcfInputError("conflict: keep | overwrite.");
  const bytes = await archiveFromArgs(args);
  const guids = Array.isArray(args.guids) ? args.guids.filter((g): g is string => typeof g === "string") : undefined;
  const summary = await importBcfArchive(bytes, deps, {
    dryRun: args.dry_run === true,
    conflict: conflict as ConflictPolicy,
    model: typeof args.model === "string" && args.model.trim() ? args.model.trim() : null,
    author: typeof args.modified_by === "string" && args.modified_by.trim() ? args.modified_by.trim() : DEFAULT_AUTHOR,
    guids,
  });
  return {
    ...summary,
    hint:
      summary.conflicts > 0
        ? "Konflikty sa nezapísali; skontroluj conflicts pri téme a prípadne zopakuj s conflict=overwrite."
        : "Viewer si témy obnoví sám; session pre Claude sa pri importe nespúšťa (bcf_topic update start_session=true).",
  };
}

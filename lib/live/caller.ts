import "server-only";

/** Request context (D-159 caller, D-189 project); lives in `lib/project/context.ts`. */
export {
  currentCaller,
  currentModels,
  currentProject,
  currentProjectId,
  maybeCurrentProject,
  withCaller,
  withProject,
  type LiveCaller,
} from "@/lib/project/context";

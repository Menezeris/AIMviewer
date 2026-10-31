import { IcddPanel } from "@/components/icdd-panel";

/** Export a kontrola kontajnera ICDD (D-181, #350). Stránka je len obal, práca beží v prehliadači. */
export default function IcddPage() {
  return (
    <div className="mx-auto w-full max-w-3xl overflow-auto p-4">
      <IcddPanel />
    </div>
  );
}

import { IcddPanel } from "@/components/icdd-panel";

/** Export and check of the ICDD container (D-181, #350). The page is just a wrapper, the work runs in the browser. */
export default function IcddPage() {
  return (
    <div className="mx-auto w-full max-w-3xl overflow-auto p-4">
      <IcddPanel />
    </div>
  );
}

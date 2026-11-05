# IFC 4.3 schema (vendor/ifc4.3)

`vendor/ifc4.3` is a git submodule of the official buildingSMART repository
<https://github.com/buildingSMART/IFC4.3.x-development>, pinned to commit
`424cadb14f28a8a120e7a9218c0ef74b801ea7a3` (3 Nov 2026). Decision: D-195 (plan 3.4).

- **License:** Creative Commons Attribution-NoDerivatives 4.0 International (CC BY-ND 4.0),
  <https://creativecommons.org/licenses/by-nd/4.0/>. We use and cite the files with this attribution.
- **Attribution:** "IFC 4.3 specification, (c) buildingSMART International, from
  buildingSMART/IFC4.3.x-development at commit 424cadb".
- **Never modify these files**, not even whitespace. Nothing in this repository copies their text into
  the database or the app; tools read them by path.
- **Checkout:** only `docs/schemas` and `reference_schemas/psd` (about 17 MB plus 4 MB git data, instead of
  about 118 MB). Fetch with `bash scripts/ifc-schema/fetch.sh` from the repo root. A plain
  `git submodule update --init` works too but checks out the whole repository.
- **Where things are:** entity `docs/schemas/<layer>/<package>/Entities/<IfcClass>.md`, types and enums
  `.../Types/`, property sets `.../PropertySets/` and `reference_schemas/psd/*.xml`.
- **Not needed by CI or the app build.** CI and Vercel do not fetch it. The machine schema used by the
  generators is ifcopenshell `IFC4X3_ADD2`; its 876 entities equal the entity files at this commit.
- **Updating the pin** is a decision (new D-record): move the submodule, rerun the generators
  (`python -m etl.entity_manifest --check`) and say what changed.

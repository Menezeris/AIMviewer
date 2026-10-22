# fork-turbo-cache-patch

Patch pre fork Menezeris/ifc-lite (zapis do forku z tejto session nebol mozny).

- Subor: `fork-turbo-cache.patch` (git format-patch, 1 commit)
- sha256: `2ca5ba14094d6fc6aa272b369eced4feceeb0d5b4cc0b79d4e502f234b4cd491`
- Base (main forku): `660ebd8635496c3f0150f29a8f009adcaa761e7c` (Merge pull request #104 release/aim-2026-10-22)
- Pouzitie: `git checkout 660ebd8635496c3f0150f29a8f009adcaa761e7c && git am fork-turbo-cache.patch`, overene `git am` na cistom klone base-u.
- Popis zmeny a postup overenia: `PR_BODY.md`

Zmena: 4 per-commit premenne (VERCEL_GIT_COMMIT_SHA, VERCEL_DEPLOYMENT_ID, VERCEL_SKEW_PROTECTION_ENABLED, GITHUB_SHA) z root `turbo.json` do novej `apps/viewer/turbo.json`; oprava hlasky o Remote Cache v `scripts/vercel-build.sh`.

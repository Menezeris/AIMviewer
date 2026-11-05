#!/usr/bin/env bash
# Vercel "Ignored Build Step" of the ai-mviewer project (D-187). Vercel: exit 1 = build, exit 0 = skip.
# The project setting (commandForIgnoringBuildStep) calls this script if it exists in the commit:
#   if [ -f scripts/vercel-ignore.sh ]; then bash scripts/vercel-ignore.sh; else exit 1; fi
#
# Rules:
#   - empty ref (deploy from the CLI / API without git) = build;
#   - "[preview]" in the commit message = build on any branch (preview on request);
#   - main = build, except a push that since the last successful deployment changes only docs/, *.md,
#     supabase/pending/ or supabase/tests/;
#   - other branches without "[preview]" = no preview (the pre-merge check is GitHub Actions CI).
#
# VERCEL_GIT_PREVIOUS_SHA = SHA of the last SUCCESSFUL deployment of the branch; skipped builds do not advance it,
# so the diff covers everything since the last deployment. If it is missing or the shallow Vercel clone does not have it
# (or the diff fails), the script prefers to build.
set -u

ref="${VERCEL_GIT_COMMIT_REF:-}"
msg="${VERCEL_GIT_COMMIT_MESSAGE:-}"
prev="${VERCEL_GIT_PREVIOUS_SHA:-}"
sha="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

if [ -z "$ref" ]; then
  echo "AIM ignore: bez git refu, build."
  exit 1
fi

shopt -s nocasematch
if [[ "$msg" == *"[preview]"* ]]; then
  echo "AIM ignore: [preview] v správe commitu, build ($ref)."
  exit 1
fi
shopt -u nocasematch

if [ "$ref" != "main" ]; then
  echo "AIM ignore: $ref bez [preview], náhľad sa nerobí (D-187)."
  exit 0
fi

if [ -z "$prev" ] || ! git cat-file -e "${prev}^{commit}" 2>/dev/null; then
  echo "AIM ignore: main, predošlé nasadenie (${prev:-žiadne}) nie je v klone, build."
  exit 1
fi

if ! changed="$(git diff --name-only "$prev" "$sha" 2>/dev/null)"; then
  echo "AIM ignore: main, diff zlyhal, build."
  exit 1
fi
if [ -z "$changed" ]; then
  echo "AIM ignore: main bez zmeny súborov od $prev, build."
  exit 1
fi

while IFS= read -r f; do
  case "$f" in
    docs/* | supabase/pending/* | supabase/tests/* | *.md) ;;
    *)
      echo "AIM ignore: main, zmena kódu ($f), build."
      exit 1
      ;;
  esac
done <<< "$changed"

echo "AIM ignore: main, od $prev sa zmenili len dokumenty a pending/testy DB, build sa preskakuje."
exit 0

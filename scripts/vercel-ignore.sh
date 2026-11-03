#!/usr/bin/env bash
# Vercel "Ignored Build Step" projektu ai-mviewer (D-187). Vercel: exit 1 = build, exit 0 = preskočiť.
# Nastavenie projektu (commandForIgnoringBuildStep) volá tento skript, ak v commite existuje:
#   if [ -f scripts/vercel-ignore.sh ]; then bash scripts/vercel-ignore.sh; else exit 1; fi
#
# Pravidlá:
#   - prázdny ref (deploy z CLI / API bez gitu) = build;
#   - "[preview]" v správe commitu = build na hocijakej vetve (náhľad na požiadanie);
#   - main = build, okrem pushu, ktorý od posledného úspešného nasadenia mení len docs/, *.md,
#     supabase/pending/ alebo supabase/tests/;
#   - ostatné vetvy bez "[preview]" = bez náhľadu (kontrolou pred zlúčením je GitHub Actions CI).
#
# VERCEL_GIT_PREVIOUS_SHA = SHA posledného ÚSPEŠNÉHO nasadenia vetvy; preskočené buildy ho neposúvajú,
# takže diff pokryje všetko od posledného nasadenia. Ak chýba alebo ho plytký klon Vercelu nemá
# (alebo diff zlyhá), skript radšej builduje.
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

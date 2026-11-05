#!/usr/bin/env bash
# Fetch the pinned IFC 4.3 schema submodule (D-195) small: shallow, blob-filtered, sparse.
# Only docs/schemas and reference_schemas/psd are checked out (about 21 MB instead of about 118 MB).
# The commit is the one recorded in the superproject (git ls-tree HEAD vendor/ifc4.3).
# Safe to run again: it only fetches when the checkout is missing or on another commit.
# Usage, from the repo root: bash scripts/ifc-schema/fetch.sh
set -euo pipefail

path="vendor/ifc4.3"
root="$(git rev-parse --show-toplevel)"
cd "$root"

url="$(git config -f .gitmodules --get "submodule.${path}.url")"
sha="$(git ls-tree HEAD "$path" | awk '$2 == "commit" { print $3 }')"
if [ -z "$sha" ]; then
  echo "fetch.sh: no submodule commit recorded for $path" >&2
  exit 1
fi

git submodule init "$path" >/dev/null

if [ -e "$path/.git" ] && [ "$(git -C "$path" rev-parse HEAD 2>/dev/null || true)" = "$sha" ]; then
  echo "IFC 4.3 schema already at ${sha:0:7} in $path"
  exit 0
fi

if [ ! -e "$path/.git" ]; then
  rm -rf "$path"
  mkdir -p "$path"
  git -C "$path" init -q
  git -C "$path" remote add origin "$url"
fi

git -C "$path" sparse-checkout set --no-cone /docs/schemas/ /reference_schemas/psd/
git -C "$path" fetch -q --depth 1 --filter=blob:none origin "$sha"
git -C "$path" -c advice.detachedHead=false checkout -q "$sha"
git submodule absorbgitdirs "$path" >/dev/null 2>&1 || true

echo "IFC 4.3 schema at ${sha:0:7} in $path ($(du -sh "$path" | cut -f1))"

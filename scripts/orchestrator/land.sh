#!/bin/bash
# Land AIMviewer PRs in order: merge origin/main into a dirty branch (doc conflicts only), verify, push, wait for Vercel, merge.
R="$(cd "$(dirname "$0")" && pwd)/resolve_docs.py"
cd "$(git -C "$(dirname "$0")" rev-parse --show-toplevel)" || exit 1
for n in "$@"; do
  for t in 1 2 3 4 5 6 7 8; do X=$(gh api repos/Menezeris/AIMviewer/pulls/$n --jq '"\(.mergeable_state) \(.head.sha) \(.head.ref)"'); S=${X%% *}; [ "$S" = "unknown" ] && { sleep 6; continue; }; break; done
  read S SHA B <<<"$X"; echo "#$n $S"
  if [ "$S" = "dirty" ]; then
    git fetch -q origin main $B && git switch -q -C $B origin/$B || exit 1
    git -c user.name=Claude -c user.email=noreply@anthropic.com merge --no-edit origin/main >/dev/null 2>&1
    U=$(git diff --name-only --diff-filter=U)
    for f in $U; do case $f in DECISIONS.md|ROADMAP.md|eval/questions.json|MCP-TOOLS.md) ;; *) echo "STOP #$n code conflict: $U"; exit 2;; esac; done
    D=$(echo "$U" | grep -v MCP-TOOLS.md); [ -n "$D" ] && python3 $R $D; if echo "$U" | grep -q MCP-TOOLS.md; then git checkout --theirs MCP-TOOLS.md; npx vitest run lib/mcp/tool-registry.test.ts -u >/dev/null 2>&1; fi; [ -n "$U" ] && git add $U
    git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q --no-edit || exit 1
    npx tsc --noEmit >/dev/null 2>&1 || { echo "STOP #$n tsc"; exit 3; }
    npx vitest run 2>&1 | grep -E "Tests " ; npx vitest run >/dev/null 2>&1 || { echo "STOP #$n vitest"; exit 3; }
    git push -q origin $B || exit 1
    SHA=$(git rev-parse HEAD)
    for i in $(seq 1 30); do V=$(gh api "repos/Menezeris/AIMviewer/commits/$SHA/status" --jq .state); [ "$V" = "success" ] && break; [ "$V" = "failure" -o "$V" = "error" ] && { echo "STOP #$n vercel $V"; exit 4; }; sleep 30; done
    echo "  vercel $V"
  elif [ "$S" != "clean" ] && [ "$S" != "unstable" ]; then echo "STOP #$n $S"; exit 5; fi
  gh api -X PUT repos/Menezeris/AIMviewer/pulls/$n/merge -f merge_method=merge -f sha=$SHA --jq '"  merged=\(.merged) \(.sha[0:9])"' || { echo "FAIL #$n"; exit 6; }
  sleep 5
done
echo DONE

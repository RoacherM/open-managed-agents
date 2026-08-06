#!/usr/bin/env bash
#
# Sync openma-ai/open-managed-agents (upstream) into this fork's main.
#
# Runs the merge in a throwaway worktree so your checkout stays put, then
# runs the gates. Nothing is pushed: on success it prints the commands to
# land the merge; on conflict it prints the files plus the resolution
# principles this fork has settled on and exits 1.
#
# Conflict-resolution principles and the record of the 2026-08-06 sync
# (which 9 upstream commits landed, which files conflicted, how each was
# resolved) live in:
#   .agents/handoffs/2026-08-06-next-steps-roadmap.md
#
# Usage:  .agents/scripts/sync-upstream.sh
#
set -euo pipefail

REPO_ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

DATE="$(date +%Y-%m-%d)"
BRANCH="sync/upstream-${DATE}"
WORKTREE="${REPO_ROOT}/../oma-sync-${DATE}"

say() { printf '\n=== %s ===\n' "$*"; }

if ! git remote get-url upstream >/dev/null 2>&1; then
  echo "no 'upstream' remote; add it with:" >&2
  echo "  git remote add upstream https://github.com/openma-ai/open-managed-agents.git" >&2
  exit 1
fi

say "fetching upstream"
git fetch upstream --prune

if [ -z "$(git log --oneline main..upstream/main)" ]; then
  echo "main is already up to date with upstream/main — nothing to sync."
  exit 0
fi

say "commits to merge"
git log --oneline main..upstream/main

if git show-ref --verify --quiet "refs/heads/${BRANCH}"; then
  echo "branch ${BRANCH} already exists — finish or delete it first:" >&2
  echo "  git worktree remove ${WORKTREE} && git branch -D ${BRANCH}" >&2
  exit 1
fi

say "creating worktree ${WORKTREE}"
git worktree add "$WORKTREE" -b "$BRANCH" main
cd "$WORKTREE"

say "merging upstream/main"
if ! git merge upstream/main --no-edit; then
  CONFLICTS="$(git diff --name-only --diff-filter=U)"
  cat >&2 <<EOF

Merge stopped on conflicts. Resolve them in:
  ${WORKTREE}

Conflicting files:
$(printf '%s\n' "$CONFLICTS" | sed 's/^/  - /')

Resolution principles (see .agents/handoffs/2026-08-06-next-steps-roadmap.md):
  - Keep the fork's behavior and refactors. The fork replaced upstream's
    buildModel/buildTools/buildHarness/buildHarnessContext with
    prepareTurn/createHarnessController, and split SessionDetail.tsx into
    session-detail/ + workspace/. Port upstream's *intent* into those
    structures; do not restore the old shape.
  - Model cards are mandatory in this fork. Do not reintroduce upstream's
    ANTHROPIC_API_KEY fallback in agent validation or model resolution.
  - Never lose: events.ts eventKey dedup, ChatColumn turn React keys,
    node-session-router next_page cursor + SSE replay exemption from the
    1024-frame cap, local-subprocess path contract, main-node Dockerfile
    ENV block.
  - package.json: take the union, upstream's version numbers win.
  - pnpm-lock.yaml: never hand-resolve. Settle every package.json first,
    then \`git checkout upstream/main -- pnpm-lock.yaml && pnpm install\`.
  - Delete code a resolution orphans rather than leaving it dead.
  - When unsure, keep fork behavior and flag it.

After resolving:  git add -A && git commit --no-edit
Then re-run the gates below by hand.
EOF
  exit 1
fi

say "pnpm install"
pnpm install

say "gate: typecheck"
pnpm typecheck

say "gate: main-node tests"
pnpm --filter @open-managed-agents/main-node test

say "gate: console tests"
# The default pool does not start on macOS here; forks pool is required.
pnpm --filter managed-agents-console test -- --pool=forks

cat <<EOF

=== all gates passed — ready to land ===

The root suite (cloudflare workers pool, ~2-4 min) is not run above.
Run it before landing if the merge touched worker code:

  cd ${WORKTREE} && VITEST_MAX_THREADS=1 pnpm vitest run --pool=forks

To land the merge:

  cd ${REPO_ROOT}
  git merge --ff-only ${BRANCH}
  git push origin main
  git worktree remove ${WORKTREE}
  git branch -d ${BRANCH}
EOF

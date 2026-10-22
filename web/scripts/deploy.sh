#!/usr/bin/env bash
# Deploys the committed web/ tree (no working-tree files, no git metadata) to Vercel production.
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)"
git archive "${1:-HEAD}:web" | tar -x -C "$out"
mkdir -p "$out/.vercel" && cp .vercel/project.json "$out/.vercel/"
(cd "$out" && vercel deploy --prod --yes)
rm -rf "$out"

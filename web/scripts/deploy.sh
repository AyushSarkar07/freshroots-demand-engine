#!/usr/bin/env bash
# Deploys the committed web/ tree (no working-tree files, no git metadata) to Vercel production.
set -euo pipefail
cd "$(dirname "$0")/.."
out="$(mktemp -d)"
# Run from the repo root: inside web/, git archive would limit itself to web/web.
git -C "$(git rev-parse --show-toplevel)" archive "${1:-HEAD}:web" | tar -x -C "$out"
test -f "$out/package.json" || { echo "archive is missing package.json"; exit 1; }
mkdir -p "$out/.vercel" && cp .vercel/project.json "$out/.vercel/"
(cd "$out" && vercel deploy --prod --yes)
rm -rf "$out"

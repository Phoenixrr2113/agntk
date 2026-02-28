#!/usr/bin/env bash
# Publish all public @agntk packages to npm.
#
# In CI:     NPM_TOKEN comes from environment (secrets.NPM_TOKEN)
# Locally:   NPM_TOKEN is loaded from .env
#
# Usage:  pnpm release        (from root)
#    or:  bash scripts/release.sh
set -euo pipefail

# Load .env into environment when running locally
if [[ -z "${NPM_TOKEN:-}" ]] && [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo "Error: NPM_TOKEN not set (set in .env or environment)" >&2
  exit 1
fi

echo "Publishing with NPM_TOKEN (${NPM_TOKEN:0:10}...)"
echo ""

# Build all packages first
pnpm build

# Publish in dependency order (all public, non-private packages)
PACKAGES=(
  "@agntk/core"
  "@agntk/logger"
  "@agntk/client"
  "@agntk/server"
  "@agntk/cli"
  "agntk"
)

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "--- Publishing ${pkg} ---"
  pnpm --filter "${pkg}" publish --access public --no-git-checks || echo "  Warning: ${pkg} publish failed (may already be at this version)"
done

echo ""
echo "Done! All packages published."

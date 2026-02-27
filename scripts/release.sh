#!/usr/bin/env bash
# Publish @agntk packages to npm using the project-level NPM_TOKEN from .env
#
# Usage:  pnpm release        (from root)
#    or:  bash scripts/release.sh
set -euo pipefail

# Load .env into environment (auto-export all vars)
if [[ ! -f .env ]]; then
  echo "Error: .env file not found. Create one with NPM_TOKEN=npm_xxx" >&2
  exit 1
fi

set -a
source .env
set +a

if [[ -z "${NPM_TOKEN:-}" ]]; then
  echo "Error: NPM_TOKEN not set in .env" >&2
  exit 1
fi

echo "Publishing with project NPM_TOKEN (${NPM_TOKEN:0:10}...)"
echo ""

# Build all packages first
pnpm build

# Publish SDK first (CLI depends on it)
echo "--- Publishing @agntk/core ---"
pnpm --filter @agntk/core publish --access public --no-git-checks

echo ""
echo "--- Publishing @agntk/cli ---"
pnpm --filter @agntk/cli publish --access public --no-git-checks

echo ""
echo "Done! Both packages published."

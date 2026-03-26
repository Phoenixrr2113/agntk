#!/usr/bin/env bash
# Publish all public @agntk packages to npm and create a GitHub release.
#
# In CI:     NPM_TOKEN and GITHUB_TOKEN come from environment (GitHub secrets)
# Locally:   Both tokens are loaded from .env
#
# Usage:  pnpm release        (from root)
#    or:  bash scripts/release.sh
set -euo pipefail

# Load .env into environment when running locally
if [[ -f .env ]]; then
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
  "@agntk/search"
  "@agntk/client"
  "@agntk/server"
  "@agntk/cli"
  "agntk"
)

PUBLISHED_COUNT=0

for pkg in "${PACKAGES[@]}"; do
  echo ""
  echo "--- Publishing ${pkg} ---"
  # Read version via fs to avoid require() breaking in ESM packages ("type": "module")
  PKG_VERSION=$(pnpm --filter "${pkg}" exec node --input-type=commonjs -e \
    "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('./package.json','utf8')); process.stdout.write(p.version)")
  # Skip cleanly if already published; any other error fails loudly (set -e)
  if pnpm view "${pkg}@${PKG_VERSION}" version &>/dev/null; then
    echo "  Skipping ${pkg}@${PKG_VERSION} — already published"
  else
    pnpm --filter "${pkg}" publish --access public --no-git-checks
    PUBLISHED_COUNT=$((PUBLISHED_COUNT + 1))
  fi
done

echo ""
if [ "$PUBLISHED_COUNT" -eq 0 ]; then
  echo "No new packages published."
  exit 0
fi

echo "Published ${PUBLISHED_COUNT} package(s)."

# Create GitHub Release — skipped gracefully if gh CLI or GITHUB_TOKEN is unavailable (e.g. local runs without gh auth)
if command -v gh &>/dev/null && [[ -n "${GITHUB_TOKEN:-}" ]]; then
  VERSION=$(python3 -c "import json; print(json.load(open('packages/sdk/package.json'))['version'])")
  echo ""
  echo "--- Creating GitHub Release v${VERSION} ---"
  if gh release view "v${VERSION}" &>/dev/null; then
    echo "  GitHub Release v${VERSION} already exists, skipping"
  else
    gh release create "v${VERSION}" \
      --title "v${VERSION}" \
      --generate-notes
    echo "  GitHub Release v${VERSION} created"
  fi
else
  echo ""
  echo "Skipping GitHub Release (gh CLI not available or GITHUB_TOKEN not set)"
fi

echo ""
echo "Done!"

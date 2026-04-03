#!/bin/bash
# scripts/build.sh — Build Industream CLI for npm distribution
set -e

echo "=== Building Industream CLI ==="
mkdir -p dist

# Bundle TypeScript → ESM (external node_modules)
echo "Bundling..."
npx esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=esm \
  --outfile=dist/index.mjs \
  --packages=external \
  --alias:react-devtools-core=./src/shims/react-devtools-core.ts

echo ""
ls -lh dist/index.mjs

# Verify
echo ""
echo "Testing..."
node dist/index.mjs --help > /dev/null 2>&1 && echo "OK" || echo "FAIL"

echo ""
echo "=== Build complete ==="

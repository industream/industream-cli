#!/bin/bash
# Build the bundle after npm install so that `industream` is usable.
# Skipped when installed as a dependency of another package (INIT_CWD check),
# when dist/index.mjs already exists (published package), or when building
# the SEA is not possible (missing tooling).
set -e

# If installed as a dependency (not the package itself), skip.
# npm sets INIT_CWD to the project that triggered the install; when that
# differs from the package dir, we're a nested dep.
if [ -n "$INIT_CWD" ] && [ "$INIT_CWD" != "$PWD" ]; then
  exit 0
fi

# If dist/index.mjs is already shipped (published package), skip.
if [ -f dist/index.mjs ] && [ ! -f src/index.ts ]; then
  exit 0
fi

# Only run build if sources are present (dev / git clone).
if [ -f src/index.ts ]; then
  echo "Building Industream CLI..."
  npm run build
fi

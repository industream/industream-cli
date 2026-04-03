#!/bin/bash
# scripts/build-sea.sh — Build Node SEA binary
set -e

echo "=== Building Industream CLI ==="

mkdir -p dist

# 1. Bundle TypeScript → single ESM file
# ink/yoga use top-level await which requires ESM format in esbuild.
# react-devtools-core is dev-only — we stub it out.
echo "Bundling..."
npx esbuild src/index.ts \
  --bundle \
  --platform=node \
  --target=node22 \
  --format=esm \
  --outfile=dist/bundle.mjs \
  --define:process.env.DEV='"false"' \
  --alias:react-devtools-core=./src/shims/react-devtools-core.ts

# 2. Create CJS wrapper that loads the ESM bundle via dynamic import()
# Node SEA requires CJS entry but supports dynamic import() for ESM.
echo "Creating CJS wrapper..."
cat > dist/bundle.cjs <<'EOF'
"use strict";
const { writeFileSync, unlinkSync, existsSync } = require("fs");
const { join } = require("path");
const { tmpdir } = require("os");
const { randomBytes } = require("crypto");

// Node SEA runs as CJS. To load our ESM bundle we write it to a temp
// file and import() it, since SEA injects the blob as the main CJS script.
const bundlePath = join(tmpdir(), "industream-" + randomBytes(4).toString("hex") + ".mjs");

// The ESM bundle content is appended below this wrapper by the build script.
const BUNDLE_MARKER = "___INDUSTREAM_ESM_BUNDLE_START___";
const fs = require("fs");
const self = fs.readFileSync(__filename, "utf8");
const markerIndex = self.indexOf(BUNDLE_MARKER);
if (markerIndex === -1) {
  console.error("Bundle marker not found — corrupted binary?");
  process.exit(1);
}
const esmCode = self.slice(markerIndex + BUNDLE_MARKER.length + 1);
writeFileSync(bundlePath, esmCode);

import(bundlePath)
  .finally(() => {
    try { unlinkSync(bundlePath); } catch {}
  })
  .catch(e => {
    console.error(e);
    process.exit(1);
  });
EOF

# Append the ESM bundle after the marker
echo "___INDUSTREAM_ESM_BUNDLE_START___" >> dist/bundle.cjs
cat dist/bundle.mjs >> dist/bundle.cjs

echo ""
ls -lh dist/bundle.mjs dist/bundle.cjs
echo "=== Bundle complete ==="

# 3. SEA generation (requires Node 22+ with postject)
echo ""
echo "Generating SEA blob..."
if node --experimental-sea-config sea-config.json 2>&1; then
  echo "SEA blob generated."

  echo "Creating binary..."
  cp "$(which node)" dist/industream

  echo "Injecting SEA blob..."
  if npx postject dist/industream NODE_SEA_BLOB dist/sea-prep.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 2>&1; then
    chmod +x dist/industream
    echo ""
    ls -lh dist/industream
    echo "=== SEA build complete ==="
  else
    echo ""
    echo "postject injection failed. Install postject: npm install -g postject"
    echo "The bundle at dist/bundle.cjs is ready for manual SEA packaging."
  fi
else
  echo ""
  echo "SEA blob generation failed (requires Node 22+ with SEA support)."
  echo "The bundle at dist/bundle.mjs can be run directly: node dist/bundle.mjs"
fi

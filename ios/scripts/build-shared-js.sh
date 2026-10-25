#!/bin/sh
# Bundles the shared TypeScript (DSL, Mermaid, layout, diff, embeds) and marked into one
# self-contained script for JavaScriptCore. Re-run after changing packages/shared.
set -e
cd "$(dirname "$0")/../.."
npx esbuild ios/scripts/shared-bridge.ts --bundle --format=iife --platform=neutral --target=es2020 \
  --main-fields=module,main --minify --legal-comments=none --outfile=ios/Clara/Resources/clara-shared.js
echo "wrote ios/Clara/Resources/clara-shared.js"

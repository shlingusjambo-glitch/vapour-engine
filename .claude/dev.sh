#!/usr/bin/env bash
# Launches a workspace dev server with the toolchain on PATH.
set -euo pipefail
NODE_BIN="/home/elywright/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
export PATH="$NODE_BIN:$PATH"
exec "$NODE_BIN/node" \
  "/home/elywright/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pnpm/bin/pnpm.cjs" \
  --filter "$1" dev --port "$2" --strictPort

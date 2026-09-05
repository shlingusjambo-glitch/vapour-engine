#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="$repo_root/packages/engine/wasm"

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "wasm-bindgen CLI is required. Install the version matching Cargo.lock." >&2
  exit 1
fi

cargo build --manifest-path "$repo_root/Cargo.toml" -p vapour-wasm --target wasm32-unknown-unknown --release
mkdir -p "$output_dir"
wasm-bindgen "$repo_root/target/wasm32-unknown-unknown/release/vapour_wasm.wasm" \
  --target web \
  --out-dir "$output_dir" \
  --out-name vapour_runtime \
  --typescript

if command -v wasm-opt >/dev/null 2>&1; then
  wasm-opt -Oz --enable-simd "$output_dir/vapour_runtime_bg.wasm" -o "$output_dir/vapour_runtime_bg.optimized.wasm"
  mv "$output_dir/vapour_runtime_bg.optimized.wasm" "$output_dir/vapour_runtime_bg.wasm"
fi

echo "Built Vapour WebAssembly package in $output_dir"

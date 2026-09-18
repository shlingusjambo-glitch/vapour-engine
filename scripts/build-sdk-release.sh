#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="${VAPOUR_RELEASE_VERSION:-0.2.0-alpha}"
release_parent="$repo_root/release"
release_root="$release_parent/vapour-engine-$version"
staging="$release_parent/.vapour-engine-$version.staging"

rm -rf "$staging"
mkdir -p "$staging/cli" "$staging/editor" "$staging/runtime" "$staging/sdk/engine" "$staging/sdk/engine-src" "$staging/sdk/math-src" "$staging/sdk/gameplay-src" "$staging/examples"

cd "$repo_root"
pnpm build
pnpm --filter @vapour/cli exec esbuild src/index.ts --bundle --platform=node --format=esm --target=node22 \
  '--banner:js=import { createRequire } from "node:module"; import { fileURLToPath as __vapourFileURLToPath } from "node:url"; import { dirname as __vapourDirname } from "node:path"; const require = createRequire(import.meta.url); const __filename = __vapourFileURLToPath(import.meta.url); const __dirname = __vapourDirname(__filename);' \
  --outfile="$staging/cli/vapour.mjs"

esbuild_version="$(node -p "require('$repo_root/packages/cli/node_modules/esbuild/package.json').version")"
# The SDK bundles a native esbuild binary for whatever platform builds it —
# there is no cross-compiling here, only picking the right @esbuild/<platform>
# package already on disk for the host running this script.
case "$(uname -s)-$(uname -m)" in
  Linux-x86_64) esbuild_platform=linux-x64 ;;
  Linux-aarch64) esbuild_platform=linux-arm64 ;;
  Darwin-x86_64) esbuild_platform=darwin-x64 ;;
  Darwin-arm64) esbuild_platform=darwin-arm64 ;;
  *)
    echo "Unsupported host platform for the SDK build: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac
esbuild_binary="$(find "$repo_root/node_modules/.pnpm" -path "*/@esbuild+$esbuild_platform@$esbuild_version/node_modules/@esbuild/$esbuild_platform/bin/esbuild" -type f -print -quit)"
if [[ -z "$esbuild_binary" ]]; then
  echo "Could not locate the installed $esbuild_platform esbuild binary (version $esbuild_version)." >&2
  exit 1
fi
cp "$esbuild_binary" "$staging/cli/esbuild"
cp "$(command -v node)" "$staging/cli/node"
cp "$repo_root/packages/cli/node_modules/typescript/lib/"lib*.d.ts "$staging/cli/"
cp "$repo_root/sdk-assets/editor-server.mjs" "$staging/cli/editor-server.mjs"
cp -R "$repo_root/packages/editor/dist/." "$staging/editor/"
cp -R "$repo_root/packages/engine/wasm/." "$staging/runtime/"
cp -R "$repo_root/packages/engine/dist/." "$staging/sdk/engine/"
cp -R "$repo_root/packages/engine/src/." "$staging/sdk/engine-src/"
# @vapour/engine imports @vapour/math and @vapour/gameplay as bare specifiers;
# the CLI aliases both to these sources exactly as it does the engine's, so a
# standalone SDK (no node_modules next to engine-src) still resolves them.
cp -R "$repo_root/packages/math/src/." "$staging/sdk/math-src/"
cp -R "$repo_root/packages/gameplay/src/." "$staging/sdk/gameplay-src/"
cp "$repo_root/packages/engine/node_modules/@webgpu/types/dist/index.d.ts" "$staging/sdk/webgpu-types.d.ts"
cp -R "$repo_root/docs" "$staging/docs"
cp -R "$repo_root/templates" "$staging/templates"
cp -R "$repo_root/examples/cubegame-port" "$staging/examples/cubegame-port"
cp -R "$repo_root/examples/narrative-real" "$staging/examples/narrative-real"
cp -R "$repo_root/examples/alpha-0.2-acceptance" "$staging/examples/alpha-0.2-acceptance"
# Ship source and ready-to-host example builds, but never repository-local
# dependencies or incremental build caches. Those make the SDK machine-specific
# and can contain stale outputs that are unrelated to the release.
find "$staging/examples" -type d \( -name node_modules -o -name .vapour \) -prune -exec rm -rf {} +
cp "$repo_root/sdk-assets/README.md" "$staging/README.md"
cp "$repo_root/sdk-assets/AGENTS.md" "$staging/AGENTS.md"
cp "$repo_root/sdk-assets/vapour" "$staging/vapour"
cp "$repo_root/sdk-assets/vapour-editor" "$staging/vapour-editor"
cp "$repo_root/COPYING" "$repo_root/COPYING.LESSER" "$repo_root/LICENSING.md" "$staging/"
cp "$repo_root/package.json" "$repo_root/pnpm-lock.yaml" "$staging/"
cp "$staging/runtime/vapour_runtime.js" "$staging/editor/vapour_runtime.js"
cp "$staging/runtime/vapour_runtime_bg.wasm" "$staging/editor/vapour_runtime_bg.wasm"
printf '%s\n' "$version" > "$staging/VERSION"
chmod +x "$staging/vapour" "$staging/vapour-editor" "$staging/cli/esbuild" "$staging/cli/node"

if command -v sha256sum >/dev/null 2>&1; then
  hash_cmd=(sha256sum)
else
  # macOS ships shasum, not sha256sum; -a 256 matches the same algorithm.
  hash_cmd=(shasum -a 256)
fi
(cd "$staging" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 "${hash_cmd[@]}" > SHA256SUMS)
rm -rf "$release_root"
mv "$staging" "$release_root"
echo "Built standalone Vapour Engine SDK: $release_root"

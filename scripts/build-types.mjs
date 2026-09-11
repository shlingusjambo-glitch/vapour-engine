// Project references need emitted declarations even for --noEmit consumers.
// Build library references before checking/testing a fresh checkout.
import { spawnSync } from 'node:child_process';
const result = spawnSync('pnpm', ['exec', 'tsc', '-b',
  'packages/math', 'packages/gameplay', 'packages/assetgen',
  'packages/net', 'packages/engine', 'packages/three-bridge'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);

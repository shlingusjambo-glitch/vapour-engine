import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] || 'doctor';
const buildRoot = path.join(root, 'build');
const distRoot = path.join(root, 'dist');
const xcodeDeveloperDir = existsSync('/Applications/Xcode-beta.app/Contents/Developer')
  ? '/Applications/Xcode-beta.app/Contents/Developer'
  : '/Applications/Xcode.app/Contents/Developer';

const publicNpmRegistry = process.env.CUBEGAME_NPM_REGISTRY || 'https://registry.npmjs.org/';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const electronBuilderBin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
const electronCacheDir = process.env.electron_config_cache || path.join(root, '.electron-cache');
const installTimeoutMs = Number(process.env.CUBEGAME_NPM_INSTALL_TIMEOUT_MS || 600000);

// Use a project-local npm cache for all electron installs so that poisoned entries
// in the global cache (e.g. packages whose resolved URLs point to a private or
// unreachable registry from a previous machine/environment) cannot cause ETIMEDOUT
// failures.  The folder is gitignored alongside .electron-cache.
const electronNpmCacheDir = path.join(root, '.npm-electron-cache');

function buildNpmEnv(extra = {}) {
  return {
    ...process.env,
    npm_config_registry: publicNpmRegistry,
    NPM_CONFIG_REGISTRY: publicNpmRegistry,
    npm_config_cache: electronNpmCacheDir,
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_progress: 'false',
    npm_config_loglevel: process.env.npm_config_loglevel || 'notice',
    npm_config_fetch_retries: process.env.npm_config_fetch_retries || '5',
    npm_config_fetch_retry_mintimeout: process.env.npm_config_fetch_retry_mintimeout || '10000',
    npm_config_fetch_retry_maxtimeout: process.env.npm_config_fetch_retry_maxtimeout || '120000',
    electron_config_cache: electronCacheDir,
    ELECTRON_CACHE: electronCacheDir,
    ELECTRON_MIRROR: process.env.CUBEGAME_ELECTRON_MIRROR || process.env.ELECTRON_MIRROR || '',
    // Skip downloading the Electron dev binary during `npm install`.
    // electron-builder fetches its own binary at build time; the
    // node_modules/electron binary is only used for `electron .` dev mode.
    // This avoids repeated failures when GitHub's CDN is slow or the
    // cached zip is corrupt from a Ctrl+C mid-download.
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
    ...extra,
  };
}

function hasCommand(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function run(command, options = {}) {
  execSync(command, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...options.env },
  });
}

function copyDirectory(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  cpSync(from, to, { recursive: true, force: true });
}

function ensureWebBuild() {
  if (!existsSync(path.join(distRoot, 'index.html'))) {
    buildWeb();
  }
}

function ensureFreshWebBuild() {
  if (process.env.CUBEGAME_SKIP_WEB_BUILD === '1' && existsSync(path.join(distRoot, 'index.html'))) {
    console.log('Using existing dist because CUBEGAME_SKIP_WEB_BUILD=1.');
    return;
  }
  console.log('Rebuilding the web bundle so make targets never package stale login/auth code.');
  buildWeb();
}

function doctor() {
  console.log('CubeGame platform doctor');
  console.log(`web source: ${existsSync(path.join(root, 'src/main.ts')) ? 'ok' : 'missing src/main.ts'}`);
  console.log(`server source: ${existsSync(path.join(root, 'server/server.ts')) ? 'ok' : 'missing server/server.ts'}`);
  console.log(`web build: ${existsSync(path.join(distRoot, 'index.html')) ? 'ok' : 'run npm run build:web'}`);
  console.log(`macOS compiler: ${hasCommand('clang++') ? 'ok' : 'missing clang++'}`);
  console.log(`Linux compiler: ${hasCommand('g++') ? 'ok' : 'missing g++'}`);
  console.log(`Windows cross-compiler: ${hasCommand('x86_64-w64-mingw32-g++') ? 'ok' : 'optional/missing'}`);
  console.log(`Xcode: ${existsSync(path.join(xcodeDeveloperDir, 'usr/bin/xcodebuild')) ? xcodeDeveloperDir : 'missing'}`);
  console.log(`iOS project: ${existsSync(path.join(root, 'native/ios/CubeGame.xcodeproj/project.pbxproj')) ? 'ok' : 'missing'}`);
  console.log(`npm registry for auto-install: ${publicNpmRegistry}`);
  console.log(`Electron builder: ${existsSync(electronBuilderBin) ? 'ok' : 'missing - run npm install or let make mac install it'}`);
}

function buildWeb() {
  run('npm run build:web');
}

function writeRuntimeManifest(platformDir, platform) {
  const payload = {
    platform,
    runtime: 'typescript-web',
    rendererPreference: 'webgpu',
    rendererFallback: 'webgl',
    modLoader: {
      serverManifest: 'resources/api/mods/manifest when hosted by server',
      localFolder: 'mods',
      bundledFolder: 'resources/mods',
    },
  };
  writeFileSync(path.join(platformDir, 'platform-runtime.json'), JSON.stringify(payload, null, 2));
}

function ensureModFolders(platformDir) {
  const topLevelMods = path.join(platformDir, 'mods');
  const resourceMods = path.join(platformDir, 'resources', 'mods');
  mkdirSync(topLevelMods, { recursive: true });
  mkdirSync(resourceMods, { recursive: true });

  const readme = [
    '# CubeGame platform mods',
    '',
    'Drop compiled JS mods here for app-local testing.',
    'Multiplayer servers publish /api/mods/manifest and clients sync required mods before joining.',
    'Use index.js or mod.js as the entry file inside each mod folder.',
    ''
  ].join('\n');

  writeFileSync(path.join(topLevelMods, 'README.md'), readme);
  writeFileSync(path.join(topLevelMods, 'manifest.json'), JSON.stringify({ version: 1, generatedAt: 0, mods: [] }, null, 2));
  if (!existsSync(path.join(resourceMods, 'README.md'))) {
    writeFileSync(path.join(resourceMods, 'README.md'), readme);
  }
  if (!existsSync(path.join(resourceMods, 'manifest.json'))) {
    writeFileSync(path.join(resourceMods, 'manifest.json'), JSON.stringify({ version: 1, generatedAt: 0, mods: [] }, null, 2));
  }
}

function packagePlatform(platform) {
  ensureFreshWebBuild();

  const platformDir = path.join(buildRoot, platform);
  rmSync(platformDir, { recursive: true, force: true });
  mkdirSync(platformDir, { recursive: true });

  copyDirectory(distRoot, path.join(platformDir, 'resources'));
  ensureModFolders(platformDir);
  writeRuntimeManifest(platformDir, platform);

  const nativeDir = path.join(platformDir, 'native');
  mkdirSync(nativeDir, { recursive: true });

  if (platform === 'mac') {
    cpSync(path.join(root, 'native/src/main.mm'), path.join(nativeDir, 'main.mm'), { force: true });
  } else if (platform === 'linux') {
    cpSync(path.join(root, 'native/src/main_linux.cpp'), path.join(nativeDir, 'main_linux.cpp'), { force: true });
  } else if (platform === 'windows') {
    cpSync(path.join(root, 'native/src/main_windows.cpp'), path.join(nativeDir, 'main_windows.cpp'), { force: true });
  }

  return platformDir;
}

function packageSpec(name, fallback) {
  const version = packageJson.devDependencies?.[name] || packageJson.dependencies?.[name] || fallback;
  return `${name}@${version}`;
}

function electronInstallLooksHealthy() {
  if (!existsSync(electronBuilderBin)) return false;
  // Only verify the package.json files exist for both packages.
  // We intentionally do NOT require the Electron dev binary
  // (node_modules/electron/dist/Electron.app / path.txt) because:
  //   • `make mac/linux/windows` runs electron-builder, which downloads
  //     its own copy of the Electron binary independently.
  //   • The dev binary is only needed for `electron .` (local dev mode).
  //   • Requiring it here caused repeated install loops whenever
  //     GitHub's binary CDN was slow or the cached zip was corrupt.
  const electronPkgJson = path.join(root, 'node_modules', 'electron', 'package.json');
  const builderPkgJson = path.join(root, 'node_modules', 'electron-builder', 'package.json');
  return existsSync(electronPkgJson) && existsSync(builderPkgJson);
}

function removeInterruptedElectronInstall() {
  const electronPackageDir = path.join(root, 'node_modules', 'electron');
  const builderPackageDir = path.join(root, 'node_modules', 'electron-builder');
  if (existsSync(electronPackageDir) && !electronInstallLooksHealthy()) {
    console.log('Found an interrupted Electron install; cleaning it before retrying.');
    rmSync(electronPackageDir, { recursive: true, force: true });
    // We no longer clear the electron binary cache here.  With
    // ELECTRON_SKIP_BINARY_DOWNLOAD=1 the binary is never downloaded during
    // `npm install`, so there is nothing corrupt to clear.  If a developer
    // later needs the dev binary they can delete .electron-cache manually.
    // Keep electron-builder when possible, but remove it if the bin shim is missing.
    if (!existsSync(electronBuilderBin)) rmSync(builderPackageDir, { recursive: true, force: true });
  }
}

function installElectronPackages(label, extraEnv = {}) {
  const electronSpec = packageSpec('electron', '^31.7.7');
  const builderSpec = packageSpec('electron-builder', '^24.13.3');
  console.log(label);
  console.log(`Using npm registry: ${publicNpmRegistry}`);
  const mirror = extraEnv.ELECTRON_MIRROR || process.env.CUBEGAME_ELECTRON_MIRROR || process.env.ELECTRON_MIRROR;
  if (mirror) console.log(`Using Electron binary mirror: ${mirror}`);
  console.log(`Electron cache: ${electronCacheDir}`);

  execFileSync(npmCommand, [
    'install',
    '--save-dev',
    electronSpec,
    builderSpec,
    '--registry',
    publicNpmRegistry,
    '--no-audit',
    '--fund=false',
    '--foreground-scripts',
    '--loglevel=verbose',
    '--progress=false',
    '--no-package-lock',
  ], {
    cwd: root,
    stdio: 'inherit',
    timeout: installTimeoutMs,
    env: buildNpmEnv(extraEnv),
  });
}

function ensureElectronDependencies() {
  if (electronInstallLooksHealthy()) return;

  removeInterruptedElectronInstall();
  console.log('Electron desktop dependencies are missing or incomplete. Installing only Electron packages instead of rerunning a full project install.');

  try {
    installElectronPackages('Downloading Electron and electron-builder. The visible verbose log prevents npm from looking frozen.');
  } catch (firstErr) {
    const userMirror = process.env.CUBEGAME_ELECTRON_MIRROR || process.env.ELECTRON_MIRROR;
    if (!userMirror) {
      try {
        removeInterruptedElectronInstall();
        installElectronPackages('Default Electron download failed or timed out; retrying once with the documented Electron mirror fallback.', {
          ELECTRON_MIRROR: 'https://npmmirror.com/mirrors/electron/',
        });
      } catch (mirrorErr) {
        printElectronInstallHelp();
        throw mirrorErr;
      }
    } else {
      printElectronInstallHelp();
      throw firstErr;
    }
  }

  if (!electronInstallLooksHealthy()) {
    printElectronInstallHelp();
    throw new Error('Electron installed, but the Electron runtime binary is still missing or unusable.');
  }
}

function printElectronInstallHelp() {
  const electronSpec = packageSpec('electron', '^31.7.7');
  const builderSpec = packageSpec('electron-builder', '^24.13.3');
  console.error('\nCubeGame could not finish installing the Electron/Chromium desktop runtime.');
  console.error('This usually means the Electron binary download from GitHub was blocked, interrupted, or extremely slow.');
  console.error('Try these from the CubeGame folder:');
  console.error(`  rm -rf node_modules/electron .electron-cache .npm-electron-cache`);
  console.error(`  npm install --save-dev ${electronSpec} ${builderSpec} --registry=${publicNpmRegistry} --no-audit --fund=false --foreground-scripts --loglevel=verbose --progress=false --no-package-lock`);
  console.error('If GitHub downloads are blocked on your network, retry with:');
  console.error('  CUBEGAME_ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ make mac');
}

function describeElectronOutput(platformDir, platform) {
  const entries = existsSync(platformDir) ? readdirSync(platformDir, { withFileTypes: true }).map(e => e.name) : [];
  const likely = entries.find(name =>
    name.endsWith('.app') ||
    name.endsWith('.exe') ||
    name.endsWith('.AppImage') ||
    name.toLowerCase().includes('unpacked') ||
    name === 'CubeGame'
  );
  const target = likely ? path.join(platformDir, likely) : platformDir;
  console.log(`${platform} Electron/Chromium package built at ${target}`);
  console.log('This package bundles Chromium through Electron; it does not use WebKitGTK, WebView2, system Chrome, system Firefox, or the old native WebKit host.');
}

function runElectronBuilder(platform) {
  ensureElectronDependencies();
  ensureFreshWebBuild();

  const platformDir = path.join(buildRoot, platform);
  rmSync(platformDir, { recursive: true, force: true });
  mkdirSync(platformDir, { recursive: true });

  const flag = platform === 'mac' ? '--mac' : platform === 'windows' ? '--win' : '--linux';
  const arch = platform === 'mac' ? '' : ' --x64';
  // --dir produces an unpacked app quickly and avoids NSIS/AppImage signing/toolchain friction.
  // It still downloads and embeds Electron's Chromium runtime for the requested platform.
  execFileSync(electronBuilderBin, ['--dir', flag, ...(arch ? [arch.trim()] : []), `--config.directories.output=${path.relative(root, platformDir)}`], {
    cwd: root,
    stdio: 'inherit',
    env: buildNpmEnv(),
  });
  describeElectronOutput(platformDir, platform);
}

function buildMac() {
  runElectronBuilder('mac');
}

function buildLinux() {
  runElectronBuilder('linux');
}

function buildWindows() {
  runElectronBuilder('windows');
}

function buildDesktop() {
  buildMac();
  buildLinux();
  buildWindows();
}


function assertIosSceneLifecycle(projectDir) {
  const appDelegatePath = path.join(projectDir, 'CubeGame', 'AppDelegate.mm');
  const sceneDelegatePath = path.join(projectDir, 'CubeGame', 'SceneDelegate.mm');
  const infoPlistPath = path.join(projectDir, 'CubeGame', 'Info.plist');
  const pbxprojPath = path.join(projectDir, 'CubeGame.xcodeproj', 'project.pbxproj');
  const appDelegate = readFileSync(appDelegatePath, 'utf8');
  const infoPlist = readFileSync(infoPlistPath, 'utf8');
  const pbxproj = readFileSync(pbxprojPath, 'utf8');

  const missing = [];
  if (!existsSync(sceneDelegatePath)) missing.push('CubeGame/SceneDelegate.mm');
  if (!appDelegate.includes('configurationForConnectingSceneSession')) missing.push('AppDelegate UIScene configurationForConnectingSceneSession');
  if (appDelegate.includes('@property (strong, nonatomic) UIWindow *window')) missing.push('legacy AppDelegate.window removal');
  if (!infoPlist.includes('UIApplicationSceneManifest')) missing.push('Info.plist UIApplicationSceneManifest');
  if (!infoPlist.includes('UISceneDelegateClassName')) missing.push('Info.plist UISceneDelegateClassName');
  if (!pbxproj.includes('SceneDelegate.mm in Sources')) missing.push('SceneDelegate.mm target membership');

  if (missing.length > 0) {
    throw new Error(`iOS project is missing required UIScene lifecycle pieces: ${missing.join(', ')}`);
  }
}

function buildIos() {
  ensureFreshWebBuild();

  // The checked-in iOS project is the template. `make ios` now produces a
  // ready-to-open build/ios/CubeGame.xcodeproj and copies the current Vite
  // bundle beside it, so the user never has to manually wire WebKit resources.
  const iosTemplateDir = path.join(root, 'native', 'ios');
  const iosDist = path.join(iosTemplateDir, 'dist');
  rmSync(iosDist, { recursive: true, force: true });
  copyDirectory(distRoot, iosDist);

  const platformDir = path.join(buildRoot, 'ios');
  rmSync(platformDir, { recursive: true, force: true });
  mkdirSync(platformDir, { recursive: true });

  assertIosSceneLifecycle(iosTemplateDir);
  copyDirectory(iosTemplateDir, platformDir);
  rmSync(path.join(platformDir, 'dist'), { recursive: true, force: true });
  copyDirectory(distRoot, path.join(platformDir, 'dist'));
  ensureModFolders(path.join(platformDir, 'AppResources'));
  writeRuntimeManifest(platformDir, 'ios');
  assertIosSceneLifecycle(platformDir);

  const readme = [
    '# CubeGame iOS WebKit Wrapper',
    '',
    'Open CubeGame.xcodeproj in Xcode, select an iPhone/iPad target, then Run.',
    'The app is a full-screen WKWebView that loads the bundled dist/ web build.',
    'Mobile controls are enabled only for iOS/touch devices through window.CubeGameNative.platform = "ios".',
    '',
    'Generated by: make ios',
    ''
  ].join('\n');
  writeFileSync(path.join(platformDir, 'README.md'), readme);

  const xcodeProjectPath = path.join(platformDir, 'CubeGame.xcodeproj');
  console.log(`iOS Xcode project generated at ${xcodeProjectPath}`);
  console.log('Open build/ios/CubeGame.xcodeproj in Xcode. The app wraps CubeGame in a full-screen WKWebView.');

  if (process.env.CUBEGAME_IOS_BUILD === '1') {
    const xcodebuild = path.join(xcodeDeveloperDir, 'usr/bin/xcodebuild');
    if (!existsSync(xcodebuild)) {
      console.log('xcodebuild not found. Project generation still succeeded.');
      return;
    }
    run(`${xcodebuild} -project build/ios/CubeGame.xcodeproj -scheme CubeGame -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build`, {
      env: { DEVELOPER_DIR: xcodeDeveloperDir },
    });
  }
}

try {
  if (target === 'doctor') doctor();
  else if (target === 'web') buildWeb();
  else if (target === 'desktop') buildDesktop();
  else if (target === 'mac') buildMac();
  else if (target === 'linux') buildLinux();
  else if (target === 'windows') buildWindows();
  else if (target === 'ios') buildIos();
  else if (target === 'all') {
    buildWeb();
    buildDesktop();
    buildIos();
  } else {
    throw new Error(`Unknown platform target: ${target}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}

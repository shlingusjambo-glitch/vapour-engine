import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { RoomManager, RoomMeta } from './RoomManager';
import { WorldRelay } from './WorldRelay';
import { CROWNFORGE_LOBBY_ROOM, MINIGAME_DEFINITIONS } from '../src/crownforge/CrownForgeCatalog';
import { AuthManager } from './AuthManager';

import fs from 'fs';
import os from 'os';
import ts from 'typescript';
import crypto from 'crypto';

const app = express();
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.CUBEGAME_TRUST_PROXY === '1' || IS_PRODUCTION;
const CORS_ORIGINS = String(process.env.CUBEGAME_CORS_ORIGINS || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const ENABLE_PUBLIC_TUNNEL = process.env.CUBEGAME_ENABLE_PUBLIC_TUNNEL === '1' || (!IS_PRODUCTION && process.env.DISABLE_PUBLIC_TUNNEL !== '1');

if (TRUST_PROXY) {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');

const logBuckets = new Map<string, { count: number; windowStart: number }>();
function serverLog(scope: string, message: string, meta?: Record<string, unknown>): void {
  const now = Date.now();
  const key = `${scope}:${message}`;
  const bucket = logBuckets.get(key) || { count: 0, windowStart: now };
  if (now - bucket.windowStart > 10_000) {
    if (bucket.count > 20) {
      console.log(`[${new Date(bucket.windowStart).toISOString()}] [${scope}] suppressed ${bucket.count - 20} repeated log line(s): ${message}`);
    }
    bucket.count = 0;
    bucket.windowStart = now;
  }
  bucket.count++;
  logBuckets.set(key, bucket);
  if (bucket.count > 20) return;
  const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`[${new Date().toISOString()}] [${scope}] ${message}${suffix}`);
}
const server = http.createServer(app);
const wss = new WebSocketServer({
  server,
  // Keep iOS/WKWebView joins boring and compatible. Some mobile WebSocket
  // stacks/tunnels are sensitive to permessage-deflate negotiation; the game
  // packets are already compact, so compression is not worth handshake risk.
  perMessageDeflate: false,
  maxPayload: 2 * 1024 * 1024,
});

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  if (CORS_ORIGINS.length === 0) return !IS_PRODUCTION;
  return CORS_ORIGINS.includes(origin);
}

function applySecurityHeaders(req: express.Request, res: express.Response): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(self), geolocation=(), payment=()');

  if (req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https') {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
}

// Enable CORS for API routes. Production deployments should set
// CUBEGAME_CORS_ORIGINS=https://play.example.com instead of accepting every origin.
app.use((req, res, next) => {
  applySecurityHeaders(req, res);
  const origin = req.headers.origin;
  if (origin && isAllowedCorsOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,authorization,x-admin-secret,bypass-tunnel-reminder,x-cubegame-client');
  if (req.method === 'OPTIONS') {
    if (!isAllowedCorsOrigin(origin)) {
      res.sendStatus(403);
      return;
    }
    res.sendStatus(204);
    return;
  }
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - start;
    const noisySuccess = res.statusCode < 400 && (req.path.startsWith('/api/mods') || req.path === '/api/health');
    if (!noisySuccess && (req.path.startsWith('/api/') || req.path.startsWith('/mods/') || res.statusCode >= 400 || elapsed > 1000)) {
      serverLog('HTTP', `${req.method} ${req.originalUrl} -> ${res.statusCode} ${elapsed}ms`, { ip: req.ip });
    }
  });
  next();
});

app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    uptimeSec: Math.round(process.uptime()),
    rooms: roomManager?.rooms?.size ?? 0,
    clients: wss.clients.size,
    memory: process.memoryUsage(),
  });
});

// Desktop builds can sit behind LocalTunnel/loca.lt. The client sends
// Bypass-Tunnel-Reminder so API/auth requests receive JSON instead of
// LocalTunnel's human browser reminder page.

interface StoredSkin {
  username: string;
  uuid?: string;   // UUID of the player who saved this skin (preferred key)
  fileName: string;
  dataUrl: string;
  updatedAt: number;
}

const dataDir = path.join(__dirname, '../server_data');
const skinsPath = path.join(dataDir, 'skins.json');
const skinsUuidPath = path.join(dataDir, 'skins_by_uuid.json');
const buildPath = path.join(__dirname, '../dist');
const indexPath = path.join(buildPath, 'index.html');
const sourceModsDir = path.join(__dirname, '../mods');
const builtClientModsDir = path.join(buildPath, 'mods');
const modRoots = [builtClientModsDir, sourceModsDir];
const PORT = parseInt(process.env.PORT || '8080', 10);
const BIND_ADDR = process.env.BIND_ADDR || '0.0.0.0';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '';
const MAX_STORED_SKINS = Number(process.env.CUBEGAME_MAX_STORED_SKINS || '128');
const MAX_SKIN_DATA_URL_BYTES = Number(process.env.CUBEGAME_MAX_SKIN_BYTES || String(256 * 1024));
const TELEPORT_GRACE_MS = Number(process.env.CUBEGAME_TELEPORT_GRACE_MS || '1750');
// Multiplayer sockets should not die just because an old desktop login token is stale.
// Accounts protect account features; public server play remains guest-friendly unless explicitly locked.
const REQUIRE_WEBSOCKET_AUTH = process.env.CUBEGAME_REQUIRE_AUTH === '1';
const publicShare = {
  url: null as string | null,
  status: 'starting',
  error: null as string | null
};

interface FeaturedServerConfig {
  id: string;
  displayName: string;
  roomId: string;
  description: string;
  kind: RoomMeta['kind'];
  dimension: string;
  pvp: boolean;
  gameModes: string[];
  motd: string;
  color: string;
  maxPlayers?: number;
}

const FEATURED_SERVERS: FeaturedServerConfig[] = [
  {
    id: 'ashfall_anarchy',
    displayName: 'Ashfall Anarchy',
    roomId: 'ashfall_anarchy_survival',
    description: 'One permanent anything-goes survival world. It is created when the Node server boots and it is not unloaded when empty.',
    kind: 'anarchy',
    dimension: 'survival_247',
    pvp: true,
    gameModes: ['Anarchy Survival', 'PvP', 'Shared Weather', 'Shared Mobs', 'Fallen Empire World'],
    motd: 'No claims. No resets. Bring food, armor, and friends.',
    color: '#d95032',
    maxPlayers: 64,
  },
  {
    id: 'crownforge_network',
    displayName: 'CrownForge Network',
    roomId: 'crownforge_lobby',
    description: 'Minigame hub with SkyWars, BedWars, Void Duels, Castle Siege, Survival Games, and modded tactical arenas.',
    kind: 'minigame_lobby',
    dimension: 'lobby',
    pvp: false,
    gameModes: ['SkyWars', 'BedWars', 'Void Duels', 'Castle Siege', 'Survival Games', 'Counter-Block Offensive', 'Fortress Arena'],
    motd: 'Use /skywars, /bedwars, /duels, /castle, /sg, /csgo, or /tf2 after joining.',
    color: '#55b8ff',
    maxPlayers: 96,
  }
];

const MATCH_ROOM_TEMPLATES: Array<{ id: string; meta: Partial<RoomMeta> }> = [
  {
    id: 'crownforge_skywars',
    meta: {
      displayName: 'CrownForge SkyWars',
      description: 'Floating islands, chest rushes, bridging, void kills, and fast PvP rounds.',
      kind: 'minigame_match',
      dimension: 'skywars',
      pvp: true,
      serverId: 'crownforge_network',
      gameModes: ['SkyWars'],
      motd: 'Loot the island chest, bridge to mid, and be the last player standing.',
      color: '#69d6ff',
      maxPlayers: 16,
      minigameId: 'skywars',
      matchPhase: 'PREGAME',
      minPlayers: Number(process.env.CROWNFORGE_MIN_PLAYERS || '1'),
    }
  },
  {
    id: 'crownforge_bedwars',
    meta: {
      displayName: 'CrownForge BedWars',
      description: 'Four team islands, beds, bridges, generators, and center resources.',
      kind: 'minigame_match',
      dimension: 'bedwars',
      pvp: true,
      serverId: 'crownforge_network',
      gameModes: ['BedWars'],
      motd: 'Protect your bed, collect resources, bridge, and break enemy beds.',
      color: '#ff5a72',
      maxPlayers: 16,
      minigameId: 'bedwars',
      matchPhase: 'PREGAME',
      minPlayers: Number(process.env.CROWNFORGE_MIN_PLAYERS || '1'),
    }
  },
  {
    id: 'crownforge_duels',
    meta: {
      displayName: 'CrownForge Void Duels',
      description: 'Small floating duel arena for quick 1v1 and 2v2 fights.',
      kind: 'minigame_match',
      dimension: 'void_duels',
      pvp: true,
      serverId: 'crownforge_network',
      gameModes: ['Void Duels'],
      motd: 'Fast arena fights. Knock them into the void.',
      color: '#b58cff',
      maxPlayers: 8,
      minigameId: 'duels',
      matchPhase: 'PREGAME',
      minPlayers: Number(process.env.CROWNFORGE_MIN_PLAYERS || '1'),
    }
  },
  {
    id: 'crownforge_castle_siege',
    meta: {
      displayName: 'CrownForge Castle Siege',
      description: 'Two ruined castles, a center bridge, walls, towers, and medieval PvP.',
      kind: 'minigame_match',
      dimension: 'castle_siege',
      pvp: true,
      serverId: 'crownforge_network',
      gameModes: ['Castle Siege'],
      motd: 'Storm the walls, hold the gate, and control the bridge.',
      color: '#ffd166',
      maxPlayers: 24,
      minigameId: 'castle',
      matchPhase: 'PREGAME',
      minPlayers: Number(process.env.CROWNFORGE_MIN_PLAYERS || '1'),
    }
  },
  {
    id: 'crownforge_csgo',
    meta: {
      displayName: 'Counter-Block Offensive',
      description: 'CS2-style Premier tactical PvP with map veto, warmup, MR12 economy rounds, bombsites, smokes, and mid control.',
      kind: 'minigame_match',
      dimension: 'cbgo_menu',
      pvp: true,
      serverId: 'crownforge_network',
      gameModes: ['Counter-Block Offensive', 'Premier', 'MR12', 'Bomb Defusal'],
      motd: 'Veto the map, read the stakes, counter-strafe, and fight for A or B site.',
      color: '#f0b84f',
      maxPlayers: 16,
      minigameId: 'csgo',
      matchPhase: 'PREGAME',
      minPlayers: Number(process.env.CROWNFORGE_MIN_PLAYERS || '1'),
      spawn: { x: 0, y: 65, z: 0 },
      pregameSpawn: { x: 0, y: 65, z: 0 },
    }
  },
  {
    id: 'crownforge_tf2',
    meta: {
      displayName: 'Fortress Arena',
      description: 'TF2-inspired Source movement, nine class profiles, ragdolls, Payload, Control Points, KOTH, and CTF foundations.',
      kind: 'minigame_match',
      dimension: 'tf2_payload',
      pvp: true,
      serverId: 'crownforge_network',
      gameModes: ['Fortress Arena', 'Payload', 'Control Points', 'King of the Hill', 'Capture the Flag'],
      motd: 'Pick a class, surf the air, blast jump, and play the objective.',
      color: '#d9853b',
      maxPlayers: 24,
      minigameId: 'tf2',
      matchPhase: 'PREGAME',
      minPlayers: Number(process.env.CROWNFORGE_MIN_PLAYERS || '1'),
      spawn: { x: -48, y: 65, z: 0 },
      pregameSpawn: { x: 0, y: 74, z: 96 },
    }
  },
  {
    id: 'crownforge_survival_games',
    meta: {
      displayName: 'CrownForge Survival Games',
      description: 'A ruined empire arena using the survival terrain generator with PvP enabled.',
      kind: 'minigame_match',
      dimension: 'survival_games',
      pvp: true,
      serverId: 'crownforge_network',
      gameModes: ['Survival Games'],
      motd: 'Scatter from spawn, loot ruins, and survive the empire wastes.',
      color: '#9ee493',
      maxPlayers: 24,
      minigameId: 'survival_games',
      matchPhase: 'PREGAME',
      minPlayers: Number(process.env.CROWNFORGE_MIN_PLAYERS || '1'),
    }
  },
];

function roomMetaFromFeatured(server: FeaturedServerConfig): Partial<RoomMeta> {
  const spawn = server.roomId === CROWNFORGE_LOBBY_ROOM
    ? { x: 0, y: 68, z: 0 }
    : server.id === 'ashfall_anarchy'
      // survival_247 generates a protected spawn platform with top surface y=64.
      // Spawn at feet y=65 so players do not appear hovering several blocks up.
      ? { x: 8.5, y: 65.05, z: 8.5 }
      : { x: 8, y: 68, z: 8 };
  return {
    displayName: server.displayName,
    description: server.description,
    kind: server.kind,
    dimension: server.dimension,
    permanent: true,
    pvp: server.pvp,
    gameModes: server.gameModes,
    motd: server.motd,
    serverId: server.id,
    color: server.color,
    maxPlayers: server.maxPlayers,
    spawn,
  };
}

function featuredServerPayload(roomManager: RoomManager) {
  return FEATURED_SERVERS.map(server => {
    const room = roomManager.rooms.get(server.roomId);
    const relatedRooms = Array.from(roomManager.rooms.values()).filter(r => r.meta.serverId === server.id);
    const playerCount = relatedRooms.reduce((sum, r) => sum + r.players.size, 0);
    return {
      ...server,
      address: '',
      playerCount,
      online: true,
      status: 'Online',
      permanent: true,
      roomMeta: room?.meta || roomMetaFromFeatured(server),
      relatedRooms: relatedRooms.map(r => ({
        id: r.id,
        displayName: r.meta.displayName,
        dimension: r.meta.dimension,
        players: r.players.size,
        gameModes: r.meta.gameModes,
      }))
    };
  });
}

function resolveFeaturedRoom(serverId: string | null): string | null {
  if (!serverId) return null;
  const clean = String(serverId || '').trim().toLowerCase();
  const server = FEATURED_SERVERS.find(s => s.id.toLowerCase() === clean || s.roomId.toLowerCase() === clean);
  return server?.roomId || null;
}

function resolveRequestedRoom(roomOrServer: string | null, serverId: string | null): string | null {
  const byServerId = resolveFeaturedRoom(serverId);
  if (byServerId) return byServerId;

  const clean = String(roomOrServer || '').trim();
  if (!clean) return null;

  const lower = clean.toLowerCase();
  if (lower === 'crownforge' || lower === 'crownforge_network' || lower === 'crownforge-network') {
    return CROWNFORGE_LOBBY_ROOM;
  }

  const byFeaturedAlias = resolveFeaturedRoom(lower);
  if (byFeaturedAlias) return byFeaturedAlias;

  return clean;
}

function ensureDataDir(): void {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function normalizeUsername(username: string): string {
  return String(username || 'Steve').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24) || 'steve';
}

function isValidSkinDataUrl(dataUrl: string): boolean {
  return /^data:image\/(png|jpeg);base64,/i.test(dataUrl) && Buffer.byteLength(dataUrl, 'utf8') <= MAX_SKIN_DATA_URL_BYTES;
}

function loadSkinStoreFrom(filePath: string): Record<string, StoredSkin> {
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, StoredSkin>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error(`Could not load skin store ${path.basename(filePath)}:`, err);
    return {};
  }
}

async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  ensureDataDir();
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await fs.promises.writeFile(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.promises.rename(tmpPath, filePath);
}

function pruneSkinStore(store: Record<string, StoredSkin>): void {
  const entries = Object.entries(store)
    .filter(([, skin]) => skin && typeof skin.dataUrl === 'string' && isValidSkinDataUrl(skin.dataUrl))
    .sort((a, b) => Number(b[1].updatedAt || 0) - Number(a[1].updatedAt || 0));
  for (const key of Object.keys(store)) delete store[key];
  for (const [key, value] of entries.slice(0, MAX_STORED_SKINS)) store[key] = value;
}

async function saveSkinStores(): Promise<void> {
  pruneSkinStore(skinStore);
  pruneSkinStore(skinStoreByUuid);
  await Promise.all([
    writeJsonFileAtomic(skinsPath, skinStore),
    writeJsonFileAtomic(skinsUuidPath, skinStoreByUuid),
  ]);
}

function getLocalShareUrls(port: number): string[] {
  const urls = [`http://localhost:${port}`];
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      const netArr = (nets as any)[name];
      for (const net of netArr) {
        if (net.family === 'IPv4' && !net.internal) {
          urls.push(`http://${net.address}:${port}`);
        }
      }
    }
  } catch {
    // keep localhost fallback
  }
  return urls;
}

const skinStore = loadSkinStoreFrom(skinsPath);
const skinStoreByUuid = loadSkinStoreFrom(skinsUuidPath);
pruneSkinStore(skinStore);
pruneSkinStore(skinStoreByUuid);
void saveSkinStores();

function getSkinForPlayer(uuid: string, username: string): string | undefined {
  return skinStoreByUuid[uuid]?.dataUrl || skinStore[normalizeUsername(username)]?.dataUrl;
}

// Auth system
ensureDataDir();
const authManager = new AuthManager(dataDir);

// Admin middleware: either a configured x-admin-secret or a logged-in Admin/Owner bearer token.
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const provided = req.headers['x-admin-secret'] || req.query['adminSecret'];
  if (ADMIN_SECRET && provided === ADMIN_SECRET) {
    (req as any).adminAccountId = 'admin-secret';
    next();
    return;
  }

  const token = String(req.headers['authorization'] || req.query['token'] || '').replace(/^Bearer /i, '');
  const session = authManager.validateToken(token);
  if (session.valid && authManager.isAdminRole(session.role)) {
    (req as any).adminAccountId = session.accountId;
    (req as any).adminRole = session.role;
    next();
    return;
  }

  res.status(403).json({
    error: ADMIN_SECRET
      ? 'Admin access requires a valid admin secret or Admin/Owner account token.'
      : 'Admin access requires an Admin/Owner account token. Bootstrap an Owner with CUBEGAME_BOOTSTRAP_OWNER_USERNAME.'
  });
}

function isSafeModSegment(value: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(value);
}

function ensureModDirectories(): void {
  for (const dir of modRoots) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

function findModRoot(modName: string): string | null {
  if (!isSafeModSegment(modName)) return null;
  for (const root of modRoots) {
    const candidate = path.join(root, modName);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return root;
    }
  }
  return null;
}

function resolveModCodeFile(modName: string, fileName: string): { filePath: string; transpile: boolean } | null {
  if (!isSafeModSegment(modName) || fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
    return null;
  }

  for (const root of modRoots) {
    const modPath = path.join(root, modName);
    if (!fs.existsSync(modPath) || !fs.statSync(modPath).isDirectory()) continue;

    const requestedPath = path.join(modPath, fileName);
    if (fs.existsSync(requestedPath) && /\.(mjs|js)$/i.test(fileName)) {
      return { filePath: requestedPath, transpile: false };
    }

    const tsFileName = fileName.replace(/\.(mjs|js)$/i, '.ts');
    const tsPath = path.join(modPath, tsFileName);
    if (fs.existsSync(tsPath)) {
      return { filePath: tsPath, transpile: true };
    }
  }

  return null;
}

function transpileModCode(code: string): string {
  return ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true
    }
  }).outputText;
}

function hashText(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function pickModEntryFile(files: string[]): string | undefined {
  return files.includes('index.js')
    ? 'index.js'
    : (files.includes('mod.js') ? 'mod.js' : files.find(file => file.endsWith('.js')));
}

interface CachedModFile {
  modName: string;
  fileName: string;
  jsCode: string;
  hash: string;
  size: number;
  sourcePath: string;
  sourceMtimeMs: number;
}

const modCodeCache = new Map<string, CachedModFile>();
let activeModManifest: any = { version: 1, generatedAt: Date.now(), mods: [] };

function modCacheKey(modName: string, fileName: string): string {
  return `${modName}/${fileName}`;
}

function listActiveMods() {
  ensureModDirectories();

  const byName = new Map<string, { name: string; files: Set<string>; hasAssets: boolean; source: string }>();

  for (const root of modRoots) {
    if (!fs.existsSync(root)) continue;
    for (const dirent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dirent.isDirectory() || !isSafeModSegment(dirent.name)) continue;

      const modName = dirent.name;
      const modPath = path.join(root, modName);
      const existing = byName.get(modName) || {
        name: modName,
        files: new Set<string>(),
        hasAssets: false,
        source: root === builtClientModsDir ? 'built-client' : 'workspace',
      };

      for (const file of fs.readdirSync(modPath)) {
        if (/\.d\.ts$/i.test(file)) continue;
        if (/\.(mjs|js)$/i.test(file)) existing.files.add(file);
        if (/\.ts$/i.test(file)) existing.files.add(file.replace(/\.ts$/i, '.js'));
      }

      existing.hasAssets = existing.hasAssets || fs.existsSync(path.join(modPath, 'assets'));
      byName.set(modName, existing);
    }
  }

  return Array.from(byName.values()).map(mod => ({
    name: mod.name,
    files: Array.from(mod.files),
    hasAssets: mod.hasAssets,
    source: mod.source,
  }));
}

function cacheModFile(modName: string, fileName: string): CachedModFile | null {
  const resolved = resolveModCodeFile(modName, fileName);
  if (!resolved) return null;
  const stat = fs.statSync(resolved.filePath);
  const cacheKey = modCacheKey(modName, fileName);
  const existing = modCodeCache.get(cacheKey);
  if (existing && existing.sourcePath === resolved.filePath && existing.sourceMtimeMs === stat.mtimeMs) return existing;

  const rawCode = fs.readFileSync(resolved.filePath, 'utf-8');
  const jsCode = resolved.transpile ? transpileModCode(rawCode) : rawCode;
  const cached: CachedModFile = {
    modName,
    fileName,
    jsCode,
    hash: hashText(jsCode),
    size: Buffer.byteLength(jsCode, 'utf8'),
    sourcePath: resolved.filePath,
    sourceMtimeMs: stat.mtimeMs,
  };
  modCodeCache.set(cacheKey, cached);
  return cached;
}

function rebuildModCache(): void {
  const mods = listActiveMods().map(mod => {
    const fileHashes = mod.files.map(file => {
      const cached = cacheModFile(mod.name, file);
      return cached
        ? { name: file, hash: cached.hash, size: cached.size }
        : { name: file, hash: '', size: 0 };
    });

    return {
      ...mod,
      entry: pickModEntryFile(mod.files),
      fileHashes,
      hash: hashText(JSON.stringify(fileHashes)),
    };
  });

  activeModManifest = { version: 1, generatedAt: Date.now(), mods };
}

function getActiveModManifest() {
  return activeModManifest;
}

ensureModDirectories();
rebuildModCache();

// Serve mod assets statically
app.use('/api/mods/:modName/assets', (req, res, next) => {
  const modName = req.params.modName;
  const root = findModRoot(modName);
  if (!root) {
    return res.status(400).send('Invalid mod name');
  }
  const assetsPath = path.join(root, modName, 'assets');
  if (fs.existsSync(assetsPath)) {
    express.static(assetsPath)(req, res, next);
  } else {
    res.status(404).send('Assets not found');
  }
});

// Serve cached transpiled TypeScript files as JS ES modules.
// The expensive TypeScript transpilation step is cached and warmed at startup, so
// public HTTP requests do not compile source trees on the main game path.
app.get('/api/mods/:modName/code/:fileName', (req, res) => {
  const { modName, fileName } = req.params;
  const cached = modCodeCache.get(modCacheKey(modName, fileName)) || cacheModFile(modName, fileName);
  if (!cached) {
    return res.status(400).send('Invalid request');
  }

  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.setHeader('ETag', `"${cached.hash}"`);
  if (req.headers['if-none-match'] === `"${cached.hash}"`) {
    res.status(304).end();
    return;
  }
  res.send(cached.jsCode);
});

// List all active mods
app.get('/api/mods', (_req, res) => {
  res.json(listActiveMods());
});

app.get('/api/mods/manifest', (_req, res) => {
  res.json(getActiveModManifest());
});

const roomManager = new RoomManager(dataDir);
roomManager.bootstrapPermanentRooms([
  ...FEATURED_SERVERS.map(server => ({ id: server.roomId, meta: roomMetaFromFeatured(server) })),
]);

// Auto-unban local IPs so the server owner can never lock themselves out.
{
  const localIps = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of (nets as any)[name] || []) {
        if (!net.internal) localIps.push(net.address);
      }
    }
  } catch { /* ignore */ }
  roomManager.unbanLocalAddresses(localIps);
}
for (const template of MATCH_ROOM_TEMPLATES) {
  // Templates are intentionally not bootstrapped as live rooms. The matchmaker
  // creates numbered rooms from these definitions so multiple games can run.
  void template;
}

setInterval(() => {
  roomManager.tickMinigameRooms();
}, 1000);

// ── Auth API ──────────────────────────────────────────────────────────────
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body || {};
  const result = await authManager.register(String(username || ''), String(password || ''), req.ip);
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({ ok: true, token: result.token, username, accountId: result.accountId, role: result.role });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const result = await authManager.login(String(username || ''), String(password || ''), req.ip);
  if (!result.ok) return res.status(401).json({ error: result.error });
  res.json({ ok: true, token: result.token, username: result.displayUsername, accountId: result.accountId, role: result.role });
});

app.get('/api/auth/me', (req, res) => {
  const token = String(req.headers['authorization'] || req.query['token'] || '');
  const result = authManager.validateToken(token.replace(/^Bearer /i, ''));
  if (!result.valid) return res.status(401).json({ error: 'Invalid or expired token.' });
  res.json({ ok: true, username: result.username, accountId: result.accountId, role: result.role });
});

// ── Admin API ──────────────────────────────────────────────────────────────
app.post('/api/admin/unban-all', requireAdmin, (req, res) => {
  const result = roomManager.adminUnbanAll(String((req as any).adminAccountId || ''), Boolean(req.body?.confirm), String(req.body?.reason || 'admin bulk unban'));
  res.status(result.ok ? 200 : 400).json(result);
});

app.post('/api/admin/unban/:identifier', requireAdmin, (req, res) => {
  const removed = roomManager.adminUnbanById(String((req as any).adminAccountId || ''), req.params.identifier, String(req.body?.reason || 'admin unban'));
  res.json({ ok: removed, message: removed ? 'Unbanned.' : 'No matching ban found.' });
});

app.post('/api/admin/unban-ip/:ip', requireAdmin, (req, res) => {
  const removed = roomManager.adminUnbanByIp(String((req as any).adminAccountId || ''), req.params.ip, String(req.body?.reason || 'admin IP unban'));
  res.json({ ok: removed, message: removed ? 'IP unbanned.' : 'No matching IP ban found.' });
});

app.get('/api/admin/bans', requireAdmin, (req, res) => {
  res.json(roomManager.adminListBans(String((req as any).adminAccountId || '')));
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'CubeGame', websocket: true, protocol: 1, rooms: roomManager.rooms.size, publicUrl: publicShare.url, serverTime: Date.now() });
});

// ── Room API ──────────────────────────────────────────────────────────────
// Add REST API for querying rooms
app.get('/api/rooms', (_req, res) => {
  res.json(roomManager.snapshotRooms());
});

app.get('/api/featured-servers', (_req, res) => {
  res.json(featuredServerPayload(roomManager));
});

app.get('/api/minigames', (_req, res) => {
  res.json(MINIGAME_DEFINITIONS.map(mode => ({
    id: mode.id,
    title: mode.title,
    shortTitle: mode.shortTitle,
    subtitle: mode.subtitle,
    command: mode.command,
    aliases: mode.aliases,
    room: mode.room,
    dimension: mode.dimension,
    icon: mode.icon,
    accent: mode.accent,
    spawn: mode.spawn,
    pvp: mode.pvp,
    maxPlayers: mode.maxPlayers,
    message: mode.message,
    matchTips: mode.matchTips,
    currentPlayers: Array.from(roomManager.rooms.values())
      .filter(room => room.meta.minigameId === mode.id || room.id === mode.room)
      .reduce((sum, room) => sum + room.players.size, 0),
  })));
});

app.get('/api/share', (_req, res) => {
  res.json({
    publicUrl: publicShare.url,
    webSocketUrl: publicShare.url ? publicShare.url.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:') : null,
    tunnelStatus: publicShare.status,
    tunnelError: publicShare.error,
    localUrls: getLocalShareUrls(PORT),
    bypassHeader: { 'Bypass-Tunnel-Reminder': '1' },
    maxPlayers: 'unlimited-by-room-memory',
    rooms: roomManager.rooms.size,
  });
});

app.post('/api/skins', async (req, res) => {
  const username = normalizeUsername(req.body?.username || 'Steve');
  const uuid = String(req.body?.uuid || '').trim().slice(0, 48);
  const fileName = String(req.body?.fileName || 'skin.png').replace(/[^\w.\- ]/g, '').slice(0, 80) || 'skin.png';
  const dataUrl = String(req.body?.dataUrl || '');

  if (!isValidSkinDataUrl(dataUrl)) {
    return res.status(400).json({ error: `Skin must be a PNG or JPG data URL under ${Math.floor(MAX_SKIN_DATA_URL_BYTES / 1024)} KB.` });
  }

  const record: StoredSkin = { username, uuid: uuid || undefined, fileName, dataUrl, updatedAt: Date.now() };

  if (uuid) skinStoreByUuid[uuid] = record;
  skinStore[username] = record;
  await saveSkinStores();

  res.json({ ok: true, username, fileName, maxStoredSkins: MAX_STORED_SKINS });
});

app.get('/api/skins/:username', (req, res) => {
  const username = normalizeUsername(req.params.username);
  const uuid = String(req.query['uuid'] || '');
  // UUID-keyed lookup first (avoids same-username skin collision)
  const skin = (uuid && skinStoreByUuid[uuid]) || skinStore[username];
  if (!skin) {
    return res.status(404).json({ error: 'Skin not found' });
  }
  res.json(skin);
});

if (fs.existsSync(indexPath)) {
  app.use(express.static(buildPath));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not Found' });
    }
    res.sendFile(indexPath);
  });
} else {
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not Found' });
    }
    res.send('CubeGame Multiplayer Server is active. Open the game via the Vite dev server at http://localhost:5173/');
  });
}

// WebSocket connection lifecycle
wss.on('connection', (ws: WebSocket, req: any) => {
  // Generate random UUID
  const uuid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  const forwardedFor = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const ipAddress = forwardedFor || String(req?.socket?.remoteAddress || '');
  
  let roomId = 'lobby_1';
  let username = `Guest ${uuid.substring(0, 4)}`;
  
  // Validate auth token if provided — use the authenticated username if valid.
  let authUsername: string | undefined;
  let authAccountId: string | undefined;
  let authRole: string | undefined;
  if (req && req.url) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const r = url.searchParams.get('room') || url.searchParams.get('roomCode') || url.searchParams.get('code');
      const u = url.searchParams.get('username');
      const s = url.searchParams.get('serverId');
      const token = url.searchParams.get('token') || '';
      const resolvedRoom = resolveRequestedRoom(r, s);
      if (resolvedRoom) roomId = resolvedRoom;

      // Token auth: if token is valid, use the authenticated username (prevents impersonation)
      if (token) {
        const authResult = authManager.validateToken(token);
        if (authResult.valid && authResult.username) {
          authUsername = authResult.username;
          authAccountId = authResult.accountId;
          authRole = authResult.role;
        } else {
          // Invalid/stale desktop tokens used to close the socket before the welcome
          // packet, which the browser reports as code 1006 through loca.lt. Ignore
          // bad tokens for public play; only enforce auth when the host opts in.
          serverLog('AUTH', 'Ignoring invalid multiplayer auth token; joining as guest', { ip: ipAddress, roomId });
          if (REQUIRE_WEBSOCKET_AUTH) {
            ws.send(JSON.stringify({ type: 'needsAuth', message: 'Please log in to play.' }));
            ws.close(4001, 'Authentication required');
            return;
          }
        }
      }

      if (authUsername) {
        username = authUsername;
      } else if (u) {
        username = u.trim();
      }
    } catch (e) {
      console.error('Error parsing WebSocket query parameters:', e);
    }
  }

  const activeBan = roomManager.getBan(authAccountId ? `acct:${authAccountId}` : ipAddress) || roomManager.getBan(ipAddress) || roomManager.getBan(username ? `user:${username.toLowerCase()}` : '');
  if (activeBan) {
    ws.send(JSON.stringify({
      type: 'banned',
      reason: activeBan.reason,
      expiresAt: activeBan.expiresAt,
    }));
    ws.close(4003, 'Banned');
    serverLog('BAN', 'Rejected banned client', { ip: ipAddress, reason: activeBan.reason });
    return;
  }

  const template = MATCH_ROOM_TEMPLATES.find(entry => entry.id === roomId);
  const room = roomManager.getOrCreateRoom(roomId, template?.meta);
  const socketState = ws as any;
  socketState.__isAlive = true;
  socketState.__missedHeartbeats = 0;
  const modManifest = getActiveModManifest();
  (room as any).__modManifest = modManifest;
  // Use UUID-keyed skin first (avoids same-name collision), then username fallback.
  const storedSkin = getSkinForPlayer(uuid, username);
  const player = room.addPlayer(uuid, ws, username, storedSkin, ipAddress, authAccountId, authRole as any);
  (player as any).__teleportGraceUntil = Date.now() + TELEPORT_GRACE_MS;
  (player as any).__teleportGraceAnchor = null;
  (player as any).__antiCheatMove = null;
  (player as any).__lastMove = null;
  const spawn = roomManager.getSpawnForPlayer(room, player);
  (player as any).__teleportGraceAnchor = { x: spawn.x, y: spawn.y, z: spawn.z };
  const anyRoom = room as any;
  if (!anyRoom.__mobAuthorityUuid || !room.players.has(anyRoom.__mobAuthorityUuid)) {
    anyRoom.__mobAuthorityUuid = uuid;
  }

  const playersList = Array.from(room.players.values())
    .filter(existing => existing.uuid !== uuid)
    .map(existing => ({
      uuid: existing.uuid,
      index: existing.index,
      username: existing.username,
      skinDataUrl: existing.skinDataUrl || null,
      role: existing.role,
      lastMove: (existing as any).__lastMove || null,
    }));

  serverLog('WS', 'Client connected', { uuid, username, roomId, ip: ipAddress, players: room.players.size });

  // Send authoritative handshake welcome packet. The client now waits for this
  // before leaving the multiplayer menu, so this must include enough room state
  // for a real load instead of a visual fallback.
  ws.send(JSON.stringify({
    type: 'welcome',
    uuid,
    index: player.index,
    seed: 12345,
    username: player.username,
    skinDataUrl: player.skinDataUrl || null,
    role: player.role,
    accountId: player.accountId || null,
    accountRole: player.accountRole || null,
    spawn,
    serverTime: Date.now(),
    protocol: 1,
    matchPhase: room.meta.matchPhase || '',
    matchState: room.meta.matchState || null,
    mobAuthorityUuid: (room as any).__mobAuthorityUuid || uuid,
    players: room.players.size,
    playersList,
    room: room.id,
    meta: room.meta,
    modManifest
  }));

  ws.on('message', (message: any, isBinary: boolean) => {
    try {
      socketState.__isAlive = true;
      socketState.__missedHeartbeats = 0;
      const payload = !isBinary && Buffer.isBuffer(message)
        ? message.toString('utf8')
        : message;
      const session = roomManager.getPlayerSession(uuid);
      WorldRelay.handleClientMessage(session?.player || player, session?.room || room, payload, roomManager);
    } catch (e) {
      serverLog('WS', 'Error handling relay message', { uuid, error: String(e) });
    }
  });

  ws.on('pong', () => {
    socketState.__isAlive = true;
    socketState.__missedHeartbeats = 0;
  });

  ws.on('close', () => {
    serverLog('WS', 'Client disconnected', { uuid, username, roomId });
    roomManager.removePlayerFromAll(uuid);
  });

  ws.on('error', (err) => {
    serverLog('WS', 'Socket error', { uuid, error: String(err) });
    roomManager.removePlayerFromAll(uuid);
  });
});

const heartbeatInterval = setInterval(() => {
  for (const ws of wss.clients) {
    const anyWs = ws as any;
    if (anyWs.__isAlive === false) {
      anyWs.__missedHeartbeats = Number(anyWs.__missedHeartbeats || 0) + 1;
      if (anyWs.__missedHeartbeats >= 3) {
        serverLog('WS', 'Terminating stale socket after missed heartbeats', { missed: anyWs.__missedHeartbeats });
        try { ws.terminate(); } catch { /* ignore */ }
        continue;
      }
    } else {
      anyWs.__missedHeartbeats = 0;
    }
    anyWs.__isAlive = false;
    try { ws.ping(); } catch {
      try { ws.terminate(); } catch { /* ignore */ }
    }
  }
}, Number(process.env.CUBEGAME_WS_HEARTBEAT_MS || '30000'));
heartbeatInterval.unref?.();

server.on('clientError', (err, socket) => {
  serverLog('HTTP', 'Dropped malformed client connection', { error: err.message });
  socket.destroy();
});

process.on('unhandledRejection', (reason) => {
  serverLog('PROCESS', 'Unhandled promise rejection', { reason: String(reason) });
});

async function startPublicTunnel(port: number, bindAddr: string): Promise<void> {
  if (!ENABLE_PUBLIC_TUNNEL) {
    publicShare.status = 'disabled';
    publicShare.error = IS_PRODUCTION
      ? 'Public tunnel disabled in production. Set CUBEGAME_ENABLE_PUBLIC_TUNNEL=1 only for temporary managed testing.'
      : 'Public tunnel disabled by DISABLE_PUBLIC_TUNNEL=1.';
    return;
  }

  try {
    publicShare.status = 'connecting';
    publicShare.error = null;

    const importer = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;
    const mod = await importer('localtunnel');
    const localtunnel = mod.default || mod;
    const tunnelOptions: Record<string, any> = {
      port,
      local_host: bindAddr === '0.0.0.0' ? '127.0.0.1' : bindAddr,
    };
    if (process.env.CUBEGAME_TUNNEL_SUBDOMAIN) {
      tunnelOptions.subdomain = process.env.CUBEGAME_TUNNEL_SUBDOMAIN;
    }
    const tunnel = await localtunnel(tunnelOptions);

    publicShare.url = tunnel.url;
    publicShare.status = 'online';
    console.log(` Public share URL: ${publicShare.url}`);
    console.log(` Friends can open that URL and join multiplayer rooms from there.`);

    tunnel.on('close', () => {
      publicShare.url = null;
      publicShare.status = 'closed';
      publicShare.error = 'The public tunnel closed.';
      console.log(' Public tunnel closed.');
    });

    tunnel.on('error', (err: any) => {
      publicShare.status = 'error';
      publicShare.error = err?.message || String(err);
      console.error(' Public tunnel error:', publicShare.error);
    });
  } catch (err: any) {
    publicShare.url = null;
    publicShare.status = 'unavailable';
    publicShare.error = err?.message || String(err);
    console.error(' Public tunnel unavailable:', publicShare.error);
  }
}

server.listen(PORT, BIND_ADDR, () => {
  serverLog('BOOT', 'CubeGame server listening', {
    port: PORT,
    bind: BIND_ADDR,
    node: process.version,
    mode: IS_PRODUCTION ? 'production' : 'development',
    corsOrigins: CORS_ORIGINS.length > 0 ? CORS_ORIGINS : (IS_PRODUCTION ? [] : ['*']),
    publicTunnel: ENABLE_PUBLIC_TUNNEL,
    watchdog: process.env.CUBEGAME_WATCHDOG_MODE || 'monitor'
  });
  console.log(`========================================`);
  console.log(` CubeGame Multiplayer Server Active`);
  console.log(` Permanent rooms: ${Array.from(roomManager.rooms.values()).filter(r => r.meta.permanent).map(r => r.id).join(', ')}`);
  console.log(` Port: ${PORT}`);
  console.log(` Bind: ${BIND_ADDR}`);
  console.log(` Mode: ${IS_PRODUCTION ? 'production' : 'development'}`);
  console.log(` CORS: ${CORS_ORIGINS.length > 0 ? CORS_ORIGINS.join(', ') : (IS_PRODUCTION ? 'same-origin only' : 'open for local development')}`);
  console.log(` Public tunnel: ${ENABLE_PUBLIC_TUNNEL ? 'enabled' : 'disabled'}`);

  try {
    const nets = os.networkInterfaces();
    const addrs: string[] = [];
    for (const name of Object.keys(nets)) {
      const netArr = (nets as any)[name];
      for (const net of netArr) {
        if (net.family === 'IPv4' && !net.internal) {
          addrs.push(net.address);
        }
      }
    }

    if (addrs.length > 0) {
      console.log(` Accessible:`);
      addrs.forEach((a) => console.log(` - http://${a}:${PORT}    ws://${a}:${PORT}`));
    } else {
      console.log(` Local: http://localhost:${PORT}`);
    }
  } catch (e) {
    console.log(` Local: http://localhost:${PORT}`);
  }

  console.log(`========================================`);
  void startPublicTunnel(PORT, BIND_ADDR);
});

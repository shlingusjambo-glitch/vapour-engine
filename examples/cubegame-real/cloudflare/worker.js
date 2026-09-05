// CubeGame Cloudflare Backend — authoritative public alpha
// Paste this whole file into the Cloudflare Worker editor for cubegame-backend.
// Public endpoint: https://cubegame-backend.shlingusjambo.workers.dev
// WebSocket endpoint: wss://cubegame-backend.shlingusjambo.workers.dev/ws
//
// This Worker intentionally avoids LocalTunnel and manual server addresses.
// It includes Blob-safe WebSocket binary handling, server-owned room/player state,
// movement sanity checks, chat, skins, BedWars beds/respawns, basic combat authority,
// basic inventory authority, and BedWars shop validation.
//
// Optional KV bindings for persistence:
//   CUBEGAME_ACCOUNTS  - stores accounts by acct:<username>
//   CUBEGAME_SESSIONS  - stores tokens by token:<token>

const GAME_VERSION = '1.1-cloudflare-authoritative';
const ROOM_IDLE_LIMIT_MS = 1000 * 60 * 60;
const accountsMemory = new Map();
const sessionsMemory = new Map();
const rooms = new Map();

const ITEM = Object.freeze({
  STICK: 200,
  IRON: 202,
  GOLD: 203,
  DIAMOND: 204,
  STRING: 206,
  GUNPOWDER: 209,
  WOOL: 210,
  ARROW: 211,
  WOOD_PICKAXE: 220,
  STONE_PICKAXE: 221,
  IRON_PICKAXE: 222,
  DIAMOND_PICKAXE: 224,
  WOOD_AXE: 230,
  STONE_AXE: 231,
  IRON_AXE: 232,
  DIAMOND_AXE: 234,
  WOOD_SWORD: 250,
  STONE_SWORD: 251,
  IRON_SWORD: 252,
  DIAMOND_SWORD: 254,
  BOW: 270,
  GOLDEN_APPLE: 285,
  EMERALD: 471,
  SHEARS: 238,
  TNT: 209,
  FIRE_CHARGE: 209,
  ENDER_PEARL: 471,
  INVIS_POTION: 285,
  END_STONE: 13,
  GLASS: 11,
  PLANKS: 15,
  LADDER: 0,
});

const TEAM_ORDER = ['Red', 'Blue', 'Green', 'Yellow'];
const TEAM_COLORS = { Red: '#ff5555', Blue: '#5599ff', Green: '#55ff77', Yellow: '#ffe066' };
const BED_BLOCK_IDS = { Red: 0, Blue: 0, Green: 0, Yellow: 0 };
const BEDWARS_SPAWNS = {
  Red: { x: -56, y: 66, z: -56 },
  Blue: { x: 56, y: 66, z: -56 },
  Green: { x: -56, y: 66, z: 56 },
  Yellow: { x: 56, y: 66, z: 56 },
};
const BEDWARS_BEDS = (() => {
  const out = {};
  for (const team of TEAM_ORDER) {
    const spawn = BEDWARS_SPAWNS[team];
    const sx = -Math.sign(spawn.x) || 1;
    const sz = -Math.sign(spawn.z) || 1;
    out[team] = {
      team,
      pieces: [
        { x: spawn.x + sx * 4, y: 64, z: spawn.z + sz * 4 },
        { x: spawn.x + sx * 3, y: 64, z: spawn.z + sz * 3 },
      ],
    };
  }
  return out;
})();

const ROOM_DEFS = {
  ashfall_anarchy_survival: {
    id: 'ashfall_anarchy_survival',
    displayName: 'Ashfall Anarchy',
    description: 'Permanent anarchy survival. Public 24/7 discovery through Cloudflare.',
    dimension: 'survival_247',
    permanent: true,
    color: '#d95032',
    gameModes: ['Anarchy Survival', 'PvP', 'Shared Mobs', 'Weather'],
    spawn: { x: 8, y: 68, z: 8 },
  },
  crownforge_lobby: {
    id: 'crownforge_lobby',
    displayName: 'CrownForge Network',
    description: 'Minigame hub for BedWars, SkyWars, Void Duels, Castle Siege, and Survival Games.',
    dimension: 'crownforge_lobby',
    permanent: true,
    color: '#55b8ff',
    gameModes: ['CrownForge', 'BedWars', 'SkyWars', 'Void Duels', 'Castle Siege'],
    spawn: { x: 0, y: 74, z: 0 },
  },
  bedwars_1: {
    id: 'bedwars_1',
    displayName: 'BedWars Islands',
    description: 'Team islands, beds, generators, item shops, and respawns.',
    dimension: 'bedwars',
    permanent: true,
    color: '#ff5555',
    gameModes: ['BedWars'],
    spawn: { x: -56, y: 66, z: -56 },
    matchPhase: 'active',
  },
  crownforge_bedwars: {
    id: 'crownforge_bedwars',
    displayName: 'BedWars Islands',
    description: 'Team islands, beds, generators, item shops, and respawns.',
    dimension: 'bedwars',
    permanent: true,
    color: '#ff5555',
    gameModes: ['BedWars'],
    spawn: { x: -56, y: 66, z: -56 },
    matchPhase: 'active',
  },
  skywars_1: {
    id: 'skywars_1',
    displayName: 'SkyWars Ring',
    description: 'Fast sky island combat with center loot.',
    dimension: 'skywars',
    permanent: true,
    color: '#a46cff',
    gameModes: ['SkyWars'],
    spawn: { x: 48, y: 74, z: 0 },
    matchPhase: 'waiting',
  },
  void_duels_1: {
    id: 'void_duels_1',
    displayName: 'Void Duels',
    description: 'Small arena duels on floating islands.',
    dimension: 'void_duels',
    permanent: true,
    color: '#55ffff',
    gameModes: ['Void Duels'],
    spawn: { x: 0, y: 72, z: 0 },
    matchPhase: 'waiting',
  },
};

const SHOP_OFFERS = {
  wool: { title: 'Wool x16', kind: 'stack', cost: { id: ITEM.IRON, count: 4 }, grants: [{ id: ITEM.WOOL, count: 16 }] },
  planks: { title: 'Oak Planks x16', kind: 'stack', cost: { id: ITEM.GOLD, count: 4 }, grants: [{ id: ITEM.PLANKS, count: 16 }] },
  end_stone: { title: 'End Stone x12', kind: 'stack', cost: { id: ITEM.IRON, count: 24 }, grants: [{ id: ITEM.END_STONE, count: 12 }] },
  glass: { title: 'Blast-Proof Glass x4', kind: 'stack', cost: { id: ITEM.IRON, count: 12 }, grants: [{ id: ITEM.GLASS, count: 4 }] },
  sword_upgrade: { title: 'Sword Upgrade', kind: 'tiered', tiers: [ITEM.WOOD_SWORD, ITEM.STONE_SWORD, ITEM.IRON_SWORD, ITEM.DIAMOND_SWORD], costs: [{ id: ITEM.IRON, count: 0 }, { id: ITEM.IRON, count: 10 }, { id: ITEM.GOLD, count: 7 }, { id: ITEM.EMERALD, count: 4 }] },
  pickaxe_upgrade: { title: 'Pickaxe Upgrade', kind: 'tiered', tiers: [ITEM.WOOD_PICKAXE, ITEM.STONE_PICKAXE, ITEM.IRON_PICKAXE, ITEM.DIAMOND_PICKAXE], costs: [{ id: ITEM.IRON, count: 10 }, { id: ITEM.IRON, count: 10 }, { id: ITEM.GOLD, count: 3 }, { id: ITEM.GOLD, count: 6 }] },
  axe_upgrade: { title: 'Axe Upgrade', kind: 'tiered', tiers: [ITEM.WOOD_AXE, ITEM.STONE_AXE, ITEM.IRON_AXE, ITEM.DIAMOND_AXE], costs: [{ id: ITEM.IRON, count: 10 }, { id: ITEM.IRON, count: 10 }, { id: ITEM.GOLD, count: 3 }, { id: ITEM.GOLD, count: 6 }] },
  bow: { title: 'Bow', kind: 'permanent', cost: { id: ITEM.GOLD, count: 12 }, grants: [{ id: ITEM.BOW, count: 1 }] },
  arrows: { title: 'Arrows x8', kind: 'stack', cost: { id: ITEM.GOLD, count: 2 }, grants: [{ id: ITEM.ARROW, count: 8 }] },
  shears: { title: 'Shears', kind: 'permanent', cost: { id: ITEM.IRON, count: 20 }, grants: [{ id: ITEM.SHEARS, count: 1 }] },
  tnt: { title: 'TNT', kind: 'stack', cost: { id: ITEM.GOLD, count: 8 }, grants: [{ id: ITEM.TNT, count: 1 }] },
  fire_charge: { title: 'Fire Charge', kind: 'stack', cost: { id: ITEM.IRON, count: 40 }, grants: [{ id: ITEM.FIRE_CHARGE, count: 1 }] },
  golden_apple: { title: 'Golden Apple', kind: 'stack', cost: { id: ITEM.GOLD, count: 3 }, grants: [{ id: ITEM.GOLDEN_APPLE, count: 1 }] },
  ender_pearl: { title: 'Ender Pearl', kind: 'stack', cost: { id: ITEM.EMERALD, count: 4 }, grants: [{ id: ITEM.ENDER_PEARL, count: 1 }] },
  invisibility_potion: { title: 'Invisibility Potion', kind: 'stack', cost: { id: ITEM.EMERALD, count: 2 }, grants: [{ id: ITEM.INVIS_POTION, count: 1 }] },
  sharpness: { title: 'Sharpened Swords', kind: 'teamUpgrade', cost: { id: ITEM.DIAMOND, count: 4 }, upgradeKey: 'sharpness', maxLevel: 1 },
  protection: { title: 'Reinforced Armor', kind: 'teamUpgrade', cost: { id: ITEM.DIAMOND, count: 2 }, upgradeKey: 'protection', maxLevel: 4 },
  haste: { title: 'Haste', kind: 'teamUpgrade', cost: { id: ITEM.DIAMOND, count: 2 }, upgradeKey: 'haste', maxLevel: 2 },
  forge: { title: 'Forge Upgrade', kind: 'teamUpgrade', cost: { id: ITEM.DIAMOND, count: 2 }, upgradeKey: 'forge', maxLevel: 4 },
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-CubeGame-Client,Bypass-Tunnel-Reminder,bypass-tunnel-reminder',
    'Access-Control-Max-Age': '86400',
  };
}
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders() } }); }
function text(data, status = 200) { return new Response(data, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders() } }); }
function cleanUsername(value) { return String(value || 'Steve').trim().replace(/[^A-Za-z0-9_\- ]/g, '').slice(0, 24) || 'Steve'; }
function clampNumber(v, min, max, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function distSq(a, b) { const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z; return dx * dx + dy * dy + dz * dz; }
function sameBlock(a, b) { return Math.round(a.x) === Math.round(b.x) && Math.round(a.y) === Math.round(b.y) && Math.round(a.z) === Math.round(b.z); }
function isBedWarsRoom(room) { return room?.meta?.dimension === 'bedwars'; }

function normalizeRoomId(value) {
  const clean = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_\-]/g, '_');
  if (!clean || clean === 'crownforge' || clean === 'crownforge_network' || clean === 'crownforge-network') return 'crownforge_lobby';
  if (clean === 'ashfall' || clean === 'survival' || clean === 'anarchy') return 'ashfall_anarchy_survival';
  if (clean === 'bedwars' || clean === 'bedwars_1' || clean === 'crownforge_bedwars') return 'bedwars_1';
  if (clean === 'skywars' || clean === 'skywars_1' || clean === 'crownforge_skywars') return 'skywars_1';
  if (clean === 'duels' || clean === 'voidduels' || clean === 'void_duels') return 'void_duels_1';
  return ROOM_DEFS[clean] ? clean : clean;
}
function roomMeta(id) {
  const def = ROOM_DEFS[id] || ROOM_DEFS.crownforge_lobby;
  return {
    id, displayName: def.displayName || id, description: def.description || 'CubeGame room.', dimension: def.dimension || id,
    permanent: Boolean(def.permanent), color: def.color || '#55b8ff', gameModes: def.gameModes || ['Survival'],
    spawn: def.spawn || { x: 0, y: 72, z: 0 }, matchPhase: def.matchPhase || '', matchState: def.matchState || null,
    motd: def.description || '',
  };
}
function makeBedWarsState() {
  return {
    phase: 'active',
    bedAlive: { Red: true, Blue: true, Green: true, Yellow: true },
    teams: { Red: [], Blue: [], Green: [], Yellow: [] },
    upgrades: { Red: {}, Blue: {}, Green: {}, Yellow: {} },
    startedAt: Date.now(),
  };
}
function getRoom(id) {
  cleanIdleRooms();
  const roomId = normalizeRoomId(id);
  let room = rooms.get(roomId);
  if (!room) {
    const meta = roomMeta(roomId);
    room = {
      id: roomId, clients: new Map(), nextIndex: 0, createdAt: Date.now(), lastSeenAt: Date.now(), meta,
      blockEdits: [], state: meta.dimension === 'bedwars' ? makeBedWarsState() : null,
    };
    rooms.set(roomId, room);
  }
  room.lastSeenAt = Date.now();
  return room;
}
function cleanIdleRooms() {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (ROOM_DEFS[id]) continue;
    if (room.clients.size === 0 && now - room.lastSeenAt > ROOM_IDLE_LIMIT_MS) rooms.delete(id);
  }
}
function publicBase(request) { const url = new URL(request.url); return `${url.protocol}//${url.host}`; }
function publicWsBase(request) { const url = new URL(request.url); return `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}/ws`; }
function countPlayers(roomId) { return rooms.get(roomId)?.clients.size || 0; }
function matchStateFor(room) {
  if (!isBedWarsRoom(room)) return room.meta.matchState || null;
  return { mode: 'bedwars', phase: room.state.phase, bedAlive: room.state.bedAlive, teams: Object.fromEntries(Object.entries(room.state.teams).map(([k, v]) => [k, v.length])), upgrades: room.state.upgrades };
}
function featuredServers(request) {
  const ws = publicWsBase(request);
  return [
    { id: 'crownforge_network', displayName: 'CrownForge Network', roomId: 'crownforge_lobby', address: ws, description: 'Official CubeGame minigame network. No manual server address required.', gameModes: ['CrownForge', 'BedWars', 'SkyWars', 'Void Duels', 'Castle Siege'], playerCount: countPlayers('crownforge_lobby') + countPlayers('bedwars_1') + countPlayers('skywars_1') + countPlayers('void_duels_1'), status: 'Online', color: '#55b8ff', motd: 'Cloudflare public backend online.' },
    { id: 'ashfall_anarchy', displayName: 'Ashfall Anarchy', roomId: 'ashfall_anarchy_survival', address: ws, description: 'Permanent public survival world.', gameModes: ['Anarchy Survival', 'PvP', 'Shared Mobs', 'Weather'], playerCount: countPlayers('ashfall_anarchy_survival'), status: 'Online', color: '#d95032', motd: 'No claims. No resets.' },
    { id: 'bedwars_1', displayName: 'BedWars Islands', roomId: 'bedwars_1', address: ws, description: 'Join directly into BedWars.', gameModes: ['BedWars'], playerCount: countPlayers('bedwars_1'), status: 'Online', color: '#ff5555', motd: 'Break beds. Buy gear. Win.' },
  ];
}
function roomsList(request) {
  const ws = publicWsBase(request);
  const defs = Object.values(ROOM_DEFS).map(def => {
    const room = rooms.get(normalizeRoomId(def.id));
    return { id: normalizeRoomId(def.id), playerCount: countPlayers(normalizeRoomId(def.id)), permanent: true, address: ws, meta: roomMeta(normalizeRoomId(def.id)), matchState: room ? matchStateFor(room) : null };
  });
  for (const room of rooms.values()) if (!ROOM_DEFS[room.id]) defs.push({ id: room.id, playerCount: room.clients.size, permanent: false, address: ws, meta: room.meta, matchState: matchStateFor(room) });
  return defs;
}

async function sha256(text) { const data = new TextEncoder().encode(text); const hash = await crypto.subtle.digest('SHA-256', data); return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join(''); }
async function getAccount(env, username) { const key = `acct:${username.toLowerCase()}`; if (env?.CUBEGAME_ACCOUNTS?.get) { const raw = await env.CUBEGAME_ACCOUNTS.get(key); return raw ? JSON.parse(raw) : null; } return accountsMemory.get(key) || null; }
async function putAccount(env, account) { const key = `acct:${account.username.toLowerCase()}`; if (env?.CUBEGAME_ACCOUNTS?.put) await env.CUBEGAME_ACCOUNTS.put(key, JSON.stringify(account)); else accountsMemory.set(key, account); }
async function putSession(env, token, session) { const key = `token:${token}`; if (env?.CUBEGAME_SESSIONS?.put) await env.CUBEGAME_SESSIONS.put(key, JSON.stringify(session), { expirationTtl: 60 * 60 * 24 * 14 }); else sessionsMemory.set(key, { ...session, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14 }); }
async function getSession(env, token) { if (!token) return null; const clean = String(token).replace(/^Bearer /i, '').trim(); const key = `token:${clean}`; if (env?.CUBEGAME_SESSIONS?.get) { const raw = await env.CUBEGAME_SESSIONS.get(key); return raw ? JSON.parse(raw) : null; } const session = sessionsMemory.get(key); if (!session || session.expiresAt < Date.now()) return null; return session; }
async function handleRegister(request, env) {
  const body = await request.json().catch(() => ({})); const username = cleanUsername(body.username); const password = String(body.password || '');
  if (username.length < 3) return json({ ok: false, error: 'Username must be at least 3 characters.' }, 400);
  if (password.length < 4) return json({ ok: false, error: 'Password must be at least 4 characters.' }, 400);
  if (await getAccount(env, username)) return json({ ok: false, error: 'That username already exists.' }, 400);
  const salt = crypto.randomUUID(); const account = { accountId: crypto.randomUUID(), username, displayUsername: username, role: accountsMemory.size === 0 ? 'Owner' : 'Player', salt, passwordHash: await sha256(`CubeGame:${salt}:${username.toLowerCase()}:${password}`), createdAt: Date.now() };
  await putAccount(env, account); const token = `cg_${crypto.randomUUID().replace(/-/g, '')}`; await putSession(env, token, { accountId: account.accountId, username, role: account.role });
  return json({ ok: true, token, username, accountId: account.accountId, role: account.role });
}
async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({})); const username = cleanUsername(body.username); const password = String(body.password || ''); const account = await getAccount(env, username);
  if (!account) return json({ ok: false, error: 'No account found.' }, 401);
  const expected = await sha256(`CubeGame:${account.salt}:${account.username.toLowerCase()}:${password}`); if (expected !== account.passwordHash) return json({ ok: false, error: 'Incorrect password.' }, 401);
  const token = `cg_${crypto.randomUUID().replace(/-/g, '')}`; await putSession(env, token, { accountId: account.accountId, username: account.username, role: account.role });
  return json({ ok: true, token, username: account.displayUsername || account.username, accountId: account.accountId, role: account.role });
}
async function authFromRequest(request, env) { const url = new URL(request.url); const header = request.headers.get('authorization') || ''; const query = url.searchParams.get('token') || ''; return getSession(env, header || query); }

function makeServerMovePacket(index, input) { const inputView = new DataView(input); const out = new ArrayBuffer(25); const view = new DataView(out); view.setUint8(0, 1); view.setUint16(1, index & 0xffff); view.setFloat32(3, inputView.getFloat32(1)); view.setFloat32(7, inputView.getFloat32(5)); view.setFloat32(11, inputView.getFloat32(9)); view.setFloat32(15, inputView.getFloat32(13)); view.setFloat32(19, inputView.getFloat32(17)); view.setUint16(23, inputView.byteLength >= 23 ? inputView.getUint16(21) : 0); return out; }
function makeServerMovePacketFromState(index, move) { const out = new ArrayBuffer(25); const view = new DataView(out); view.setUint8(0, 1); view.setUint16(1, index & 0xffff); view.setFloat32(3, move.x); view.setFloat32(7, move.y); view.setFloat32(11, move.z); view.setFloat32(15, move.yaw || 0); view.setFloat32(19, move.pitch || 0); view.setUint16(23, move.heldItemId || 0); return out; }
function decodeMove(input) { const view = new DataView(input); return { x: view.getFloat32(1), y: view.getFloat32(5), z: view.getFloat32(9), yaw: view.getFloat32(13), pitch: view.getFloat32(17), heldItemId: view.byteLength >= 23 ? view.getUint16(21) : 0 }; }
function decodeBlockEdit(input) { const view = new DataView(input); return { x: view.getInt32(1), y: view.getInt32(5), z: view.getInt32(9), blockId: view.getUint16(13) }; }
function makeBlockEditPacket(x, y, z, blockId) { const out = new ArrayBuffer(15); const view = new DataView(out); view.setUint8(0, 2); view.setInt32(1, x | 0); view.setInt32(5, y | 0); view.setInt32(9, z | 0); view.setUint16(13, Math.max(0, blockId | 0)); return out; }
function sendSafe(ws, payload) { try { if (ws && ws.readyState === 1) ws.send(payload); } catch (_) {} }
function broadcast(room, payload, exceptUuid = '') { for (const [id, client] of room.clients) { if (id === exceptUuid) continue; sendSafe(client.ws, payload); } }
async function normalizeSocketData(data) {
  if (data instanceof ArrayBuffer) return { kind: 'binary', value: data };
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const buffer = await data.arrayBuffer();
    if (buffer.byteLength > 0) {
      const packetType = new DataView(buffer).getUint8(0);
      if (packetType >= 1 && packetType <= 32) return { kind: 'binary', value: buffer };
    }
    return { kind: 'text', value: new TextDecoder().decode(buffer) };
  }
  if (ArrayBuffer.isView(data)) return { kind: 'binary', value: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) };
  return { kind: 'text', value: String(data || '') };
}

function countInventory(player, itemId) { return Number(player.inventory?.[itemId] || 0); }
function setInventory(player, itemId, count) { player.inventory[itemId] = Math.max(0, Math.floor(count)); if (player.inventory[itemId] <= 0) delete player.inventory[itemId]; }
function addInventory(player, itemId, count) { setInventory(player, itemId, countInventory(player, itemId) + Math.max(0, Math.floor(count))); }
function removeInventory(player, itemId, count) { const have = countInventory(player, itemId); const need = Math.max(0, Math.floor(count)); if (have < need) return false; setInventory(player, itemId, have - need); return true; }
function hasAny(player, itemIds) { return itemIds.some(id => countInventory(player, id) > 0); }
function clearItems(player, ids) { for (const id of ids) setInventory(player, id, 0); }
function inventorySnapshot(player) { return { type: 'inventorySnapshot', inventory: { ...player.inventory }, equipment: player.equipment || {}, team: player.team || null }; }
function sendInventory(player) { sendSafe(player.ws, JSON.stringify(inventorySnapshot(player))); }
function inventoryPatch(player, ops, message = '') { sendSafe(player.ws, JSON.stringify({ type: 'inventoryPatch', ops, inventory: { ...player.inventory }, message })); }
function grantStarterInventory(player, room) {
  player.inventory = {};
  player.equipment = player.equipment || {};
  if (isBedWarsRoom(room)) {
    addInventory(player, ITEM.WOOD_SWORD, 1);
    addInventory(player, ITEM.IRON, 64);
    addInventory(player, ITEM.GOLD, 16);
    player.equipment = { helmet: `${player.team} Leather Helmet`, chestplate: `${player.team} Leather Chestplate`, leggings: `${player.team} Leather Leggings`, boots: `${player.team} Leather Boots`, tint: TEAM_COLORS[player.team] };
  }
}
function chooseTeam(room) {
  if (!isBedWarsRoom(room)) return null;
  let best = TEAM_ORDER[0]; let count = Infinity;
  for (const team of TEAM_ORDER) {
    const size = room.state.teams[team].filter(id => room.clients.has(id)).length;
    if (size < count) { best = team; count = size; }
  }
  return best;
}
function joinTeam(room, player, preferred) {
  if (!isBedWarsRoom(room)) return;
  const team = TEAM_ORDER.includes(preferred) ? preferred : chooseTeam(room);
  player.team = team;
  for (const t of TEAM_ORDER) room.state.teams[t] = room.state.teams[t].filter(id => id !== player.uuid);
  room.state.teams[team].push(player.uuid);
  room.meta.spawn = BEDWARS_SPAWNS[team];
}
function getPlayerSpawn(room, player) {
  if (isBedWarsRoom(room) && player.team) return BEDWARS_SPAWNS[player.team] || room.meta.spawn;
  return room.meta.spawn;
}
function bedTeamAt(x, y, z) {
  const pos = { x, y, z };
  for (const team of TEAM_ORDER) for (const piece of BEDWARS_BEDS[team].pieces) if (sameBlock(pos, piece)) return team;
  return null;
}
function findOffer(keyOrTitle) {
  const raw = String(keyOrTitle || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (SHOP_OFFERS[raw]) return { key: raw, offer: SHOP_OFFERS[raw] };
  for (const [key, offer] of Object.entries(SHOP_OFFERS)) {
    const title = offer.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (title === raw) return { key, offer };
  }
  return null;
}
function currentTierIndex(player, tiers) { let highest = -1; for (let i = 0; i < tiers.length; i++) if (countInventory(player, tiers[i]) > 0) highest = i; return highest; }
function handleShopPurchase(room, player, msg) {
  if (!isBedWarsRoom(room) || !player.team || player.role === 'spectator') return sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: false, message: 'You can only use BedWars shops while playing BedWars.' }));
  const found = findOffer(msg.offerKey || msg.offer || msg.title || msg.id);
  if (!found) return sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: false, message: 'Unknown shop item.' }));
  const { key, offer } = found;
  let cost = offer.cost;
  let grants = offer.grants || [];
  let removeTiers = [];
  if (offer.kind === 'tiered') {
    const i = currentTierIndex(player, offer.tiers);
    if (i >= offer.tiers.length - 1) return sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: false, message: `${offer.title} is already maxed.` }));
    const nextIndex = i + 1;
    cost = offer.costs[Math.min(nextIndex, offer.costs.length - 1)];
    grants = [{ id: offer.tiers[nextIndex], count: 1 }];
    removeTiers = offer.tiers.filter(id => id !== offer.tiers[nextIndex]);
  } else if (offer.kind === 'permanent' && grants.length && hasAny(player, grants.map(g => g.id))) {
    return sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: false, message: `Already owns ${offer.title}.` }));
  } else if (offer.kind === 'teamUpgrade') {
    const upgrades = room.state.upgrades[player.team];
    const level = upgrades[offer.upgradeKey] || 0;
    if (level >= offer.maxLevel) return sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: false, message: `${offer.title} is already maxed.` }));
    cost = { id: offer.cost.id, count: offer.cost.count * (level + 1) };
    if (!removeInventory(player, cost.id, cost.count)) return sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: false, message: `Need ${cost.count} currency.` }));
    upgrades[offer.upgradeKey] = level + 1;
    sendInventory(player);
    broadcast(room, JSON.stringify({ type: 'bedwarsUpgrade', team: player.team, upgradeKey: offer.upgradeKey, level: upgrades[offer.upgradeKey], purchaser: player.username }));
    return sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: true, offerKey: key, message: `Purchased ${offer.title} level ${level + 1}.` }));
  }
  if (!removeInventory(player, cost.id, cost.count)) return sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: false, message: `Need ${cost.count} currency.` }));
  clearItems(player, removeTiers);
  for (const grant of grants) addInventory(player, grant.id, grant.count);
  sendInventory(player);
  inventoryPatch(player, [{ type: 'buy', offerKey: key, cost, grants, remove: removeTiers }], `Purchased ${offer.title}.`);
  sendSafe(player.ws, JSON.stringify({ type: 'shopPurchaseResult', ok: true, offerKey: key, message: `Purchased ${offer.title}.` }));
}
function handleBlockEdit(room, player, data) {
  const edit = decodeBlockEdit(data);
  if (isBedWarsRoom(room)) {
    const team = bedTeamAt(edit.x, edit.y, edit.z);
    if (team) {
      if (player.team === team) {
        sendSafe(player.ws, JSON.stringify({ type: 'chat', sender: 'BedWars', text: 'You cannot break your own bed.' }));
        return;
      }
      if (!room.state.bedAlive[team]) return;
      room.state.bedAlive[team] = false;
      for (const piece of BEDWARS_BEDS[team].pieces) {
        const pkt = makeBlockEditPacket(piece.x, piece.y, piece.z, 0);
        if (room.blockEdits.length > 500) room.blockEdits.shift();
        room.blockEdits.push(pkt);
        broadcast(room, pkt);
      }
      broadcast(room, JSON.stringify({ type: 'bedDestroyed', team, by: player.username, bedAlive: room.state.bedAlive, matchState: matchStateFor(room) }));
      return;
    }
  }
  if (room.blockEdits.length > 500) room.blockEdits.shift();
  room.blockEdits.push(data);
  broadcast(room, data, player.uuid);
}
function respawnPlayer(room, player, reason = 'respawn') {
  const spawn = getPlayerSpawn(room, player);
  player.health = 20;
  player.dead = false;
  player.lastMove = { ...spawn, yaw: 0, pitch: 0, heldItemId: ITEM.WOOD_SWORD };
  player.lastMoveAt = Date.now();
  sendSafe(player.ws, JSON.stringify({ type: 'playerHealth', uuid: player.uuid, health: player.health }));
  sendSafe(player.ws, JSON.stringify({ type: 'serverJump', reason, room: room.id, dimension: room.meta.dimension, spawn, forceSpawn: true, meta: room.meta, matchState: matchStateFor(room), message: reason === 'respawn' ? 'Respawned at your team island.' : 'Joined room.' }));
}
function eliminatePlayer(room, player, killer) {
  player.role = 'spectator'; player.dead = true; player.health = 0;
  const spawn = { x: 0, y: 82, z: 0 };
  sendSafe(player.ws, JSON.stringify({ type: 'playerHealth', uuid: player.uuid, health: 0 }));
  sendSafe(player.ws, JSON.stringify({ type: 'serverJump', reason: 'eliminated', room: room.id, dimension: room.meta.dimension, spawn, forceSpawn: true, role: 'spectator', meta: room.meta, matchState: matchStateFor(room), message: `Final death${killer ? ` by ${killer.username}` : ''}!` }));
  broadcast(room, JSON.stringify({ type: 'chat', sender: 'BedWars', text: `${player.username} was eliminated${killer ? ` by ${killer.username}` : ''}.` }));
}
function handleCombat(room, attacker, msg) {
  const targetUuid = String(msg.targetUuid || '');
  const target = room.clients.get(targetUuid);
  if (!target || target.uuid === attacker.uuid || attacker.role === 'spectator') return;
  const now = Date.now();
  if (now - (attacker.lastAttackAt || 0) < 380) return;
  const a = attacker.lastMove || getPlayerSpawn(room, attacker);
  const b = target.lastMove || getPlayerSpawn(room, target);
  if (distSq(a, b) > 6.25 * 6.25) return;
  attacker.lastAttackAt = now;
  const requested = clampNumber(msg.damage, 0.5, 9, 1);
  const sharp = isBedWarsRoom(room) ? Number(room.state.upgrades[attacker.team]?.sharpness || 0) : 0;
  const damage = Math.min(10, requested + sharp);
  target.health = Math.max(0, (target.health ?? 20) - damage);
  broadcast(room, JSON.stringify({ type: 'playerDamage', uuid: attacker.uuid, targetUuid: target.uuid, damage, health: target.health, attacker: attacker.username }));
  broadcast(room, JSON.stringify({ type: 'playerHealth', uuid: target.uuid, health: target.health }));
  if (target.health <= 0) {
    if (isBedWarsRoom(room) && target.team && room.state.bedAlive[target.team]) respawnPlayer(room, target, 'respawn');
    else if (isBedWarsRoom(room)) eliminatePlayer(room, target, attacker);
    else respawnPlayer(room, target, 'respawn');
  }
}
function validateMovement(room, player, move) {
  const now = Date.now();
  const last = player.lastMove;
  if (!Number.isFinite(move.x) || !Number.isFinite(move.y) || !Number.isFinite(move.z) || Math.abs(move.x) > 100000 || Math.abs(move.y) > 5000 || Math.abs(move.z) > 100000) return false;
  if (!last) return true;
  const dt = Math.max(0.033, Math.min(0.5, (now - (player.lastMoveAt || now)) / 1000));
  const maxSpeed = isBedWarsRoom(room) ? 15 : 22;
  const maxDist = maxSpeed * dt + 1.25;
  const dx = move.x - last.x, dy = move.y - last.y, dz = move.z - last.z;
  const flatSq = dx * dx + dz * dz;
  if (flatSq > maxDist * maxDist) return false;
  if (dy > 4.25 && dt < 0.25) return false;
  return true;
}
function handleMovement(room, player, data) {
  const move = decodeMove(data);
  if (!validateMovement(room, player, move)) {
    sendSafe(player.ws, JSON.stringify({ type: 'chat', sender: 'AntiCheat', text: 'Movement rejected: too fast or invalid.' }));
    if (player.lastMove) sendSafe(player.ws, JSON.stringify({ type: 'serverJump', reason: 'movement-correction', room: room.id, dimension: room.meta.dimension, spawn: player.lastMove, forceSpawn: true, meta: room.meta, matchState: matchStateFor(room), message: 'Corrected by server movement checks.' }));
    return;
  }
  player.lastMove = move;
  player.lastMoveAt = Date.now();
  if (move.y < -32 || (isBedWarsRoom(room) && move.y < 20)) {
    if (isBedWarsRoom(room) && player.team && room.state.bedAlive[player.team]) respawnPlayer(room, player, 'void-respawn');
    else if (isBedWarsRoom(room)) eliminatePlayer(room, player, null);
    else respawnPlayer(room, player, 'void-respawn');
    return;
  }
  broadcast(room, makeServerMovePacket(player.index, data), player.uuid);
}

async function handleWebSocket(request, env) {
  const upgrade = request.headers.get('Upgrade');
  if (!upgrade || upgrade.toLowerCase() !== 'websocket') return text('Expected WebSocket upgrade.', 426);
  const url = new URL(request.url);
  const session = await authFromRequest(request, env).catch(() => null);
  const requestedRoom = url.searchParams.get('room') || url.searchParams.get('roomCode') || url.searchParams.get('serverId') || 'crownforge_lobby';
  const room = getRoom(requestedRoom);
  const username = cleanUsername(session?.username || url.searchParams.get('username') || 'Steve');
  const uuid = crypto.randomUUID(); const index = room.nextIndex++; const now = Date.now();
  const pair = new WebSocketPair(); const [client, server] = Object.values(pair); server.accept();
  const player = { uuid, index, username, ws: server, joinedAt: now, skinDataUrl: null, lastMove: null, lastMoveAt: 0, lastAttackAt: 0, role: session?.role || 'Player', health: 20, inventory: {}, equipment: {}, team: null, dead: false };
  if (isBedWarsRoom(room)) joinTeam(room, player, url.searchParams.get('team')); else player.lastMove = room.meta.spawn;
  grantStarterInventory(player, room);
  const spawn = getPlayerSpawn(room, player);
  player.lastMove = { ...spawn, yaw: 0, pitch: 0, heldItemId: ITEM.WOOD_SWORD };
  player.lastMoveAt = now;
  room.clients.set(uuid, player);
  const playersList = [...room.clients.values()].filter(p => p.uuid !== uuid).map(p => ({ uuid: p.uuid, index: p.index, username: p.username, skinDataUrl: p.skinDataUrl, role: p.role, team: p.team, health: p.health, lastMove: p.lastMove }));
  sendSafe(server, JSON.stringify({ type: 'welcome', uuid, index, seed: 12345, username, team: player.team, role: player.role, accountId: session?.accountId || null, accountRole: player.role, spawn, serverTime: now, timeOfDay: ((now / 1000 / 600) % 1), protocol: 3, authoritative: true, matchPhase: room.meta.matchPhase || '', matchState: matchStateFor(room), mobAuthorityUuid: [...room.clients.values()][0]?.uuid || uuid, players: room.clients.size, playersList, room: room.id, meta: { ...room.meta, spawn }, inventory: { ...player.inventory }, equipment: player.equipment, modManifest: { version: 1, generatedAt: 0, mods: [] } }));
  sendInventory(player);
  broadcast(room, JSON.stringify({ type: 'join', uuid, index, username, role: player.role, team: player.team, skinDataUrl: null, lastMove: player.lastMove }), uuid);
  if (isBedWarsRoom(room)) broadcast(room, JSON.stringify({ type: 'chat', sender: 'BedWars', text: `${username} joined ${player.team} team.` }), uuid);

  async function handleSocketMessage(rawData) {
    const normalized = await normalizeSocketData(rawData);
    if (normalized.kind === 'binary') {
      const data = normalized.value;
      if (data.byteLength < 1 || data.byteLength > 4096) return;
      const type = new DataView(data).getUint8(0);
      if (type === 1 && data.byteLength >= 23) return handleMovement(room, player, data);
      if (type === 2 && data.byteLength >= 15) return handleBlockEdit(room, player, data);
      return broadcast(room, data, uuid);
    }
    const textPayload = String(normalized.value || '').trim();
    if (!textPayload || (textPayload[0] !== '{' && textPayload[0] !== '[')) return;
    const msg = JSON.parse(textPayload);
    if (msg.type === 'ping') return sendSafe(server, JSON.stringify({ type: 'pong', t: msg.t || Date.now(), serverTime: Date.now() }));
    if (msg.type === 'identity') { if (msg.username) player.username = cleanUsername(msg.username); if (msg.skinDataUrl) player.skinDataUrl = String(msg.skinDataUrl); return; }
    if (msg.type === 'timeRequest') return sendSafe(server, JSON.stringify({ type: 'timeSync', timeOfDay: ((Date.now() / 1000 / 600) % 1), serverTime: Date.now() }));
    if (msg.type === 'syncRequest') return sendSafe(server, JSON.stringify({ type: 'serverInfo', room: room.id, meta: { ...room.meta, spawn: getPlayerSpawn(room, player) }, spawn: getPlayerSpawn(room, player), players: room.clients.size, playersList: [...room.clients.values()].filter(p => p.uuid !== uuid).map(p => ({ uuid: p.uuid, index: p.index, username: p.username, skinDataUrl: p.skinDataUrl, role: p.role, team: p.team, health: p.health, lastMove: p.lastMove })), mobAuthorityUuid: [...room.clients.values()][0]?.uuid || uuid, matchState: matchStateFor(room), inventory: { ...player.inventory }, equipment: player.equipment, modManifest: { version: 1, generatedAt: 0, mods: [] } }));
    if (msg.type === 'chat') return broadcast(room, JSON.stringify({ type: 'chat', sender: player.username, text: String(msg.text || '').slice(0, 240).replace(/[\u0000-\u001F\u007F]/g, '') }));
    if (msg.type === 'skin') { player.skinDataUrl = String(msg.skinDataUrl || '').slice(0, 200000); return broadcast(room, JSON.stringify({ type: 'skin', uuid, username: player.username, skinDataUrl: player.skinDataUrl }), uuid); }
    if (msg.type === 'bedwarsShopPurchase' || msg.type === 'shopPurchase') return handleShopPurchase(room, player, msg);
    if (msg.type === 'inventoryRequest') return sendInventory(player);
    if (msg.type === 'playerDamage') return handleCombat(room, player, msg);
    if (msg.type === 'playerHealth') return sendSafe(player.ws, JSON.stringify({ type: 'playerHealth', uuid: player.uuid, health: player.health }));
    if (msg.type === 'itemPickup') { const itemId = clampNumber(msg.itemId || msg.id, 1, 2000, 0); const count = clampNumber(msg.count, 1, 64, 1); if (itemId) { addInventory(player, itemId, count); sendInventory(player); broadcast(room, JSON.stringify({ ...msg, type: 'itemPickup', uuid } ), uuid); } return; }
    if (msg.type === 'itemDrop') { const itemId = clampNumber(msg.itemId || msg.id, 1, 2000, 0); const count = clampNumber(msg.count, 1, 64, 1); if (itemId && removeInventory(player, itemId, count)) { sendInventory(player); broadcast(room, JSON.stringify({ ...msg, type: 'itemDrop', uuid, itemId, count }), uuid); } return; }
    if (['playerState', 'playerAction', 'blockBreakProgress', 'modPacket', 'weatherSync', 'mobDamage', 'mobSnapshot'].includes(msg.type)) return broadcast(room, JSON.stringify({ ...msg, uuid: msg.uuid || uuid, senderUuid: msg.senderUuid || uuid, username: player.username }), uuid);
  }
  server.addEventListener('message', event => { handleSocketMessage(event.data).catch(err => sendSafe(server, JSON.stringify({ type: 'chat', sender: 'Server', text: `Packet error: ${err?.message || err}` }))); });
  const cleanup = () => { room.clients.delete(uuid); if (isBedWarsRoom(room) && player.team) room.state.teams[player.team] = room.state.teams[player.team].filter(id => id !== uuid); broadcast(room, JSON.stringify({ type: 'leave', uuid })); };
  server.addEventListener('close', cleanup); server.addEventListener('error', cleanup);
  return new Response(null, { status: 101, webSocket: client });
}

async function handleRequest(request, env) {
  cleanIdleRooms();
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  const url = new URL(request.url); const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/ws' || request.headers.get('Upgrade')?.toLowerCase() === 'websocket') return handleWebSocket(request, env);
  if (path === '/' || path === '/status' || path === '/api/status') return json({ game: 'CubeGame', status: 'online', version: GAME_VERSION, websocket: publicWsBase(request), authoritative: true, rooms: roomsList(request) });
  if (path === '/servers' || path === '/api/servers' || path === '/api/featured-servers') return json(featuredServers(request));
  if (path === '/rooms' || path === '/api/rooms') return json(roomsList(request));
  if (path === '/api/share') return json({ publicUrl: publicBase(request), wsUrl: publicWsBase(request), tunnelStatus: 'cloudflare', manualAddressesRequired: false });
  if (path === '/matchmake' || path === '/api/matchmake') { const body = request.method === 'POST' ? await request.json().catch(() => ({})) : {}; const roomId = normalizeRoomId(body.room || body.mode || url.searchParams.get('room') || 'crownforge_lobby'); return json({ ok: true, roomId, wsUrl: `${publicWsBase(request)}?room=${encodeURIComponent(roomId)}` }); }
  if (path === '/api/auth/register' && request.method === 'POST') return handleRegister(request, env);
  if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env);
  if (path === '/api/auth/me') { const session = await authFromRequest(request, env).catch(() => null); if (!session) return json({ ok: false, error: 'Invalid or expired token.' }, 401); return json({ ok: true, username: session.username, accountId: session.accountId, role: session.role || 'Player' }); }
  return json({ ok: false, error: 'Not found', path }, 404);
}
export default { async fetch(request, env) { return handleRequest(request, env); } };

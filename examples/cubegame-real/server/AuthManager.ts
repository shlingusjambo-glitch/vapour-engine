/**
 * AuthManager — username/password auth for CubeGame.
 *
 * Security pass:
 * - PBKDF2 uses the async libuv thread-pool API instead of blocking the game loop.
 * - Account/session JSON writes are atomic temp-file + rename operations.
 * - Expired sessions are pruned on load, validation, login/register, and a timer.
 * - First public registration no longer silently becomes Owner. Bootstrap Owner
 *   with CUBEGAME_BOOTSTRAP_OWNER_USERNAME, or explicitly enable the old local-only
 *   behavior with CUBEGAME_ALLOW_FIRST_LOCAL_OWNER=1.
 * - Legacy SHA-256 login migration is disabled unless
 *   CUBEGAME_ALLOW_LEGACY_PASSWORD_UPGRADE=1 is set.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export type AccountRole = 'Player' | 'Moderator' | 'Admin' | 'Owner';

export interface AccountRecord {
  accountId: string;
  username: string;
  normalizedUsername: string;
  salt: string;
  passwordHash: string;
  passwordAlgorithm?: 'pbkdf2-sha256' | 'sha256-legacy';
  passwordIterations?: number;
  createdAt: number;
  lastLogin: number;
  creationIp?: string;
  lastLoginIp?: string;
  role: AccountRole;
  failedLoginCount?: number;
  lockedUntil?: number;
}

export interface SessionRecord {
  token: string;
  accountId: string;
  username: string;
  normalizedUsername: string;
  role: AccountRole;
  createdAt: number;
  expiresAt: number;
}

export interface ValidatedSession {
  valid: boolean;
  accountId?: string;
  username?: string;
  normalizedUsername?: string;
  role?: AccountRole;
}

const TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 210_000;
const LOGIN_LOCK_THRESHOLD = 6;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const SESSION_PRUNE_INTERVAL_MS = 5 * 60 * 1000;

export class AuthManager {
  private accounts = new Map<string, AccountRecord>();
  private sessions = new Map<string, SessionRecord>();
  private accountsPath: string;
  private sessionsPath: string;

  constructor(dataDir: string) {
    this.accountsPath = path.join(dataDir, 'accounts.json');
    this.sessionsPath = path.join(dataDir, 'sessions.json');
    this.load();

    const pruneTimer = setInterval(() => {
      void this.pruneExpiredSessions(true);
    }, SESSION_PRUNE_INTERVAL_MS);
    pruneTimer.unref?.();
  }

  private normalise(username: string): string {
    return String(username || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_\-]/g, '')
      .slice(0, 24);
  }

  private load(): void {
    try {
      if (fs.existsSync(this.accountsPath)) {
        const raw = JSON.parse(fs.readFileSync(this.accountsPath, 'utf8')) as AccountRecord[];
        if (Array.isArray(raw)) {
          let migrated = false;
          for (const acc of raw) {
            if (!acc.normalizedUsername) continue;
            if (!acc.accountId) { acc.accountId = this.generateAccountId(); migrated = true; }
            if (!acc.role) { acc.role = 'Player'; migrated = true; }
            if (!acc.passwordAlgorithm) { acc.passwordAlgorithm = 'sha256-legacy'; migrated = true; }
            this.accounts.set(acc.normalizedUsername, acc);
          }
          if (migrated) void this.saveAccountsAsync();
        }
      }
    } catch (err) {
      console.error('[Auth] Could not load accounts:', err);
    }

    try {
      if (fs.existsSync(this.sessionsPath)) {
        const raw = JSON.parse(fs.readFileSync(this.sessionsPath, 'utf8')) as SessionRecord[];
        if (Array.isArray(raw)) {
          const now = Date.now();
          for (const s of raw) {
            if (s.expiresAt > now) this.sessions.set(s.token, s);
          }
        }
      }
    } catch (err) {
      console.error('[Auth] Could not load sessions:', err);
    }
  }

  private async writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
    const dir = path.dirname(filePath);
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(tmpPath, JSON.stringify(value, null, 2) + '\n', 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  }

  private async saveAccountsAsync(): Promise<void> {
    try {
      await this.writeJsonFileAtomic(this.accountsPath, Array.from(this.accounts.values()));
    } catch (err) {
      console.error('[Auth] Could not save accounts:', err);
    }
  }

  private async saveSessionsAsync(): Promise<void> {
    try {
      const now = Date.now();
      const valid = Array.from(this.sessions.values()).filter(s => s.expiresAt > now);
      await this.writeJsonFileAtomic(this.sessionsPath, valid);
    } catch (err) {
      console.error('[Auth] Could not save sessions:', err);
    }
  }

  private hashPasswordAsync(salt: string, password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(String(password), salt, iterations, 32, 'sha256', (err, derivedKey) => {
        if (err) reject(err);
        else resolve(derivedKey.toString('hex'));
      });
    });
  }

  private hashLegacy(salt: string, password: string): string {
    return crypto.createHash('sha256').update(salt + password).digest('hex');
  }

  private hashesEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a || '', 'hex');
    const bb = Buffer.from(b || '', 'hex');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }

  private generateSalt(): string { return crypto.randomBytes(32).toString('hex'); }
  private generateToken(): string { return crypto.randomBytes(32).toString('hex'); }
  private generateAccountId(): string { return `acct_${crypto.randomBytes(16).toString('hex')}`; }

  private isLocalIp(ipAddress?: string): boolean {
    const ip = String(ipAddress || '').replace(/^::ffff:/, '');
    return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('10.') || ip.startsWith('192.168.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip);
  }

  private roleForNewAccount(norm: string, ipAddress?: string): AccountRole {
    const bootstrapOwner = this.normalise(process.env.CUBEGAME_BOOTSTRAP_OWNER_USERNAME || '');
    if (bootstrapOwner && bootstrapOwner === norm) return 'Owner';
    if (process.env.CUBEGAME_ALLOW_FIRST_LOCAL_OWNER === '1' && this.accounts.size === 0 && this.isLocalIp(ipAddress)) return 'Owner';
    return 'Player';
  }

  public async register(username: string, password: string, ipAddress?: string): Promise<{ ok: boolean; error?: string; token?: string; accountId?: string; role?: AccountRole }> {
    const norm = this.normalise(username);
    if (!norm || norm.length < 3) return { ok: false, error: 'Username must be at least 3 characters (letters, numbers, _ or -).' };
    if (String(password || '').length < 8) return { ok: false, error: 'Password must be at least 8 characters.' };
    if (this.accounts.has(norm)) return { ok: false, error: 'That username is already taken.' };

    await this.pruneExpiredSessions(false);

    const salt = this.generateSalt();
    const now = Date.now();
    const role = this.roleForNewAccount(norm, ipAddress);
    const record: AccountRecord = {
      accountId: this.generateAccountId(),
      username: username.trim().slice(0, 24),
      normalizedUsername: norm,
      salt,
      passwordHash: await this.hashPasswordAsync(salt, password),
      passwordAlgorithm: 'pbkdf2-sha256',
      passwordIterations: PBKDF2_ITERATIONS,
      createdAt: now,
      lastLogin: now,
      creationIp: ipAddress,
      lastLoginIp: ipAddress,
      role,
      failedLoginCount: 0,
      lockedUntil: 0,
    };
    this.accounts.set(norm, record);
    await this.saveAccountsAsync();

    const token = await this.createSession(record);
    return { ok: true, token, accountId: record.accountId, role: record.role };
  }

  public async login(username: string, password: string, ipAddress?: string): Promise<{ ok: boolean; error?: string; token?: string; displayUsername?: string; accountId?: string; role?: AccountRole }> {
    const norm = this.normalise(username);
    const account = this.accounts.get(norm);
    if (!account) return { ok: false, error: 'Account not found.' };

    const now = Date.now();
    if ((account.lockedUntil || 0) > now) {
      const minutes = Math.ceil(((account.lockedUntil || 0) - now) / 60000);
      return { ok: false, error: `Too many failed login attempts. Try again in ${minutes} minute(s).` };
    }

    const algorithm = account.passwordAlgorithm || 'sha256-legacy';
    if (algorithm === 'sha256-legacy' && process.env.CUBEGAME_ALLOW_LEGACY_PASSWORD_UPGRADE !== '1') {
      return { ok: false, error: 'This account uses a retired legacy password hash. Ask the server owner to enable one-time legacy migration or reset the account.' };
    }

    const expected = algorithm === 'sha256-legacy'
      ? this.hashLegacy(account.salt, password)
      : await this.hashPasswordAsync(account.salt, password, account.passwordIterations || PBKDF2_ITERATIONS);

    if (!this.hashesEqual(expected, account.passwordHash)) {
      account.failedLoginCount = (account.failedLoginCount || 0) + 1;
      if (account.failedLoginCount >= LOGIN_LOCK_THRESHOLD) {
        account.lockedUntil = now + LOGIN_LOCK_MS;
        account.failedLoginCount = 0;
      }
      await this.saveAccountsAsync();
      return { ok: false, error: 'Incorrect password.' };
    }

    if (algorithm === 'sha256-legacy') {
      account.salt = this.generateSalt();
      account.passwordHash = await this.hashPasswordAsync(account.salt, password);
      account.passwordAlgorithm = 'pbkdf2-sha256';
      account.passwordIterations = PBKDF2_ITERATIONS;
    }

    account.lastLogin = now;
    account.lastLoginIp = ipAddress;
    account.failedLoginCount = 0;
    account.lockedUntil = 0;
    await this.saveAccountsAsync();

    const token = await this.createSession(account);
    return { ok: true, token, displayUsername: account.username, accountId: account.accountId, role: account.role };
  }

  public validateToken(token: string): ValidatedSession {
    if (!token) return { valid: false };
    const session = this.sessions.get(token);
    if (!session) return { valid: false };
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(token);
      void this.saveSessionsAsync();
      return { valid: false };
    }
    return {
      valid: true,
      accountId: session.accountId,
      username: session.username,
      normalizedUsername: session.normalizedUsername,
      role: session.role,
    };
  }

  public revokeToken(token: string): void {
    this.sessions.delete(token);
    void this.saveSessionsAsync();
  }

  public async pruneExpiredSessions(save = true): Promise<void> {
    const now = Date.now();
    let changed = false;
    for (const [token, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token);
        changed = true;
      }
    }
    if (changed && save) await this.saveSessionsAsync();
  }

  public hasAccount(username: string): boolean { return this.accounts.has(this.normalise(username)); }
  public accountCount(): number { return this.accounts.size; }

  public getAccountByName(username: string): AccountRecord | null {
    return this.accounts.get(this.normalise(username)) || null;
  }

  public getAccountById(accountId: string): AccountRecord | null {
    for (const acc of this.accounts.values()) {
      if (acc.accountId === accountId) return acc;
    }
    return null;
  }

  public isAdminRole(role?: string): boolean {
    return role === 'Admin' || role === 'Owner';
  }

  private async createSession(account: AccountRecord): Promise<string> {
    const token = this.generateToken();
    const now = Date.now();
    const session: SessionRecord = {
      token,
      accountId: account.accountId,
      username: account.username,
      normalizedUsername: account.normalizedUsername,
      role: account.role,
      createdAt: now,
      expiresAt: now + TOKEN_LIFETIME_MS,
    };
    this.sessions.set(token, session);
    await this.saveSessionsAsync();
    return token;
  }
}

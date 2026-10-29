import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AuthAccount, Identity, Input, Repository } from './model';
import { BusinessError } from './service';
import { verifySession, wechatUserId } from './identity';

export interface AuthContext { identity?: Identity; token?: string; clientKey: string }
export interface AuthService {
  handle(action: string, data: Input, context: AuthContext): Promise<unknown>;
  authenticate(token: string): Promise<Identity>;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fail = (code: string, message: string): never => { throw new BusinessError(code, message); };
const credentialsError = () => fail('AUTH_FAILED', '账号或密码不可用，请检查后重试');
const unauthenticated = () => fail('UNAUTHENTICATED', '登录已失效，请重新登录');
const SESSION_MS = 7 * 24 * 3600000;
const WINDOW_MS = 15 * 60000;
function credentials(data: Input) {
  const username = typeof data.username === 'string' ? data.username.trim().toLowerCase() : '';
  if (!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username) || typeof data.password !== 'string'
    || data.password.length < 10 || data.password.length > 128) return fail('INVALID_INPUT', '账号需3至32位字母、数字或._-，密码需10至128位');
  return { username, password: data.password };
}
function passwordHash(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, Buffer.from(salt, 'hex'), 64,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, value) => error ? reject(error) : resolve(value)));
}
export function createAuthService(repo: Repository, options: { now?: () => number } = {}): AuthService {
  const now = options.now || Date.now;
  async function session(token?: string) {
    const verified = await verifySession(repo, token || '', now());
    return verified || unauthenticated();
  }
  async function throttle(username: string, context: AuthContext, registering: boolean) {
    // Persist attempted requests before password work; failures must not roll this back.
    // The shared username bucket covers both login and register, including unknown accounts.
    const buckets: Array<[string, number]> = [
      [`username/${username}`, 10],
      [`client/${registering ? 'register' : 'login'}/${context.clientKey}`, registering ? 20 : 100],
      [`global/${registering ? 'register' : 'login'}`, registering ? 300 : 2000],
    ];
    await repo.transaction(async unit => {
      const timestamp = now();
      for (const [key, limit] of buckets) {
        const id = hash(key), old = await unit.get('auth_throttles', id);
        const current = old && timestamp - old.windowStart < WINDOW_MS;
        const attempts = current ? old.attempts : 0;
        if (attempts >= limit) return fail('RATE_LIMITED', '尝试过于频繁，请15分钟后重试');
        await unit.put('auth_throttles', { _id: id, windowStart: current ? old.windowStart : timestamp,
          attempts: attempts + 1, expiresAt: timestamp + WINDOW_MS, createdAt: old?.createdAt || timestamp, updatedAt: timestamp });
      }
    });
  }
  async function issue(account: AuthAccount) {
    const token = randomBytes(32).toString('base64url'), tokenHash = hash(token), timestamp = now(), expiresAt = timestamp + SESSION_MS;
    await repo.transaction(async unit => {
      const [current, user] = await Promise.all([unit.get('auth_accounts', account._id), unit.get('users', account.userId)]);
      if (!current || current.status !== 'active' || current.userId !== account.userId || !user || user.status !== 'active'
        || user.username !== account.username) return credentialsError();
      // Fence disable/block against session creation; no credential material is returned.
      await unit.put('auth_accounts', { ...current, updatedAt: timestamp });
      await unit.put('users', { ...user, lastLoginAt: timestamp, updatedAt: timestamp });
      await unit.put('auth_sessions', { _id: tokenHash, tokenHash, userId: user._id, accountId: account._id,
        expiresAt, revokedAt: null, createdAt: timestamp, updatedAt: timestamp });
    });
    return { token, expiresAt, userId: account.userId, username: account.username };
  }
  return {
    async authenticate(token) { return (await session(token)).identity; },
    async handle(action, data, context) {
      if (action === 'me') {
        const wxId = context.identity && wechatUserId(context.identity);
        if (wxId) {
          const user = await repo.get('users', wxId);
          if (!user || user.status !== 'active') return unauthenticated();
          return { userId: user._id, username: user.username || '' };
        }
        const verified = await session(context.token);
        return { userId: verified.session.userId, username: verified.username };
      }
      if (action === 'logout') {
        const verified = await session(context.token);
        await repo.transaction(async unit => {
          const current = await unit.get('auth_sessions', verified.session._id);
          if (current) await unit.put('auth_sessions', { ...current, revokedAt: now(), updatedAt: now() });
        });
        return { success: true };
      }
      if (!['register', 'login', 'bind'].includes(action)) return fail('INVALID_ACTION', '暂不支持此操作');
      // Binding must never accept a session identity or a client supplied userId.
      const wxId = context.identity && wechatUserId(context.identity);
      if (action === 'bind' && !wxId) return fail('FORBIDDEN', '请在原微信账号中绑定登录账号');
      const { username, password } = credentials(data), accountId = hash(`username/${username}`);
      await throttle(username, action === 'bind' ? { ...context, clientKey: `wx/${wxId}` } : context, action !== 'login');
      if (action === 'login') {
        const account = await repo.get('auth_accounts', accountId);
        // Unknown usernames still perform the same expensive KDF and fixed-length comparison.
        const derived = await passwordHash(password, account?.salt || '0'.repeat(32));
        const expected = Buffer.from(account?.passwordHash || '0'.repeat(128), 'hex');
        const matches = expected.length === derived.length && timingSafeEqual(expected, derived);
        if (!account || account.algorithm !== 'scrypt-v1' || account.status !== 'active' || !matches) return credentialsError();
        return issue(account);
      }
      const timestamp = now(), salt = randomBytes(16).toString('hex'), derived = await passwordHash(password, salt);
      const userId = wxId && action === 'bind' ? wxId : randomBytes(20).toString('hex');
      const account: AuthAccount = { _id: accountId, username, userId, algorithm: 'scrypt-v1', salt,
        passwordHash: derived.toString('hex'), status: 'active', createdAt: timestamp, updatedAt: timestamp };
      await repo.transaction(async unit => {
        const [existingAccount, user] = await Promise.all([unit.get('auth_accounts', accountId), unit.get('users', userId)]);
        if (existingAccount || user?.username) return credentialsError();
        if (action === 'bind' && (!user || user.status !== 'active')) return unauthenticated();
        if (action === 'register' && user) return credentialsError();
        await unit.put('auth_accounts', account);
        await unit.put('users', user ? { ...user, username, updatedAt: timestamp } : {
          _id: userId, _openid: '', username, activeFamilyId: '', status: 'active',
          lastLoginAt: timestamp, createdAt: timestamp, updatedAt: timestamp,
        });
      });
      return action === 'bind' ? { userId, username } : issue(account);
    },
  };
}

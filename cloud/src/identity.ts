import { createHash } from 'node:crypto';
import { AuthSession, Identity, Repository } from './model';

const principals = new WeakMap<Identity, string>();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export function wechatUserId(identity: Identity): string | undefined {
  if (!identity || !identity.openid || identity.appid !== 'wx80f51573314b7bd2'
    || !['wx_client', 'wx_devtools'].includes(identity.source)) return undefined;
  return hash(`wx/${identity.appid}/${identity.openid}`).slice(0, 40);
}

// A session principal has no serializable userId or client-selectable trust flag.
// Only verifySession can mint it after a fresh database check. Cloning loses trust.
export function identityUserId(identity: Identity): string | undefined {
  return identity && (principals.get(identity) || wechatUserId(identity));
}

export async function verifySession(repo: Repository, token: string, now: number): Promise<{
  identity: Identity; session: AuthSession; username: string;
} | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await repo.get('auth_sessions', hash(token));
  if (!session || session.tokenHash !== hash(token) || session.revokedAt !== null || session.expiresAt <= now) return null;
  const [user, account] = await Promise.all([repo.get('users', session.userId), repo.get('auth_accounts', session.accountId)]);
  if (!user || user.status !== 'active' || !account || account.status !== 'active'
    || account.userId !== user._id || user.username !== account.username) return null;
  const identity = Object.freeze({ openid: '', appid: '', source: '' });
  principals.set(identity, user._id);
  return { identity, session, username: account.username };
}

import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = 'pbb_session';
const SESSION_SECONDS = 7 * 24 * 60 * 60;

export class AuthError extends Error {
  constructor(message, statusCode = 400, code = 'auth_error') {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class AuthManager {
  constructor(dataDirectory, { now = () => Date.now() } = {}) {
    this.authFile = path.join(dataDirectory, 'auth.json');
    this.dataDirectory = dataDirectory;
    this.now = now;
    this.credentials = null;
    this.setupPromise = null;
  }

  async initialize() {
    await mkdir(this.dataDirectory, { recursive: true });
    try {
      const stored = JSON.parse(await readFile(this.authFile, 'utf8'));
      this.credentials = validateStoredCredentials(stored);
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }

  isConfigured() {
    return Boolean(this.credentials);
  }

  username() {
    return this.credentials?.username || '';
  }

  async setup(username, password) {
    if (this.setupPromise) throw new AuthError('管理员账号正在创建，请稍后重试', 409, 'setup_in_progress');
    this.setupPromise = this.createCredentials(username, password);
    try {
      return await this.setupPromise;
    } finally {
      this.setupPromise = null;
    }
  }

  async createCredentials(username, password) {
    if (this.credentials) throw new AuthError('管理员账号已经创建', 409, 'already_configured');
    const normalizedUsername = validateUsername(username);
    validatePassword(password);
    const salt = randomBytes(16);
    const passwordHash = await scrypt(String(password), salt, 64);
    const credentials = {
      schemaVersion: 1,
      username: normalizedUsername,
      passwordSalt: salt.toString('base64'),
      passwordHash: Buffer.from(passwordHash).toString('base64'),
      sessionSecret: randomBytes(32).toString('base64'),
      createdAt: new Date(this.now()).toISOString()
    };
    await writeAtomic(this.authFile, credentials);
    this.credentials = credentials;
    return normalizedUsername;
  }

  async authenticate(username, password) {
    if (!this.credentials) return false;
    const suppliedUsername = String(username || '').trim();
    if (typeof password !== 'string' || password.length > 128) return false;
    const expected = Buffer.from(this.credentials.passwordHash, 'base64');
    const actual = Buffer.from(await scrypt(password, Buffer.from(this.credentials.passwordSalt, 'base64'), expected.length));
    const passwordMatches = expected.length === actual.length && timingSafeEqual(expected, actual);
    return suppliedUsername === this.credentials.username && passwordMatches;
  }

  createSessionCookie(username = this.username()) {
    const token = this.createSessionToken(username);
    return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
  }

  clearSessionCookie() {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  }

  isRequestAuthenticated(request) {
    const token = parseCookies(request.headers.cookie || '')[COOKIE_NAME];
    return this.verifySessionToken(token);
  }

  createSessionToken(username = this.username()) {
    if (!this.credentials || username !== this.credentials.username) throw new AuthError('管理员账号尚未创建', 409, 'setup_required');
    const payload = Buffer.from(JSON.stringify({
      username,
      expiresAt: this.now() + SESSION_SECONDS * 1000
    })).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verifySessionToken(token) {
    if (!this.credentials || typeof token !== 'string') return false;
    const [payload, suppliedSignature, extra] = token.split('.');
    if (!payload || !suppliedSignature || extra) return false;
    const expectedSignature = this.sign(payload);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return false;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return data.username === this.credentials.username
        && Number.isFinite(Number(data.expiresAt))
        && Number(data.expiresAt) > this.now();
    } catch {
      return false;
    }
  }

  sign(payload) {
    return createHmac('sha256', Buffer.from(this.credentials.sessionSecret, 'base64'))
      .update(payload)
      .digest('base64url');
  }
}

function validateStoredCredentials(value) {
  if (!value || value.schemaVersion !== 1 || typeof value.username !== 'string'
    || !isBase64(value.passwordSalt) || !isBase64(value.passwordHash) || !isBase64(value.sessionSecret)) {
    throw new Error('auth.json 格式无效');
  }
  return value;
}

function validateUsername(value) {
  const username = String(value || '').trim();
  if (username.length < 3 || username.length > 64 || /[\u0000-\u001f\u007f]/.test(username)) {
    throw new AuthError('管理员账号长度需为 3 到 64 个字符');
  }
  return username;
}

function validatePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new AuthError('管理员密码长度需为 8 到 128 个字符');
  }
}

function parseCookies(header) {
  return String(header).split(';').reduce((cookies, item) => {
    const separator = item.indexOf('=');
    if (separator < 0) return cookies;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!key) return cookies;
    try { cookies[key] = decodeURIComponent(value); } catch { cookies[key] = value; }
    return cookies;
  }, {});
}

function isBase64(value) {
  return typeof value === 'string' && value.length >= 16 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

async function writeAtomic(filename, value) {
  const temporary = `${filename}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filename);
}

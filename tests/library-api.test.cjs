const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createApi, hashPassword } = require('../lib/library-server.cjs');
const { BlobPreconditionFailedError } = require('@vercel/blob');

function memoryBlobs() {
  const data = new Map();
  let revision = 0;
  return {
    data,
    async list({ prefix }) { return { blobs: [...data.keys()].filter(key => key.startsWith(prefix)).map(pathname => ({ pathname })), hasMore: false }; },
    async get(key) {
      const item = data.get(key);
      return item && { statusCode: 200, blob: { etag: item.etag }, stream: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(item.body)); c.close(); } }) };
    },
    async put(key, body, options) {
      const item = data.get(key);
      if ((item && !options.allowOverwrite) || (options.ifMatch && item?.etag !== options.ifMatch)) throw Object.assign(new Error('conflict'), { status: 412 });
      data.set(key, { body, etag: String(++revision) });
      return { pathname: key };
    },
    async del(key, options = {}) {
      if (options.ifMatch && data.get(key)?.etag !== options.ifMatch) throw Object.assign(new Error('conflict'), { status: 412 });
      data.delete(key);
    },
  };
}

async function request(handler, method, body, { cookie, origin = 'https://example.test', action = '', id = '' } = {}) {
  const req = Readable.from(body ? [JSON.stringify(body)] : []);
  Object.assign(req, { method, url: `/api/library${action ? '?action=' + action : id ? '?id=' + id : ''}`, headers: { host: 'example.test', origin, 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1', ...(cookie && { cookie }) } });
  const headers = {};
  let status, result;
  await handler(req, { setHeader(key, value) { headers[key.toLowerCase()] = value; }, status(code) { status = code; return this; }, json(value) { result = value; } });
  return { status, result, headers };
}

test('public reads, owner sessions, safe upload, versioned edit, and deletion', async () => {
  const store = memoryBlobs();
  const password = 'test-password-that-is-long';
  const handler = createApi(store, { ADMIN_PASSWORD_HASH: await hashPassword(password), BLOB_READ_WRITE_TOKEN: 'test-only' });
  assert.equal((await request(handler, 'PUT', {})).status, 401);
  assert.equal((await request(handler, 'POST', { password }, { action: 'login', origin: 'https://elsewhere.test' })).status, 403);
  assert.equal((await request(handler, 'POST', { password: 'wrong' }, { action: 'login' })).status, 401);
  const login = await request(handler, 'POST', { password }, { action: 'login' });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.match(login.headers['set-cookie'], /HttpOnly/);
  assert.match(login.headers['set-cookie'], /SameSite=Strict/);
  const program = { title: 'Fibonacci custom', filename: 'CUSTOM.CPP', code: 'int main() { return 0; }' };
  assert.equal((await request(handler, 'PUT', { ...program, filename: '../TC.EXE' }, { cookie })).status, 400);
  assert.equal((await request(handler, 'PUT', { ...program, filename: 'CON.CPP' }, { cookie })).status, 400);
  assert.equal((await request(handler, 'PUT', { ...program, filename: 'MAIN.CPP' }, { cookie })).status, 400, 'The blank startup file must not collide with published programs');
  const created = await request(handler, 'PUT', program, { cookie });
  assert.equal(created.status, 201);
  const id = created.result.program.id;
  const listing = await request(handler, 'GET');
  assert.equal(listing.result.programs[0].title, program.title);
  assert.equal(listing.result.admin, false);
  assert.equal((await request(handler, 'GET', null, { id })).result.program.code, program.code);
  const updated = await request(handler, 'PUT', { ...program, id, revision: created.result.program.revision, title: 'Updated title' }, { cookie });
  assert.equal(updated.status, 200);
  assert.equal((await request(handler, 'PUT', { ...program, id, revision: created.result.program.revision }, { cookie })).status, 409);
  assert.equal((await request(handler, 'DELETE', { id, revision: updated.result.program.revision })).status, 401);
  assert.equal((await request(handler, 'DELETE', { id, revision: updated.result.program.revision }, { cookie })).status, 200);
  assert.equal((await request(handler, 'GET', null, { id })).status, 404);
  assert.equal((await request(handler, 'GET')).result.programs.length, 0);
  const legacy = { ...program, id, filename: 'MAIN.CPP' };
  await store.put('programs/' + id + '.json', JSON.stringify(legacy), { allowOverwrite: false });
  const legacySource = (await request(handler, 'GET', null, { id })).result.program;
  assert.equal(legacySource.code, program.code, 'Existing colliding programs must retain their stored source');
  const renamed = await request(handler, 'PUT', { ...legacySource, filename: 'LEGACY.CPP' }, { cookie });
  assert.equal(renamed.status, 200, 'An owner can repair a legacy startup filename collision by renaming it');
  assert.equal((await request(handler, 'GET', null, { id })).result.program.code, program.code);
});

test('durable login throttling survives a new function instance and missing configuration fails closed', async () => {
  const store = memoryBlobs();
  const env = { ADMIN_PASSWORD_HASH: await hashPassword('another-long-test-password'), BLOB_READ_WRITE_TOKEN: 'test-only' };
  for (let i = 0; i < 8; i++) assert.equal((await request(createApi(store, env), 'POST', { password: 'wrong' }, { action: 'login' })).status, 401);
  assert.equal((await request(createApi(store, env), 'POST', { password: 'wrong' }, { action: 'login' })).status, 429);
  const disabled = await request(createApi(store, {}), 'GET');
  assert.equal(disabled.status, 503);
  assert.equal(disabled.result.configured, false);
});

test('malformed cookies are guests, password changes invalidate sessions, and logout clears the cookie', async () => {
  const store = memoryBlobs();
  const password = 'third-long-test-password';
  const env = { ADMIN_PASSWORD_HASH: await hashPassword(password), BLOB_READ_WRITE_TOKEN: 'test-only' };
  const handler = createApi(store, env);
  const forged = `tc_owner=${Date.now() + 1000000}.${'a'.repeat(24)}.${'é'.repeat(43)}`;
  assert.equal((await request(handler, 'GET', null, { cookie: forged })).status, 200, 'Malformed cookies must not turn public reads into server errors');
  const login = await request(handler, 'POST', { password }, { action: 'login' });
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.equal((await request(handler, 'GET', null, { cookie })).result.admin, true);
  const rotated = createApi(store, { ...env, ADMIN_PASSWORD_HASH: await hashPassword('a-new-strong-test-password') });
  assert.equal((await request(rotated, 'GET', null, { cookie })).result.admin, false);
  const logout = await request(handler, 'POST', {}, { cookie, action: 'logout' });
  assert.match(logout.headers['set-cookie'], /Max-Age=0/);
});

test('real Blob SDK conflicts retry login counters and report stale program writes', async () => {
  const store = memoryBlobs();
  const password = 'sdk-conflict-test-password';
  const handler = createApi(store, { ADMIN_PASSWORD_HASH: await hashPassword(password), BLOB_READ_WRITE_TOKEN: 'test-only' });
  const originalPut = store.put;
  let conflictPath;
  store.put = async (pathname, body, options) => {
    if (pathname === conflictPath) { conflictPath = null; throw new BlobPreconditionFailedError(); }
    return originalPut(pathname, body, options);
  };
  await request(handler, 'POST', { password: 'wrong' }, { action: 'login' });
  conflictPath = '_auth/login-limits.json';
  const login = await request(handler, 'POST', { password }, { action: 'login' });
  assert.equal(login.status, 200, 'A racing login counter update should retry');
  const cookie = login.headers['set-cookie'].split(';')[0];
  const program = { title: 'Conflict test', filename: 'CONFLICT.CPP', code: 'int main() {}' };
  const created = await request(handler, 'PUT', program, { cookie });
  conflictPath = 'programs/' + created.result.program.id + '.json';
  const updated = await request(handler, 'PUT', { ...created.result.program, title: 'Concurrent edit' }, { cookie });
  assert.equal(updated.status, 409, 'A real SDK precondition failure should be reported as a conflict');
});

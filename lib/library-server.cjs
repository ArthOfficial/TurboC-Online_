const { randomBytes, randomUUID, scrypt, timingSafeEqual, createHmac } = require('node:crypto');
const { promisify } = require('node:util');
const { BlobPreconditionFailedError } = require('@vercel/blob');
const deriveKey = promisify(scrypt);
const PREFIX = 'programs/';
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BUILT_INS = new Set(['FIBO.CPP', 'FACT.CPP', 'PRIME.CPP', 'PALIN.CPP', 'SORT.CPP', 'HELLO.CPP']);
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const conflict = error => error instanceof BlobPreconditionFailedError || error.status === 412 || error.statusCode === 412 || /Precondition|AlreadyExists/.test(error.name);

async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 16) throw new Error('Use a password with at least 16 characters.');
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + (await deriveKey(password, salt, 64)).toString('hex');
}

function createApi(blob, env = process.env) {
  const passwordHash = env.ADMIN_PASSWORD_HASH || '';
  const configured = /^[a-f0-9]{32}:[a-f0-9]{128}$/.test(passwordHash) && !!env.BLOB_READ_WRITE_TOKEN;
  const options = { access: 'private', token: env.BLOB_READ_WRITE_TOKEN };
  const sign = text => createHmac('sha256', passwordHash).update(text).digest('base64url');
  const equal = (left, right) => left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
  const isOwner = req => {
    const cookie = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('tc_owner='));
    if (!cookie) return false;
    const [expires, nonce, signature, extra] = cookie.slice(9).split('.');
    return !extra && /^\d+$/.test(expires || '') && /^[a-f0-9]{24}$/.test(nonce || '') && Number(expires) > Date.now() &&
      /^[A-Za-z0-9_-]{43}$/.test(signature || '') && equal(sign(`owner:${expires}.${nonce}`), signature);
  };
  const read = async pathname => {
    const result = await blob.get(pathname, { ...options, useCache: false });
    if (!result) return null;
    return { document: JSON.parse(await new Response(result.stream).text()), revision: result.blob.etag };
  };
  const listPrograms = async () => {
    const programs = [];
    let cursor;
    do {
      const page = await blob.list({ token: env.BLOB_READ_WRITE_TOKEN, prefix: PREFIX, limit: 1000, cursor });
      for (let offset = 0; offset < page.blobs.length; offset += 10) {
        const documents = await Promise.all(page.blobs.slice(offset, offset + 10).map(entry => read(entry.pathname)));
        for (const item of documents) if (item) programs.push({ ...item.document, revision: item.revision });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return programs.sort((a, b) => a.title.localeCompare(b.title));
  };
  const metadata = ({ code, ...program }) => program;
  const bodyOf = async req => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) fail(415, 'Send JSON data.');
    let body = req.body;
    if (body === undefined) {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += Buffer.byteLength(chunk);
        if (size > 96 * 1024) fail(413, 'The program is too large.');
        chunks.push(Buffer.from(chunk));
      }
      body = Buffer.concat(chunks).toString('utf8');
    }
    if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body)) > 96 * 1024) fail(413, 'The program is too large.');
    try { body = typeof body === 'string' ? JSON.parse(body || '{}') : body; }
    catch { fail(400, 'Invalid JSON data.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid program data.');
    return body;
  };
  const throttle = async req => {
    // Persist counters in Blob so cold starts cannot reset the login limit.
    const address = String(req.headers['x-vercel-forwarded-for'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
    const key = sign(`login:${address}`);
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await read('_auth/login-limits.json');
      const now = Date.now();
      const entries = Object.fromEntries(Object.entries(current?.document || {}).filter(([, item]) => item.until > now));
      const counter = entries[key] || { count: 0, until: now + 15 * 60 * 1000 };
      if (counter.count >= 8) fail(429, 'Too many sign-in attempts. Try again in 15 minutes.');
      if (Object.keys(entries).length >= 1000 && !entries[key]) fail(429, 'Sign-in is busy. Try again later.');
      entries[key] = { ...counter, count: counter.count + 1 };
      try {
        await blob.put('_auth/login-limits.json', JSON.stringify(entries), { ...options, addRandomSuffix: false, allowOverwrite: !!current, ...(current && { ifMatch: current.revision }), contentType: 'application/json' });
        return;
      } catch (error) { if (!conflict(error)) throw error; }
    }
    fail(429, 'Sign-in is busy. Try again shortly.');
  };

  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      if (!configured) return res.status(503).json({ configured: false, admin: false, programs: [], error: 'Cloud library is not connected yet.' });
      const url = new URL(req.url, 'https://localhost');
      const action = url.searchParams.get('action');
      const admin = isOwner(req);
      if (req.method === 'GET') {
        const id = url.searchParams.get('id');
        if (id) {
          if (!ID.test(id)) fail(400, 'Invalid program ID.');
          const item = await read(PREFIX + id + '.json');
          if (!item) fail(404, 'This program no longer exists.');
          return res.status(200).json({ program: { ...item.document, revision: item.revision } });
        }
        return res.status(200).json({ configured: true, admin, programs: (await listPrograms()).map(metadata) });
      }
      const protocol = req.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https';
      if (req.headers.origin !== `${protocol}://${req.headers.host}`) fail(403, 'This request must come from this website.');
      if (req.method === 'POST' && action === 'login') {
        await throttle(req);
        const { password } = await bodyOf(req);
        if (typeof password !== 'string' || password.length > 1024) fail(401, 'Incorrect password.');
        const [salt, expected] = passwordHash.split(':');
        const actual = (await deriveKey(password, salt, 64)).toString('hex');
        if (!equal(actual, expected)) fail(401, 'Incorrect password.');
        const value = `${Date.now() + 3600000}.${randomBytes(12).toString('hex')}`;
        res.setHeader('Set-Cookie', `tc_owner=${value}.${sign('owner:' + value)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=3600${protocol === 'https' ? '; Secure' : ''}`);
        return res.status(200).json({ admin: true });
      }
      if (req.method === 'POST' && action === 'logout') {
        res.setHeader('Set-Cookie', `tc_owner=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${protocol === 'https' ? '; Secure' : ''}`);
        return res.status(200).json({ admin: false });
      }
      if (!admin) fail(401, 'Sign in as the owner to manage programs.');
      if (req.method !== 'PUT' && req.method !== 'DELETE') fail(405, 'Method not allowed.');
      const body = await bodyOf(req);
      if (body.id !== undefined && !ID.test(body.id)) fail(400, 'Invalid program ID.');
      const existing = body.id ? await read(PREFIX + body.id + '.json') : null;
      if (body.id && !existing) fail(404, 'This program no longer exists.');
      if (existing && body.revision !== existing.revision) fail(409, 'This program changed. Open it again before saving or deleting.');
      if (req.method === 'DELETE') {
        if (!body.id) fail(400, 'Choose a program to delete.');
        await blob.del(PREFIX + body.id + '.json', { token: env.BLOB_READ_WRITE_TOKEN, ifMatch: existing.revision });
        return res.status(200).json({ deleted: body.id });
      }
      const { title, code } = body;
      const filename = typeof body.filename === 'string' ? body.filename.toUpperCase() : '';
      if (typeof title !== 'string' || !title.trim() || title.trim().length > 80 || /[\x00-\x1f]/.test(title)) fail(400, 'Use a program title of 1–80 characters.');
      if (!/^[A-Z0-9_]{1,8}\.(CPP|C|H|HPP)$/.test(filename)) fail(400, 'Use a DOS filename of up to 8 letters, numbers, or underscores, ending in .CPP, .C, .H, or .HPP.');
      if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])\./.test(filename)) fail(400, 'Choose a filename that is not a reserved DOS device name.');
      if (BUILT_INS.has(filename)) fail(400, 'This filename belongs to a built-in example. Choose a different name.');
      if (typeof code !== 'string' || !code.trim() || code.includes('\0') || Buffer.byteLength(code) > 60 * 1024) fail(400, 'Provide source code up to 60 KB.');
      if ((await listPrograms()).some(program => program.filename === filename && program.id !== body.id)) fail(409, 'Another program already uses this filename.');
      const program = { id: body.id || randomUUID(), title: title.trim(), filename, code, updatedAt: new Date().toISOString() };
      const pathname = PREFIX + program.id + '.json';
      await blob.put(pathname, JSON.stringify(program), { ...options, addRandomSuffix: false, allowOverwrite: !!existing, ...(existing && { ifMatch: existing.revision }), contentType: 'application/json' });
      const saved = await read(pathname);
      return res.status(existing ? 200 : 201).json({ program: { ...program, revision: saved.revision } });
    } catch (error) {
      if (conflict(error)) return res.status(409).json({ error: 'This program changed. Refresh the library and try again.' });
      const status = error.status >= 400 && error.status < 500 ? error.status : 503;
      if (status === 503) console.error('Cloud library error:', error.name);
      return res.status(status).json({ error: status === 503 ? 'Cloud library is temporarily unavailable. Try again later.' : error.message });
    }
  };
}

module.exports = { createApi, hashPassword };

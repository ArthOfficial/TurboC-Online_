const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { createApi, hashPassword } = require('../lib/library-server.cjs');

async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Timed out waiting for the emulator state.');
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const password = 'local-browser-test-password';
  const files = new Map();
  let revision = 0;
  const store = {
    async list({ prefix }) { return { blobs: [...files.keys()].filter(key => key.startsWith(prefix)).map(pathname => ({ pathname })), hasMore: false }; },
    async get(key) { const item = files.get(key); return item && { statusCode: 200, blob: { etag: item.revision }, stream: new Response(item.body).body }; },
    async put(key, body, options) {
      if ((files.has(key) && !options.allowOverwrite) || (options.ifMatch && files.get(key)?.revision !== options.ifMatch)) throw Object.assign(new Error('conflict'), { status: 412 });
      files.set(key, { body, revision: String(++revision) }); return { pathname: key };
    },
    async del(key, options) { if (options.ifMatch && files.get(key)?.revision !== options.ifMatch) throw Object.assign(new Error('conflict'), { status: 412 }); files.delete(key); },
  };
  const api = createApi(store, { ADMIN_PASSWORD_HASH: await hashPassword(password), BLOB_READ_WRITE_TOKEN: 'test-only' });
  const server = createServer(async (req, res) => {
    if (new URL(req.url, 'http://localhost').pathname === '/api/library') {
      req.headers['x-forwarded-proto'] = 'http';
      res.status = status => { res.statusCode = status; return res; };
      res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      return api(req, res);
    }
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const filename = path.resolve(root, '.' + (pathname === '/admin' ? '/admin.html' : pathname.replace(/\/$/, '/index.html')));
    if (!filename.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(filename)] || 'application/octet-stream');
      res.end(await readFile(filename));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url);
    await page.waitForFunction(() => document.querySelectorAll('#example-programs .program-open').length === 6);
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => document.querySelector('#status-dot').classList.contains('online'), null, { timeout: 60000 });
    assert.equal(await page.evaluate(() => TurboWorkspace.filename), 'MAIN.CPP');
    await page.locator('[data-program-id="builtin-fibonacci"]').click();
    await page.waitForFunction(() => TurboWorkspace.filename === 'FIBO.CPP');
    await page.locator('#dos').focus();
    await page.keyboard.press('Control+F9');
    await until(() => page.evaluate(async () => JSON.stringify(await ci.fsTree()).includes('FIBO.EXE')));
    await until(() => page.evaluate(async () => /^FIBO(?:\.EXE)?$/i.test(await ci.getRunningProgram())));
    await page.keyboard.type('8');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    await page.keyboard.press('Space');
    await until(() => page.evaluate(async () => /^TC(?:\.EXE)?$/i.test(await ci.getRunningProgram())));
    await page.locator('[data-program-id="builtin-factorial"]').click();
    await page.waitForFunction(() => window.TurboWorkspace.filename === 'FACT.CPP', null, { timeout: 60000 });
    await page.locator('#dos').focus();
    await page.keyboard.press('Control+F9');
    await until(() => page.evaluate(async () => /^FACT(?:\.EXE)?$/i.test(await ci.getRunningProgram())));
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    await mkdir(path.join(root, 'scratch'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'scratch/factorial-running.png'), fullPage: true });
    const tree = await page.evaluate(() => ci.fsTree());
    assert(JSON.stringify(tree).includes('FACT.EXE'), 'The Factorial example must compile in the real Turbo C++ compiler');
    await page.keyboard.press('Space');
    await until(() => page.evaluate(async () => /^TC(?:\.EXE)?$/i.test(await ci.getRunningProgram())));

    await page.locator('#btn-new-program').click();
    await page.locator('#new-program-filename').fill('CON.CPP');
    await page.locator('#new-program-form button[type=submit]').click();
    await page.waitForFunction(() => document.querySelector('#new-program-message').textContent.includes('reserved DOS'));
    await page.locator('#new-program-filename').fill('NEWFILE.CPP');
    await page.locator('#new-program-form button[type=submit]').click();
    await page.waitForFunction(() => window.TurboWorkspace.filename === 'NEWFILE.CPP');
    await page.locator('#new-program-dialog').waitFor({ state: 'hidden' });
    assert(await page.locator('[data-program-id="working-NEWFILE.CPP"]').isVisible());
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dos', 'A newly created file must be focused for immediate typing');
    const draft = await page.evaluate(() => TurboWorkspace.readFile('NEWFILE.CPP'));
    assert(draft.includes('int main()'));
    await page.locator('#dos').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Home');
    await page.keyboard.type('savededit');
    await page.keyboard.press('F2');
    await page.waitForTimeout(200);
    await page.keyboard.press('Alt+y');
    await page.waitForTimeout(200);
    const editedDraft = await page.evaluate(() => TurboWorkspace.readFile('NEWFILE.CPP'));
    assert(editedDraft.includes('savededit'));
    await page.locator('[data-program-id="builtin-hello"]').click();
    await page.waitForFunction(() => TurboWorkspace.filename === 'HELLO.CPP');
    await page.locator('[data-program-id="working-NEWFILE.CPP"]').click();
    await page.waitForFunction(() => TurboWorkspace.filename === 'NEWFILE.CPP');
    assert.equal(await page.evaluate(() => TurboWorkspace.readFile('NEWFILE.CPP')), editedDraft, 'Switching away and reopening a working file must preserve the saved source');

    const adminPage = await context.newPage();
    adminPage.on('pageerror', error => errors.push(error.message));
    await adminPage.goto(url + '/admin');
    assert.equal((await adminPage.locator('meta[name=robots]').getAttribute('content')).includes('noindex'), true);
    await adminPage.locator('#owner-form').waitFor();
    await adminPage.locator('#owner-password').fill('incorrect');
    await adminPage.locator('#owner-submit').click();
    await adminPage.waitForFunction(() => document.querySelector('#owner-message').textContent.includes('Wrong password'));
    assert.equal(await adminPage.locator('#owner-password').getAttribute('aria-invalid'), 'true');
    assert(await adminPage.locator('#admin-workspace').isHidden(), 'Wrong passwords must not reveal management controls');
    await adminPage.setViewportSize({ width: 390, height: 844 });
    assert(await adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'The admin sign-in form must fit on mobile');
    await adminPage.screenshot({ path: path.join(root, 'scratch/admin-wrong-password.png'), fullPage: true });
    await adminPage.setViewportSize({ width: 1440, height: 1100 });
    await adminPage.locator('#owner-password').fill(password);
    await adminPage.locator('#owner-submit').click();
    await adminPage.locator('#btn-save-program').waitFor();
    await adminPage.locator('#btn-save-program').click();
    await adminPage.locator('#program-upload').setInputFiles({ name: 'MYSUM.CPP', mimeType: 'text/plain', buffer: Buffer.from('int main() { return 0; }') });
    await adminPage.waitForFunction(() => document.querySelector('#program-code').value.includes('int main()'));
    await adminPage.locator('#program-title').fill('Saved Sum');
    await adminPage.locator('#program-submit').click();
    await adminPage.getByRole('button', { name: 'Edit Saved Sum', exact: true }).waitFor();
    await adminPage.reload();
    await adminPage.getByRole('button', { name: 'Edit Saved Sum', exact: true }).click();
    await adminPage.locator('#program-title').fill('Updated Sum');
    await adminPage.locator('#program-code').fill('int main() { return 1; }');
    await context.clearCookies();
    await adminPage.locator('#program-submit').click();
    await adminPage.locator('#owner-form').waitFor();
    await adminPage.locator('#owner-password').fill(password);
    await adminPage.locator('#owner-submit').click();
    await adminPage.locator('#program-dialog').waitFor();
    assert.equal(await adminPage.locator('#program-title').inputValue(), 'Updated Sum', 'Signing in again must restore the unsaved program name');
    assert.equal(await adminPage.locator('#program-code').inputValue(), 'int main() { return 1; }', 'Signing in again must restore unsaved source');
    await adminPage.locator('#program-submit').click();
    await adminPage.getByRole('button', { name: 'Delete Updated Sum', exact: true }).waitFor();

    await page.reload();
    await page.locator('#saved-programs .program-open').waitFor();
    assert.equal(await page.locator('#btn-owner-login, #owner-form, #btn-save-program, .program-row-actions, a[href*="admin"]').count(), 0, 'Even a signed-in owner must only see management controls on /admin');

    const visitor = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const publicPage = await visitor.newPage();
    await publicPage.goto(url);
    await publicPage.locator('#saved-programs .program-open').waitFor();
    assert.equal(await publicPage.locator('#saved-programs .program-row-actions').count(), 0, 'Visitors cannot see owner controls');
    assert.equal(await publicPage.locator('#btn-owner-login, #owner-form, a[href*="admin"]').count(), 0);
    const publicPrograms = await (await publicPage.request.get(url + '/api/library')).json();
    const program = await (await publicPage.request.get(url + '/api/library?id=' + publicPrograms.programs[0].id)).json();
    assert.equal(program.program.code, 'int main() { return 1; }');
    await publicPage.screenshot({ path: path.join(root, 'scratch/program-library-mobile.png'), fullPage: true });
    await visitor.close();

    const slowContext = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const slowPage = await slowContext.newPage();
    const session = await slowContext.newCDPSession(slowPage);
    await session.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await slowPage.goto(url);
    await slowPage.locator('#start-btn').click();
    await slowPage.waitForFunction(() => document.querySelector('#status-dot').classList.contains('online'), null, { timeout: 60000 });
    assert.equal(await slowPage.evaluate(() => TurboWorkspace.filename), 'MAIN.CPP');
    assert.equal(await slowPage.evaluate(() => TurboWorkspace.readFile('MAIN.CPP')), '');
    await slowPage.keyboard.type('slowstartup');
    await slowPage.keyboard.press('F2');
    await slowPage.waitForTimeout(300);
    assert.match(await slowPage.evaluate(() => TurboWorkspace.readFile('MAIN.CPP')), /slowstartup/);
    await slowPage.screenshot({ path: path.join(root, 'scratch/startup-slow.png'), fullPage: true });
    await slowContext.close();

    await adminPage.getByRole('button', { name: 'Delete Updated Sum', exact: true }).click();
    await adminPage.locator('#delete-program-dialog button[data-close-dialog]').click();
    assert(await adminPage.getByRole('button', { name: 'Delete Updated Sum', exact: true }).isVisible(), 'Cancelling deletion must retain the program');
    await adminPage.getByRole('button', { name: 'Delete Updated Sum', exact: true }).click();
    await adminPage.locator('#delete-program-form button[type=submit]').click();
    await adminPage.waitForFunction(() => document.querySelectorAll('#admin-programs .program-row').length === 0);
    await adminPage.locator('#btn-owner-logout').click();
    await adminPage.locator('#owner-form').waitFor();
    assert(await adminPage.locator('#admin-workspace').isHidden());
    await adminPage.screenshot({ path: path.join(root, 'scratch/admin-sign-in.png'), fullPage: true });
    await adminPage.close();
    await page.screenshot({ path: path.join(root, 'scratch/program-library-desktop.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: blank normal/throttled startup, examples compile, new files preserve edits, /admin handles wrong/correct passwords and owner CRUD, public pages have no owner controls, sessions survive reload, and mobile fits');
  } catch (error) {
    console.error('Library status:', await page.locator('#library-status').textContent());
    await page.screenshot({ path: path.join(root, 'scratch/library-failure.png'), fullPage: true });
    throw error;
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

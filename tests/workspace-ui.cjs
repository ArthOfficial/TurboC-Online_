const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  let published = [];
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/api/library') {
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ configured: true, admin: false, programs: published }));
    }
    const filename = path.resolve(root, '.' + (pathname === '/admin' ? '/admin.html' : pathname.replace(/\/$/, '/index.html')));
    if (!filename.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' })[path.extname(filename)] || 'application/octet-stream');
      res.end(await readFile(filename));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    await mkdir(path.join(root, 'scratch'), { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelectorAll('#example-programs .program-open').length === 5);
    const before = await page.locator('.workspace-editor').boundingBox();
    await page.screenshot({ path: path.join(root, 'scratch/workspace-before-launch.png'), fullPage: true });
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => document.querySelector('#status-dot').classList.contains('online'), null, { timeout: 60000 });
    const after = await page.locator('.workspace-editor').boundingBox();
    console.log('Workspace bounds:', { before, after });
    await page.screenshot({ path: path.join(root, 'scratch/workspace-after-launch.png'), fullPage: true });
    assert(Math.abs(before.x + before.width / 2 - 720) < 2, 'The editor must be centered in the viewport before launch');
    assert(Math.abs(after.x + after.width / 2 - 720) < 2, 'The editor must stay centered after launch');
    assert(Math.abs(before.x - after.x) < 2 && Math.abs(before.y - after.y) < 2 && Math.abs(before.width - after.width) < 2, 'Launching must not shift or resize the workspace');
    assert(Math.abs(before.height - after.height) < 2, 'The launch card must reserve the running editor height');
    assert.equal(await page.evaluate(() => TurboWorkspace.filename), 'MAIN.CPP');
    assert.equal(await page.evaluate(() => TurboWorkspace.readFile('MAIN.CPP')), '', 'Startup must open a blank file');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'dos', 'The blank editor must be focused for typing');
    await page.keyboard.type('typedatstartup');
    await page.keyboard.press('F2');
    await page.waitForTimeout(250);
    assert.match(await page.evaluate(() => TurboWorkspace.readFile('MAIN.CPP')), /typedatstartup/);
    assert.equal(await page.locator('#owner-form, #btn-owner-login, #btn-save-program, a[href*="/admin"]').count(), 0, 'The public workspace must have no owner controls or admin link');
    await page.locator('#btn-new-program').click();
    assert(await page.getByText('Create a temporary file for this session.', { exact: true }).isVisible());
    await page.locator('#new-program-dialog [data-close-dialog]').click();
    for (const width of [1280, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `The workspace must fit at ${width}px`);
      const editor = await page.locator('.workspace-editor').boundingBox();
      assert(Math.abs(editor.x + editor.width / 2 - width / 2) < 2, `The editor must be centered at ${width}px`);
    }
    published = [{ id: '5fb19cfe-4b78-4dca-9801-e6690d1f0de1', title: 'Legacy startup collision', filename: 'MAIN.CPP' }];
    const legacyPage = await browser.newPage({ viewport: { width: 390, height: 1000 } });
    await legacyPage.goto(`http://127.0.0.1:${server.address().port}`);
    await legacyPage.locator('#saved-programs .program-open').click();
    await legacyPage.waitForFunction(() => document.querySelector('#library-status').textContent.includes('publisher needs to rename'));
    assert(await legacyPage.locator('#emulator-section').isHidden(), 'Legacy startup collisions must explain the rename instead of silently opening blank source');
    await legacyPage.close();
    await page.close();
    console.log('PASS: stable centered workspace, blank startup file ready for typing, temporary-file wording, and no public owner controls');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

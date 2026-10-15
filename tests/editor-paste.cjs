// Run with Node.js and Playwright available (NODE_PATH may point to its install).
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile, mkdir } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = createServer(async (req, res) => {
    const filename = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
    if (!filename.startsWith(root + path.sep)) return res.writeHead(403).end();
    try {
      const data = await readFile(filename);
      res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(filename)] || 'application/octet-stream');
      res.end(data);
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
      viewport: { width: 1280, height: 1000 },
    });
    page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
    page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure().errorText));
    await page.goto(process.env.APP_URL || `http://127.0.0.1:${server.address().port}`);
    console.log('Local page loaded');
    await page.waitForLoadState('networkidle');
    await page.locator('#start-btn').click();
    await page.waitForFunction(() => window.ci, null, { timeout: 60000 });
    console.log('Emulator ready');
    await page.waitForTimeout(3500);

    const original = 'int main()\r\n{\r\n    return 0;\r\n}\r\n';
    const snippet = 'int value = 42;\n    ';
    await page.locator('#btn-open-paste').click();
    await page.locator('#inject-filename').fill('CHECK.CPP');
    await page.locator('#paste-code-input').fill(original);
    await page.locator('#btn-paste-and-open').click();
    await page.waitForTimeout(3000);
    console.log('File popup:', await page.locator('#toast-msg').textContent());
    await page.waitForFunction(() => document.querySelector('#toast-msg').textContent.includes('Loaded CHECK.CPP'), null, { timeout: 5000 });
    await page.locator('#dos').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Home');
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    await page.evaluate(text => navigator.clipboard.writeText(text), snippet);
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(2000);
    await page.keyboard.press('F2');
    await page.waitForTimeout(400);
    const saved = await page.evaluate(async () => new TextDecoder().decode(await ci.fsReadFile('TURBOC3/BIN/CHECK.CPP')));
    assert.equal(saved, original.replace('    return', '    int value = 42;\r\n    return'), 'Ctrl+V must insert a multiline snippet at the caret without replacing the open file');
    await page.keyboard.type('typed ');
    await page.evaluate(() => navigator.clipboard.writeText('/* pasted */ '));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(2000);
    await page.keyboard.press('F2');
    await page.waitForTimeout(200);
    await page.keyboard.press('Alt+y');
    await page.waitForTimeout(400);
    const repeated = await page.evaluate(async () => new TextDecoder().decode(await ci.fsReadFile('TURBOC3/BIN/CHECK.CPP')));
    assert.equal(repeated, saved.replace('    return', '    typed /* pasted */ return'), 'Repeated paste must continue at the caret and preserve unsaved typing');

    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Home');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight');
    await page.evaluate(() => navigator.clipboard.writeText('long'));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(2000);
    await page.keyboard.press('F2');
    await page.waitForTimeout(200);
    await page.keyboard.press('Alt+y');
    await page.waitForTimeout(400);
    const selected = await page.evaluate(async () => new TextDecoder().decode(await ci.fsReadFile('TURBOC3/BIN/CHECK.CPP')));
    assert.equal(selected, repeated.replace('int main', 'long main'), 'Paste must replace the selected text');

    await page.keyboard.press('Shift+Insert');
    assert(await page.locator('#paste-modal').evaluate(el => el.classList.contains('visible')), 'Shift+Insert must still open the file popup');
    await page.locator('#paste-code-input').fill('ab');
    await page.locator('#paste-code-input').focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    await page.evaluate(() => navigator.clipboard.writeText('X'));
    await page.keyboard.press('Control+v');
    assert.equal(await page.locator('#paste-code-input').inputValue(), 'aXb', 'Native paste in the popup must remain normal textarea editing');
    await page.locator('#paste-code-input').fill('replacement from popup');
    await page.locator('#btn-paste-and-open').click();
    await page.waitForTimeout(3000);
    await page.locator('#dos').focus();
    await page.keyboard.press('F2');
    await page.waitForTimeout(200);
    await page.keyboard.press('Alt+y');
    await page.waitForTimeout(400);
    const sameName = await page.evaluate(async () => new TextDecoder().decode(await ci.fsReadFile('TURBOC3/BIN/CHECK.CPP')));
    assert.equal(sameName, selected, 'The same-name file popup must keep the existing open buffer');

    await page.keyboard.press('F11');
    await page.waitForTimeout(400);
    assert(await page.locator('body').evaluate(el => el.classList.contains('is-fullscreen')), 'Fullscreen must activate');
    await page.locator('#dos').focus();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Home');
    await page.evaluate(() => navigator.clipboard.writeText('\t// fullscreen paste\r\n\r\n'));
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(2000);
    await page.keyboard.press('F2');
    await page.waitForTimeout(200);
    await page.keyboard.press('Alt+y');
    await page.waitForTimeout(400);
    const fullscreen = await page.evaluate(async () => new TextDecoder().decode(await ci.fsReadFile('TURBOC3/BIN/CHECK.CPP')));
    assert.equal(fullscreen, '\t// fullscreen paste\r\n\r\n' + selected, 'Fullscreen paste must preserve tabs and blank lines');
    await page.keyboard.press('F11');
    await page.waitForTimeout(400);

    const credit = page.locator('#arth-attribution-mark');
    assert.equal(await credit.getAttribute('href'), 'https://github.com/ArthOfficial');
    assert((await credit.textContent()).includes('ArthOfficial'));
    await mkdir(path.join(root, 'scratch'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'scratch/editor-paste-desktop.png'), fullPage: true });
    const checkPages = await context.newPage();
    await checkPages.setViewportSize({ width: 390, height: 844 });
    for (const filename of ['index.html', 'shortcuts.html', 'faq.html', 'docs.html']) {
      await checkPages.goto(new URL(filename, page.url()).href);
      const badge = checkPages.locator('#arth-attribution-mark');
      assert(await badge.isVisible(), `Creator credit must be visible on ${filename}`);
      assert.equal(await badge.getAttribute('href'), 'https://github.com/ArthOfficial');
      const box = await badge.boundingBox();
      assert(box.x >= 0 && box.x + box.width <= 390, `Creator credit must fit mobile on ${filename}`);
    }
    await checkPages.screenshot({ path: path.join(root, 'scratch/creator-credit-mobile.png'), fullPage: true });
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    console.log('PASS: cursor insertion, repeated paste, unsaved edits, selection replacement, native popup editing, same-name popup behavior, fullscreen formatting, and desktop/mobile creator credit');
  } catch (error) {
    if (page) {
      console.error('Current toast:', await page.locator('#toast-msg').textContent());
      await page.evaluate(() => document.querySelector('#paste-modal').classList.remove('visible'));
      await mkdir(path.join(root, 'scratch'), { recursive: true });
      await page.screenshot({ path: path.join(root, 'scratch/paste-failure.png') });
    }
    throw error;
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

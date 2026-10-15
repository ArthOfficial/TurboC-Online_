const { createInterface } = require('node:readline/promises');
const { Writable } = require('node:stream');
const { hashPassword } = require('../lib/library-server.cjs');

(async () => {
  if (!process.stdin.isTTY) throw new Error('Run this command in an interactive terminal.');
  const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const prompt = createInterface({ input: process.stdin, output: muted, terminal: true });
  try {
    process.stdout.write('Choose an owner password (16+ characters; input is hidden): ');
    const password = await prompt.question('');
    process.stdout.write('\nRepeat password: ');
    const confirmation = await prompt.question('');
    if (password !== confirmation) throw new Error('Passwords do not match. Run the command again.');
    const hash = await hashPassword(password);
    process.stdout.write('\nSet this server-only Vercel environment variable, then redeploy:\nADMIN_PASSWORD_HASH=' + hash + '\n');
    process.stdout.write('Keep the hash private; do not commit it or put it in browser code.\n');
  } finally { prompt.close(); }
})().catch(error => { process.stderr.write('\n' + error.message + '\n'); process.exitCode = 1; });

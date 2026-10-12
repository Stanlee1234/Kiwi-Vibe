const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createAsk } = require('../confirmation');
const readline = require('node:readline');
const { PassThrough } = require('node:stream');

for (const event of ['SIGINT', 'close', 'EOF']) {
  test(`real readline ${event} denies the pending and next question`, async t => {
    const input = new PassThrough();
    const output = new PassThrough();
    const rl = readline.createInterface({ input, output, terminal: false });
    t.after(() => { rl.close(); input.destroy(); output.destroy(); });
    const ask = createAsk(rl);
    const pending = ask('approve?');
    if (event === 'EOF') input.end();
    else if (event === 'close') rl.close();
    else rl.emit('SIGINT');
    assert.equal(await pending, '');
    assert.equal(await ask('approve next?'), '');
    assert.equal(rl.listenerCount('SIGINT'), 0);
  });
}

test('piped yes cannot authorize a shell command', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-pipe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'executed');
  const command = `touch ${JSON.stringify(marker)}`;
  const script = `require('./shell-tool').executeBash(${JSON.stringify(command)}, async () => require('fs').readFileSync(0, 'utf8')).then(result => console.log(result.error));`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: path.join(__dirname, '..'), input: 'yes\n', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /interactive terminal is required/);
  assert.equal(fs.existsSync(marker), false);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const shell = require('../shell-tool');
const executeBash = (command, confirm) => shell.executeBash(command, confirm, { input: { isTTY: true }, output: { isTTY: true } });

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiwi-shell-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const marker = path.join(dir, 'executed');
  const program = `require("fs").writeFileSync(${JSON.stringify(marker)}, "ok")`;
  const command = `${JSON.stringify(process.execPath)} -e '${program}'`;
  return { marker, command };
}

test('shell commands default to denied without a confirmation callback', async t => {
  const { marker, command } = fixture(t);
  const result = await executeBash(command);
  assert.match(result.error, /confirmation is required/);
  assert.equal(fs.existsSync(marker), false);
});

for (const answer of ['', 'no', 'y', true, undefined]) {
  test(`answer ${JSON.stringify(answer)} does not authorize execution`, async t => {
    const { marker, command } = fixture(t);
    const result = await executeBash(command, async () => answer);
    assert.match(result.error, /declined/);
    assert.equal(fs.existsSync(marker), false);
  });
}

test('shows the exact command and waits for approval before executing once', async t => {
  const { marker, command } = fixture(t);
  let approve;
  let prompts = 0;
  const resultPromise = executeBash(command, prompt => {
    prompts++;
    assert.ok(prompt.includes(JSON.stringify(command)));
    assert.equal(fs.existsSync(marker), false);
    return new Promise(resolve => { approve = resolve; });
  });
  assert.equal(fs.existsSync(marker), false);
  approve('yes');
  const result = await resultPromise;
  assert.equal(prompts, 1);
  assert.equal(fs.readFileSync(marker, 'utf8'), 'ok');
  assert.match(result.output, /successfully/);
});

test('a rejected confirmation never executes the command', async t => {
  const { marker, command } = fixture(t);
  await assert.rejects(executeBash(command, async () => { throw new Error('input closed'); }), /input closed/);
  assert.equal(fs.existsSync(marker), false);
});

test('invalid commands are rejected before prompting', async () => {
  for (const command of ['', '   ', undefined, 123]) {
    const result = await executeBash(command, () => { throw new Error('should not ask'); });
    assert.match(result.error, /non-empty string/);
  }
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../index.js'), 'utf8');

test('production tool executor forwards command confirmation and awaits its result', async () => {
  const executor = source.slice(source.indexOf('async function executeTool'), source.indexOf('\nfunction listFiles'));
  const ask = () => {};
  let observed;
  const context = { getAllowedToolNames: () => ['executeBash'], executeBash: async (command, confirm) => {
    observed = { command, confirm };
    return { output: 'approved result' };
  } };
  vm.createContext(context);
  vm.runInContext(executor, context);
  const result = await context.executeTool('executeBash', { command: 'printf ok' }, ask);
  assert.equal(observed.command, 'printf ok');
  assert.equal(observed.confirm, ask);
  assert.equal(result.output, 'approved result');
});

test('all mode declarations use the replacement summary tool', () => {
  const declarations = source.slice(source.indexOf('const toolDefinitions'), source.indexOf('\nclass OpenAIChatSession'));
  const modes = source.slice(source.indexOf('function getAllowedToolNames'), source.indexOf('\nfunction buildGeminiTools'));
  assert.ok(modes, 'mode selector exists');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${declarations}\n${modes}\nthis.definitions = toolDefinitions;`, context);
  for (const mode of ['agent', 'plan', 'chat']) {
    for (const name of context.getAllowedToolNames(mode)) assert.ok(context.definitions[name], name);
  }
  assert.equal(context.definitions.actionSummary.parameters.required[0], 'summary');
  assert.equal(context.definitions.plan, undefined);
});

test('dispatch blocks file writes and shell calls in chat and plan modes', async () => {
  const executor = source.slice(source.indexOf('async function executeTool'), source.indexOf('\nfunction listFiles'));
  const modes = source.slice(source.indexOf('function getAllowedToolNames'), source.indexOf('\nfunction buildGeminiTools'));
  const context = { executeBash: () => { throw new Error('shell reached'); }, fs: { writeFileSync: () => { throw new Error('write reached'); } } };
  vm.createContext(context);
  vm.runInContext(`${modes}\n${executor}`, context);
  for (const mode of ['chat', 'plan']) {
    for (const name of ['writeFile', 'executeBash']) {
      const result = await context.executeTool(name, {}, () => 'yes', mode);
      assert.match(result.error, /not allowed/);
    }
  }
  assert.match(source, /finally\s*{\s*busy = false/);
});

const { execSync } = require('child_process');

async function executeBash(command, confirmCommand, terminal = { input: process.stdin, output: process.stdout }) {
  if (!terminal.input.isTTY || !terminal.output.isTTY) {
    return { error: 'command not executed: an interactive terminal is required' };
  }
  if (typeof command !== 'string' || !command.trim()) {
    return { error: 'command must be a non-empty string' };
  }
  if (typeof confirmCommand !== 'function') {
    return { error: 'command not executed: user confirmation is required' };
  }

  const answer = await confirmCommand(`\ncommand to run:\n${JSON.stringify(command)}\nrun this command? type yes to approve: `);
  if (typeof answer !== 'string' || answer.trim().toLowerCase() !== 'yes') {
    return { error: 'command not executed: user declined' };
  }

  const output = execSync(command, { encoding: 'utf8', cwd: process.cwd() });
  return { output: output || 'command executed successfully with no output.' };
}

module.exports = { executeBash };

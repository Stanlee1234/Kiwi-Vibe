function createAsk(rl) {
  let closed = false;
  rl.once('close', () => { closed = true; });
  return question => new Promise(resolve => {
    if (closed) return resolve('');
    let settled = false;
    const finish = answer => {
      if (settled) return;
      settled = true;
      rl.removeListener('close', deny);
      rl.removeListener('SIGINT', interrupt);
      resolve(typeof answer === 'string' ? answer.trim() : '');
    };
    const deny = () => finish('');
    const interrupt = () => {
      closed = true;
      rl.close();
      deny();
    };
    rl.once('close', deny);
    rl.once('SIGINT', interrupt);
    rl.question(question, finish);
  });
}
module.exports = { createAsk };

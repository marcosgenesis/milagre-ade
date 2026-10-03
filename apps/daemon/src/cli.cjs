#!/usr/bin/env node
const path = require('node:path');
const { parseArgs } = require('node:util');
const { startDaemon } = require('./server.cjs');
const { connect } = require('./client.cjs');
const { version } = require('../package.json');

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    'data-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('milagre daemon <serve|status|stop|request METHOD [JSON_ARGS]> --data-dir /absolute/path\n\nLocal macOS/Linux daemon. Use a separate profile and close these Projects in older desktop releases.');
    return;
  }
  const command = positionals[0];
  if (!['serve', 'status', 'stop', 'request'].includes(command)) throw new Error('Choose serve, status, stop or request. Use --help for usage.');
  if (!values['data-dir'] || !path.isAbsolute(values['data-dir'])) throw new Error('Pass an absolute --data-dir');
  const dataDir = values['data-dir'];
  if (command === 'serve') {
    if (positionals.length !== 1) throw new Error('Unexpected serve arguments');
    const daemon = await startDaemon({ dataDir, version });
    console.log(JSON.stringify({ status: 'ready', pid: process.pid, dataDir, socketPath: daemon.socketPath }));
    const stop = () => { void daemon.close().catch(error => { console.error(error.message); process.exitCode = 1; }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return;
  }
  const method = command === 'request' ? positionals[1] : `daemon:${command}`;
  if (!method) throw new Error('Pass a method after request');
  if (positionals.length > (command === 'request' ? 3 : 1)) throw new Error('Unexpected command arguments');
  const args = positionals[2] ? JSON.parse(positionals[2]) : [];
  if (!Array.isArray(args)) throw new Error('JSON_ARGS must be an array');
  const client = await connect({ dataDir });
  try { console.log(JSON.stringify(await client.call(method, args), null, 2)); }
  finally { client.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

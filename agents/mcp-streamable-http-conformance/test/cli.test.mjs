import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startFixture } from './fixture-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', 'src', 'cli.mjs');

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('CLI exits zero on a conforming server and never prints bearer secret', async () => {
  const fixture = await startFixture({ echoAuthInError: true });
  try {
    const secret = 'cli-secret-f31c9d';
    const result = await run([fixture.endpoint, '--require-session', '--bearer-env', 'PROBE_TOKEN'], { PROBE_TOKEN: secret });
    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.includes(secret), false);
    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.ok, true);
    assert.equal(report.authenticated, true);
  } finally { await fixture.close(); }
});

test('CLI requires configured bearer env to exist', async () => {
  const result = await run(['http://127.0.0.1:1/mcp', '--bearer-env', 'DEFINITELY_UNSET_PROBE_TOKEN'], { DEFINITELY_UNSET_PROBE_TOKEN: '' });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /empty or unset/);
});

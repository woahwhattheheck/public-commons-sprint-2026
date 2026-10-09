import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildDemoBundle } from '../web/core.mjs';

const cli = fileURLToPath(new URL('../src/verify_browser_bundle_cli.mjs', import.meta.url));

function verifyFile(file) {
  const run = spawnSync(process.execPath, [cli, '--file', file, '--json'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.stderr, '', run.stderr);
  return { exitCode: run.status, receipt: JSON.parse(run.stdout) };
}

test('exported synthetic browser bundle passes offline; forged amount and oversize fail closed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workseal-offline-'));
  try {
    const path = join(dir, 'signed.json');
    const bundle = await buildDemoBundle();
    await writeFile(path, JSON.stringify(bundle));
    const clean = verifyFile(path);
    assert.equal(clean.exitCode, 0);
    assert.equal(clean.receipt.status, 'PASS');
    assert.equal(clean.receipt.independentlyConfirmedProviderEvidence, false);
    assert.equal(clean.receipt.externalAuthorityGranted, false);
    bundle.task.amountAtomic = '12345';
    await writeFile(path, JSON.stringify(bundle));
    const tampered = verifyFile(path);
    assert.equal(tampered.exitCode, 1);
    assert.equal(tampered.receipt.status, 'HOLD');
    await writeFile(path, Buffer.alloc(2 * 1024 * 1024 + 1, 32));
    const oversized = verifyFile(path);
    assert.equal(oversized.exitCode, 1);
    assert.match(oversized.receipt.reason, /2 MiB/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

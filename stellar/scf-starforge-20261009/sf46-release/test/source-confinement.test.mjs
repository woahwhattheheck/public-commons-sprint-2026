// MIT. One focused regression for the SF46 offline source-confinement guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assessRelease, gitBlobSha } from '../preflight.mjs';

test('release preflight rejects an off-tree symlink but permits an in-tree one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sf46-in-'));
  const outside = await mkdtemp(join(tmpdir(), 'sf46-out-'));
  const fixture = 'genuine-source-bytes\n';
  const digest = gitBlobSha(Buffer.from(fixture));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    const external = join(outside, 'module0.mjs');
    await writeFile(external, fixture);
    await writeFile(join(root, 'src', 'canonical.mjs'), fixture);
    await symlink(external, join(root, 'src', 'module0.mjs'));
    await symlink(join(root, 'src', 'canonical.mjs'), join(root, 'src', 'module1.mjs'));
    for (let i = 2; i < 8; i++) {
      await writeFile(join(root, 'src', 'module' + i + '.mjs'), fixture);
    }
    const manifestPath = join(root, 'pins.json');
    await writeFile(manifestPath, JSON.stringify({
      schema: 'stellar-forge.release-pins.v1',
      sources: Array.from({length: 8}, (_, i) => ({
        id: 'source_' + i, path: 'src/module' + i + '.mjs',
        sha: digest, exports: []
      })),
      gates: []
    }));
    const report = await assessRelease({ root, manifestPath, strictPins: true });
    // Both symlinks point at identical pinned bytes. Reading the unchecked
    // off-tree target would incorrectly have reported PIN_MATCH.
    assert.equal(report.sources[0].status, 'UNSAFE_PATH');
    assert.equal(report.sources[0].actualGitBlob, null);
    assert.ok(report.failures.includes('source_0: UNSAFE_PATH'));
    assert.equal(report.sources[1].status, 'PIN_MATCH');
    assert.ok(report.sources.slice(2).every(row => row.status === 'PIN_MATCH'));
    assert.equal(report.status, 'FAIL_SOURCE_PREFLIGHT');
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

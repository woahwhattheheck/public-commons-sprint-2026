import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { buildPublicRelease, loadManifest, sha256 } from '../release/gate-lib.mjs';

const execFile = promisify(execFileCallback);

async function git(cwd, ...args) {
  const { stdout } = await execFile('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return stdout.trim();
}

async function fixture(files = { 'README.md': 'hello\n', 'src/app.mjs': 'export const x=1;\n' }, limits = {}) {
  const base = await mkdtemp(path.join(os.tmpdir(), 'release-gate-v2-'));
  const repo = path.join(base, 'repo');
  const root = path.join(repo, 'project');
  const release = path.join(root, 'release');
  const out = path.join(base, 'public');
  await mkdir(release, { recursive: true });
  for (const [rel, value] of Object.entries(files)) {
    const p = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, value);
  }
  const manifestPath = path.join(release, 'public-release.manifest.json');
  const manifest = {
    version: 1,
    project: 'fixture',
    maxFiles: limits.maxFiles ?? 32,
    maxFileBytes: limits.maxFileBytes ?? 1024,
    maxTotalBytes: limits.maxTotalBytes ?? 4096,
    files: Object.keys(files).map((source) => ({ source })),
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await git(base, 'init', repo);
  await git(repo, 'config', 'user.email', 'fixture@example.invalid');
  await git(repo, 'config', 'user.name', 'fixture');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'fixture');
  const sourceCommit = await git(repo, 'rev-parse', 'HEAD');
  return { base, repo, root, out, manifestPath, manifest, sourceCommit };
}

async function commitFixture(f, message = 'update') {
  await git(f.repo, 'add', '-A');
  await git(f.repo, 'commit', '-m', message);
  f.sourceCommit = await git(f.repo, 'rev-parse', 'HEAD');
  return f.sourceCommit;
}

const code = async (promise, expected) => assert.rejects(promise, (error) => error?.code === expected, `expected ${expected}`);

test('stages exact committed bytes and v2 receipt binds Git objects', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const receipt = await buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit });
  assert.equal(receipt.schema, 'hearthline-public-release/v2');
  assert.equal(receipt.sourceCommit, f.sourceCommit);
  assert.match(receipt.manifest.gitBlobSha, /^[0-9a-f]{40}$/);
  assert.match(receipt.manifest.sha256, /^[0-9a-f]{64}$/);
  assert.equal(await readFile(path.join(f.out, 'README.md'), 'utf8'), 'hello\n');
  const readme = receipt.files.find((row) => row.source === 'README.md');
  assert.equal(readme.sha256, sha256(Buffer.from('hello\n')));
  assert.equal(readme.gitBlobSha, await git(f.repo, 'rev-parse', `${f.sourceCommit}:project/README.md`));
  assert.deepEqual(JSON.parse(await readFile(path.join(f.out, 'PUBLIC_RELEASE_RECEIPT.json'), 'utf8')), receipt);
});

test('same committed inputs yield same receipt hash', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const a = await buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit });
  const b = await buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: `${f.out}-2`, sourceCommit: f.sourceCommit });
  assert.equal(a.receiptSha256, b.receiptSha256);
});

test('dirty working-tree source and manifest cannot change committed export', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  await writeFile(path.join(f.root, 'README.md'), `sk_live_${'x'.repeat(24)}\n`);
  await writeFile(f.manifestPath, JSON.stringify({ ...f.manifest, project: 'dirty', files: [{ source: 'src/app.mjs' }] }));
  const receipt = await buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit });
  assert.equal(receipt.project, 'fixture');
  assert.equal(await readFile(path.join(f.out, 'README.md'), 'utf8'), 'hello\n');
  assert.equal(receipt.files.length, 2);
});

test('requires source commit to exist exactly in source repository', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: 'a'.repeat(40) }), 'INVALID_SOURCE_COMMIT');
  for (const value of ['deadbeef', 'A'.repeat(40), 'g'.repeat(40)]) {
    await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: `${f.out}-${value.slice(0, 4)}`, sourceCommit: value }), 'INVALID_SOURCE_COMMIT');
  }
});

test('committed symlink source is rejected even if working tree target is regular', async (t) => {
  const f = await fixture({ 'README.md': 'safe\n' }); t.after(() => rm(f.base, { recursive: true, force: true }));
  const target = path.join(f.root, 'real.txt');
  const link = path.join(f.root, 'link.txt');
  await writeFile(target, 'safe target\n');
  await symlink('real.txt', link);
  f.manifest.files = [{ source: 'link.txt' }];
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await commitFixture(f, 'symlink fixture');
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'SYMLINK_SOURCE');
});

test('committed directory entry is rejected as non-regular source', async (t) => {
  const f = await fixture({ 'README.md': 'safe\n', 'dir/child.txt': 'child\n' }); t.after(() => rm(f.base, { recursive: true, force: true }));
  f.manifest.files = [{ source: 'dir', destination: 'dir.txt' }];
  await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await commitFixture(f, 'directory manifest');
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'NON_REGULAR_SOURCE');
});

test('rejects existing final destination and broken symlink final destination', async (t) => {
  let f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  await mkdir(f.out);
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'DESTINATION_EXISTS');

  f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  await symlink(path.join(f.base, 'missing'), f.out);
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'DESTINATION_EXISTS');
});

test('rejects destination inside private source root', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: path.join(f.root, 'out'), sourceCommit: f.sourceCommit }), 'INVALID_DESTINATION');
});

test('rejects symlinked destination parent whose real target is private source root', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const alias = path.join(f.base, 'alias');
  await symlink(f.root, alias, 'dir');
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: path.join(alias, 'public'), sourceCommit: f.sourceCommit }), 'INVALID_DESTINATION');
});

test('rejects even otherwise-safe symlinked destination parent ancestry', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const realParent = path.join(f.base, 'real-parent');
  const alias = path.join(f.base, 'safe-alias');
  await mkdir(realParent);
  await symlink(realParent, alias, 'dir');
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: path.join(alias, 'public'), sourceCommit: f.sourceCommit }), 'INVALID_DESTINATION');
});

test('late destination creation after source validation fails without overwriting', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  await code(buildPublicRelease({
    root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit,
    _testHooks: { afterValidation: async () => { await mkdir(f.out); await writeFile(path.join(f.out, 'marker'), 'foreign\n'); } },
  }), 'DESTINATION_EXISTS');
  assert.equal(await readFile(path.join(f.out, 'marker'), 'utf8'), 'foreign\n');
});

test('destination replacement after atomic reserve fails closed and preserves replacement', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const moved = `${f.out}-moved`;
  await code(buildPublicRelease({
    root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit,
    _testHooks: { afterReserve: async () => {
      await rename(f.out, moved);
      await mkdir(f.out);
      await writeFile(path.join(f.out, 'marker'), 'replacement\n');
    } },
  }), 'DESTINATION_IDENTITY_CHANGED');
  assert.equal(await readFile(path.join(f.out, 'marker'), 'utf8'), 'replacement\n');
  await assert.rejects(readFile(path.join(f.out, 'PUBLIC_RELEASE_RECEIPT.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(moved, 'PUBLIC_RELEASE_RECEIPT.json')), { code: 'ENOENT' });
  const aborted = JSON.parse(await readFile(path.join(moved, 'PUBLIC_RELEASE_ABORTED.json'), 'utf8'));
  assert.equal(aborted.code, 'DESTINATION_IDENTITY_CHANGED');
});

test('abort boundary name swap cannot make cleanup delete a foreign replacement', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const moved = `${f.out}-moved`;
  await assert.rejects(buildPublicRelease({
    root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit,
    _testHooks: {
      afterReserve: async () => { throw new Error('forced post-reserve failure'); },
      beforeAbort: async () => {
        await rename(f.out, moved);
        await mkdir(f.out);
        await writeFile(path.join(f.out, 'foreign-sentinel'), 'must survive\n');
      },
    },
  }), /forced post-reserve failure/);
  assert.equal(await readFile(path.join(f.out, 'foreign-sentinel'), 'utf8'), 'must survive\n');
  await assert.rejects(readFile(path.join(f.out, 'PUBLIC_RELEASE_ABORTED.json')), { code: 'ENOENT' });
  const aborted = JSON.parse(await readFile(path.join(moved, 'PUBLIC_RELEASE_ABORTED.json'), 'utf8'));
  assert.equal(aborted.code, 'EXPORT_FAILED');
  await assert.rejects(readFile(path.join(moved, 'PUBLIC_RELEASE_RECEIPT.json')), { code: 'ENOENT' });
});

test('replacement at final visibility boundary removes owned receipt and preserves foreign destination', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const moved = `${f.out}-moved`;
  await code(buildPublicRelease({
    root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit,
    _testHooks: { beforeFinalVisibilityCheck: async () => {
      await rename(f.out, moved);
      await mkdir(f.out);
      await writeFile(path.join(f.out, 'foreign-sentinel'), 'must survive\n');
    } },
  }), 'DESTINATION_IDENTITY_CHANGED');
  assert.equal(await readFile(path.join(f.out, 'foreign-sentinel'), 'utf8'), 'must survive\n');
  await assert.rejects(readFile(path.join(f.out, 'PUBLIC_RELEASE_RECEIPT.json')), { code: 'ENOENT' });
  await assert.rejects(readFile(path.join(moved, 'PUBLIC_RELEASE_RECEIPT.json')), { code: 'ENOENT' });
  const aborted = JSON.parse(await readFile(path.join(moved, 'PUBLIC_RELEASE_ABORTED.json'), 'utf8'));
  assert.equal(aborted.code, 'DESTINATION_IDENTITY_CHANGED');
});

test('rejects traversal, duplicate sources, and duplicate destinations in manifest', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  f.manifest.files = [{ source: '../x' }]; await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await code(loadManifest(f.manifestPath), 'UNSAFE_PATH');
  f.manifest.files = [{ source: 'README.md' }, { source: 'README.md', destination: 'x' }]; await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await code(loadManifest(f.manifestPath), 'DUPLICATE_SOURCE');
  f.manifest.files = [{ source: 'README.md', destination: 'x' }, { source: 'src/app.mjs', destination: 'x' }]; await writeFile(f.manifestPath, JSON.stringify(f.manifest));
  await code(loadManifest(f.manifestPath), 'DUPLICATE_DESTINATION');
});

test('rejects forbidden filenames from committed manifest', async (t) => {
  const f = await fixture({ '.env': 'PLACEHOLDER=1\n' }); t.after(() => rm(f.base, { recursive: true, force: true }));
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'UNSAFE_FILENAME');
});

for (const [name, secret] of [
  ['private-key', ['-----BEGIN ', 'PRIVATE KEY-----\nabc'].join('')],
  ['aws', `AKIA${'Z'.repeat(16)}`],
  ['github', `ghp_${'a'.repeat(30)}`],
  ['slack', `xoxb-${'a'.repeat(24)}`],
  ['stripe', `sk_live_${'a'.repeat(24)}`],
  ['google', `AIza${'A'.repeat(35)}`],
  ['bearer', `Bearer ${'a'.repeat(32)}`],
  ['url', `https://x.test/?access_token=${'a'.repeat(20)}`],
]) test(`rejects committed ${name} signature`, async (t) => {
  const f = await fixture({ 'src/app.mjs': secret }); t.after(() => rm(f.base, { recursive: true, force: true }));
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'SECRET_DETECTED');
});

test('rejects committed invalid UTF-8', async (t) => {
  const f = await fixture({ 'src/app.mjs': Buffer.from([0xc3, 0x28]) }); t.after(() => rm(f.base, { recursive: true, force: true }));
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'NON_UTF8_SOURCE');
});

test('enforces committed per-file and aggregate byte ceilings before destination reservation', async (t) => {
  let f = await fixture({ 'a.txt': '12345' }, { maxFileBytes: 4 }); t.after(() => rm(f.base, { recursive: true, force: true }));
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'FILE_TOO_LARGE');
  await assert.rejects(readFile(path.join(f.out, 'PUBLIC_RELEASE_RECEIPT.json')), { code: 'ENOENT' });

  f = await fixture({ 'a.txt': '1234', 'b.txt': '5678' }, { maxTotalBytes: 7 }); t.after(() => rm(f.base, { recursive: true, force: true }));
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination: f.out, sourceCommit: f.sourceCommit }), 'TOTAL_TOO_LARGE');
  await assert.rejects(readFile(path.join(f.out, 'PUBLIC_RELEASE_RECEIPT.json')), { code: 'ENOENT' });
});

test('rejects manifest path outside source root even if file exists', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const outside = path.join(f.repo, 'outside.json');
  await writeFile(outside, JSON.stringify(f.manifest));
  await git(f.repo, 'add', '.'); await git(f.repo, 'commit', '-m', 'outside manifest');
  const commit = await git(f.repo, 'rev-parse', 'HEAD');
  await code(buildPublicRelease({ root: f.root, manifestPath: outside, destination: f.out, sourceCommit: commit }), 'INVALID_MANIFEST');
});

test('destination parent must pre-exist', async (t) => {
  const f = await fixture(); t.after(() => rm(f.base, { recursive: true, force: true }));
  const destination = path.join(f.base, 'missing-parent', 'public');
  await code(buildPublicRelease({ root: f.root, manifestPath: f.manifestPath, destination, sourceCommit: f.sourceCommit }), 'INVALID_DESTINATION');
});

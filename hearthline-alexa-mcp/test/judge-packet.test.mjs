import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildJudgePacket, canonicalJson } from '../judge/packet.mjs';
import { gitBlobSha, verifyJudgePacket } from '../judge/verify.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('judge verifier binds all 47 public source blobs and the executable mode', async () => {
  const report = await verifyJudgePacket({ rootDir });
  assert.equal(report.schema, 'hearthline-judge-verification/v1');
  assert.equal(report.ok, true);
  assert.equal(report.sourceFiles, 47);
  assert.equal(report.executableFiles, 1);
  assert.equal(report.sourceCommit, '404ddba708a97755a716874e58301202abbb13d9');
  assert.equal(report.manifestBlob, '59c095074c58375c2598278cd6dda9a8250f2be6');
});

test('Git blob hashing matches the canonical Git object identity algorithm', () => {
  assert.equal(gitBlobSha(Buffer.from('hello\n')), 'ce013625030ba8dba906f756967f9e9ca394464a');
});

test('one-byte public source drift fails the judge gate', async () => {
  const target = path.join(rootDir, 'README.md');
  const readFileImpl = async (file, options) => {
    if (file === target && options === undefined) return Buffer.from('tampered\n');
    return readFile(file, options);
  };
  await assert.rejects(
    () => verifyJudgePacket({ rootDir, readFileImpl }),
    (error) => error?.code === 'SOURCE_BLOB_MISMATCH',
  );
});

test('a manufactured external submission claim fails closed', async () => {
  const target = path.join(rootDir, 'judge', 'submission-fields.json');
  const readFileImpl = async (file, options) => {
    if (file === target && options === 'utf8') {
      const value = JSON.parse(await readFile(file, 'utf8'));
      value.truthBoundary.devpostSubmitted = true;
      return JSON.stringify(value);
    }
    return readFile(file, options);
  };
  await assert.rejects(
    () => verifyJudgePacket({ rootDir, readFileImpl }),
    (error) => error?.code === 'SUBMISSION_CLAIM_TRUE',
  );
});

test('judge packet compilation is byte-deterministic and preserves every false external claim', async () => {
  const first = canonicalJson(await buildJudgePacket({ rootDir }));
  const second = canonicalJson(await buildJudgePacket({ rootDir }));
  assert.equal(first, second);
  const packet = JSON.parse(first);
  assert.equal(packet.schema, 'hearthline-judge-packet/v1');
  assert.equal(packet.reproducibility.deterministic, true);
  assert.equal(packet.reproducibility.networkRequired, false);
  assert.equal(packet.reproducibility.credentialsRequired, false);
  assert(Object.values(packet.truthBoundary).every((value) => value === false));
  assert(packet.ownerActionsRequired.length >= 5);
});

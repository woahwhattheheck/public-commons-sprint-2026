import test from 'node:test';
import assert from 'node:assert/strict';
import { compareArtifactManifests, artifactDeltaMarkdown } from '../src/artifact_diff.mjs';

const hex = char => char.repeat(64);
const manifest = files => ({ schema: 'workseal-artifact-manifest/v1', files });
test('artifact delta reports missing, changed and unexpected without implying acceptance', () => {
  const expected = manifest([
    { path: 'a.txt', bytes: 3, sha256: hex('a') },
    { path: 'b.txt', bytes: 5, sha256: hex('b') },
    { path: 'c.txt', bytes: 7, sha256: hex('c') },
  ]);
  const observed = manifest([
    { path: 'a.txt', bytes: 3, sha256: hex('a') },
    { path: 'b.txt', bytes: 8, sha256: hex('d') },
    { path: 'd.txt', bytes: 9, sha256: hex('e') },
  ]);
  const delta = compareArtifactManifests(expected, observed);
  assert.equal(delta.comparison, 'DIFFERENT_DECLARATION');
  assert.deepEqual(delta.totals, { matched: 1, changed: 1, missing: 1, unexpected: 1 });
  assert.deepEqual(delta.changes.map(item => [item.path, item.kind]), [
    ['b.txt', 'CHANGED'], ['c.txt', 'MISSING'], ['d.txt', 'UNEXPECTED'],
  ]);
  assert.equal(delta.authority.acceptanceEvaluated, false);
  assert.equal(delta.authority.settlementAuthorized, false);
  assert.match(artifactDeltaMarkdown(delta), /DIFFERENT_DECLARATION/);
  assert.equal(compareArtifactManifests(expected, expected).comparison, 'SAME_DECLARATION');
  assert.throws(() => compareArtifactManifests(expected, manifest([
    { path: '../escape', bytes: 1, sha256: hex('f') },
  ])));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CANONICAL, validateHandoff, validatePrograms, selectPrograms } from './handoff.mjs';

const sample = JSON.parse(readFileSync(new URL('./programs.json', import.meta.url), 'utf8'));
const good = { ...CANONICAL, audioMode: 'existing-provider-link', archiveMode: 'existing-provider-link', cms: 'wordpress-core' };

test('KZFR source URLs and buyer handoff are approved', () => {
  assert.deepEqual(validateHandoff(good), []);
  assert.deepEqual(validatePrograms(sample.programs), []);
});
test('unapproved donation origin is rejected', () => {
  assert.ok(validateHandoff({ ...good, donate: 'https://kzfr-donate.creek.org.example.org/' }).length);
});
test('donation URLs require approved HTTPS origin and no query parameters', () => {
  for (const donate of ['http://kzfr-donate.creek.org/', 'https://kzfr-donate.creek.org/?item=1']) {
    assert.ok(validateHandoff({ ...good, donate }).length, donate);
  }
});
test('buyer remains on WordPress and original audio platform', () => {
  assert.ok(validateHandoff({ ...good, cms: 'custom-static' }).length);
  assert.ok(validateHandoff({ ...good, archiveMode: 'local-rehost' }).length);
  assert.ok(validateHandoff({ ...good, audioMode: 'new-unverified-stream' }).length);
});
test('published programs are filtered without mutating inputs', () => {
  const before = JSON.stringify(sample.programs);
  assert.deepEqual(selectPrograms(sample.programs, { category: 'Jazz' }).map(r => r.name), ['2-Penny Opera']);
  assert.deepEqual(selectPrograms(sample.programs, { query: 'swing' }).map(r => r.name), ['Swing City']);
  assert.deepEqual(selectPrograms(sample.programs, { query: 'not-a-show' }), []);
  assert.equal(JSON.stringify(sample.programs), before);
});
test('duplicate schedule keys and synthetic source redirects are caught', () => {
  assert.ok(validatePrograms([...sample.programs, sample.programs[0]]).some(x => x.includes('duplicate')));
  assert.ok(validatePrograms([{ ...sample.programs[0], source: 'https://not-creek.example/' }]).length);
});

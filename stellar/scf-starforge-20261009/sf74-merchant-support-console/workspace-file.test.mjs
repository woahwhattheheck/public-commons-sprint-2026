// MIT. Focused local file-transport checks; these are not merchant/payment results.
import test from 'node:test';
import assert from 'node:assert/strict';
import {serializeWorkspace, parseWorkspace, encodeSource, decodeSource,
  MAX_SOURCE_BYTES, workspaceFilename} from './workspace-file.mjs';
const encoder = new TextEncoder();
const encode = text => encodeSource(encoder.encode(text));
const intake = '{ "schema": "stellar-forge.merchant-intake.v1", "state":"INCONCLUSIVE", "note":"Illustrative café 東京" }\r\n';
const post = '{"schema":"stellar-forge.post-only-browser-preflight.v1","status":"ILLUSTRATIVE"}\n';
const now = '2026-10-11T13:20:00.000Z';
const base = () => ({name:'Café merchant / unfinished', inputs:{resource:'https://seller.example/draft',
  method:'POST', credentialed:true}, sources:{intake:encode(intake), before:encode(intake),
  preflight:encode(post), postBefore:encode(post)}, termsText:'{ "unfinished": ', baselineOnly:true});

test('save, close, reopen: exact capture bytes, deduplication and unfinished terms survive', async () => {
  const file = await serializeWorkspace(base(), {now});
  const saved = JSON.parse(file);
  assert.equal(Object.keys(saved.blobs).length, 2);
  assert.equal(saved.sources.intake, saved.sources.before);
  const state = await parseWorkspace(file);
  assert.equal(state.savedAt, now);
  assert.deepEqual(state.inputs, {resource:'https://seller.example/draft', catalog:'', origin:'',
    network:'', payTo:'', method:'POST', credentialed:true});
  assert.equal(new TextDecoder().decode(decodeSource(state.sources.intake)), intake);
  assert.equal(state.termsText, base().termsText);
  assert.equal(state.sources.after, null);
  assert.equal(state.summary.sourceCount, 4);
  assert.equal(state.summary.uniqueSourceCount, 2);
  assert.equal(state.baselineOnly, true);
  const {savedAt, summary, ...resavable} = state;
  assert.equal(await serializeWorkspace(resavable, {now}), file);
  assert.equal(workspaceFilename('../../Café case?'), 'Cafe-case.merchant-workspace.json');
});

test('corrupted, foreign and permission-bearing files reject before restoration', async () => {
  const file = JSON.parse(await serializeWorkspace(base(), {now}));
  const check = async mutate => {
    const changed = structuredClone(file); mutate(changed);
    await assert.rejects(parseWorkspace(JSON.stringify(changed)), TypeError);
  };
  await check(f => { f.blobs[f.sources.before].data = encode(intake.replace('INCONCLUSIVE', 'CHANGED')); });
  await check(f => { f.blobs[f.sources.before].bytes++; });
  await check(f => { f.sources.before = f.sources.preflight; });
  await check(f => { f.sources.before = 'a'.repeat(64); });
  await check(f => { f.sources.after = '../arbitrary-path'; });
  await check(f => { f.inputs.permission = true; });
  await check(f => { f.schema = 'other-console.v9'; });
  await check(f => { delete f.termsText; });
  await check(f => { f.blobs['a'.repeat(64)] = f.blobs[f.sources.before]; });
  await check(f => { f.savedAt = '2026-02-30T00:00:00.000Z'; });
  await assert.rejects(serializeWorkspace({...base(), sources:{before:encode(post)}}), /original/);
  await assert.rejects(serializeWorkspace({...base(), inputs:{permission:true}}), /Unexpected/);
  assert.throws(() => decodeSource('Zh=='), /encoding/); // Noncanonical pad bits.
  assert.throws(() => decodeSource('===='), /Base64/);
});

test('full-size native source is accepted without recursive decoding; overflow rejects', async () => {
  const prefix = '{"schema":"stellar-forge.merchant-intake.v1","padding":"';
  const suffix = '"}';
  const text = prefix + 'x'.repeat(MAX_SOURCE_BYTES - prefix.length - suffix.length) + suffix;
  const file = await serializeWorkspace({sources:{before:encode(text)}, name:'Maximum source'}, {now});
  const state = await parseWorkspace(file);
  assert.equal(state.summary.sourceBytes, MAX_SOURCE_BYTES);
  assert.equal(decodeSource(state.sources.before).length, MAX_SOURCE_BYTES);
  await assert.rejects(serializeWorkspace({sources:{before:encode(text+' ')}}), /size|bytes/);
});

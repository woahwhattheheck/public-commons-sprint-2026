import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalJson, sha256Hex } from '../src/canonical.mjs';
import {
  canonicalJson as browserCanonicalJson,
  sha256Hex as browserSha256Hex,
  generateEd25519, signCanonical, verifyCanonical,
} from '../web/core.mjs';
import { parseStrictJsonBytes } from '../src/github_evidence_acquire.mjs';

const parse = (text) => parseStrictJsonBytes(Buffer.from(text));

test('canonical server/browser hashes retain own special JSON keys at every depth', async () => {
  const input = JSON.parse('{"z":1,"__proto__":{"receipt":"changed"},"nested":{"__proto__":null,"constructor":2,"prototype":3}}');
  const expected = '{"__proto__":{"receipt":"changed"},"nested":{"__proto__":null,"constructor":2,"prototype":3},"z":1}';
  assert.equal(canonicalJson(input), expected);
  assert.equal(browserCanonicalJson(input), expected);
  assert.equal(await browserSha256Hex(input), sha256Hex(input));
  assert.notEqual(sha256Hex(JSON.parse('{"__proto__":null}')), sha256Hex({}));
  assert.equal(Object.getPrototypeOf(input), Object.prototype);
  assert.equal(canonicalJson({ z: [1, null], a: true }), '{"a":true,"z":[1,null]}');
});

test('a valid signature cannot be reused after adding an own __proto__ field', async () => {
  const key = await generateEd25519();
  const signature = await signCanonical({}, key.privateKey);
  assert.equal(await verifyCanonical({}, signature, key.publicKeySpkiBase64), true);
  assert.equal(await verifyCanonical(JSON.parse('{"__proto__":{"receipt":"changed"}}'), signature, key.publicKeySpkiBase64), false);
});

test('canonicalization rejects holes instead of hashing them as explicit null', () => {
  for (const canonical of [canonicalJson, browserCanonicalJson]) {
    assert.throws(() => canonical(new Array(1)), /missing array entry/);
    assert.throws(() => canonical({ entries: [1, , 3] }), /missing array entry/);
    assert.throws(() => canonical([undefined]), /unsupported value/);
    assert.equal(canonical([null]), '[null]');
  }
});

test('strict capture parser preserves JSON key semantics and duplicate detection', () => {
  const text = '{"__proto__":{"receipt":"changed"},"nested":{"__proto__":null,"constructor":2}}';
  const parsed = parse(text);
  assert.deepEqual(parsed, JSON.parse(text));
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.getPrototypeOf(parsed.nested), Object.prototype);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(canonicalJson(parsed), canonicalJson(JSON.parse(text)));
  assert.throws(() => parse('{"__proto__":1,"__pr\\u006fto__":2}'), { code: 'DUPLICATE_KEY' });
});

test('strict capture parser checks decimal integers before rounding or underflow', () => {
  for (const text of ['1e-400', '0.99999999999999999', '9007199254740990.9', '9007199254740992', '1e100000', '1e-100000']) {
    assert.throws(() => parse(text), { code: 'UNSAFE_NUMBER' }, text);
  }
  for (const [text, expected] of [['12', 12], ['12.000', 12], ['1.2e1', 12], ['100e-2', 1], ['0.0001e4', 1], ['9007199254740991.0', Number.MAX_SAFE_INTEGER], ['0e100000', 0]]) {
    assert.equal(parse(text), expected, text);
  }
});

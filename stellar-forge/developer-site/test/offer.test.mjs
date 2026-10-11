import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOffer, headerValue, exampleOffer } from '../dist/offer.mjs';

test('a UTF-8 header and a JSON body preserve the same exact payment choices', () => {
  const offer=structuredClone(exampleOffer);
  offer.resource.description='Weather in Montréal — 気温';
  offer.accepts.push({...offer.accepts[0],amount:'170141183460469231731687303715884105727',network:'stellar:pubnet'});
  const body=parseOffer(JSON.stringify(offer));
  const header=parseOffer('PAYMENT-REQUIRED: '+headerValue(offer));
  assert.deepEqual(header.offer,body.offer);
  assert.equal(header.encoding,'Base64 → JSON');
  assert.equal(header.offer.accepts[1].amount,offer.accepts[1].amount);
  assert.equal(header.warnings.some(w=>w.includes('exceeds')),false);
});

test('malformed and oversized responses cannot produce a decoded offer', () => {
  for(const value of ['', 'invalid%%%','e30=', '{bad}', '{"accepts":[null]}','{"accepts":[]}','x'.repeat(131073)]) assert.throws(()=>parseOffer(value));
  assert.throws(()=>parseOffer(JSON.stringify({accepts:Array(101).fill({})})),/100/);
});

test('nonpayable examples, malformed atomic units, and i128 overflow are visible', () => {
  assert.ok(parseOffer(JSON.stringify(exampleOffer)).warnings.some(w=>w.includes('nonpayable')));
  for(const amount of ['1.5', '1e8', 10000, '0', '-1']) {
    const offer=structuredClone(exampleOffer);offer.accepts[0].amount=amount;
    assert.ok(parseOffer(JSON.stringify(offer)).warnings.some(w=>w.includes('integer string')));
  }
  const offer=structuredClone(exampleOffer);offer.accepts[0].amount='170141183460469231731687303715884105728';
  assert.ok(parseOffer(JSON.stringify(offer)).warnings.some(w=>w.includes('exceeds')));
});

test('untrusted metadata is returned as inert data, including prototype-like keys', () => {
  const input=JSON.stringify({...exampleOffer,resource:{url:'javascript:alert(1)',description:'<img src=x onerror=alert(1)>'}});
  const parsed=parseOffer(input);
  assert.equal(parsed.offer.resource.description,'<img src=x onerror=alert(1)>');
  assert.ok(parsed.warnings.some(w=>w.includes('HTTPS')));
  const malicious=input.replace('"x402Version":2','"x402Version":2,"__proto__":{"polluted":true}');
  parseOffer(malicious);
  assert.equal({}.polluted,undefined);
});

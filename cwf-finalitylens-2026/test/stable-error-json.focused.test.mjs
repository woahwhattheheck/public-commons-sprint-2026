import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {stableErrorJson} from '../src/stable-error-json.mjs';
const fp = err => createHash('sha256').update(stableErrorJson(err)).digest('hex').slice(0,16);

test('equal RPC execution errors agree despite top-level and nested key order', () => {
  const a = JSON.parse('{"InstructionError":[0,{"Custom":12}],"context":{"slot":99,"meta":{"b":2,"a":1}}}');
  const b = JSON.parse('{"context":{"meta":{"a":1,"b":2},"slot":99},"InstructionError":[0,{"Custom":12}]}');
  assert.notEqual(JSON.stringify(a),JSON.stringify(b));
  assert.equal(stableErrorJson(a),stableErrorJson(b));
  assert.equal(fp(a),fp(b));
});
test('distinct actual errors retain distinct fingerprints', () => {
  assert.notEqual(fp({InstructionError:[0,{Custom:12}]}),fp({InstructionError:[0,{Custom:13}]}));
});
test('array element order is significant', () => {
  assert.notEqual(fp({InstructionError:[0,{Custom:12}]}),fp({InstructionError:[{Custom:12},0]}));
});
test('literal __proto__ JSON key preserves own data without mutation', () => {
  const v=JSON.parse('{"__proto__":{"bad":1},"x":2}');
  assert.match(stableErrorJson(v),/"__proto__":/);
  assert.equal({}.bad,undefined);
});
test('overly nested payload fails closed and cyclic synthetic objects are rejected', () => {
  let nested={};for(let i=0;i<60;i++)nested={next:nested};
  assert.throws(()=>stableErrorJson(nested),/canonicalization limits/);
  const cycle={};cycle.self=cycle;
  assert.throws(()=>stableErrorJson(cycle),/Cyclic RPC/);
});
test('unsupported non-JSON payloads do not silently alias', () => {
  assert.throws(()=>stableErrorJson({err:undefined}),/Unsupported RPC/);
  assert.throws(()=>stableErrorJson({err:Infinity}),/Unsupported RPC/);
});

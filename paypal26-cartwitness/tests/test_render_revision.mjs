// Focused execution of the real browser script, no network or payment provider.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import vm from 'node:vm';

class Element {
  constructor() {
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.children = [];
  }
  replaceChildren(...items) { this.children = items; }
  append(...items) { this.children.push(...items); }
  addEventListener() {}
}
const elements = new Map();
const get = id => {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
};
const document = {
  getElementById: get,
  createElement: () => new Element()
};
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'static', 'app.js'), 'utf8');
const context = vm.createContext({
  document,
  // Initial GET stays pending; directly drive the original app's paint function.
  fetch: () => new Promise(() => {}),
  console
});
vm.runInContext(source, context, {filename: 'static/app.js'});

function state(generation, revision, phase) {
  return {
    generation, revision, phase, csrf: 'fixture-csrf',
    plan: null, order_id: null, approval_url: null,
    audit: [], mode: 'fixture', paypal_ready: false, ai_ready: false, catalogue: []
  };
}
const paint = s => vm.runInContext('paint(' + JSON.stringify(s) + ')', context);

test('late older state cannot hide a newer payment-completion phase', () => {
  paint(state('session-A', 5, 'fixture_completed'));
  assert.match(get('result').textContent, /FIXTURE ONLY/);
  paint(state('session-A', 4, 'payer_returned'));
  assert.match(get('result').textContent, /FIXTURE ONLY/);
  assert.equal(get('captureform').hidden, true);
  paint(state('session-A', 6, 'cancelled'));
  assert.match(get('result').textContent, /Cancelled/);
});

test('reset with larger revision and new server-generation both render', () => {
  paint(state('session-A', 7, 'idle'));
  assert.equal(get('result').textContent, 'No order created.');
  paint(state('session-B', 0, 'planned'));
  assert.equal(get('orderform').hidden, false);
  paint(state('session-B', -1, 'completed'));
  assert.equal(get('orderform').hidden, false);
  assert.match(get('error').textContent, /Invalid checkout state/);
});

test('4,096 deterministic out-of-order checkout reply sequences preserve newest state', () => {
  let rng = 0x6a09e667;
  function next() {
    rng ^= rng << 13; rng ^= rng >>> 17; rng ^= rng << 5;
    return rng >>> 0;
  }
  for (let trial = 0; trial < 4096; trial++) {
    const generation = 'sequence-' + trial;
    const replies = [
      state(generation, 1, 'planned'),
      state(generation, 2, 'approval_pending'),
      state(generation, 3, 'payer_returned'),
      state(generation, 4, 'fixture_completed')
    ];
    for (let j = replies.length - 1; j > 0; j--) {
      const k = next() % (j + 1);
      [replies[j], replies[k]] = [replies[k], replies[j]];
    }
    for (const reply of replies) paint(reply);
    assert.match(get('result').textContent, /FIXTURE ONLY/,
      'trial ' + trial + ' must finish at largest server revision');
    assert.equal(get('captureform').hidden, true);
  }
});

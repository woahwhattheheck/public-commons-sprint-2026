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

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createServer } from '../server.mjs';

test('shipped coordinator actions inspect real candidates and require approval for replacements', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  const base = 'http://127.0.0.1:' + server.address().port;
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const nodes = new Map(), examples = [];
  const element = tag => ({
    tag, children: [], textContent: '', className: '', value: '', dataset: {}, disabled: false, hidden: false, events: {},
    append(...items) { this.children.push(...items); },
    replaceChildren(...items) { this.children = items; },
    addEventListener(type, handler) { this.events[type] = handler; },
    focus() { this.focused = true; },
    scrollIntoView() { this.scrolledIntoView = true; },
    async click() { assert.equal(this.disabled, false, 'action must be enabled'); return this.events.click?.(); }
  });
  for (const match of html.matchAll(/<([a-z]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const n = element(match[1]); n.hidden = /\bhidden\b/.test(match[2]); nodes.set(match[3], n);
  }
  for (const match of html.matchAll(/<button class="example" data-prompt="([^"]+)">([^<]+)<\/button>/g)) {
    const n = element('button'); n.className = 'example'; n.dataset.prompt = match[1]; n.textContent = match[2]; examples.push(n);
  }
  function all() {
    const seen = new Set(), list = [];
    function walk(n) { if (seen.has(n)) return; seen.add(n); list.push(n); for (const child of n.children || []) walk(child); }
    for (const n of [...nodes.values(), ...examples]) walk(n);
    return list;
  }
  const $ = id => { assert.ok(nodes.has(id), 'HTML must contain ' + id); return nodes.get(id); };
  const document = {
    getElementById: $, createElement: element, createTextNode: text => ({ textContent: text }),
    querySelectorAll(selector) {
      const classes = selector.split(',').map(value => value.trim().slice(1));
      return all().filter(n => classes.some(name => (n.className || '').split(' ').includes(name)));
    }
  };
  $('ask').requestSubmit = () => $('ask').events.submit({ preventDefault() {} });
  let cookie = '';
  const requests = [];
  async function transport(path, options = {}) {
    if (options.body) requests.push({ path, body: JSON.parse(options.body) });
    const response = await fetch(base + path, { ...options, headers: { ...options.headers, ...(cookie ? { cookie } : {}) } });
    cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie;
    return response;
  }
  const context = vm.createContext({ document, fetch: transport, window: {}, confirm: () => true });
  vm.runInContext(source, context);
  const limit = Date.now() + 2000;
  while (vm.runInContext('busy', context) && Date.now() < limit) await new Promise(resolve => setImmediate(resolve));
  assert.equal(vm.runInContext('busy', context), false, 'initial event must finish loading');
  const text = n => [n.textContent || '', ...(n.children || []).map(text)].join(' ');
  const action = label => {
    const button = all().find(n => n.tag === 'button' && n.textContent === label);
    assert.ok(button, 'visible board action ' + label); return button;
  };
  const current = async () => (await transport('/api/state')).json();
  assert.equal($('roster').children.length, 8);
  assert.match($('coverage-summary').textContent, /3 open places/);
  assert.match(text($('roster')), /Qualifications: welcome/);
  await action('Fill openings').click();
  let state = await current();
  assert.equal(state.revision, 0);
  assert.deepEqual(state.pending.chosen.map(v => v.id), ['iris']);
  assert.equal(state.pending.candidateReview.find(v => v.id === 'iris').status, 'chosen');
  assert.match(state.pending.candidateReview.find(v => v.id === 'leo').reason, /Overlaps.*Early equipment setup/);
  assert.equal($('proposal').hidden, false);
  assert.equal($('proposal').focused, true);
  assert.equal($('proposal').scrolledIntoView, true);
  assert.equal($('candidate-review').hidden, false);
  assert.match(text($('candidates')), /Leo.*Overlaps an existing assignment/s);
  await $('approve').click();
  assert.equal((await current()).revision, 1);
  await action('Replace Maya').click();
  state = await current();
  assert.equal(state.revision, 1, 'replacement action only proposes');
  assert.deepEqual(state.pending.chosen.map(v => v.id), ['zoe']);
  assert.match(state.pending.candidateReview.find(v => v.id === 'maya').reason, /Reported absent in this request/);
  assert.equal(state.unavailable.maya, undefined);
  const proposalId = state.pending.id;
  await $('approve').click();
  assert.equal(requests.at(-1).body.proposalId, proposalId);
  state = await current();
  assert.deepEqual(state.shifts.find(s => s.id === 'welcome').assigned, ['iris', 'zoe']);
  assert.deepEqual(state.unavailable.maya, ['welcome']);
  assert.match(text($('roster')), /Reported absent: Morning welcome desk/);
  await $('undo').click();
  assert.equal((await current()).unavailable.maya, undefined);
  assert.doesNotMatch(text($('roster')), /Reported absent:/);
  await $('reset').click();
  assert.equal((await current()).revision, 4);
  await action('Replace Omar').click();
  state = await current();
  assert.equal(state.revision, 4);
  assert.equal(state.pending, null, 'incomplete replacement cannot be approved');
  assert.equal($('proposal').hidden, true);
  assert.equal($('approve').disabled, true);
  assert.equal($('conversation').focused, true);
  assert.match(text($('candidates')), /Eve.*Eligible alternative/s);
  assert.doesNotMatch(text($('candidates')), /Proposed/);
  assert.match(text($('conversation')), /will not publish an understaffed schedule/);
});

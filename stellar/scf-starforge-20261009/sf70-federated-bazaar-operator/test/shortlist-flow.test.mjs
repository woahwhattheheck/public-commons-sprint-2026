// One shipped-app workflow check. Minimal DOM, not rendered-browser validation.
// Run: node --experimental-vm-modules --test test/shortlist-flow.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceTextModule, createContext } from 'node:vm';
import { start } from '../server.mjs';

test('browse, compare, refresh, recover and save original projected options', async () => {
  const server = await start();
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    class Element {
      constructor(tag) { this.tag = tag; this.children = []; this.events = {}; this.attributes = {}; this.value = ''; this.disabled = false; }
      set textContent(value) { this.children = []; this.text = String(value); }
      get textContent() { return (this.text ?? '') + this.children.map(child => child.textContent ?? String(child)).join(' '); }
      append(...children) { this.children.push(...children); }
      replaceChildren(...children) { this.text = ''; this.children = children; }
      setAttribute(name, value) { this.attributes[name] = value; }
      addEventListener(name, fn) { this.events[name] = fn; }
      click() { if (!this.disabled) return this.events.click?.({preventDefault(){}}); }
      remove() {}
      focus() { document.activeElement = this; }
      querySelectorAll(selector) {
        const all = this.children.filter(child => child instanceof Element);
        return all.flatMap(child => [
          ...((selector.startsWith('.') ? (child.className ?? '').split(' ').includes(selector.slice(1)) : child.tag === selector) ? [child] : []),
          ...child.querySelectorAll(selector),
        ]);
      }
    }
    const htmlResponse = await fetch(origin);
    assert.equal(htmlResponse.status, 200);
    const html = await htmlResponse.text();
    const elements = new Map([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element('div')]));
    const document = { activeElement: null, body: new Element('body'),
      getElementById: id => { assert.ok(elements.has(id), 'real HTML must expose ' + id); return elements.get(id); },
      createElement: tag => new Element(tag), createDocumentFragment: () => new Element('fragment') };
    const $ = id => document.getElementById(id);
    const amount = '170141183460469231731687303715884105727';
    const row = { source:'vellar', sourceRow:1, label:'Fictional weather', url:'https://example.invalid/weather',
      description:'Local test data', kind:'http', method:'POST', toolName:'', routeTemplate:'/weather', hiddenPaymentOptions:0,
      paymentOptions:[{ network:'stellar:testnet', scheme:'exact', asset:'ASSET_A', payTo:'RECIPIENT_A', amount }] };
    const snapshot = time => ({ network:'stellar:testnet', observedAt:time, state:'BOTH_SOURCES_COMPLETE', observedListingRows:2,
      sources:[{provider:'vellar',name:'Vellar',endpoint:'https://example.invalid/catalog',status:'COMPLETE_GET_CAPTURE',observedAt:time,rows:2,pages:1,coverage:'DECLARED_TOTAL_MATCHED',declaredTotal:2}],
      listings:[structuredClone(row), {...structuredClone(row),sourceRow:2,label:'Fictional alternate',url:'https://example.invalid/alternate'}] });
    let current = snapshot('2026-10-11T10:00:00.000Z');
    let requests = 0;
    let failRefresh = false;
    let saved;
    const context = createContext({ document, window:{document}, navigator:{}, console, structuredClone, Blob, setTimeout,
      URL: {createObjectURL: blob => { saved = blob; return 'blob:local-check'; }, revokeObjectURL(){}},
      fetch: async url => {
        assert.match(url, /^\/api\/federated(?:\?refresh=1)?$/);
        requests++;
        if (failRefresh) throw new Error('Local fixture refresh failed');
        return {json:async () => structuredClone(current)};
      },
    });
    const modules = new Map();
    async function module(path) {
      if (modules.has(path)) return modules.get(path);
      const response = await fetch(origin + path);
      assert.equal(response.status, 200, 'existing HTTP allowlist must serve ' + path);
      const instance = new SourceTextModule(await response.text(), {context, identifier:origin + path});
      modules.set(path, instance);
      await instance.link((specifier, parent) => module(new URL(specifier, parent.identifier).pathname));
      return instance;
    }
    await (await module('/app.mjs')).evaluate();
    const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };
    await settle();
    assert.match($('shortlist-content').textContent, /Build a comparison/);
    assert.equal(requests, 1);
    let buttons = $('results').querySelectorAll('.compare-option');
    assert.equal(buttons.length, 2);
    buttons[0].click();
    buttons[1].click();
    assert.equal(buttons[0].attributes['aria-pressed'], 'true');
    assert.match($('shortlist-content').textContent, /Selected from latest source capture/);
    assert.ok($('shortlist-content').textContent.includes(amount));
    $('query').value = 'no-match-at-all';
    $('query').events.input();
    assert.match($('shortlist-count').textContent, /2 \/ 6/);
    assert.ok($('shortlist-content').textContent.includes('RECIPIENT_A'));
    current = snapshot('2026-10-11T10:01:00.000Z');
    current.listings[0].paymentOptions[0].amount = '1';
    $('refresh').click();
    await settle();
    assert.match($('shortlist-content').textContent, /Selected tuple not in latest source capture/);
    assert.match($('shortlist-content').textContent, /Earlier observation; same tuple seen again/);
    assert.ok($('shortlist-content').textContent.includes(amount));
    failRefresh = true;
    $('refresh').click();
    await settle();
    assert.match($('shortlist-content').textContent, /Latest refresh unavailable/);
    const remove = $('shortlist-content').querySelectorAll('.remove-option')[0];
    remove.click();
    assert.equal(document.activeElement, $('shortlist-content').querySelectorAll('.remove-option')[0]);
    $('shortlist-undo').click();
    assert.match($('shortlist-count').textContent, /2 \/ 6/);
    $('shortlist-clear').click();
    assert.match($('shortlist-content').textContent, /Build a comparison/);
    $('shortlist-undo').click();
    $('shortlist-export').click();
    const exported = JSON.parse(await saved.text());
    assert.equal(exported.selections[0].option.amount, amount);
    assert.equal(exported.selections[0].source.observedAt, '2026-10-11T10:00:00.000Z');
    assert.equal(exported.selections.length, 2);
    assert.equal(requests, 3, 'only initial discovery and two explicit refreshes');
    assert.equal(exported.payments, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

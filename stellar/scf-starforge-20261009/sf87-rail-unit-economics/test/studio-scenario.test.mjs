// One actual local HTTP/UI orchestration check; minimal DOM, not rendered browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import {Script,createContext} from 'node:vm';
import {once} from 'node:events';
import {createStudioServer} from '../studio.mjs';

test('editable scenarios reopen through original engine and delayed results cannot revive stale assumptions', async () => {
  const server = createStudioServer(); server.listen(0,'127.0.0.1'); await once(server,'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  try {
    const elements = new Map();
    let document, saved;
    class Element {
      constructor(tag) { this.tag=tag;this.children=[];this.events={};this.attributes={};this.value='';this.disabled=false; }
      set id(id) { this._id=id;elements.set(id,this); }
      get id() { return this._id; }
      set textContent(text) { this.text=String(text);this.children=[]; }
      get textContent() { return (this.text??'')+this.children.map(c=>c.textContent??String(c)).join(' '); }
      append(...items) { this.children.push(...items); }
      replaceChildren(...items) { this.children=items;this.text=''; }
      addEventListener(event,fn) { this.events[event]=fn; }
      setAttribute(key,value) { this.attributes[key]=value; }
      get classList() { return {
        add:key=>{this.className=[...new Set((this.className??'').split(' ').concat(key))].join(' ');},
        remove:key=>{this.className=(this.className??'').split(' ').filter(x=>x!==key).join(' ');},
        contains:key=>(this.className??'').split(' ').includes(key),
      }; }
      click() { if(!this.disabled) return this.events.click?.({preventDefault(){}}); }
      focus() { document.activeElement=this; }
      scrollIntoView() {}
    }
    const html = await (await fetch(origin)).text();
    for (const [,tag,id,tail] of html.matchAll(/<([a-z0-9-]+)\b[^>]*\bid="([^"]+)"([^>]*)>/g)) {
      const e=new Element(tag);e.id=id;e.disabled=/\bdisabled\b/.test(tail);
    }
    document={getElementById:id=>{assert.ok(elements.has(id),'shipped HTML/inputs must expose '+id);return elements.get(id);},
      createElement:tag=>new Element(tag),activeElement:null};
    const $=id=>document.getElementById(id);
    let hold=false, release, waiting;
    const context=createContext({document,console,structuredClone,Blob,TextDecoder,AbortController,
      setTimeout:fn=>{fn();return 0;},
      URL:class extends URL {static createObjectURL(blob){saved=blob;return 'blob:local';}static revokeObjectURL(){}},
      fetch:async(path,opts)=>{
        assert.ok(['/sample.json','/evaluate'].includes(path),'only original local routes');
        const res=await fetch(origin+path,opts);
        if(hold && path==='/evaluate') { waiting?.();await new Promise(resolve=>{release=resolve;}); }
        return res;
      },
    });
    const script=await fetch(origin+'/studio.js');assert.equal(script.status,200);
    await new Script(await script.text()).runInContext(context);
    assert.match($('scenario-status').textContent,/Illustrative sample/);
    $('scenario-name').value='Merchant forecast — exact inputs';
    $('workload-unitPriceUsd').value='9007199254740993.000001';
    $('shared-perPaidUsd').value='';
    await $('save-scenario').click();
    const raw=JSON.parse(await saved.text());
    assert.equal(raw.schema,'stellar-forge.rail-economics.v1');
    assert.equal(raw.workload.unitPriceUsd,'9007199254740993.000001');
    assert.equal(raw.costs.shared.perPaidUsd,null);
    assert.equal(typeof raw.workload.paidRequestsMonth,'number');
    assert.equal($('download-json').disabled,false);
    assert.match($('decision').textContent,/No overall winner/);
    const open=async(value,size)=>{
      const bytes=new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value));
      $('scenario-file').files=[{size:size??bytes.byteLength,arrayBuffer:async()=>bytes.buffer}];
      await $('scenario-file').events.change();
    };
    $('reset').click();const initialName=$('scenario-name').value;
    await open(raw);
    assert.equal($('scenario-name').value,raw.title);
    assert.equal($('workload-unitPriceUsd').value,'9007199254740993.000001');
    assert.equal($('shared-perPaidUsd').value,'');
    assert.equal(document.activeElement,$('scenario-name'));
    $('undo-scenario').click();
    assert.equal($('scenario-name').value,initialName);
    assert.equal($('results').classList.contains('hidden'),true);
    assert.equal($('download-json').disabled,true);
    await open('{bad json'); assert.equal($('scenario-name').value,initialName);
    assert.match($('error').textContent,/not valid/);
    await open(raw,128*1024+1);assert.match($('error').textContent,/128 KiB/);
    await open({...raw,schema:'stellar-forge.rail-economics-report.v1'});
    assert.match($('error').textContent,/not a calculated report/);
    const invalid=structuredClone(raw);invalid.workload.activeChannelsAverage=0;
    await open(invalid);assert.match($('error').textContent,/nonzero/);
    assert.equal($('scenario-name').value,initialName,'invalid complete file never replaces current form');

    hold=true;const reached=new Promise(resolve=>{waiting=resolve;});
    const pending=$('inputs').events.submit({preventDefault(){}});await reached;
    $('workload-unitPriceUsd').value='0.25';
    $('inputs').events.input({target:$('workload-unitPriceUsd')});
    release();await pending;
    assert.equal($('results').classList.contains('hidden'),true);
    assert.equal($('download-json').disabled,true);
    assert.equal($('calculate').disabled,false);
    assert.match($('scenario-status').textContent,/Assumptions changed/);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});

#!/usr/bin/env node
'use strict';
// Execute the real page's inline JS with DOM/Grid doubles; no CDN or payment calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, webcrypto } = require('node:crypto');
const sourcePath = process.env.CASEBOARD_SOURCE || path.resolve(__dirname, '../../src/caseboard.html');
const html = fs.readFileSync(sourcePath, 'utf8');
const source = /<script>\s*([\s\S]*?)<\/script>/.exec(html)[1];
const defer = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
function fixture(number = 1, summary = 'First advisory') {
  const items = [{sku:'fixture',name:'Synthetic review item',quantity:1,unit_price:'2.00',line_total:'2.00'}];
  const terms = 'Synthetic fixture terms';
  const fingerprint = createHash('sha256').update(JSON.stringify({items,total:200,merchantTerms:terms,currency:'USD'})).digest('hex');
  return {record_type:'claimproof-prepurchase-review-v1',payment_receipt:false,merchant_verified:false,
    review_id:`00000000-0000-0000-0000-${String(number).padStart(12,'0')}`,
    cart:{items,currency:'USD',merchant_terms:terms,fingerprint,total_cents:200,total:'2.00'},
    findings:[],advisory:{model_used:false,summary},exported_at:'2026-10-09T06:00:00Z'};
}
const file = record => { const text=JSON.stringify(record); return {name:'synthetic.json',size:Buffer.byteLength(text),text:async()=>text}; };
function setup(digest = (...args) => webcrypto.subtle.digest(...args)) {
  const elements = new Map();
  const document = {getElementById(id) {
    if(!elements.has(id))elements.set(id,{value:id==='priority'?'all':'',textContent:'',className:'',
      handlers:{},addEventListener(name,fn){this.handlers[name]=fn;}});
    return elements.get(id);
  }};
  let options;
  const agGrid = {colorSchemeDark:{name:'dark'},themeQuartz:{withPart(part){return {name:'quartz',part};}},
    createGrid(_element,config){options=config;return {setGridOption(){},forEachNodeAfterFilterAndSort(){}};}};
  const context = vm.createContext({document,agGrid,window:{agGrid},TextEncoder,crypto:{subtle:{digest}},console});
  vm.runInContext(source+'\nglobalThis.board={onFiles,allRows,inspect,verifyRecord,refresh};',context);
  const get = id => document.getElementById(id);
  return {...context.board,get,options,clear:()=>get('clear').handlers.click()};
}
const checks=[];
function check(name,body){checks.push({name,body});}
check('Clear invalidates pending file reads and pending fingerprint verification',async()=>{
  for(const phase of ['read','digest']) {
    const pending=defer();
    const b=setup(phase==='digest'?async(...args)=>{await pending.promise;return webcrypto.subtle.digest(...args);}:undefined);
    const input=file(fixture());
    if(phase==='read')input.text=async()=>{await pending.promise;return JSON.stringify(fixture());};
    const work=b.onFiles([input]);await new Promise(setImmediate);
    b.clear();pending.resolve();await work;
    assert.equal(b.allRows.size,0,`old ${phase} must not repopulate cleared records`);
    assert.match(b.get('status').textContent,/cleared/,'old import must not overwrite Clear status');
  }
});
check('Concurrent imports enforce the 500-case cap after awaited verification',async()=>{
  const gate=defer();let started=0;
  const b=setup(async(...args)=>{started++;await gate.promise;return webcrypto.subtle.digest(...args);});
  for(let n=1;n<=499;n++)b.allRows.set('existing-'+n,{id:'existing-'+n,amount_cents:200,level:'none',ai:'Offline only'});
  const first=b.onFiles([file(fixture(500))]),second=b.onFiles([file(fixture(501))]);
  await new Promise(setImmediate);assert.equal(started,2,'both verification requests must be in flight');
  gate.resolve();await Promise.all([first,second]);
  assert.equal(b.allRows.size,500,'concurrent imports must not admit case 501');
});
check('Replacing the selected review refreshes its advisory, then Clear removes it',async()=>{
  const b=setup();await b.onFiles([file(fixture())]);
  b.inspect(b.allRows.values().next().value);assert.match(b.get('details').textContent,/First advisory/);
  await b.onFiles([file(fixture(1,'Updated advisory'))]);
  assert.match(b.get('details').textContent,/Updated advisory/);
  assert.doesNotMatch(b.get('details').textContent,/First advisory/);
  b.clear();assert.doesNotMatch(b.get('details').textContent,/Updated advisory/);
});
check('Cart fingerprint validation is retained and the built-in theme is configured',async()=>{
  const b=setup();const invalid=fixture();invalid.cart.merchant_terms='Changed after export';
  await assert.rejects(b.verifyRecord(invalid),/fingerprint/);
  assert.equal(b.options.theme.name,'quartz');assert.equal(b.options.theme.part.name,'dark');
});
(async()=>{
  console.log('ClaimProof caseboard | focused offline lifecycle execution');
  console.log('Node '+process.version+'; source SHA256 '+createHash('sha256').update(html).digest('hex'));
  console.log('Actual inline application logic and WebCrypto; DOM/AG Grid are test doubles, not visual acceptance.');
  let failed=0;
  for(const test of checks){try{await test.body();console.log('PASS '+test.name);}catch(e){failed++;console.log('FAIL '+test.name+' :: '+e.message);}}
  console.log(`Result: ${checks.length-failed}/${checks.length} passed; ${failed} failed`);process.exitCode=failed?1:0;
})().catch(e=>{console.error(e);process.exitCode=1;});

// Provider-free, focused browser response-order regression for RenewalGuard.
// Run: node test/ui-response-race.focused.test.mjs
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../web/app.js',import.meta.url),'utf8');
function harness(){
  const calls=[], elements=new Map();
  function makeEl(){
    return {value:'',textContent:'',disabled:false,children:[],listeners:{},
      addEventListener(kind,fn){this.listeners[kind]=fn;},
      replaceChildren(){this.children=[];this.textContent='';},
      append(...items){this.children.push(...items);}};
  }
  const document={getElementById(id){if(!elements.has(id))elements.set(id,makeEl());return elements.get(id);},createElement(){return makeEl();}};
  document.getElementById('mode').value='demo';
  const fetch=(url,init)=>new Promise((resolve,reject)=>calls.push({url,init,resolve,reject}));
  const ctx={document,fetch,console,Error};
  runInNewContext(source,ctx,{timeout:1000});
  const e=id=>document.getElementById(id);
  const success=(call,data)=>call.resolve({ok:true,status:200,json:async()=>data});
  return {calls,e,ctx,success};
}
function receipt(id){return {receipt:{fingerprint:id+'-fingerprint',subscription_id:id,status:'ACTIVE'}};}
function need(calls,index,path){assert(calls[index],'missing call '+index);assert(calls[index].url.startsWith(path));return calls[index];}

// A slow old detail response must not replace newer selection B.
{
  const h=harness();
  const a=h.ctx.openItem('I-DEMOACTIVE1','demo');
  const b=h.ctx.openItem('I-DEMOSUSPEND1','demo');
  h.success(need(h.calls,1,'/api/detail'),receipt('I-DEMOSUSPEND1'));
  await b;
  h.success(need(h.calls,0,'/api/detail'),receipt('I-DEMOACTIVE1'));
  await a;
  assert.match(h.e('facts').textContent,/I-DEMOSUSPEND1/);
  assert.doesNotMatch(h.e('facts').textContent,/I-DEMOACTIVE1/);
  assert.equal(h.e('draft').disabled,false);
}
// An old detail failure must not clear the selected new subscription.
{
  const h=harness();
  const a=h.ctx.openItem('I-DEMOACTIVE1','demo');
  const b=h.ctx.openItem('I-DEMOSUSPEND1','demo');
  h.success(need(h.calls,1,'/api/detail'),receipt('I-DEMOSUSPEND1'));
  await b;
  need(h.calls,0,'/api/detail').reject(Error('stale A request failed'));
  await a;
  assert.match(h.e('facts').textContent,/I-DEMOSUSPEND1/);
  assert.equal(h.e('error').textContent,'');
  assert.equal(h.e('draft').disabled,false);
}
// An obsolete draft failure must not override the later selection.
{
  const h=harness();
  const a=h.ctx.openItem('I-DEMOACTIVE1','demo');
  h.success(need(h.calls,0,'/api/detail'),receipt('I-DEMOACTIVE1'));await a;
  const oldDraft=h.e('draft').listeners.click();
  const b=h.ctx.openItem('I-DEMOSUSPEND1','demo');
  h.success(need(h.calls,2,'/api/detail'),receipt('I-DEMOSUSPEND1'));await b;
  need(h.calls,1,'/api/draft').reject(Error('prior draft no longer available'));
  await oldDraft;
  assert.equal(h.e('error').textContent,'');
  assert.equal(h.e('proposal').textContent,'No draft requested.');
  assert.equal(h.e('draft').disabled,false);
  assert.match(h.e('facts').textContent,/I-DEMOSUSPEND1/);
}
// Previous-mode list failure must not leak into current mode.
{
  const h=harness();
  const oldList=h.e('load').listeners.click();
  h.e('mode').value='sandbox';h.e('mode').listeners.change();
  need(h.calls,0,'/api/list').reject(Error('stale mode list'));
  await oldList;
  assert.equal(h.e('error').textContent,'');
  assert.equal(h.e('load').disabled,false);
  assert.equal(h.e('list').children.length,0);
  assert.equal(h.e('facts').textContent,'Select a subscription.');
}
console.log('PASS RenewalGuard response-order fence: 4 focused fake-DOM scenarios; mock fetch only; provider calls 0');

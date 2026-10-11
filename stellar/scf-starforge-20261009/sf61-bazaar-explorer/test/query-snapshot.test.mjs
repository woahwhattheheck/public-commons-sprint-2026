// Shipped UI source with an HTML-derived minimal DOM and controlled native-page
// responses. No provider/network/rendered-browser acceptance is claimed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {SourceTextModule,createContext} from 'node:vm';

test('observed pages retain submitted filters across drafts, paging failures and replaced requests',async()=>{
  const elements=new Map();let document,saved;
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.events={};this.value='';this.disabled=false;this.attributes={};}
    set textContent(value){this.text=String(value);this.children=[];}
    get textContent(){return (this.text??'')+this.children.map(c=>c.textContent??String(c)).join(' ');}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.text='';this.children=items;}
    addEventListener(name,fn){this.events[name]=fn;}
    setAttribute(name,value){this.attributes[name]=value;}
    get classList(){return {add:key=>{this.className=((this.className??'')+' '+key).trim();},
      remove:key=>{this.className=(this.className??'').split(' ').filter(x=>x!==key).join(' ');}};}
    click(){if(!this.disabled)return this.events.click?.({preventDefault(){}});}
    remove(){}focus(){document.activeElement=this;}
    querySelectorAll(selector){return this.children.filter(c=>c instanceof Element).flatMap(c=>[
      ...((c.className??'').split(' ').includes(selector.slice(1))?[c]:[]),...c.querySelectorAll(selector)]);}
  }
  const html=await readFile(new URL('../index.html',import.meta.url),'utf8');
  for(const [,tag,id,tail] of html.matchAll(/<([a-z0-9-]+)\b[^>]*\bid="([^"]+)"([^>]*)>/g)){
    const e=new Element(tag);e.disabled=/\bdisabled\b/.test(tail);elements.set(id,e);
  }
  document={body:new Element('body'),getElementById:id=>{assert.ok(elements.has(id),'HTML must expose '+id);return elements.get(id);},
    createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),activeElement:null};
  const $=id=>document.getElementById(id);$('network').value='stellar:testnet';
  const page=(name,cursor=null)=>({mode:'ORIGINAL_SF60_DURABLE_CATALOG',view:cursor?'search':'list',
    observedAt:'2026-10-11T14:00:00Z',pagination:{total:75,cursor},resources:[{
      resource:{url:'https://seller.invalid/'+name,name},accepts:[
        {network:'stellar:testnet',scheme:'exact',amount:'9007199254740993',asset:'ASSET',payTo:'PAYEE'},
        {network:'stellar:pubnet',scheme:'exact',amount:'10',asset:'OTHER',payTo:'OTHER'},
      ],
    }]});
  const response=data=>({ok:true,json:async()=>data});
  let transport=async()=>response(page('initial'));
  const requests=[];
  const context=createContext({document,URL:class extends URL{
    static createObjectURL(blob){saved=blob;return 'blob:local';}static revokeObjectURL(){}
  },URLSearchParams,AbortController,Blob,console,
  fetch:async(path,options)=>{
    if(path==='/api/source')return response({mode:'ORIGINAL_SF60_DURABLE_CATALOG',origin:'local original source'});
    assert.ok(path.startsWith('/api/discovery?'));
    const request={params:new URL(path,'http://local').searchParams,signal:options.signal};requests.push(request);
    return transport(request);
  }});
  const entry=new SourceTextModule(await readFile(new URL('../app.mjs',import.meta.url),'utf8'),{context});
  await entry.link(()=>{throw Error('unexpected import');});await entry.evaluate();
  const submit=()=> $('query-form').events.submit({preventDefault(){}});
  const exportPage=async()=>{$('export').click();return JSON.parse(await saved.text());};
  const options=()=> $('results').querySelectorAll('.payment-option');
  assert.equal(options()[0].className,'payment-option');
  assert.match(options()[1].className,/out-of-filter/);
  $('network').value='stellar:pubnet';$('query-form').events.change();
  assert.equal($('next').disabled,true);
  assert.match($('filter-status').textContent,/Unapplied/);
  assert.match($('applied-filters').textContent,/stellar:testnet/);
  assert.equal(options()[0].className,'payment-option','draft does not relabel observed options');
  assert.equal((await exportPage()).filterRequest.network,'stellar:testnet');
  $('restore-filters').click();assert.equal($('network').value,'stellar:testnet');
  assert.equal($('next').disabled,false);

  transport=async()=>{throw Error('local page failure');};await $('next').click();
  assert.match($('page-info').textContent,/Page 1/);
  assert.match($('status').textContent,/previous observed page/);
  assert.equal((await exportPage()).filterRequest.offset,'0');
  transport=async()=>response(page('page-two'));await $('next').click();
  assert.equal(requests.at(-1).params.get('offset'),'25','failed page did not advance offset');
  assert.equal((await exportPage()).filterRequest.offset,'25');

  let releaseOld;
  transport=()=>new Promise(resolve=>{releaseOld=resolve;});
  $('query').value='old';const old=submit();const oldSignal=requests.at(-1).signal;
  transport=async()=>response({...page('new','native+/token='),view:'search'});
  $('query').value='new';await submit();
  assert.equal(oldSignal.aborted,true);
  releaseOld(response(page('stale')));await old;
  assert.match($('results').textContent,/new/);assert.doesNotMatch($('results').textContent,/stale/);
  assert.equal((await exportPage()).filterRequest.query,'new');
  $('payto').value='DRAFT-RECIPIENT';$('query-form').events.input();
  assert.equal($('next').disabled,true);
  assert.equal((await exportPage()).filterRequest.payTo,undefined);
  $('restore-filters').click();await $('next').click();
  assert.equal(requests.at(-1).params.get('cursor'),'native+/token=');
  assert.equal((await exportPage()).filterRequest.cursor,'native+/token=');
  await $('prev').click();assert.equal(requests.at(-1).params.has('cursor'),false);

  let complete;
  transport=()=>new Promise(resolve=>{complete=resolve;});
  $('query').value='submitted';const pending=submit();
  $('network').value='stellar:pubnet';$('query-form').events.change();
  complete(response(page('submitted')));await pending;
  assert.equal((await exportPage()).filterRequest.network,'stellar:testnet');
  assert.equal(options()[0].className,'payment-option');
  assert.equal($('network').value,'stellar:pubnet','submitted response does not replace draft');
  assert.match($('filter-status').textContent,/Unapplied/);
});

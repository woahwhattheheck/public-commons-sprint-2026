// One integration check: original SF60 HTTP → shipped Atlas UI → original SF88 CLI.
// The DOM comes from shipped HTML; this is not a rendered-browser/CSS acceptance.
// Fixtures are temporary noncommercial listings. No seller/wallet/network call.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createContext,SourceTextModule} from 'node:vm';
import {DurableCatalogTransaction} from '../../sf60-durable-catalog-transaction/journal.mjs';
import {serveDiscovery} from '../../sf60-durable-catalog-transaction/service.mjs';
import {prepare} from '../../sf88-operator-buyer-cli/prepare.mjs';
import {startExplorer} from '../server.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const AMOUNT='9007199254740993123456789';
const seller='https://seller.example';
const terms=(network,amount,payTo,asset)=>({scheme:'exact',network,amount,payTo,asset,
  maxTimeoutSeconds:60,extra:{paymentFlow:'authorization'}});
const listing=(path,name,accepts)=>({resource:{url:seller+path,serviceName:name,
  description:'Temporary original-catalog integration fixture'},accepts,
  extensions:{bazaar:{info:{input:{type:'http',method:'GET'},output:{type:'json'}},
    schema:{type:'object',properties:{city:{type:'string'}}}}}});
const authority={sellerId:'atlas-fixture',signer:'UNSIGNED_NONCOMMERCIAL_TEST_FIXTURE',
  allowedOrigins:new Set([seller]),allowedRecipients:new Set(['GTEST','GPUBLIC']),
  allowedNetworks:new Set(['stellar:testnet','stellar:pubnet']),allowedSchemes:new Set(['exact'])};

function dom(html){
  const elements=new Map(),downloads=[],blobs=new Map();let document;
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.events={};this.value='';this.disabled=false;this.hidden=false;this.attributes={};}
    set textContent(value){this.text=String(value);this.children=[];}
    get textContent(){return(this.text??'')+this.children.map(c=>c.textContent??String(c)).join(' ');}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.text='';this.children=items;}
    addEventListener(name,fn){this.events[name]=fn;}
    setAttribute(name,value){this.attributes[name]=value;}
    get classList(){return{add:key=>{this.className=((this.className??'')+' '+key).trim();},
      remove:key=>{this.className=(this.className??'').split(' ').filter(x=>x!==key).join(' ');}};}
    click(){
      if(this.disabled)return;
      if(this.tag==='a'&&blobs.has(this.href))downloads.push({name:this.download,blob:blobs.get(this.href)});
      return this.events.click?.({preventDefault(){}});
    }
    remove(){}focus(){document.activeElement=this;}
    querySelectorAll(selector){return this.children.filter(c=>c instanceof Element).flatMap(c=>[
      ...(selector.startsWith('.')?(c.className??'').split(' ').includes(selector.slice(1)):c.tag===selector)?[c]:[],
      ...c.querySelectorAll(selector)]);}
  }
  for(const[,tag,id,tail]of html.matchAll(/<([a-z0-9-]+)\b[^>]*\bid="([^"]+)"([^>]*)>/g)){
    const e=new Element(tag);e.disabled=/\bdisabled\b/.test(tail);e.hidden=/\bhidden\b/.test(tail);elements.set(id,e);
  }
  document={body:new Element('body'),getElementById:id=>{assert.ok(elements.has(id),'shipped HTML missing '+id);return elements.get(id);},
    createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),activeElement:null};
  class LocalURL extends URL{
    static createObjectURL(blob){const id='blob:atlas-'+blobs.size;blobs.set(id,blob);return id;}
    static revokeObjectURL(id){blobs.delete(id);}
  }
  return{document,downloads,LocalURL,$:id=>document.getElementById(id)};
}

test('Atlas selected source produces exact SF88 bytes and invalidates changed or late review output',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'atlas-review-'));
  let catalog,native,explorer;const originalFetch=globalThis.fetch,requests=[];
  try{
    catalog=await DurableCatalogTransaction.open(join(directory,'catalog'));
    const target=listing('/weather','Review target',[
      terms('stellar:pubnet','5','GPUBLIC','PUBLIC_FIXTURE_ASSET'),
      terms('stellar:testnet',AMOUNT,'GTEST','TEST_FIXTURE_ASSET')]);
    async function ingest(entry,sequence){
      return catalog.ingest({sellerId:'atlas-fixture',sequence,entry},authority,{
        authority:'signed_export',sellerId:'atlas-fixture',sourceURL:seller+'/test-fixture.json',
        sourceSha256:sha(JSON.stringify(entry)),observedAt:'2026-10-11T14:00:00.000Z'});
    }
    await ingest(listing('/alpha','Earlier decoy',[terms('stellar:testnet','7','GTEST','TEST_FIXTURE_ASSET')]),1);
    await ingest(target,2);
    native=await serveDiscovery({catalog});
    explorer=await startExplorer({localUpstream:native.origin});
    globalThis.fetch=async(address,options={})=>{
      const url=new URL(String(address));
      assert.ok([native.origin,explorer.url].includes(url.origin),'unexpected nonlocal request '+url.origin);
      requests.push({url:url.href,method:options.method??'GET'});
      return originalFetch(address,options);
    };
    const htmlResponse=await fetch(explorer.url+'/');
    assert.equal(htmlResponse.status,200);
    const harness=dom(await htmlResponse.text()),{$,document,downloads,LocalURL}=harness;
    $('network').value='stellar:testnet';
    let holdNext=false,releaseHeld,heldReady;
    const context=createContext({document,URL:LocalURL,URLSearchParams,AbortController,Blob,console,
      fetch:async(path,options={})=>{
        const isReview=path==='/api/prepare-review';
        const response=await fetch(new URL(path,explorer.url),{...options,
          headers:{...options.headers,...(isReview?{Origin:explorer.url,'Sec-Fetch-Site':'same-origin'}:{})}});
        if(isReview&&holdNext){
          holdNext=false;const data=await response.json();
          return new Promise(resolve=>{releaseHeld=()=>resolve({ok:response.ok,status:response.status,json:async()=>data});heldReady();});
        }
        return response;
      }});
    const appResponse=await fetch(explorer.url+'/app.mjs');
    assert.equal(appResponse.status,200);
    const entry=new SourceTextModule(await appResponse.text(),{context});
    await entry.link(()=>{throw Error('Unexpected browser module import');});await entry.evaluate();
    const submit=()=> $('review-form').events.submit({preventDefault(){}});
    const edit=(id,value)=>{$(id).value=value;$('review-form').events.input();};
    const targetButtons=()=> $('results').querySelectorAll('.resource')[1].querySelectorAll('button');
    assert.equal($('results').querySelectorAll('.resource').length,2);
    assert.equal(targetButtons()[1].disabled,false);
    targetButtons()[1].click();
    assert.equal($('review-title').textContent,'Review target');
    assert.match($('review-terms').textContent,new RegExp(AMOUNT));
    edit('review-intent','atlas-review-001');edit('review-url',seller+'/weather?city=Lagos');
    $('review-source-download').click();
    const sourceText=await downloads.at(-1).blob.text(),observed=JSON.parse(sourceText);
    assert.equal(observed.schema,'scf61-observed-native-page-v1');
    assert.equal(new URL(observed.sourceUrl).origin,native.origin);
    assert.equal(observed.nativeProviderRows[1].accepts[1].amount,AMOUNT);
    assert.equal(observed.filterRequest.network,'stellar:testnet');
    await submit();
    assert.equal($('review-download').disabled,false);
    assert.equal($('review-output').hidden,false);
    $('review-download').click();
    const configText=await downloads.at(-1).blob.text(),config=JSON.parse(configText);
    assert.equal(config.operation.expect.maxAtomic,AMOUNT);
    assert.equal(config.operation.expect.network,'stellar:testnet');
    assert.equal(config.operation.expect.payTo,'GTEST');
    assert.equal(config.preparedFrom.rowIndex,1);assert.equal(config.preparedFrom.acceptIndex,1);
    assert.equal(config.preparedFrom.discoveryFileSha256,sha(sourceText));
    assert.deepEqual(config.preparedFrom.originalListing,observed.nativeProviderRows[1]);
    assert.match($('review-digests').textContent,new RegExp(sha(configText)));
    const sourcePath=join(directory,'observed.json'),configPath=join(directory,'cli-review.json');
    await writeFile(sourcePath,sourceText);
    const cli=await prepare(['--discovery',sourcePath,'--row','1','--accept','1',
      '--intent-id','atlas-review-001','--url',seller+'/weather?city=Lagos','--method','GET','--out',configPath]);
    assert.equal(await readFile(configPath,'utf8'),configText,'original CLI and local API must produce identical bytes');
    assert.equal(cli.configSha256,sha(configText));assert.equal(cli.sourceFileSha256,sha(sourceText));

    // A changed request cannot export the old config, and API errors remain actionable.
    edit('review-url','https://different.example/weather');
    assert.equal($('review-download').disabled,true);assert.equal($('review-output').hidden,true);
    const before=downloads.length;$('review-download').click();assert.equal(downloads.length,before);
    await submit();
    assert.match($('review-status').textContent,/Keep the selected seller origin and path/);
    assert.equal($('review-download').disabled,true);
    edit('review-url',seller+'/weather?city=Lagos');edit('review-intent','pending-review');
    holdNext=true;const waiting=new Promise(resolve=>{heldReady=resolve;});const pending=submit();
    await waiting;edit('review-intent','edited-during-request');
    releaseHeld();await pending;
    assert.equal($('review-download').disabled,true,'late successful response must not revive edited config');
    assert.equal($('review-output').hidden,true);
    assert.match($('review-status').textContent,/Request edited/);
    await submit();assert.equal($('review-download').disabled,false);
    assert.equal(JSON.parse($('review-config').textContent).operation.intentId,'edited-during-request');

    // Browsing pins the chosen observation; choosing a new offer invalidates it.
    const revised=structuredClone(target);revised.accepts[1].amount='9007199254740993123456790';
    await ingest(revised,3);
    await $('query-form').events.submit({preventDefault(){}});
    assert.match($('review-source-status').textContent,/earlier source page/);
    assert.equal(JSON.parse($('review-config').textContent).operation.expect.maxAtomic,AMOUNT);
    $('review-source-download').click();assert.equal(await downloads.at(-1).blob.text(),sourceText);
    targetButtons()[0].click();
    assert.equal($('review-download').disabled,true);assert.equal($('review-output').hidden,true);
    assert.equal($('review-intent').value,'');
    assert.match($('review-terms').textContent,/stellar:pubnet/);
    assert.doesNotMatch($('review-terms').textContent,new RegExp(AMOUNT));
    $('review-source-download').click();
    const newSource=JSON.parse(await downloads.at(-1).blob.text());
    assert.equal(newSource.nativeProviderRows[1].accepts[1].amount,revised.accepts[1].amount);

    const selection={rowIndex:1,acceptIndex:1,intentId:'origin-check',url:seller+'/weather',method:'GET'};
    const body=JSON.stringify({discovery:sourceText,selection});
    const denied=await fetch(explorer.url+'/api/prepare-review',{method:'POST',
      headers:{'Content-Type':'application/json',Origin:'https://foreign.example'},body});
    assert.equal(denied.status,403);assert.equal((await denied.json()).error,'LOCAL_ORIGIN_ONLY');
    const missingMethod={...selection};delete missingMethod.method;
    const invalid=await fetch(explorer.url+'/api/prepare-review',{method:'POST',
      headers:{'Content-Type':'application/json',Origin:explorer.url,'Sec-Fetch-Site':'same-origin'},
      body:JSON.stringify({discovery:sourceText,selection:missingMethod})});
    assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'INVALID_METHOD');
    assert.ok(requests.some(x=>x.url.startsWith(native.origin+'/discovery/resources')),'original SF60 HTTP was exercised');
    assert.ok(requests.some(x=>x.url===explorer.url+'/api/prepare-review'&&x.method==='POST'));
  }finally{
    globalThis.fetch=originalFetch;
    if(explorer)await explorer.close();if(native)await native.close();if(catalog)await catalog.close();
    await rm(directory,{recursive:true,force:true});
  }
});


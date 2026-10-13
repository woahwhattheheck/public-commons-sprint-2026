// MIT. Load the original maintained companion and source index into the shared reader.
import {SOURCE_INDEX_SCHEMA,MAX_SOURCE_BYTES,parseCompanionMarkdown,companionReaderMarkup,activateCompanionReader} from './grant-companion-core.mjs';
import {createCompanionEditionModel} from './grant-companion-editions.mjs';
import {createCompanionReturnModel} from './grant-companion-returns.mjs';
import {mountCompanionReadingWorkspace,offlineCompanionReadingWorkspace} from './grant-companion-reading.mjs';

const reader=document.getElementById('companion-reader');
async function readBytes(path,maximum=MAX_SOURCE_BYTES) {
  const response=await fetch(new URL(path,location.href),{cache:'no-store'});
  if(!response.ok)throw new Error('Could not open '+path+' (HTTP '+response.status+').');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>maximum)throw new Error(path+' exceeds the complete reader allowance.');
  if(!response.body){const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>maximum)throw new Error(path+' exceeds the complete reader allowance.');return bytes;}
  const stream=response.body.getReader(),parts=[];let total=0;
  try{for(;;){const {done,value}=await stream.read();if(done)break;total+=value.length;if(total>maximum)throw new Error(path+' exceeds the complete reader allowance.');parts.push(value);}}
  catch(error){await stream.cancel().catch(()=>{});throw error;}finally{stream.releaseLock();}
  const bytes=new Uint8Array(total);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}return bytes;
}
const decode=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
async function sourceEdition(){
  for(let attempt=0;attempt<2;attempt++){
    const [indexBytes,markdownBytes]=await Promise.all([readBytes('./grant-data/source-index.json'),readBytes('./grant-data/product-and-finance.md')]);
    const indexText=decode(indexBytes),index=JSON.parse(indexText.replace(/^\uFEFF/,'')),selected=index.product_and_finance;
    if(index.schema!==SOURCE_INDEX_SCHEMA||!selected||!Number.isSafeInteger(selected.bytes)||!/^[a-f0-9]{64}$/.test(selected.sha256||''))throw new Error('Open the original source index with its complete product and finance selection.');
    const sha256=await digest(markdownBytes);
    if(selected.bytes===markdownBytes.length&&selected.sha256===sha256)return {markdown:decode(markdownBytes),indexText,bytes:markdownBytes.length,sha256};
    if(attempt===1)throw new Error('The companion and source index changed during publication. Reload this reader to open the completed edition.');
  }
}
function save(body,name,type){const url=URL.createObjectURL(new Blob([body],{type})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
let activeReading=null;
async function open(){
  reader.setAttribute('aria-busy','true');
  const source=await sourceEdition(),api=createCompanionReturnModel({editions:createCompanionEditionModel({parseMarkdown:parseCompanionMarkdown})}),key='scf-companion-reading:maintained-application';
  let initial=null,warning='';
  try{const saved=localStorage.getItem(key);if(saved)initial=await api.reopen(saved);}catch(error){warning='The saved browser copy could not reopen; the current published source is selected. '+error.message;}
  activeReading?.destroy();
  activeReading=await mountCompanionReadingWorkspace(reader,{
    api,reader:{parseCompanionMarkdown,companionReaderMarkup,activateCompanionReader},
    initialSource:source,initialWorkspace:initial,origin:new URL('./grant-data/product-and-finance.md',location.href).href,
    persist:workspace=>localStorage.setItem(key,JSON.stringify(workspace)),
    onOffline:async workspace=>{
      const paths=['./grant-companion.css','./grant-companion-core.mjs','./grant-companion-editions.mjs','./grant-companion-reading.mjs','./grant-companion-returns.mjs'];
      const [css,coreSource,editionSource,viewSource,returnsSource]=await Promise.all(paths.map(async path=>decode(await readBytes(path,1024*1024))));
      const html=offlineCompanionReadingWorkspace(workspace,{css,coreSource,editionSource,viewSource,returnsSource,applicationUrl:new URL('./grant.html',location.href).href,submissionUrl:new URL('./grant-submission.html',location.href).href});
      save(html,'scf-companion-reading-workspace.html','text/html;charset=utf-8');
    }
  });
  if(warning)reader.querySelector('[data-reading-status]').textContent=warning;
  reader.setAttribute('aria-busy','false');
}
function failed(error){
  reader.setAttribute('aria-busy','false');reader.replaceChildren();
  const box=document.createElement('main');box.className='reader-error';
  const title=document.createElement('h1');title.textContent='Open the complete companion';
  const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message||String(error);
  const retry=document.createElement('button');retry.type='button';retry.textContent='Reload companion';retry.addEventListener('click',()=>{retry.disabled=true;open().catch(failed);});
  const links=document.createElement('p');
  for(const [label,href] of [['Download the original Markdown','./grant-data/product-and-finance.md'],['Open the application','./grant.html']]){const a=document.createElement('a');a.textContent=label;a.href=href;if(href.endsWith('.md'))a.download='product-and-finance.md';if(links.childNodes.length)links.append(' · ');links.append(a);}
  box.append(title,message,retry,links);reader.append(box);
}
open().catch(failed);

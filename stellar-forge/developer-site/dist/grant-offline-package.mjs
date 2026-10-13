// MIT. One portable edition of the original SCF submission editor and draft.
import {importSubmissionWorkingCopy, submissionWorkingDraft} from './grant-submission-working-copy.mjs';
import {openDraftEnvelope} from './grant-handover-source.mjs';
export const OFFLINE_SCHEMA='stellar-forge.grant-offline-editor.v1';
export const RUNTIME_SCHEMA='stellar-forge.grant-offline-runtime.v1';
export const MAX_RUNTIME_BYTES=8*1024*1024;
export const MAX_RUNTIME_FILE_BYTES=2*1024*1024;
export const MAX_RUNTIME_FILES=96;
const ENTRY='/grant-submission-workspace.mjs', PAGE='/grant-submission.html';
const need=(value,message)=>{if(!value)throw new Error(message);};
const bytes=value=>new TextEncoder().encode(value);
const hex=value=>Array.from(new Uint8Array(value),byte=>byte.toString(16).padStart(2,'0')).join('');
async function digest(value){need(globalThis.crypto?.subtle,'Use a browser with Web Crypto to open the complete offline editor.');return hex(await crypto.subtle.digest('SHA-256',bytes(value)));}
function json(value){return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));}

// Browser URL resolution, clamped at the mounted root, including original
// ../../../stellar aliases. No query strings, remote imports or credentials.
export function resolveOfflineRoute(from,specifier){
  if(typeof specifier!=='string'||!specifier||/[?#\\%:\0]/.test(specifier)||(!specifier.startsWith('.')&&!specifier.startsWith('/')))throw new Error('The offline editor needs a declared local source: '+specifier);
  const parts=specifier.startsWith('/')?[]:from.split('/').slice(0,-1).filter(Boolean);
  for(const part of specifier.split('/')){if(!part||part==='.')continue;if(part==='..')parts.pop();else{if(!/^[A-Za-z0-9_.-]+$/.test(part))throw new Error('Invalid editor source path.');parts.push(part);}}
  const route='/'+parts.join('/');
  if(!/^\/[A-Za-z0-9_./-]+\.(mjs|css|html)$/.test(route))throw new Error('Unsupported offline editor source '+route+'.');
  return route;
}
export function offlineModuleReferences(source){
  const found=[],starts=new Set(),pattern=/(?:^|\n)\s*(?:import\s+(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from|export\s+(?:\*|\{[^}]*\})\s+from)\s*(['"])([^'"]+)\1/g;
  for(const match of source.matchAll(pattern)){
    starts.add(match.index+match[0].search(/\b(?:import|export)\b/));
    const local=match[0].lastIndexOf(match[1]+match[2]+match[1])+1;
    found.push({start:match.index+local,end:match.index+local+match[2].length,specifier:match[2]});
  }
  for(const match of source.matchAll(/(?:^|\n)\s*import\b/g))if(!starts.has(match.index+match[0].lastIndexOf('import')))throw new Error('Retain every original static import before exporting this editor.');
  // The maintained editor has explicit static imports. Unknown loading forms
  // must be added to this source contract before they can be made portable.
  if(/\bimport\s*\(/.test(source)||/\bimport\.meta/.test(source)||/(?:^|\n)\s*import\s*['"]/.test(source))throw new Error('This editor edition uses an unsupported module loader. Retain its complete native source.');
  return found;
}
function pageReferences(source){
  const modules=[...source.matchAll(/<script\b[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi)].map(x=>resolveOfflineRoute(PAGE,x[1]));
  const styles=[...source.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)].map(x=>resolveOfflineRoute(PAGE,x[1]));
  need(modules.length===1&&modules[0]===ENTRY,'Use the original complete Prepare submission page.');
  need(styles.length>0,'Retain the original submission stylesheet.');
  return {modules,styles};
}
function checkClosure(runtime){
  const files=new Map(runtime.files.map(file=>[file.route,file]));
  need(files.has(PAGE)&&files.has(ENTRY),'Retain the original editor page and entry module.');
  const page=pageReferences(files.get(PAGE).content);
  const pending=[PAGE,...page.modules,...page.styles],visited=new Set();
  while(pending.length){const route=pending.pop();if(visited.has(route))continue;visited.add(route);const file=files.get(route);need(file,'Retain complete editor dependency '+route+'.');
    if(route.endsWith('.mjs'))for(const reference of offlineModuleReferences(file.content))pending.push(resolveOfflineRoute(route,reference.specifier));
    if(route.endsWith('.css'))need(!/@import\b|url\s*\(/i.test(file.content),'Retain all stylesheet resources before exporting this editor.');
  }
  need(visited.size===files.size,'Keep exactly the original editor dependency closure.');
  return {files,page};
}
export async function validateOfflineRuntime(runtime){
  need(runtime?.schema===RUNTIME_SCHEMA&&runtime.entry===ENTRY&&runtime.page===PAGE&&Array.isArray(runtime.files)&&runtime.files.length>0&&runtime.files.length<=MAX_RUNTIME_FILES,'Open a complete retained editor runtime.');
  const seen=new Set();let total=0;
  for(const file of runtime.files){
    need(file&&typeof file.route==='string'&&resolveOfflineRoute('/',file.route)===file.route&&!seen.has(file.route),'Keep one complete source per editor route.');seen.add(file.route);
    need(typeof file.content==='string'&&Number.isSafeInteger(file.bytes)&&file.bytes>=0&&file.bytes<=MAX_RUNTIME_FILE_BYTES&&/^[a-f0-9]{64}$/.test(file.sha256),'Keep the complete editor source identity.');
    const length=bytes(file.content).length;total+=length;
    need(length===file.bytes&&total<=MAX_RUNTIME_BYTES&&await digest(file.content)===file.sha256,'The retained editor source changed: '+file.route+'.');
  }
  checkClosure(runtime);return runtime;
}
export async function collectOfflineRuntime({readText}){
  need(typeof readText==='function','Provide the original declared editor source reader.');
  const files=new Map(),pending=[PAGE];let total=0;
  while(pending.length){
    const route=pending.shift();if(files.has(route))continue;
    need(files.size<MAX_RUNTIME_FILES,'This editor exceeds the portable source limit.');
    const content=await readText(route,MAX_RUNTIME_FILE_BYTES);need(typeof content==='string','Read complete UTF-8 editor source.');
    const size=bytes(content).length;total+=size;need(size<=MAX_RUNTIME_FILE_BYTES&&total<=MAX_RUNTIME_BYTES,'This editor exceeds the portable source limit.');
    files.set(route,{route,bytes:size,sha256:await digest(content),content});
    if(route===PAGE){const page=pageReferences(content);pending.push(...page.modules,...page.styles);}
    if(route.endsWith('.mjs'))for(const reference of offlineModuleReferences(content))pending.push(resolveOfflineRoute(route,reference.specifier));
  }
  const runtime={schema:RUNTIME_SCHEMA,page:PAGE,entry:ENTRY,files:[...files.values()].sort((a,b)=>a.route.localeCompare(b.route))};
  return validateOfflineRuntime(runtime);
}
export async function collectBrowserOfflineRuntime({baseUrl=document.baseURI,signal}={}){
  const base=new URL('.',baseUrl);need(['https:','http:'].includes(base.protocol),'Use the retained runtime when exporting from an offline file.');
  return collectOfflineRuntime({readText:async(route,maximum)=>{
    // Routes use the same mounted root as the original source aliases.
    const url=new URL(route,base);need(url.origin===base.origin,'Keep source reads on the original host.');
    const response=await fetch(url,{cache:'no-cache',credentials:'same-origin',redirect:'error',signal});
    need(response.ok,'Editor source '+route+' returned HTTP '+response.status+'.');
    const declared=response.headers.get('content-length');if(declared!==null)need(/^\d+$/.test(declared)&&Number(declared)<=maximum,'Editor source exceeds the portable limit.');
    const reader=response.body?.getReader();need(reader,'This browser cannot read the complete editor source stream.');
    let size=0;const chunks=[];
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;need(size<=maximum,'Editor source exceeds the portable limit.');chunks.push(part.value);}}
    catch(error){try{await reader.cancel();}catch{}throw error;}finally{reader.releaseLock();}
    const body=new Uint8Array(size);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
    return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(body);
  }});
}

// This exact bootstrap is embedded with the complete runtime. Imports remain
// native browser ES modules, including cycles; only their route strings change.
async function startOffline(resolveRoute,references){
  const fail=error=>{const box=document.getElementById('error');box.hidden=false;box.textContent='Offline editor: '+(error.message||error);document.getElementById('status').textContent='The complete offline edition could not be opened.';};
  try{
    if(!crypto?.subtle||!HTMLScriptElement.supports?.('importmap'))throw new Error('Open this HTML in a current desktop or mobile browser with Web Crypto and import-map support.');
    const pack=JSON.parse(document.getElementById('scf-offline-edition').textContent),runtime=pack.runtime;
    if(pack.schema!=='stellar-forge.grant-offline-editor.v1'||runtime?.schema!=='stellar-forge.grant-offline-runtime.v1'||runtime.entry!=='/grant-submission-workspace.mjs'||!Array.isArray(runtime.files)||runtime.files.length>96)throw new Error('Retain the complete original offline edition.');
    const table=new Map(),imports=Object.create(null);let total=0;
    for(const file of runtime.files){
      if(typeof file.content!=='string'||table.has(file.route)||resolveRoute('/',file.route)!==file.route)throw new Error('Retain complete unique editor source files.');
      const body=new TextEncoder().encode(file.content);total+=body.length;
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',body)),x=>x.toString(16).padStart(2,'0')).join('');
      if(body.length!==file.bytes||body.length>2097152||total>8388608||hash!==file.sha256)throw new Error('Editor source changed: '+file.route);
      table.set(file.route,file);
    }
    if(!table.has(runtime.entry))throw new Error('The original editor entry is missing.');
    const prefix='https://scf-offline.invalid';
    for(const file of runtime.files){
      if(!file.route.endsWith('.mjs'))continue;
      let content=file.content;
      for(const reference of references(content).reverse()){
        const route=resolveRoute(file.route,reference.specifier);if(!table.has(route))throw new Error('Missing original editor dependency '+route);
        content=content.slice(0,reference.start)+prefix+route+content.slice(reference.end);
      }
      imports[prefix+file.route]=URL.createObjectURL(new Blob([content],{type:'text/javascript'}));
    }
    const map=document.createElement('script');map.type='importmap';map.nonce=pack.nonce;map.textContent=JSON.stringify({imports});document.head.append(map);
    globalThis.__STELLAR_GRANT_OFFLINE__={schema:pack.schema,envelope:pack.envelope,workingEnvelope:pack.workingEnvelope||null,runtime};
    const entry=document.createElement('script');entry.type='module';entry.nonce=pack.nonce;entry.src=imports[prefix+runtime.entry];entry.onerror=()=>fail(new Error('The original editor could not start. Open this complete HTML in your browser rather than its document preview.'));document.head.append(entry);
  }catch(error){fail(error);}
}
export async function createOfflineEditor({envelope=null,workingEnvelope=null,runtime,planningOptions,exportedAt=new Date().toISOString()}){
  need((typeof envelope==='string')!==(typeof workingEnvelope==='string'),'Select one complete original draft or unfinished working export.');
  let draft;
  if(workingEnvelope!==null){const working=await importSubmissionWorkingCopy(workingEnvelope);draft=submissionWorkingDraft(working);need(draft,'Open an application before exporting its offline editor.');}
  else{need(bytes(envelope).length<=32*1024*1024+65536,'Retain the complete original draft export.');draft=await openDraftEnvelope(envelope,{planningOptions});}
  await validateOfflineRuntime(runtime);
  need(Number.isFinite(Date.parse(exportedAt)),'Use a valid offline export date.');
  const {files,page}=checkClosure(runtime),nonce=crypto.randomUUID().replace(/-/g,'');
  const pack={schema:OFFLINE_SCHEMA,exportedAt,nonce,envelope,workingEnvelope,runtime};
  let html=files.get(PAGE).content;
  html=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<link\b[^>]*>/gi,'');
  html=html.replace(/<header class="site-header">[\s\S]*?<\/header>/,'<header class="site-header"><a class="brand" href="#editor">Stellar Forge <span>Offline submission</span></a><nav aria-label="Main navigation"><a href="#workspace-root">Draft and output controls</a></nav></header>');
  html=html.replace(/<noscript>[\s\S]*?<\/noscript>/,'<noscript><p>Open this complete HTML in a browser with JavaScript enabled to edit and export the retained draft.</p></noscript>');
  html=html.replace('Opening the current application…','Opening the complete retained application…');
  const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  html=html.replace(/<title>[\s\S]*?<\/title>/,()=>'<title>'+escape(draft.title)+' — offline submission</title>');
  const policy='<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; script-src &#39;nonce-'+nonce+'&#39; blob:; style-src &#39;unsafe-inline&#39;; img-src data: blob:; connect-src &#39;none&#39;; object-src &#39;none&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;">';
  const styles=page.styles.map(route=>'<style>'+files.get(route).content.replace(/</g,'\\3c ')+'</style>').join('\n');
  html=html.replace('</head>',()=>policy+'\n'+styles+'\n</head>');
  const bootstrap='('+startOffline.toString()+')('+resolveOfflineRoute.toString()+','+offlineModuleReferences.toString()+');';
  html=html.replace('</body>',()=>'<script id="scf-offline-edition" type="application/json">'+json(pack)+'</script>\n<script nonce="'+nonce+'">'+bootstrap.replace(/<\/script/gi,'<\\/script')+'</script>\n</body>');
  return html;
}

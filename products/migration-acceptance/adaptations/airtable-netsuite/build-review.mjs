#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Complete offline edition of the unchanged provider review modules.
import fs from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256Utf8,utf8ByteLength} from './sha256.mjs';
const ROOT='adaptations/airtable-netsuite/',ENTRY=ROOT+'app.mjs';
const need=(yes,message)=>{if(!yes)throw Error(message);};
const stringify=value=>JSON.stringify(value,null,2)+'\n';
function normalized(base,specifier){
 need(specifier.startsWith('.'),'Offline review imports only its retained relative source.');
 const parts=base.split('/');parts.pop();
 for(const part of specifier.split('/')){if(part==='.'||!part)continue;if(part==='..'){need(parts.length,'Module path leaves the product source.');parts.pop();}else parts.push(part);}
 return parts.join('/');
}
function graph(files,path,visiting=new Set(),done=new Map()){
 if(done.has(path))return done;
 need(!visiting.has(path),'The selected review module graph contains a cycle.');need(typeof files[path]==='string','Missing complete browser module: '+path);
 visiting.add(path);const original=files[path],imports=[];
 need(!/\bimport\s*\(/.test(original),'Dynamic module imports require an explicitly supported offline binding.');
 const pattern=/^(?:import\s+[^;\n]*?\s+from\s*|export\s+[^;\n]*?\s+from\s*)['"]([^'"]+)['"]\s*;?/gm;let match;
 while((match=pattern.exec(original))){const specifier=match[1],target=normalized(path,specifier);imports.push({specifier,target});graph(files,target,visiting,done);}
 need(!/^import\s*['"]/m.test(original),'Side-effect imports require an explicitly supported offline binding.');
 visiting.delete(path);done.set(path,{path,source:original,bytes:utf8ByteLength(original),sha256:sha256Utf8(original).sha256,imports});return done;
}
function base64(bytes){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',out=[];let part='';
 for(let i=0;i<bytes.length;i+=3){const n=(bytes[i]<<16)|((bytes[i+1]||0)<<8)|(bytes[i+2]||0);part+=alphabet[(n>>>18)&63]+alphabet[(n>>>12)&63]+(i+1<bytes.length?alphabet[(n>>>6)&63]:'=')+(i+2<bytes.length?alphabet[n&63]:'=');if(part.length>32768){out.push(part);part='';}}
 if(part)out.push(part);return out.join('');
}
const BOOTSTRAP=String.raw`
const fail=error=>{const e=document.getElementById('error');e.hidden=false;e.textContent='The complete offline review could not open: '+error.message;};
try{
 const packet=JSON.parse(document.getElementById('provider-offline-source').textContent),urls=new Map(),made=[];
 const make=(body,type)=>{const url=URL.createObjectURL(new Blob([body],{type}));made.push(url);return url;};
 const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0)),sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
 const files=new Map();
 for(const f of packet.files){const bytes=decode(f.content);if(bytes.length!==f.bytes||await sha(bytes)!==f.sha256)throw Error('Retained source differs: '+f.path);files.set(f.path,new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
 for(const module of packet.modules){
  let source=files.get(module.path);if(typeof source!=='string')throw Error('Missing retained module '+module.path);
  for(const ref of module.imports){const target=urls.get(ref.target);if(!target)throw Error('Unresolved original import '+ref.target);
   const escaped=ref.specifier.replace(/[.*+?^$\{}()|[\]\\]/g,'\\$&');
   const pattern=new RegExp('(^\\s*(?:import|export)\\s+[^;\\n]*?\\s+from\\s*)([\x27\x22])'+escaped+'\\2','gm');
   let hits=0;source=source.replace(pattern,(_,prefix,quote)=>{hits++;return prefix+quote+target+quote;});if(!hits)throw Error('Original module import is missing '+ref.specifier);
  }
  urls.set(module.path,make(source,'text/javascript'));
 }
 const sourceURL=make(JSON.stringify(packet,null,2)+'\n','application/json'),download=document.getElementById('offline-source');
 download.href=sourceURL;download.download='provider-offline-review-source.json';
 const guide=make(files.get(packet.root+'OPERATING.md'),'text/plain;charset=utf-8');
 for(const a of document.querySelectorAll('a[href="./OPERATING.md"]')){a.href=guide;a.download='OPERATING.md';}
 const example=files.get(packet.root+'examples/reviewed-project.json');
 if(example){const a=document.getElementById('offline-example');a.href=make(example,'application/json');a.download='reference-project.json';a.hidden=false;}
 document.getElementById('offline-source-count').textContent=packet.files.length+' complete source files retained in this offline review.';
 await import(urls.get(packet.entry));
 // Keep Blob URLs for this document's lifetime, including back/forward-cache restores.
}catch(error){fail(error);}
`;
export function buildOfflineReview({files}){
 need(files&&typeof files==='object','Complete original file map is required.');
 const manifest=JSON.parse(files[ROOT+'SOURCE_MANIFEST.json']);need(Array.isArray(manifest.files),'Missing complete addon manifest.');
 const selected=new Set([ROOT+'SOURCE_MANIFEST.json']);
 for(const row of manifest.files){const p=ROOT+row.path;need(!row.path.startsWith('/')&&!row.path.split('/').some(x=>!x||x==='.'||x==='..'),'Unsafe source manifest path.');
  need(typeof files[p]==='string'&&utf8ByteLength(files[p])===row.bytes&&sha256Utf8(files[p]).sha256===row.sha256,'Original addon source changed: '+row.path);selected.add(p);}
 const modules=graph(files,ENTRY);for(const path of modules.keys())selected.add(path);
 const nativeManifest=JSON.parse(files['workbench/SOURCE_MANIFEST.json']);selected.add('workbench/SOURCE_MANIFEST.json');
 for(const path of modules.keys())if(path.startsWith('workbench/')){const row=nativeManifest.files.find(x=>x.path===path.slice('workbench/'.length));need(row&&row.bytes===utf8ByteLength(files[path])&&row.sha256===sha256Utf8(files[path]).sha256,'Original native browser dependency changed: '+path);}
 const encoder=new TextEncoder(),packet={schema:'tjlabs.provider-offline-review.v1',root:ROOT,entry:ENTRY,
  modules:[...modules.values()].map(({path,imports})=>({path,imports})),
  files:[...selected].sort().map(path=>({path,bytes:utf8ByteLength(files[path]),sha256:sha256Utf8(files[path]).sha256,content:base64(encoder.encode(files[path]))}))};
 let html=files[ROOT+'index.html'];need(typeof html==='string'&&html.includes('<script type="module" src="./app.mjs"></script>'),'Keep the original complete review HTML.');
 need(html.includes('<link rel="stylesheet" href="./style.css">'),'Keep the original complete review stylesheet.');
 html=html.replace('<link rel="stylesheet" href="./style.css">','<style>'+files[ROOT+'style.css'].replace(/<\/style/gi,'<\\/style')+'</style>');
 const toolbar='<section><h2>Offline review source</h2><p id="offline-source-count">Opening complete retained source…</p><div class="actions"><a id="offline-source">Download this complete review source</a><a id="offline-example" hidden>Download the authored reference project</a></div><p>Use the original project control to open a saved project. The reference file demonstrates the mapping and retains an intentional comparison difference. Native execution uses the complete maintained Migration Acceptance Workbench.</p></section>';
 html=html.replace('<main>','<main>'+toolbar);
 const embedded=JSON.stringify(packet).replace(/</g,'\\u003c');
 html=html.replace('<script type="module" src="./app.mjs"></script>','<script id="provider-offline-source" type="application/json">'+embedded+'</script><script type="module">'+BOOTSTRAP+'</script>');
 return{html,packet,bytes:utf8ByteLength(html),sha256:sha256Utf8(html).sha256};
}
async function main(){
 const addon=dirname(fileURLToPath(import.meta.url)),product=resolve(addon,'../..'),out=process.argv[2];need(out,'Usage: node build-review.mjs /absolute/path/provider-review.html');
 const manifestText=await fs.readFile(join(addon,'SOURCE_MANIFEST.json'),'utf8'),manifest=JSON.parse(manifestText),files={[ROOT+'SOURCE_MANIFEST.json']:manifestText};
 for(const row of manifest.files){need(typeof row.path==='string'&&!row.path.startsWith('/')&&!row.path.split('/').some(x=>!x||x==='.'||x==='..'),'Unsafe source path.');files[ROOT+row.path]=await fs.readFile(join(addon,row.path),'utf8');}
 for(const path of ['workbench/SOURCE_MANIFEST.json','workbench/web/sha256.mjs','workbench/vendor/dlt/vendor/sling/vendor/stellar-expert/exact-json.mjs'])files[path]=await fs.readFile(join(product,path),'utf8');
 const result=buildOfflineReview({files}),target=resolve(out);await fs.mkdir(dirname(target),{recursive:true});
 try{const existing=await fs.readFile(target,'utf8');need(existing===result.html,'Keep the existing different offline edition and select another output path.');}catch(e){if(e.code!=='ENOENT')throw e;const tmp=target+'.'+process.pid+'.tmp';const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(result.html,'utf8');await h.sync();}finally{await h.close();}try{await fs.link(tmp,target);}finally{await fs.unlink(tmp);}}
 console.log(stringify({path:target,bytes:result.bytes,sha256:result.sha256,sourceFiles:result.packet.files.length,browserModules:result.packet.modules.length}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();

#!/usr/bin/env node
// MIT. File-only whole programme export. The original five-module CASE receiving CLI stays unchanged.
import {open,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import * as engine from './case-source.mjs';
import {createCASEProgramme,parseCASEProgrammeJSON} from './programme.mjs';
import {buildCASEProgrammeHTML} from './programme-build.mjs';
const hash=async b=>createHash('sha256').update(b).digest('hex'),encode=s=>new TextEncoder().encode(s);
const M=createCASEProgramme({uuid:()=>randomUUID(),now:()=>new Date().toISOString(),hash,encode,compare:engine.compareCASEEditions,delivery:engine.createCASEDelivery,inspectDelivery:engine.inspectCASEDelivery,inspectSource:engine.inspectCASESource});
async function read(path){const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Select an ordinary complete file.');const h=await open(path,'r');try{const a=await h.stat();if(a.dev!==stat.dev||a.ino!==stat.ino)throw Error('File identity changed before reading.');const bytes=await h.readFile(),b=await h.stat();if(a.size!==b.size||a.mtimeMs!==b.mtimeMs||bytes.length!==b.size)throw Error('File changed while reading.');return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}finally{await h.close();}}
async function write(path,text){const h=await open(path,'wx',0o600);try{await h.writeFile(text,'utf8');await h.sync();}finally{await h.close();}if(await read(path)!==text)throw Error('Complete file readback differs.');}
async function syncDir(path){if(process.platform==='win32')return;const h=await open(path,'r');try{await h.sync();}finally{await h.close();}}
async function assets(){const root=dirname(fileURLToPath(import.meta.url)),files={};for(const p of ['source-json.mjs','case-source.mjs','case-report.mjs','programme.mjs','programme-host.mjs','programme-app.mjs','programme-boot.mjs','programme-build.mjs','desk.css'])files['product/'+p]=await read(join(root,p));for(const p of ['framework-v1.json','framework-v2.json'])files['examples/'+p]=await read(join(root,'../examples',p));return files;}
export async function runCASEProgrammeCLI(argv){
 const [command,...rest]=argv;if(!command||command==='--help'){process.stdout.write('CASE programme file workflow (Node 22+)\ninspect --working file.json\nhtml --working file.json --out new-file.html\nexport --working file.json --out new-directory\nNo network requests or publisher writes. Outputs are created exclusively.\n');return;}
 const o={};for(let i=0;i<rest.length;i+=2){if(!['--working','--out'].includes(rest[i])||o[rest[i]]!==undefined||!rest[i+1])throw Error('Use complete, unique documented options.');o[rest[i]]=rest[i+1];}
 if(!o['--working'])throw Error('Select the complete working JSON.');const original=await read(resolve(o['--working'])),w=parseCASEProgrammeJSON(original);await M.verify(w);
 if(command==='inspect'){if(o['--out'])throw Error('Inspect does not write output.');process.stdout.write(JSON.stringify({programme:w.id,sequence:w.sequence,frameworks:M.continuity(w),editions:w.editions.length,receiving:w.receiving.map(x=>({name:x.name,status:x.status,sha256:x.sha256}))},null,2)+'\n');return;}
 if(!o['--out'])throw Error('Select a new output path.');const out=resolve(o['--out']);
 if(command==='html'){await write(out,buildCASEProgrammeHTML(w,await assets()));await syncDir(dirname(out));process.stdout.write(JSON.stringify({file:out})+'\n');return;}
 if(command!=='export')throw Error('Unknown command.');const files={'selected-working-original.json':original,...await M.exportProgramme(w)};files['programme-working.html']=buildCASEProgrammeHTML(w,await assets());delete files['programme-manifest.json'];const members=[];for(const[name,text]of Object.entries(files))members.push({name,bytes:encode(text).length,sha256:await hash(encode(text))});files['programme-manifest.json']=JSON.stringify({schema:'commons.case-programme-files.v1',files:members},null,2)+'\n';
 await mkdir(out,{mode:0o700});for(const[name,text]of Object.entries(files))await write(join(out,name),text);await syncDir(out);await syncDir(dirname(out));process.stdout.write(JSON.stringify({directory:out,members},null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)runCASEProgrammeCLI(process.argv.slice(2)).catch(e=>{process.stderr.write(JSON.stringify({error:e.message})+'\n');process.exitCode=1;});

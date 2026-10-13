#!/usr/bin/env node
'use strict';
const {readFile,open,link,unlink,lstat}=require('node:fs/promises');
const {resolve,join,dirname,basename}=require('node:path');
const {randomUUID}=require('node:crypto');
const {createConfiguration,validateConfiguration}=require('./configuration.cjs');
const core=require('./formward_commissioning.cjs');
const {renderKit}=require('./generator.cjs');
const HELP='Formward commissioning\n\n  node cli.cjs init --id YOUR_WORKSPACE_ID --out /private/configuration.json [--forms 1] [--title TITLE]\n  node cli.cjs inspect --config /private/configuration.json [--state /private/record.json]\n  node cli.cjs build --config /private/configuration.json --out /private/commissioning.html [--state /private/record.json] [--operator NAME] [--actual-return /private/actual-return.json]\n\nOutputs are complete UTF-8 files created with mode 0600. Existing files are never overwritten. Configuration and saved records stay on your chosen private paths. No command sends a submission.\n';
function parse(argv){
 const [command,...rest]=argv;if(!command||command==='help'||command==='--help')return {command:'help',options:{}};
 const allowed={init:['id','out','forms','title'],inspect:['config','state'],build:['config','state','out','operator','actual-return']}[command];
 if(!allowed)throw new Error('Use init, inspect or build. See --help.');
 const options={};
 for(let i=0;i<rest.length;i+=2){const key=rest[i].slice(2),value=rest[i+1];if(!rest[i].startsWith('--')||!allowed.includes(key)||Object.hasOwn(options,key)||value===undefined||value.startsWith('--'))throw new Error('Use each documented option once with its complete value.');options[key]=value;}
 const required=command==='init'?['id','out']:command==='build'?['config','out']:['config'];
 for(const k of required)if(!options[k])throw new Error('Missing --'+k+'.');
 return {command,options};
}
async function writeComplete(path,content){
 path=resolve(path);const bytes=Buffer.from(content,'utf8');
 async function existing(){
  let info;try{info=await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
  if(!info.isFile()||info.isSymbolicLink()||(info.mode&0o077))throw new Error('The existing output must be a private regular file: '+path);
  if(!(await readFile(path)).equals(bytes))throw new Error('The output already contains different work. Select a new path: '+path);
  return {created:false,path};
 }
 const previous=await existing();if(previous)return previous;
 const temporary=join(dirname(path),'.'+basename(path)+'.'+randomUUID()+'.tmp');
 let handle,temporaryOwned=false;
 try{
  handle=await open(temporary,'wx',0o600);temporaryOwned=true;
  await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;const received=await existing();if(received)return received;throw error;}
  return {created:true,path};
 }finally{
  if(handle)await handle.close().catch(()=>{});
  if(temporaryOwned)await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});
 }
}
async function readJSON(path){const body=await readFile(resolve(path),'utf8');if(Buffer.byteLength(body,'utf8')>8000000)throw new Error('Use a complete input smaller than 8 MB.');return JSON.parse(body);}
async function run(argv,{print=value=>process.stdout.write(value+'\n')}={}){
 const {command,options:o}=parse(argv);if(command==='help'){print(HELP);return;}
 if(command==='init'){
  if(o.forms!==undefined&&!/^[1-9][0-9]*$/.test(o.forms))throw new Error('Use an integer form count.');
  const value=createConfiguration({id:o.id,title:o.title||'Form commissioning',caseCount:Number(o.forms||1)});
  const written=await writeComplete(o.out,JSON.stringify(value,null,2)+'\n');
  print(JSON.stringify({configuration:written.path,created:written.created,forms:value.cases.length,ready:false}));return;
 }
 const configuration=validateConfiguration(await readJSON(o.config));
 const state=o.state?core.readState(await readJSON(o.state),configuration):core.createKit(configuration);
 if(command==='inspect'){print(JSON.stringify({pack_id:state.pack_id,edition_id:state.edition_id,revision:state.revision,forms:state.cases.map(c=>({id:c.id,...core.readiness(c.settings),pending:!!c.working?.pending,observations:c.observations.length}))},null,2));return;}
 const [coreSource,browserSource,css]=await Promise.all(['formward_commissioning.cjs','formward_commissioning_browser.js','style.css'].map(p=>readFile(join(__dirname,p),'utf8')));
 const html=renderKit({configuration,state,coreSource,browserSource,css,operator:o.operator||'',actualReturn:o['actual-return']?await readJSON(o['actual-return']):null});
 const written=await writeComplete(o.out,html);
 print(JSON.stringify({output:written.path,created:written.created,bytes:Buffer.byteLength(html,'utf8'),edition_id:state.edition_id,revision:state.revision,forms:state.cases.length}));
}
if(require.main===module)run(process.argv.slice(2)).catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
module.exports={run,parse,writeComplete};

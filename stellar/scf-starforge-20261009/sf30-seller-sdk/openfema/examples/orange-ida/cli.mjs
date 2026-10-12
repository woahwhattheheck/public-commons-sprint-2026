#!/usr/bin/env node
// MIT. Operator commands for the same source/review workspace used by workspace.html.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createWorkspace,reopenWorkspace,saveWorkspace,importPortfolio,importEngineeringContext,reviewUnits,analyze,exportUnitCsv,exportProjectCsv,htmlReport,base64Bytes} from './workspace.mjs';
const argv=process.argv.slice(2),command=argv.shift(),args={};
for(let i=0;i<argv.length;i+=2){if(!/^--[a-z-]+$/.test(argv[i])||argv[i+1]===undefined)throw Error('Use --name value arguments.');args[argv[i].slice(2)]=argv[i+1];}
const requireArg=k=>args[k]||(()=>{throw Error('Missing --'+k)})();
const home=fileURLToPath(new URL('.',import.meta.url));
const read=async path=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await readFile(resolve(path)));
const parseJson=raw=>JSON.parse(raw.charCodeAt(0)===0xfeff?raw.slice(1):raw);
const create=async(path,content)=>writeFile(resolve(path),content,{flag:'wx'});
try{
 let state;
 if(command==='init'){
  state=createWorkspace({register:parseJson(await read(join(home,'source-register.json'))),createdAt:new Date().toISOString(),id:args.id||'orange-ida-'+randomUUID()});
  state=importEngineeringContext(state,{operationId:'orange-init-context-'+randomUUID(),expectedRevision:state.revision,receivedAt:new Date().toISOString(),name:'engineering-context.json',raw:await read(join(home,'engineering-context.json'))});
  await create(requireArg('out'),saveWorkspace(state));
 }else{
  state=reopenWorkspace(await read(requireArg('workspace')));
  if(command==='import'){
   const source=requireArg('portfolio');state=importPortfolio(state,{operationId:args['operation-id']||'orange-import-'+randomUUID(),expectedRevision:state.revision,receivedAt:new Date().toISOString(),name:source.split(/[\\/]/).pop(),raw:await read(source)});
   await create(requireArg('out'),saveWorkspace(state));
  }else if(command==='context'){
   const source=requireArg('context');state=importEngineeringContext(state,{operationId:args['operation-id']||'orange-context-'+randomUUID(),expectedRevision:state.revision,receivedAt:new Date().toISOString(),name:source.split(/[\\/]/).pop(),raw:await read(source)});
   await create(requireArg('out'),saveWorkspace(state));
  }else if(command==='review'){
   const input=parseJson(await read(requireArg('input')));state=reviewUnits(state,{operationId:args['operation-id']||input.operationId||'orange-review-'+randomUUID(),expectedRevision:state.revision,receivedAt:input.receivedAt||new Date().toISOString(),decisions:input.decisions});
   await create(requireArg('out'),saveWorkspace(state));
  }else if(command==='export'){
   const out=resolve(requireArg('out'));await mkdir(out,{recursive:false});
   await writeFile(join(out,'workspace.json'),saveWorkspace(state),{flag:'wx'});
   await writeFile(join(out,'locations.csv'),exportUnitCsv(state),{flag:'wx'});
   await writeFile(join(out,'projects.csv'),exportProjectCsv(state),{flag:'wx'});
   await writeFile(join(out,'report.html'),htmlReport(state),{flag:'wx'});
   await mkdir(join(out,'portfolios'));for(const p of state.portfolios)await writeFile(join(out,'portfolios',p.sha256+'.json'),p.raw,{flag:'wx'});
   await mkdir(join(out,'engineering-contexts'));for(const c of state.engineeringContexts??[])await writeFile(join(out,'engineering-contexts',c.sha256+'.json'),c.raw,{flag:'wx'});
   await mkdir(join(out,'documents'));for(const d of state.documents)await writeFile(join(out,'documents',d.sha256),base64Bytes(d.base64),{flag:'wx'});
   await writeFile(join(out,'original-files.json'),JSON.stringify({portfolios:state.portfolios.map(({raw,...m})=>m),engineeringContexts:(state.engineeringContexts??[]).map(({raw,...m})=>m),documents:state.documents.map(({base64,...m})=>m)},null,2)+'\n',{flag:'wx'});
  }else if(command!=='inspect')throw Error('Commands: init, import, context, review, inspect, export.');
 }
 console.log(JSON.stringify({workspaceId:state.id,revision:state.revision,summary:analyze(state).summary},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}

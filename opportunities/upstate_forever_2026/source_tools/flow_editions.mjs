#!/usr/bin/env node
/** Build/reopen an exact original-flow study without a network dependency. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {previewFlowStudy,flowCSV} from '../measurement_workspace/engine/flow_workspace.mjs';
import {reconcileFlowEditions} from '../measurement_workspace/engine/flow_editions.mjs';
import {hash,stable} from '../measurement_workspace/engine/normalise.mjs';
const [command='help',...args]=process.argv.slice(2),o={};
for(let i=0;i<args.length;i++){if(!args[i].startsWith('--')||args[i+1]===undefined)throw Error('Options require --name value pairs');o[args[i].slice(2)]=args[++i];}
const json=v=>JSON.stringify(v,null,2)+'\n';
const read=async p=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await fs.readFile(p));
const standalone={readConsistent:fn=>fn(),source:()=>{throw Error('Use the original Measurements CLI for retained import IDs');},iterate:()=>{throw Error('Use the original Measurements CLI for saved chemistry selection');}};
async function inputs(file){
 const input=JSON.parse(await read(file)),root=path.dirname(await fs.realpath(file));
 async function sources(rows){return Promise.all((rows||[]).map(async s=>{
  if(s.text!==undefined)return s;
  if(typeof s.path!=='string'||path.isAbsolute(s.path)||s.path.split(/[\\/]/).includes('..'))throw Error('Source paths must remain within the selected input directory');
  const target=await fs.realpath(path.resolve(root,s.path));
  if(target!==root&&!target.startsWith(root+path.sep))throw Error('Source escapes its original input directory');
  const text=await read(target);
  if(s.sha256&&hash(text)!==s.sha256)throw Error('Original source checksum differs: '+s.path);
  const {path:sourcePath,...rest}=s;return {...rest,text};
 }));}
 input.sources=await sources(input.sources);input.sample_sources=await sources(input.sample_sources);
 return input;
}
async function writeOutputs(directory,files){
 const root=path.resolve(directory);await fs.mkdir(root,{recursive:true});const manifest=[];
 for(const [name,text] of Object.entries(files)){
  const target=path.join(root,name),body=Buffer.from(text);
  try{await fs.writeFile(target,body,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||hash(await fs.readFile(target))!==hash(body))throw Error('Output already contains a different file: '+target);}
  manifest.push({path:name,bytes:body.length,sha256:hash(body)});
 }
 const record={schema:'upstate.daily-flow-output/v1',files:manifest};
 const target=path.join(root,'manifest.json'),content=json(record);
 try{await fs.writeFile(target,content,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||await read(target)!==content)throw Error('Output manifest already differs');}
 process.stdout.write(json({output:root,...record}));
}
if(command==='build'){
 const input=await inputs(o.input),study=previewFlowStudy(standalone,input),reopened=previewFlowStudy(standalone,study.input);
 if(stable(study)!==stable(reopened))throw Error('Original-source reopening differs');
 await writeOutputs(o.output,{'flow-study.json':json(study),'flow-input.json':json(study.input),'daily-flow.csv':flowCSV(study,'daily'),'flow-periods.csv':flowCSV(study,'periods'),'sample-flow.csv':flowCSV(study,'samples')});
}else if(command==='compare'){
 const before=JSON.parse(await read(o.before)),after=JSON.parse(await read(o.after));
 for(const study of [before,after])if(stable(previewFlowStudy(standalone,study.input))!==stable(study))throw Error('Selected saved flow study differs from its originals');
 const comparison=reconcileFlowEditions(before.edition,after.edition);
 await writeOutputs(o.output,{'flow-comparison.json':json(comparison),'before-flow-study.json':json(before),'after-flow-study.json':json(after)});
}else if(command==='help'){
 process.stdout.write('Original Measurements daily flow\n\nnode source_tools/flow_editions.mjs build --input original-input.json --output output-directory\nnode source_tools/flow_editions.mjs compare --before before/flow-study.json --after after/flow-study.json --output comparison-directory\n\nEach original input source contains text or a relative path, exact SHA256, original URI and explicit interpretation. Reuse all generated files, including full originals in flow-study.json.\n');
}else throw Error('Choose build, compare or help');

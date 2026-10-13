#!/usr/bin/env node
// MIT. Prepare, capture and reopen original customer GridFabric procedures.
import { parseArgs } from 'node:util';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectGridFabricOperator } from '../../sf30-seller-sdk/gridfabric-plaid/sdk/http-client.mjs';
import { loadCommandCatalog } from './load.mjs';
import { saveExport, saveTextExport } from './write-json.mjs';
import { renderOperatingPlanHTML, renderOperatingPlanMarkdown, inspectOperatingPlan } from './operating-plan.mjs';
import { GRIDFABRIC_PROCEDURE_INPUT_SCHEMA, inspectGridFabricProcedureInput, prepareGridFabricProcedure } from './gridfabric-procedure.mjs';
import { captureGridFabricProcedure, readGridFabricProcedureCapture } from './gridfabric-procedure-native.mjs';
import { exportGridProcedureArchive, receiveGridProcedureArchive } from '../../sf30-seller-sdk/gridfabric-plaid/procedure-archive.mjs';

const HELP = [
  'GridFabric customer procedures','',
  '  starforge gridfabric-procedure catalog --out NEW_COMPLETE_CATALOG_JSON',
  '  starforge gridfabric-procedure input --connection-file PRIVATE_URL_FILE',
  '      --id PLAN_ID --title TITLE --instance INSTANCE_ID --out NEW_INPUT_JSON',
  '      [--customer NAME] [--owner NAME] [--period TEXT]',
  '  starforge gridfabric-procedure prepare --input INPUT_JSON --out NEW_PLAN_JSON',
  '      [--catalog COMPLETE_CATALOG_JSON]',
  '  starforge gridfabric-procedure capture --connection-file PRIVATE_URL_FILE',
  '      --input INPUT_JSON --out NEW_CAPTURE_DIRECTORY [--plan COMPLETE_PLAN_JSON]',
  '      [--catalog COMPLETE_CATALOG_JSON]',
  '  starforge gridfabric-procedure show --directory CAPTURE_DIRECTORY',
  '  starforge gridfabric-procedure archive --directory CAPTURE_DIRECTORY --out NEW_ARCHIVE_GZ',
  '  starforge gridfabric-procedure receive --archive COMPLETE_ARCHIVE_GZ',
  '      --sha256 ARCHIVE_SHA256 --bytes ARCHIVE_BYTES --out NEW_CAPTURE_DIRECTORY',
  '      [--maximum-expanded-bytes BYTES]',
  '  starforge gridfabric-procedure render --plan COMPLETE_PLAN_JSON --out NEW_FILE',
  '      --format html|markdown','',
  'input reads the existing authenticated workspace and selected instance.',
  'Edit the complete input JSON to select original records/files and record operator assessments.',
  'prepare retains the original installed command registration in the complete plan.',
  'capture reads the existing owner, follows complete dependent pages/files, and saves the full plan history.',
  'show reopens every declared capture member without opening a native workspace.',
  'archive streams a complete verified capture, including files and plan history, into one new gzip file.',
  'receive streams that archive into a new private directory and reopens it through the same capture reader.',
  'Use archive and receive for files that exceed the browser import allowance; neither opens a Grid workspace.',
  'Import the plan JSON in Command finder → Operating Plans to edit, compare, return and save its history.',
  'All output files/directories are new; original customer files remain available.',''
].join('\n');
const allowed = {
  catalog:['out'],
  input:['connection-file','id','title','instance','out','customer','owner','period'],
  prepare:['input','out','catalog'],
  capture:['connection-file','input','out','plan','catalog'],
  show:['directory'],
  archive:['directory','out'],
  receive:['archive','sha256','bytes','out','maximum-expanded-bytes'],
  render:['plan','out','format']
};
const required = {
  catalog:['out'],
  input:['connection-file','id','title','instance','out'],
  prepare:['input','out'],
  capture:['connection-file','input','out'],
  show:['directory'],
  archive:['directory','out'],
  receive:['archive','sha256','bytes','out'],
  render:['plan','out','format']
};
function argumentsFor(args) {
  const names=[...new Set(Object.values(allowed).flat())];
  const parsed=parseArgs({args,allowPositionals:true,strict:true,
    options:{...Object.fromEntries(names.map(name=>[name,{type:'string'}])),help:{type:'boolean',short:'h'}}});
  const action=parsed.positionals[0]??'help';
  if(parsed.values.help||action==='help')return {action:'help',options:{}};
  if(parsed.positionals.length!==1||!allowed[action])throw new TypeError('Select one supported GridFabric procedure action.');
  for(const key of Object.keys(parsed.values))if(!allowed[action].includes(key))throw new TypeError('Unsupported option for '+action+': --'+key);
  for(const key of required[action])if(!parsed.values[key])throw new TypeError('Required option: --'+key);
  return {action,options:parsed.values};
}
async function originalJSON(filename) {
  filename=resolve(filename);
  const entry=await lstat(filename);
  if(!entry.isFile()||entry.isSymbolicLink()||entry.size>96*1024*1024)throw new TypeError('Select a complete regular JSON file up to 96 MiB.');
  const raw=await readFile(filename);
  if(raw.length>96*1024*1024)throw new TypeError('The complete JSON exceeds 96 MiB.');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
  return JSON.parse(text);
}
const absoluteOutput=value=>{
  if(!isAbsolute(value))throw new TypeError('Select an absolute new output path.');
  return resolve(value);
};
function byteCount(value,label) {
  if(typeof value!=='string'||!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<1)
    throw new TypeError('Supply a positive safe integer for --'+label+'.');
  return Number(value);
}
export async function mainGridFabricProcedure(args=process.argv.slice(2)) {
  const {action,options}=argumentsFor(args);
  if(action==='help'){console.log(HELP);return;}
  if(action==='catalog') {
    const catalog=await loadCommandCatalog(),path=absoluteOutput(options.out);
    await saveExport(path,catalog);
    console.log(JSON.stringify({path,package:catalog.package,entries:catalog.items.length,sources:catalog.sources.length}));return catalog;
  }
  if(action==='show') {
    const result=await readGridFabricProcedureCapture(resolve(options.directory));
    console.log(JSON.stringify(result,null,2));return result;
  }
  if(action==='archive') {
    const result=await exportGridProcedureArchive({directory:resolve(options.directory),outputFile:absoluteOutput(options.out)});
    console.log(JSON.stringify(result,null,2));return result;
  }
  if(action==='receive') {
    if(!/^[a-f0-9]{64}$/.test(options.sha256))throw new TypeError('Supply the complete lowercase archive SHA-256 with --sha256.');
    const expectedBytes=byteCount(options.bytes,'bytes');
    const maximumExpanded=options['maximum-expanded-bytes']===undefined?undefined:
      byteCount(options['maximum-expanded-bytes'],'maximum-expanded-bytes');
    const result=await receiveGridProcedureArchive({file:resolve(options.archive),outputDirectory:absoluteOutput(options.out),
      expectedSha256:options.sha256,expectedBytes,...(maximumExpanded===undefined?{}:{maximumExpanded})});
    console.log(JSON.stringify({directory:result.directory,planId:result.plan.id,revisions:result.plan.revisions.length,
      capture:result.receipt,archive:result.archive},null,2));return result;
  }
  if(action==='render') {
    const plan=inspectOperatingPlan(await originalJSON(options.plan));
    if(!['html','markdown'].includes(options.format))throw new TypeError('Choose html or markdown.');
    const body=options.format==='html'?renderOperatingPlanHTML(plan):renderOperatingPlanMarkdown(plan);
    const path=absoluteOutput(options.out);await saveTextExport(path,body);
    const result={path,planId:plan.id,revisions:plan.revisions.length};console.log(JSON.stringify(result));return result;
  }
  if(action==='input') {
    const client=await connectGridFabricOperator({connectionFile:resolve(options['connection-file'])});
    try {
      const state=await client.call('state');
      const instance=await client.call('detail',{collection:'instances',id:options.instance});
      const after=await client.call('state');
      if(state.revision!==after.revision||state.workspace_id!==client.identity.workspace_id||
        instance.record?.instance_id!==options.instance)throw new TypeError('The original workspace changed while selecting the instance. Read it again.');
      const input=inspectGridFabricProcedureInput({schema:GRIDFABRIC_PROCEDURE_INPUT_SCHEMA,
        id:options.id,title:options.title,customer:options.customer??'',owner:options.owner??'',period:options.period??'',
        workspace:{workspace_id:client.identity.workspace_id,workspace_directory:client.identity.workspace_directory,
          source_sha256:client.identity.source_sha256},expectedRevision:state.revision,instanceId:options.instance,
        records:[{stepId:'configuration',collection:'instances',id:options.instance}],files:[],stepResults:[]});
      const path=absoluteOutput(options.out);await saveExport(path,input);
      console.log(JSON.stringify({path,workspace:input.workspace,revision:input.expectedRevision,instanceId:input.instanceId}));return input;
    }finally{await client.close();}
  }
  const input=inspectGridFabricProcedureInput(await originalJSON(options.input));
  const catalog=options.catalog?await originalJSON(options.catalog):await loadCommandCatalog();
  if(action==='prepare') {
    const plan=prepareGridFabricProcedure({catalog,input}),path=absoluteOutput(options.out);
    await saveExport(path,plan);console.log(JSON.stringify({path,planId:plan.id,revisions:plan.revisions.length,steps:plan.revisions.at(-1).steps.length}));return plan;
  }
  const plan=options.plan?inspectOperatingPlan(await originalJSON(options.plan)):undefined;
  const client=await connectGridFabricOperator({connectionFile:resolve(options['connection-file']),
    expectedWorkspaceId:input.workspace.workspace_id,expectedWorkspace:input.workspace.workspace_directory,
    expectedSourceSha256:input.workspace.source_sha256});
  try {
    const result=await captureGridFabricProcedure({client,catalog,input,outputDirectory:absoluteOutput(options.out),...(plan?{plan}:{})});
    console.log(JSON.stringify({directory:options.out,planId:result.plan.id,revisions:result.plan.revisions.length,
      capture:result.capture??result.receipt},null,2));return result;
  }finally{await client.close();}
}
if(process.argv[1]&&await realpath(resolve(process.argv[1])).then(file=>pathToFileURL(file).href===import.meta.url,()=>false))
  mainGridFabricProcedure().catch(error=>{console.error(JSON.stringify({code:error.code??'GRID_PROCEDURE_ERROR',message:error.message}));process.exitCode=1;});

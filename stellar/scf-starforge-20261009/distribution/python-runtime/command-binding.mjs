// MIT. Installation-bound original Python commands for the existing Applications runner.
import { constants } from 'node:fs';
import { join } from 'node:path';
import { access } from 'node:fs/promises';
import { absolute, canonical, digest, json, need, plain, regular } from '../runtime-workspace/storage.mjs';
import { inspectPythonInstallation } from './workspace.mjs';

const SCHEMA='stellar-forge.python-application-command.v1';
const hash=value=>digest(json(canonical(value)));
const MODULES=Object.freeze({
  analysis:'stellar_forge_buyer.analysis_workspace',
  duckdb:'stellar_forge_buyer.duckdb_cli',

  postgres:'stellar_forge_buyer.postgres_cli',
  workbooks:'stellar_forge_buyer.analysis_workbooks',
  workbookDelivery:'stellar_forge_buyer.workbook_client',
  synthesis:'stellar_forge_buyer.synthesis_cli',
});
export const PYTHON_APPLICATION_COMMANDS=Object.freeze([
  {id:'stellar-forge-dbnomics-analysis',kind:'script',title:'DBnomics economic analysis and workbook receiving'},

  {id:'postgres',kind:'module',title:'PostgreSQL receiving workspace',module:MODULES.postgres,
    description:'Review complete source mappings, import retained editions, compare changes and select the application SQL view.'},
  {id:'duckdb',kind:'module',title:'DuckDB dataset workspace',module:MODULES.duckdb,
    description:'Review original dataset deliveries, retain editions, run SQL and export portable analytical results.'},
  {id:'stellar-forge-analysis-project',kind:'script',title:'Complete Analysis project opening and following delivery'},
  {id:'analysis',kind:'module',title:'Analysis workspace',module:MODULES.analysis,
    description:'Open the original retained analysis database and its matching merchant source.'},
  {id:'workbooks',kind:'module',title:'Workbook build and receiving',module:MODULES.workbooks,
    description:'Use the original workbook build, receive, inspect and copy commands.'},
  {id:'workbookDelivery',kind:'module',title:'Workbook delivery',module:MODULES.workbookDelivery,
    description:'Run the original recipe against its selected analysis database and delivery operation.'},
  {id:'synthesis',kind:'module',title:'Evidence synthesis',module:MODULES.synthesis,
    description:'Review retained study publications, run saved synthesis protocols and receive complete original reports.'},
  {id:'stellar-forge-synthesis',kind:'script',title:'Evidence synthesis command'},
  {id:'stellar-forge-duckdb',kind:'script',title:'DuckDB dataset command'},
  {id:'stellar-forge-postgres',kind:'script',title:'PostgreSQL receiving command'},
  {id:'stellar-forge-buyer',kind:'script',title:'Original buyer command'},
  {id:'stellar-forge-agent',kind:'script',title:'Original agent workflow'},
  {id:'stellar-forge-workbook',kind:'script',title:'Original workbook command'},
  {id:'stellar-forge-workbook-deliver',kind:'script',title:'Original workbook delivery command'},
]);
function argumentsList(args) {
  need(Array.isArray(args) && args.length<=128 && args.every(value=>typeof value==='string' &&
    !value.includes('\0') && Buffer.byteLength(value)<=8192) && Buffer.byteLength(JSON.stringify(args))<=65536,
    'PYTHON_APPLICATION_ARGUMENTS_INVALID');
  return [...args];
}
function requiredExtras(command,args) {
  if(command==='stellar-forge-dbnomics-analysis')return ['workbooks'];

  if(['duckdb','stellar-forge-duckdb'].includes(command))return ['duckdb'];
  if(['postgres','stellar-forge-postgres'].includes(command))return ['postgres'];
  if(command==='stellar-forge-agent')return ['agents'];
  if(['synthesis','stellar-forge-synthesis'].includes(command))return ['synthesis'];
  if(['workbookDelivery','stellar-forge-workbook-deliver'].includes(command))return ['workbooks'];
  if(['workbooks','stellar-forge-workbook'].includes(command) && !['receive','inspect','copy','--help'].includes(args[0]))return ['workbooks'];
  return [];
}
function argumentValue(args,name,fallback) {
  const values=[];
  for(let index=0;index<args.length;index++){
    if(args[index]===name){need(index+1<args.length,'PYTHON_APPLICATION_ARGUMENTS_INVALID');values.push(args[index+1]);}
    else if(args[index].startsWith(name+'='))values.push(args[index].slice(name.length+1));
  }
  need(values.length<=1,'PYTHON_APPLICATION_ARGUMENTS_INVALID','Select '+name+' once.');
  return values[0]??fallback;
}
function exactOption(args,name,value) {
  const positions=args.map((item,index)=>item===name?index:-1).filter(index=>index>=0);
  need(positions.length===1 && args[positions[0]+1]===value &&
    !args.some(item=>item.startsWith(name+'=')),'PYTHON_APPLICATION_SOURCE_CHANGED',
    'The original Analysis command must keep its selected source checkout.',409);
}
function analysisProjectAction(args) {
  const options=new Set(['--checkout','--project','--database','--manifest-sha256',
    '--project-sha256','--workspace-id','--node','--project-cache']);
  for(let index=0;index<args.length;index++){
    if(['inspect','receive','serve','export'].includes(args[index]))return args[index];
    need(options.has(args[index]) && index+1<args.length,'PYTHON_APPLICATION_ARGUMENTS_INVALID',
      'Use the installed Analysis project command and its original named selections.');
    index++;
  }
  need(false,'PYTHON_APPLICATION_ARGUMENTS_INVALID','Select inspect, receive, serve or export.');
}
export async function bindPythonApplicationCommand(root,{
  runtimeId,runtimeDirectory,installationId,command,args=[],leaseFd,
}={}) {
  const selected=PYTHON_APPLICATION_COMMANDS.find(item=>item.id===command);
  need(selected,'PYTHON_APPLICATION_COMMAND_INVALID');
  const originalArgs=argumentsList(args);
  const projectAction=command==='stellar-forge-analysis-project'?analysisProjectAction(originalArgs):null;
  const {binding,installation}=await inspectPythonInstallation(root,{runtimeId,runtimeDirectory,installationId,leaseFd});
  const extras=requiredExtras(command,originalArgs);
  need(extras.every(extra=>installation.extras.includes(extra)),'PYTHON_APPLICATION_EXTRA_REQUIRED',
    'Install the declared '+extras.join(', ')+' extra for this original command.');
  if(['stellar-forge-dbnomics-analysis','stellar-forge-analysis-project'].includes(command))
    exactOption(originalArgs,'--checkout',binding.sourceRoot);
  if(command==='stellar-forge-analysis-project'){
    const project=argumentValue(originalArgs,'--project');
    need(typeof project==='string','PYTHON_ANALYSIS_PROJECT_REQUIRED');absolute(project);
    if(projectAction!=='inspect'){
      const database=argumentValue(originalArgs,'--database'),workspaceId=argumentValue(originalArgs,'--workspace-id');
      need(typeof database==='string' && /^[a-f0-9]{32}$/.test(workspaceId??'') &&
        /^[a-f0-9]{64}$/.test(argumentValue(originalArgs,'--manifest-sha256')??''),
        'PYTHON_ANALYSIS_PROJECT_REVIEW_REQUIRED','Keep the reviewed complete project and original workspace identity.');
      absolute(database);
    }
  }
  if(['synthesis','stellar-forge-synthesis'].includes(command)){
    const checkout=argumentValue(originalArgs,'--checkout');
    need(checkout===undefined || checkout===binding.sourceRoot,'PYTHON_APPLICATION_SOURCE_CHANGED',
      'Keep the original complete source selected for this synthesis installation.',409);
    if(!originalArgs.includes('--help') && !originalArgs.includes('-h') && !originalArgs.includes('engine')){
      const database=argumentValue(originalArgs,'--database');
      need(typeof database==='string','PYTHON_APPLICATION_DATABASE_REQUIRED',
        'Select the original private Analysis database directory with --database.');
      absolute(database);
    }
  }
  let argv,entrypoint=null,module=null;
  if(selected.kind==='module'){
    module=MODULES[command];
    need(installation.modules?.[command]===module,'PYTHON_APPLICATION_MODULE_NOT_INSTALLED');
    if(command==='analysis'){
      exactOption(originalArgs,'--checkout',binding.sourceRoot);
      const databases=originalArgs.filter(item=>item==='--database');
      need(databases.length===1 && !originalArgs.some(item=>item.startsWith('--database=')),
        'PYTHON_APPLICATION_DATABASE_REQUIRED','Select one original Analysis database directory.');
      absolute(originalArgs[originalArgs.indexOf('--database')+1]);
    }
    if(command==='duckdb'){
      const workspaces=originalArgs.filter(item=>item==='--workspace');
      need(workspaces.length===1 && !originalArgs.some(item=>item==='--database' ||
        item.startsWith('--database=') || item.startsWith('--workspace=')),
        'PYTHON_APPLICATION_WORKSPACE_REQUIRED','Select one private DuckDB workspace directory with --workspace.');
      absolute(originalArgs[originalArgs.indexOf('--workspace')+1]);
    }
    if(command==='postgres' && originalArgs.includes('serve')){
      const directory=argumentValue(originalArgs,'--workspace');
      need(typeof directory==='string','PYTHON_APPLICATION_WORKSPACE_REQUIRED',
        'Select the private PostgreSQL receiving directory with --workspace.');
      absolute(directory);
    }
    argv=['-I','-m',module,...originalArgs];
  }else{
    entrypoint=installation.entrypoints?.[command];
    need(plain(entrypoint) && typeof entrypoint.target==='string' &&
      entrypoint.target===installation.source.scripts?.[command] &&
      /^[a-f0-9]{64}$/.test(entrypoint.sha256??''),'PYTHON_APPLICATION_ENTRYPOINT_CHANGED');
    absolute(entrypoint.path);await access(entrypoint.path,constants.R_OK);
    need(digest(await regular(entrypoint.path,1024*1024))===entrypoint.sha256,'PYTHON_APPLICATION_ENTRYPOINT_CHANGED',undefined,409);
    argv=['-I',entrypoint.path,...originalArgs];
  }
  // No realpath() here: venv/bin/python selects pyvenv.cfg and its installed wheels.
  absolute(installation.python);await access(installation.python,constants.X_OK);
  const value={schema:SCHEMA,runtime:binding,installationId:installation.id,sourceId:installation.source.id,
    lockSha256:installation.lockSha256,python:installation.python,command,args:originalArgs,
    module,entrypoint,requiredExtras:extras,executable:installation.python,argv,cwd:binding.directory,
    ready:(command==='analysis' || projectAction==='serve')?{kind:'analysis-private-launch',schema:'stellar-forge.customer-analysis.v1',
      file:join(absolute(originalArgs[originalArgs.indexOf('--database')+1]),'analysis-launch.json'),
      ...(command==='stellar-forge-analysis-project'?{expectedWorkspaceId:argumentValue(originalArgs,'--workspace-id')}: {})}:
      command==='duckdb'?{kind:'duckdb-private-launch',schema:'stellar-forge.duckdb-operator-launch.v1',
        directory:absolute(originalArgs[originalArgs.indexOf('--workspace')+1]),
        file:join(absolute(originalArgs[originalArgs.indexOf('--workspace')+1]),'duckdb-launch.json')}:
      command==='postgres' && originalArgs.includes('serve')?{
        kind:'postgres-private-launch',schema:'stellar-forge.postgres-operator-launch.v1',
        directory:absolute(argumentValue(originalArgs,'--workspace')),
        databaseSchema:argumentValue(originalArgs,'--schema','sf_received'),
        file:join(absolute(argumentValue(originalArgs,'--workspace')),'postgres-launch.json')}:null,
    capabilities:installation.capabilities};
  return {...value,fingerprint:hash(value)};
}
export async function preparePythonApplicationCommand(root,descriptor,{leaseFd}={}) {
  need(plain(descriptor) && descriptor.schema===SCHEMA,'PYTHON_APPLICATION_BINDING_REQUIRED');
  const {fingerprint,...body}=descriptor;
  need(hash(body)===fingerprint,'PYTHON_APPLICATION_BINDING_CHANGED');
  const current=await bindPythonApplicationCommand(root,{runtimeId:descriptor.runtime.runtimeId,
    runtimeDirectory:descriptor.runtime.directory,installationId:descriptor.installationId,
    command:descriptor.command,args:descriptor.args,leaseFd});
  need(current.fingerprint===fingerprint,'PYTHON_APPLICATION_BINDING_CHANGED',
    'Reopen this application with its original source and Python installation.',409);
  return {executable:current.python,args:current.argv,cwd:current.cwd,binding:current};
}

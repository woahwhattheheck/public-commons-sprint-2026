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
  workbooks:'stellar_forge_buyer.analysis_workbooks',
  workbookDelivery:'stellar_forge_buyer.workbook_client',
});
export const PYTHON_APPLICATION_COMMANDS=Object.freeze([
  {id:'analysis',kind:'module',title:'Analysis workspace',module:MODULES.analysis,
    description:'Open the original retained analysis database and its matching merchant source.'},
  {id:'workbooks',kind:'module',title:'Workbook build and receiving',module:MODULES.workbooks,
    description:'Use the original workbook build, receive, inspect and copy commands.'},
  {id:'workbookDelivery',kind:'module',title:'Workbook delivery',module:MODULES.workbookDelivery,
    description:'Run the original recipe against its selected analysis database and delivery operation.'},
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
  if(command==='stellar-forge-agent')return ['agents'];
  if(['workbookDelivery','stellar-forge-workbook-deliver'].includes(command))return ['workbooks'];
  if(['workbooks','stellar-forge-workbook'].includes(command) && !['receive','inspect','copy','--help'].includes(args[0]))return ['workbooks'];
  return [];
}
function exactOption(args,name,value) {
  const positions=args.map((item,index)=>item===name?index:-1).filter(index=>index>=0);
  need(positions.length===1 && args[positions[0]+1]===value &&
    !args.some(item=>item.startsWith(name+'=')),'PYTHON_APPLICATION_SOURCE_CHANGED',
    'The original Analysis command must keep its selected source checkout.',409);
}
export async function bindPythonApplicationCommand(root,{
  runtimeId,runtimeDirectory,installationId,command,args=[],leaseFd,
}={}) {
  const selected=PYTHON_APPLICATION_COMMANDS.find(item=>item.id===command);
  need(selected,'PYTHON_APPLICATION_COMMAND_INVALID');
  const originalArgs=argumentsList(args);
  const {binding,installation}=await inspectPythonInstallation(root,{runtimeId,runtimeDirectory,installationId,leaseFd});
  const extras=requiredExtras(command,originalArgs);
  need(extras.every(extra=>installation.extras.includes(extra)),'PYTHON_APPLICATION_EXTRA_REQUIRED',
    'Install the declared '+extras.join(', ')+' extra for this original command.');
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
    ready:command==='analysis'?{kind:'analysis-private-launch',schema:'stellar-forge.customer-analysis.v1',
      file:join(absolute(originalArgs[originalArgs.indexOf('--database')+1]),'analysis-launch.json')}:null,
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

// MIT. Original merchant cases and SF93 incidents through the managed Applications lifecycle.
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {inspectMerchantRuntime} from '../../sf46-release/runtime-package.mjs';
import {absolute,need,plain} from './storage.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf74-merchant-support-console';
const STARTUP='stellar-forge.support-console-launch.v1';
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});

export function merchantSupportApplication(common=[]) {
  return {id:'merchant-support',command:'support-console',requiredSource:SOURCE+'/managed-launch.mjs',
    title:'Merchant support',terminal:false,
    description:'Operate original seller incidents, inspect retained captures, prepare merchant cases and reopen their saved remediation work.',
    fields:[
      field('workspaceDirectory','Private merchant case directory','path',true,
        'Reopen the original case directory, or create one folder in an existing private parent.'),
      field('incidentSources','Private incident source profiles','path',true,
        'Select the original support-incident-sources JSON with up to eight initialized SF93 stores.'),
      field('allowLoopback','Allow local seller captures','boolean',false,
        'Enable original capture support for an explicitly local seller.'),
      ...common,
    ]};
}

export async function prepareMerchantSupportApplication(settings,{inputPath,runtimeDirectory}={}) {
  need(typeof inputPath==='function','APPLICATION_SUPPORT_ORIGINAL_INPUTS_REQUIRED');
  const runtime=await inspectMerchantRuntime(absolute(runtimeDirectory),{load:false,source:false});
  const native=join(runtime.sourceRoot,SOURCE),inputs=[],createDirectories=[];
  const cases=await inputPath(settings.workspaceDirectory,'directory',true,true);
  inputs.push(cases);
  if(!cases.exists)createDirectories.push(cases.path);
  const profiles=await inputPath(settings.incidentSources,'file');
  inputs.push(profiles);
  for(const name of ['managed-launch.mjs','server.mjs','incident-sources.mjs'])
    inputs.push(await inputPath(join(native,name),'file'));
  // Read the selected runtime's original parser. A copied profile document does
  // not initialize, replace, start or migrate an incident store.
  const original=await import(pathToFileURL(join(native,'managed-launch.mjs')).href);
  need(typeof original.inspectSupportSelection==='function'&&typeof original.supportSelectionSha256==='function',
    'APPLICATION_SUPPORT_SOURCE_REQUIRED','Choose a runtime containing the managed merchant support command.');
  const selection=await original.inspectSupportSelection({casesDir:cases.path,incidentSources:profiles.path,
    allowLoopback:settings.allowLoopback??false,allowMissingCases:!cases.exists});
  need(selection.incidents.sha256===profiles.sha256,'APPLICATION_SUPPORT_PROFILES_CHANGED',
    'Review the current private incident source configuration.');
  for(const source of selection.incidents.sources) {
    const selected=await inputPath(source.store.path,'directory',false,true);
    need(selected.dev===source.store.dev&&selected.ino===source.store.ino,
      'APPLICATION_SUPPORT_STORE_CHANGED','Reopen the selected original incident store.');
    inputs.push(selected);
  }
  const args=['--cases-dir',cases.path,'--incident-sources',profiles.path,'--startup-format','json',
    '--expected-selection-sha256',original.supportSelectionSha256(selection)];
  if(settings.allowLoopback)args.push('--allow-loopback');
  return {args,inputs,createDirectories};
}

function launchArguments(request) {
  need(Array.isArray(request.args),'APPLICATION_SUPPORT_STARTUP_CHANGED');
  const fields=new Map(),allowed=new Set(['--cases-dir','--incident-sources','--startup-format',
    '--expected-selection-sha256','--port']);
  let allowLoopback=false;
  for(let index=0;index<request.args.length;index++) {
    const flag=request.args[index];
    if(flag==='--allow-loopback') {
      need(!allowLoopback,'APPLICATION_SUPPORT_STARTUP_CHANGED');allowLoopback=true;continue;
    }
    need(allowed.has(flag)&&!fields.has(flag)&&typeof request.args[index+1]==='string'&&request.args[index+1],
      'APPLICATION_SUPPORT_STARTUP_CHANGED');
    fields.set(flag,request.args[++index]);
  }
  need(fields.get('--startup-format')==='json'&&fields.has('--cases-dir')&&fields.has('--incident-sources')&&
    /^[a-f0-9]{64}$/.test(fields.get('--expected-selection-sha256')??''),'APPLICATION_SUPPORT_STARTUP_CHANGED');
  const port=Number(fields.get('--port')??0);
  need(Number.isInteger(port)&&port>=0&&port<=65535,'APPLICATION_SUPPORT_PORT_CHANGED');
  return {casesDir:fields.get('--cases-dir'),incidentSources:fields.get('--incident-sources'),
    selectionSha256:fields.get('--expected-selection-sha256'),port};
}

export async function merchantSupportStartup(request,text) {
  if(request.command!=='support-console'||typeof text!=='string'||text.length>16384||
    !text.startsWith('{"schema":"'+STARTUP+'",'))return null;
  let announcement;try {announcement=JSON.parse(text);}catch{return null;}
  if(!plain(announcement)||announcement.schema!==STARTUP)return null;
  const selected=launchArguments(request);
  const {readSupportLaunch}=await import('../../sf74-merchant-support-console/managed-launch.mjs');
  return readSupportLaunch(announcement,selected);
}

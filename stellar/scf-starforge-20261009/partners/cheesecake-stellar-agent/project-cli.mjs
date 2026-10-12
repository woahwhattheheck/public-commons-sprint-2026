#!/usr/bin/env node
// MIT. Installed and source CLI for complete encrypted application receiving.
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfiguration,loadApplication } from './configuration.mjs';
import { PROFILE,absolute,need,json,privateDirectory,exists,publishBytes } from './project-files.mjs';
import { inspectApplicationProject } from './project.mjs';
import { receiveApplicationProject,verifyApplicationProject,inspectReceivedApplicationProject,
  restoreApplicationProject,withRestoredApplicationProject,openReceivedApplicationProject } from './project-receive.mjs';

const ownSource=()=>resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const commands={
  'project-configure':['config','out','exports','pass-env','http-workspace','state-root','http-operators','native-host'],
  'project-inspect':['config'],
  'project-snapshot':['config','operation'],
  'project-archives':['config'],
  'project-verify':['bundle','pass-env','runtime','expected-manifest-sha256'],
  'project-receive':['bundle','dir','pass-env','runtime','expected-manifest-sha256'],
  'project-review':['dir','runtime','mode'],
  'project-restore':['dir','runtime','mode','expected-record-sha256','pass-env'],
  'project-serve':['dir','runtime','subject','host','port','pass-env'],
  'project-read':['dir','runtime','subject','intent','format','limit-bytes'],
  'project-export':['dir','runtime','subject','intent','out'],
  'project-command':['dir','runtime','mode','expected-record-sha256','pass-env','action','intent','format','limit-bytes','out','transaction'],
};
const help=[
  'Encrypted application projects — original requests, response files and complete native spending history',
  '',
  '  project-configure --config ORIGINAL_APP --out NEW_APP --exports PRIVATE_BACKUP_DIRECTORY',
  '    --pass-env PASSPHRASE_ENV [--http-workspace ORIGINAL_SF88 --state-root ORIGINAL_PRIVATE_ROOT]',
  '    [--http-operators JSON_ARRAY_OF_ORIGINAL_DIRECTORIES] [--native-host ORIGINAL_MCP_HOST_JSON]',
  '  project-inspect --config APP',
  '  project-snapshot --config APP [--operation STABLE_EXPORT_ID]',
  '  project-archives --config APP',
  '  project-verify --bundle ENCRYPTED_DIRECTORY --pass-env NAME [--expected-manifest-sha256 SHA256]',
  '  project-receive --bundle ENCRYPTED_DIRECTORY --dir NEW_PRIVATE_DIRECTORY --pass-env NAME',
  '    [--expected-manifest-sha256 SHA256] [--runtime TRUSTED_SF88_RUNTIME]',
  '  project-review --dir RECEIVED_DIRECTORY [--mode restore|reattach]',
  '  project-restore --dir RECEIVED_DIRECTORY --expected-record-sha256 REVIEWED_SHA256',
  '    [--mode restore|reattach] [--pass-env NAME]',
  '  project-serve --dir RECEIVED_DIRECTORY --subject HOST_SUBJECT [--port 0] [--host 127.0.0.1|::1]',
  '  project-read --dir RECEIVED_DIRECTORY --subject HOST_SUBJECT --intent ORIGINAL_INTENT',
  '    [--format json|text|base64|file] [--limit-bytes N]',
  '  project-export --dir RECEIVED_DIRECTORY --subject HOST_SUBJECT --intent ORIGINAL_INTENT --out NEW_FILE',
  '  project-command --dir RECEIVED_DIRECTORY --expected-record-sha256 REVIEWED_SHA256',
  '    --mode restore|reattach --action review|execute|status|recover|read|export|cancel|spending|reconcile --intent ORIGINAL_INTENT',
  '',
  'Receiving reads saved results immediately. Restore uses original canonical paths and native encrypted financial owners.',
  'Reattach verifies current journal history includes the captured checkpoint and preserves later legitimate work.',
  'Passphrases, SF36 control keys and wallet/provider credentials come from the protected host environment.',
  'Project serve uses STELLAR_APP_ACCESS_TOKEN. Enter that token in the original browser connection field.',
  'Use the original subject for live reopening; payment approval remains in the original controlling terminal.',
  'Transport the complete encrypted directory, including manifest.json and every objects/*.gcm file.',
  '',
].join('\n');
function parse(args){
  const [command,...tail]=args;
  if(!command||command==='--help'||command==='project-help')return {help:true};
  need(Object.hasOwn(commands,command)&&tail.length%2===0,'APPLICATION_PROJECT_COMMAND_INVALID');
  const options={};
  for(let i=0;i<tail.length;i+=2){
    const key=tail[i].slice(2),value=tail[i+1];
    need(tail[i].startsWith('--')&&commands[command].includes(key)&&!Object.hasOwn(options,key)&&
      typeof value==='string'&&value&&!value.startsWith('--'),'APPLICATION_PROJECT_OPTIONS_INVALID');
    options[key]=value;
  }
  return {command,options};
}
function sourceRoot(options){
  if(!options.runtime)return ownSource();
  const runtime=absolute(options.runtime),source=resolve(runtime,'../../..');
  need(runtime===join(source,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli'),
    'APPLICATION_SELECTED_RUNTIME_CHANGED');
  return source;
}
function selected(options,signal){
  return {directory:options.dir&&absolute(options.dir),bundle:options.bundle&&absolute(options.bundle),
    sourceRoot:sourceRoot(options),passphraseEnv:options['pass-env'],
    expectedManifestSha256:options['expected-manifest-sha256'],
    expectedRecordSha256:options['expected-record-sha256'],mode:options.mode,signal};
}
async function configure(options){
  need(options.config&&options.out&&options.exports&&options['pass-env'],'APPLICATION_PROJECT_REQUIRED_OPTION');
  const configuration=await loadConfiguration(absolute(options.config)),out=absolute(options.out),
    exportsDirectory=absolute(options.exports),profileFile=out+'.project-profile.json';
  await privateDirectory(dirname(out));
  if(!await exists(exportsDirectory)){await privateDirectory(dirname(exportsDirectory));await privateDirectory(exportsDirectory,{create:true});}
  else await privateDirectory(exportsDirectory);
  need(Boolean(options['http-workspace'])===Boolean(options['state-root']),'APPLICATION_PROJECT_HTTP_PROFILE_INVALID');
  const profile={schema:PROFILE,exportsDirectory,passphraseEnv:options['pass-env'],
    ...(options['http-workspace']?{httpRecovery:{directory:absolute(options['http-workspace']),
      stateRoot:absolute(options['state-root']),operators:options['http-operators']?JSON.parse(options['http-operators']):[]}}:{}),
    ...(options['native-host']?{nativeMcpHost:absolute(options['native-host'])}:{})};
  need(!configuration.remoteMcp||profile.nativeMcpHost,'APPLICATION_PROJECT_NATIVE_HOST_REQUIRED');
  need(!configuration.operatorProfile||profile.httpRecovery,'APPLICATION_PROJECT_HTTP_OWNER_NOT_SELECTED');
  await publishBytes(profileFile,json(profile));
  const config={...configuration,projectProfile:profileFile};await publishBytes(out,json(config));
  return inspectApplicationProject({configFile:out,config,sourceRoot:resolve(config.runtimeDirectory,'../../..')});
}
async function waitServer(opened){
  process.stdout.write(JSON.stringify({schema:'stellar-forge.application-project-startup.v1',
    status:'APPLICATION_PROJECT_RECEIVER_READY',origin:opened.origin,identity:opened.identity})+'\n');
  let stopping=false;
  const stop=async()=>{if(stopping)return;stopping=true;
    try{await opened.close();}catch{process.exitCode=1;}};
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  return opened;
}
export async function main(args=process.argv.slice(2)){
  const input=parse(args);if(input.help){process.stdout.write(help);return;}
  const {command,options:o}=input,controller=new AbortController();
  if(command==='project-serve'){
    need(o.dir&&o.subject,'APPLICATION_PROJECT_REQUIRED_OPTION');
    const {createApplicationServer}=await import('./server.mjs');
    return waitServer(await createApplicationServer({receivedDirectory:absolute(o.dir),sourceRoot:sourceRoot(o),
      subject:o.subject,passphraseEnv:o['pass-env'],host:o.host??'127.0.0.1',port:o.port===undefined?0:Number(o.port)}));
  }
  const stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
  const settings=selected(o,controller.signal);let result;
  try{
    if(command==='project-configure')result=await configure(o);
    else if(command==='project-inspect'){
      need(o.config,'APPLICATION_CONFIG_REQUIRED');const config=await loadConfiguration(absolute(o.config));
      result=await inspectApplicationProject({configFile:o.config,config,sourceRoot:resolve(config.runtimeDirectory,'../../..')});
    }else if(['project-snapshot','project-archives'].includes(command)){
      need(o.config,'APPLICATION_CONFIG_REQUIRED');const loaded=await loadApplication(absolute(o.config));
      try{
        need(typeof loaded.application.project==='function','APPLICATION_PROJECT_PROFILE_REQUIRED');
        result=await loaded.application.project(loaded.context,command==='project-snapshot'?'snapshot':'archives',
          {...(o.operation?{operationId:o.operation}:{}),signal:controller.signal});
      }finally{await loaded.close();}
    }else if(command==='project-verify'){
      need(o.bundle&&o['pass-env'],'APPLICATION_PROJECT_REQUIRED_OPTION');
      const verified=await verifyApplicationProject(settings);
      const {record,...view}=verified;result={...view,applicationId:record.config.applicationId,
        requests:record.application.requests.length,operationId:record.operationId};
    }else if(command==='project-receive'){
      need(o.bundle&&o.dir&&o['pass-env'],'APPLICATION_PROJECT_REQUIRED_OPTION');
      result=await receiveApplicationProject(settings);
    }else if(command==='project-review'){
      need(o.dir,'APPLICATION_PROJECT_REQUIRED_OPTION');result=await inspectReceivedApplicationProject(settings);
    }else if(command==='project-restore'){
      need(o.dir&&o['expected-record-sha256'],'APPLICATION_PROJECT_REQUIRED_OPTION');
      result=await restoreApplicationProject(settings);
    }else if(command==='project-command'){
      need(o.dir&&o.intent&&o.action&&o['expected-record-sha256'],'APPLICATION_PROJECT_REQUIRED_OPTION');
      need(['review','execute','status','recover','read','export','cancel','spending','reconcile'].includes(o.action),
        'APPLICATION_ACTION_INVALID');
      result=await withRestoredApplicationProject(settings,loaded=>loaded.application.call(loaded.context,o.action,o.intent,
        {signal:controller.signal,...(o.format?{format:o.format}:{}),
          ...(o['limit-bytes']?{limitBytes:Number(o['limit-bytes'])}:{}),
          ...(o.out?{destination:absolute(o.out)}:{}),...(o.transaction?{transaction:o.transaction}:{})}));
    }else{
      need(o.dir&&o.subject&&o.intent,'APPLICATION_PROJECT_REQUIRED_OPTION');
      const context=Object.freeze({subject:o.subject}),application=await openReceivedApplicationProject({
        ...settings,subject:o.subject,authorize:async({context:current})=>current.subject===o.subject});
      try{
        result=await application.call(context,command==='project-export'?'export':'read',o.intent,
          {signal:controller.signal,...(o.format?{format:o.format}:{}),
            ...(o['limit-bytes']?{limitBytes:Number(o['limit-bytes'])}:{}),...(o.out?{destination:absolute(o.out)}:{})});
      }finally{await application.close();}
    }
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{
    const supplied=String(error.code??''),code=/^[A-Z][A-Z0-9_]{1,100}$/.test(supplied)?supplied:'APPLICATION_PROJECT_COMMAND_FAILED';
    process.stderr.write(JSON.stringify({error:code,...(error.recovery?{recovery:error.recovery}:{})})+'\n');process.exitCode=1;
  });

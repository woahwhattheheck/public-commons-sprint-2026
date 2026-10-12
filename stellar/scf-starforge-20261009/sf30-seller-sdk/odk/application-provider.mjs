// MIT. Applications registration for the original leased ODK Central operator.
import {join} from 'node:path';
import {APPLICATION_PROVIDER_SCHEMA,applicationPreparation,observeApplicationStartup}
  from '../../distribution/runtime-workspace/application-provider.mjs';
import {centralManagedOptions} from './managed.mjs';
import {ODK_STARTUP_SCHEMA,ODK_CONNECTION_FILENAME,odkNeed,odkPlain,
  readCentralConnection,inspectCentralListener,odkInspectPrivateFile} from './connection.mjs';

export const ODK_APPLICATION_ID='odk-central';
export default {
  schema:APPLICATION_PROVIDER_SCHEMA,id:'odk',order:1020,
  catalog({common,field}){
    return [{
      id:ODK_APPLICATION_ID,command:'odk-central-workspace',title:'ODK Central field reporting',
      terminal:false,requiredSource:'stellar/scf-starforge-20261009/sf30-seller-sdk/odk/managed.mjs',
      description:'Retain complete Central forms, repeat rows, submission versions and media; review field periods, prepare reports and datasets, and reopen the same source on another host.',
      fields:[
        field('workspaceDirectory','Field reporting workspace','path',true,
          'Choose the original private workspace or a new private directory.'),
        field('operator','Recording operator','text',true,
          'The accountable operator for this retained field-data workspace.'),
        field('commissioningConnection','Central host connection','path',false,
          'Optional original private connection or bootstrap file for the customer commissioning editor.'),
        field('commissioningEnvironment','Central authorization file','path',false,
          'Optional private host file containing the selected connection authorization alias.'),
        field('restoreArchive','Original workspace archive','path',false,
          'Optional exact original archive received into a new or empty workspace before opening.'),
        field('restoreSha256','Original archive SHA-256','text',false,
          'The reviewed archive hash; required with an archive. Exact receiving replay preserves subsequent work.'),
        ...common,
      ],
    }];
  },
  validateSettings(_type,settings){
    const args=['--workspace',settings.workspaceDirectory,'--operator',settings.operator];
    if(settings.commissioningConnection)args.push('--commissioning-connection',settings.commissioningConnection);
    if(settings.commissioningEnvironment)args.push('--commissioning-environment',settings.commissioningEnvironment);
    if(settings.restoreArchive)args.push('--restore-archive',settings.restoreArchive);
    if(settings.restoreSha256)args.push('--restore-sha256',settings.restoreSha256);
    centralManagedOptions(args);
  },
  async prepare(_type,settings,{inputPath}){
    const {args,inputs,createDirectories,path,option}=applicationPreparation(settings,inputPath);
    const workspace=await path('workspaceDirectory','directory',true,true);
    if(!workspace.exists)createDirectories.push(workspace.path);
    option('--workspace',workspace.path);option('--operator',settings.operator);
    const commissioning=await path('commissioningConnection','file',false,true);
    if(commissioning)option('--commissioning-connection',commissioning.path);
    const authorization=await path('commissioningEnvironment','file',false,true);
    if(authorization)option('--commissioning-environment',authorization.path);
    const archive=await path('restoreArchive','file',false,true);
    if(archive){
      const retained=await odkInspectPrivateFile(archive.path);
      odkNeed(retained.sha256===settings.restoreSha256&&retained.bytes===archive.bytes&&
        ['dev','ino','mtimeMs','ctimeMs'].every(key=>retained[key]===archive[key]),'ODK_RESTORE_SOURCE_CHANGED',
        'The selected original archive differs from its reviewed SHA-256.',409);
      option('--restore-archive',archive.path);option('--restore-sha256',settings.restoreSha256);
    }
    return {args,inputs,createDirectories};
  },
  matchRequest(request){return !request.pythonCommand&&request.command==='odk-central-workspace';},
  createObserver(request,directory){
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"'+ODK_STARTUP_SCHEMA+'",'))return null;
      return ()=>centralApplicationStartup(request,text);
    });
  },
};
export async function centralApplicationStartup(request,text){
  if(request.command!=='odk-central-workspace')return null;
  let announced;try{announced=JSON.parse(text);}catch{return null;}
  if(!odkPlain(announced)||announced.schema!==ODK_STARTUP_SCHEMA||announced.status!=='ODK_WORKSPACE_READY')return null;
  const selected=centralManagedOptions(request.args);
  odkNeed(announced.directory===selected.directory&&announced.operator===selected.operator&&
    announced.connectionFile===join(selected.directory,ODK_CONNECTION_FILENAME),
  'ODK_APPLICATION_STARTUP_CHANGED','The original Central launch differs from the reviewed application.',409);
  const connection=await readCentralConnection(announced.connectionFile,{directory:selected.directory});
  odkNeed(connection.sha256===announced.connectionSha256&&connection.value.instanceId===announced.instanceId&&
    connection.value.pid===announced.pid&&connection.value.workspaceId===announced.workspaceId&&
    connection.value.operator===selected.operator&&connection.value.origin===announced.origin&&
    connection.value.url===announced.url&&(!selected.port||Number(new URL(connection.value.origin).port)===selected.port),
  'ODK_APPLICATION_STARTUP_CHANGED','The original listener differs from its retained startup.',409);
  const live=await inspectCentralListener(connection);
  const input=request.inputs?.find(value=>value.path===selected.directory&&value.kind==='directory');
  if(selected.restoreArchive){
    odkNeed(live.receivedArchive?.archiveSha256===selected.restoreSha256&&
      live.receivedArchive.workspaceId===live.id&&
      Number.isSafeInteger(live.receivedArchive.workspaceRevision)&&
      live.receivedArchive.workspaceRevision<=live.revision,
    'ODK_APPLICATION_RESTORE_CHANGED','The original live workspace has not received the reviewed archive.',409);
  }else if(input?.exists)odkNeed(connection.value.directoryIdentity.dev===String(input.dev)&&
    connection.value.directoryIdentity.ino===String(input.ino),
  'ODK_APPLICATION_STARTUP_CHANGED','The selected original directory changed after review.',409);
  return {url:connection.value.url,workspaceId:live.id,connectionFile:connection.path,original:{
    schema:ODK_STARTUP_SCHEMA,workspaceId:live.id,directory:selected.directory,
    instanceId:connection.value.instanceId,connectionSha256:connection.sha256,pid:connection.value.pid,
    operator:connection.value.operator,...(selected.restoreArchive?{receivedArchive:live.receivedArchive}:{}),
  }};
}

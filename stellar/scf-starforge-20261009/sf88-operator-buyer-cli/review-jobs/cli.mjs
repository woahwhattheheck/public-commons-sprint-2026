// MIT — Installed inbox review-jobs workflow; native recovery stays in SF88.
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openReviewJobs } from './model.mjs';
import { openJobStore } from './store.mjs';
import { serveReviewJobs } from './server.mjs';
import { readBytes, readJson } from '../node/store.mjs';
import { WorkspaceRecovery } from '../node/workspace-recovery.mjs';
import { requireValue } from './source.mjs';
const help={
  command:'starforge inbox review-jobs',
  workflow:['serve','status','source-import','source-fetch','catalog-import','create','prepare',
    'review','approve','assign','execute','recover','finalize','cancel','annotate','deliver','export','handoff','backup'],
  example:'starforge inbox review-jobs serve --state /private/review-jobs --workspace /private/operator --port 0',
  inputs:'Mutation commands read their exact JSON request from --input FILE. Native actions wait for completion.',
  backup:'Close the foreground workspace, then backup --state APP --state-root ROOT --out NEW_BUNDLE --quiesced true --pass-env SF88_BACKUP_PASSPHRASE',
  restore:'Use the original starforge inbox workspace recovery command and exact expected record hash; reopen the same --state.',
};
function options(args){
  const result=new Map();
  requireValue(args.length%2===0,'REVIEW_JOB_FLAGS_REQUIRE_VALUES');
  for(let i=0;i<args.length;i+=2){
    requireValue(/^--[a-z-]+$/.test(args[i])&&!result.has(args[i])&&typeof args[i+1]==='string','REVIEW_JOB_FLAGS_INVALID');
    result.set(args[i],args[i+1]);
  }
  return result;
}
export async function main(args=process.argv.slice(2)){
  if(!args.length||args[0]==='help'||args[0]==='--help'){process.stdout.write(JSON.stringify(help,null,2)+'\n');return help;}
  const command=args[0],flags=options(args.slice(1));
  const allowed=new Set(['--state','--workspace','--profile','--buyer-state','--inbox','--port','--input',
    '--file','--kind','--url','--retrieved-at','--query','--id','--out','--state-root','--quiesced','--pass-env']);
  requireValue([...flags.keys()].every(k=>allowed.has(k)),'REVIEW_JOB_FLAG_UNKNOWN');
  requireValue(flags.has('--state'),'REVIEW_JOB_STATE_REQUIRED');
  const binding={state:resolve(flags.get('--state'))};
  for(const [flag,key]of [['--workspace','workspace'],['--profile','profile'],['--buyer-state','buyerState'],['--inbox','inbox']])
    if(flags.has(flag))binding[key]=resolve(flags.get(flag));
  if(command==='backup'){
    requireValue(flags.get('--quiesced')==='true'&&flags.has('--state-root')&&flags.has('--out'),'QUIESCED_BACKUP_INPUTS_REQUIRED');
    const store=await openJobStore(binding);
    try{
      requireValue(store.config.workspace,'ORIGINAL_OPERATOR_WORKSPACE_REQUIRED');
      const recovery=new WorkspaceRecovery({runtimeDirectory:fileURLToPath(new URL('../',import.meta.url))});
      const result=await recovery.snapshot({directory:store.config.workspace,stateRoot:resolve(flags.get('--state-root')),
        inboxes:[store.config.inbox],include:[store.state,store.config.buyerState],output:resolve(flags.get('--out')),
        quiesced:true,passphraseEnv:flags.get('--pass-env')??'SF88_BACKUP_PASSPHRASE'});
      process.stdout.write(JSON.stringify(result)+'\n');return result;
    }finally{await store.close();}
  }
  const app=await openReviewJobs(binding);let service;
  try{
    if(command==='serve'){
      await app.library.scan();
      service=await serveReviewJobs(app,{port:Number(flags.get('--port')??0)});
      process.stdout.write(JSON.stringify({status:'REVIEW_JOBS_READY',url:service.url,workspaceId:app.store.config.id})+'\n');
      let closing;
      const close=()=>closing??=service.close();
      const stop=()=>{void close().catch(()=>{process.exitCode=1;});};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
      return {...service,close};
    }
    let result;
    const input=async()=>{requireValue(flags.has('--input'),'REVIEW_JOB_INPUT_REQUIRED');return readJson(resolve(flags.get('--input')),4*1024*1024);};
    if(command==='status')result=flags.has('--id')?await app.inspect(flags.get('--id')):await app.context();
    else if(command==='source-import'){
      requireValue(flags.has('--file')&&flags.has('--kind')&&flags.has('--url'),'SOURCE_IMPORT_ARGUMENTS_REQUIRED');
      result=await app.importSource(await readBytes(resolve(flags.get('--file')),4*1024*1024),{
        kind:flags.get('--kind'),url:flags.get('--url'),retrievedAt:flags.get('--retrieved-at')??null,
        acquisition:'operator-retained'});
    }else if(command==='source-fetch')result=await app.fetchSource({kind:flags.get('--kind')??'search',query:flags.get('--query')??''});
    else if(command==='catalog-import'){
      requireValue(flags.has('--file'),'CATALOG_FILE_REQUIRED');
      result=await app.importCatalog(await readBytes(resolve(flags.get('--file')),1048576));
    }else if(['create','prepare','review','approve','assign','annotate','deliver'].includes(command))result=await app[command](await input());
    else if(['execute','recover','finalize','cancel'].includes(command)){
      const value=await input();await app.action({...value,kind:command});await app.whenIdle();result=await app.inspect(value.externalId);
    }else if(command==='export'){
      requireValue(flags.has('--id')&&flags.has('--out'),'DELIVERY_EXPORT_ARGUMENTS_REQUIRED');
      result=await app.exportDelivery(flags.get('--id'),resolve(flags.get('--out')));
    }else if(command==='handoff'){
      requireValue(flags.has('--id'),'EXTERNAL_JOB_ID_REQUIRED');result=await app.handoff(flags.get('--id'));
    }else requireValue(false,'REVIEW_JOB_COMMAND_UNKNOWN');
    process.stdout.write(JSON.stringify(result)+'\n');return result;
  }catch(e){if(service)await service.close();throw e;}
  finally{if(!service)await app.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(e=>{process.stderr.write(JSON.stringify({error:e.code??'REVIEW_JOB_COMMAND_FAILED'})+'\n');process.exitCode=1;});

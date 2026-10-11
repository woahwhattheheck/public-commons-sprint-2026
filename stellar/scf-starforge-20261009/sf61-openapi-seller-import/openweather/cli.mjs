#!/usr/bin/env node
// MIT. Headless and browser entrypoints use the same weather application engines.
import {readFile,writeFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openStore,restoreStore} from './store.mjs';
import {startApplication} from './server.mjs';
import {configureBudget,saveProject,createAcquisition,createAcquirer,dataset,reviewAcquisition,readReview,selectReview,rollbackReview} from './acquisition.mjs';
import {importInventory,prepareIntegration,exportIntegration,createDeployment} from './integration.mjs';
import {csv,ndjson,handoff,configureSchedule} from './delivery.mjs';
import {integer,fail} from './contract.mjs';

export const HELP=
  ('OpenWeather customer application\n'+
  '\nBrowser:\n  node openweather/cli.mjs serve --store PRIVATE_DIRECTORY [--port 8428] [--package-parent ORIGINAL_PACKAGES]\n'+
  '\nHeadless (close the browser workspace before acquiring its private store):\n'+
  '  project --store DIR --project NAME --input SETTINGS.json [--expect REVISION]\n'+
  '  account --store DIR --input ACCOUNT_ALLOWANCE.json\n'+
  '  source --store DIR --project NAME --file ORIGINAL_OPENAPI [--name LABEL] [--url HTTPS_URL]\n'+
  '  acquire --store DIR --project NAME --start UTC_OR_UNIX --end UTC_OR_UNIX [--request-id ID]\n'+
  '  resume --store DIR --job ID [--extra-pages N] [--acknowledge-unknown]\n'+
  '  status --store DIR\n  inspect --store DIR --job ID\n'+
  '  review --store DIR --job ID [--notes FILE] [--accept-partial] [--conflicts first|last|reject]\n'+
  '  select --store DIR --project NAME --review ID --expect REVISION\n'+
  '  rollback-data --store DIR --project NAME --expect-review ID\n'+
  '  export --store DIR --project NAME --review ID --out NEW_FILE [--format json|csv|ndjson|handoff]\n'+
  '  schedule --store DIR --input SCHEDULE.json\n'+
  '  integration-review --store DIR --input INTEGRATION.json --origin http://127.0.0.1:PORT [--package-parent ORIGINAL_PACKAGES]\n'+
  '  integration-export --store DIR --project NAME --integration ID --name PACKAGE\n'+
  '  stage --store DIR --input RELEASE.json\n'+
  '  deployment --store DIR\n  diff --store DIR --release ID\n'+
  '  activate --store DIR --release ID --expect GENERATION\n'+
  '  rollback --store DIR --expect GENERATION [--release ID]\n'+
  '  backup --store DIR --out NEW_FILE\n  restore --store NEW_DIRECTORY --file BACKUP.json\n'+
  '\nStart and stop the original merchant from the running browser application. The CLI returns structured JSON.\n');
const flags=new Set(['acknowledge-unknown','accept-partial']);
const commandOptions={
  serve:['port','package-parent'],project:['project','input','expect'],account:['input'],source:['project','file','name','url'],
  acquire:['project','start','end','request-id'],resume:['job','extra-pages','acknowledge-unknown'],status:[],inspect:['job','conflicts'],
  review:['job','notes','accept-partial','conflicts'],select:['project','review','expect'],'rollback-data':['project','expect-review'],
  export:['project','review','out','format'],schedule:['input'],'integration-review':['input','origin','package-parent'],
  'integration-export':['project','integration','name'],stage:['input'],deployment:[],diff:['release'],activate:['release','expect'],
  rollback:['expect','release'],backup:['out'],restore:['file']
};
function argumentsOf(args){
  const command=args[0]??'help';if(['help','--help','-h'].includes(command))return {command:'help'};
  if(!Object.hasOwn(commandOptions,command))fail('ARGUMENT','Unknown command. Use --help.');
  const allowed=new Set(['store',...commandOptions[command]]),o={};
  for(let i=1;i<args.length;i++){
    const key=args[i]?.slice(2);if(!args[i]?.startsWith('--')||Object.hasOwn(o,key))fail('ARGUMENT','Use distinct named command options');
    if(!allowed.has(key))fail('ARGUMENT','Unknown '+command+' option --'+key);
    if(flags.has(key)){o[key]=true;continue;}
    const value=args[++i];if(value===undefined||value.startsWith('--'))fail('ARGUMENT','Missing value for --'+key);o[key]=value;
  }
  if(!o.store)fail('ARGUMENT','Supply --store PRIVATE_DIRECTORY');
  return {command,o};
}
const required=(o,key)=>o[key]??fail('ARGUMENT','Supply --'+key);
async function file(path,limit=8*1024*1024){
  const p=resolve(path),s=await lstat(p);if(!s.isFile()||s.size>limit)fail('INPUT_FILE','Use a regular input file within its allowance');
  const bytes=await readFile(p);if(bytes.length>limit)fail('INPUT_FILE','Input file exceeds its allowance');return bytes.toString('utf8');
}
const input=o=>file(required(o,'input')).then(JSON.parse);
const number=(o,key,defaultValue)=>o[key]===undefined?defaultValue:Number(o[key]);
function utc(value){const seconds=/^-?\d+$/.test(value);if(!seconds&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))fail('ARGUMENT','Use exact Unix seconds or an ISO timestamp with UTC offset');
  const n=seconds?Number(value):Date.parse(value)/1000;if(!Number.isSafeInteger(n))fail('ARGUMENT','Use exact Unix seconds or an ISO timestamp with UTC offset');return n;}
async function outputFile(path,value){const text=typeof value==='string'?value:JSON.stringify(value,null,2)+'\n';await writeFile(resolve(path),text,{flag:'wx',mode:0o600});return {path:resolve(path),bytes:Buffer.byteLength(text)};}
export async function main(args=process.argv.slice(2)){
  const {command,o}=argumentsOf(args);if(command==='help'){process.stdout.write(HELP);return;}
  if(command==='serve'){
    const app=await startApplication({root:o.store,port:number(o,'port',undefined),packageParent:o['package-parent']?resolve(o['package-parent']):undefined});
    process.stdout.write(JSON.stringify({ready:true,url:app.url,origin:app.origin,root:app.store.root,application:'OpenWeather customer integration'})+'\n');return app;
  }
  if(command==='restore'){
    const value=await restoreStore(o.store,JSON.parse(await file(required(o,'file'),512*1024*1024)));process.stdout.write(JSON.stringify(value)+'\n');return value;
  }
  const store=await openStore(o.store),acquirer=createAcquirer(store),deployment=createDeployment(store);let result;
  try{
    await acquirer.recover();
    if(command==='project')result=await saveProject(store,{id:required(o,'project'),selection:await input(o),expectedRevision:number(o,'expect',0)});
    else if(command==='account')result=await configureBudget(store,await input(o));
    else if(command==='source')result=await importInventory(store,{project:required(o,'project'),specText:await file(required(o,'file'),4*1024*1024),name:o.name??'Customer API',sourceUrl:o.url??''});
    else if(command==='status')result=store.snapshot();
    else if(command==='acquire'){
      const job=await createAcquisition(store,{project:required(o,'project'),start:utc(required(o,'start')),end:utc(required(o,'end')),requestId:o['request-id']});
      result=await acquirer.run(job.id);
    }else if(command==='resume')result=await acquirer.resume(required(o,'job'),{extraPages:number(o,'extra-pages',0),acknowledgeUnknown:Boolean(o['acknowledge-unknown'])});
    else if(command==='inspect')result=await dataset(store,required(o,'job'),{conflicts:o.conflicts??'reject'});
    else if(command==='review')result=await reviewAcquisition(store,{job:required(o,'job'),notes:o.notes?await file(o.notes,16000):'',acceptPartial:Boolean(o['accept-partial']),conflicts:o.conflicts??'reject'});
    else if(command==='select')result=await selectReview(store,{project:required(o,'project'),review:required(o,'review'),expectedRevision:number(o,'expect',undefined)});
    else if(command==='rollback-data')result=await rollbackReview(store,{project:required(o,'project'),expectedReview:required(o,'expect-review')});
    else if(command==='schedule')result=await configureSchedule(store,await input(o));
    else if(command==='integration-review')result=await prepareIntegration(store,await input(o),{origin:required(o,'origin'),packageParent:o['package-parent']?resolve(o['package-parent']):undefined});
    else if(command==='integration-export')result=await exportIntegration(store,{project:required(o,'project'),integration:required(o,'integration'),name:required(o,'name')});
    else if(command==='stage')result=await deployment.stage(await input(o));
    else if(command==='deployment')result=await deployment.status();
    else if(command==='diff')result=await deployment.diff(required(o,'release'));
    else if(command==='activate')result=await deployment.select({id:required(o,'release'),expectedGeneration:number(o,'expect',undefined)});
    else if(command==='rollback')result=await deployment.rollback({id:o.release,expectedGeneration:number(o,'expect',undefined)});
    else if(command==='backup')result=await outputFile(required(o,'out'),await store.backup());
    else if(command==='export'){
      const review=await readReview(store,required(o,'project'),required(o,'review')),format=o.format??'json';
      if(!['json','csv','ndjson','handoff'].includes(format))fail('ARGUMENT','Choose json, csv, ndjson or handoff');
      const content=format==='csv'?csv(review.data):format==='ndjson'?ndjson(review.data):format==='handoff'?await handoff(store,o.project,o.review):review;
      result=await outputFile(required(o,'out'),content);
    }else fail('ARGUMENT','Unknown command. Use --help.');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await acquirer.close();await deployment.close();await store.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'OPENWEATHER_ERROR',error:error.message})+'\n');process.exitCode=1;});
}

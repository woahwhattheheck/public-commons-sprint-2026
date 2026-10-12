// MIT. The CLI and browser operate the same original retained OData workspace.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openODataWorkspace } from './workspace.mjs';
import { writeNew, formatted } from './state.mjs';

const HELP=`OData source and merchant workspace

node cli.mjs --workspace DIRECTORY COMMAND [options]

  init | status
  serve [--port 8797] [--live-service SERVICE]
  connect --url SERVICE --name NAME [--id ID] [--auth-env VARIABLE]
  schema --connection ID
  refresh --connection ID
  plan --connection ID --input QUERY.json [--name NAME] [--id ID]
  review-plan --id ID --note TEXT
  capture --plan ID [--label NAME] [--pages 10000]
  resume --id EDITION [--pages 10000]
  rows --id EDITION [--out FILE]
  review --id EDITION --decision accept|needs-work --note TEXT
  compare --before EDITION --after EDITION [--out FILE]
  export --id EDITION [--name NAME] [--fields A,B] [--payment FILE --origin URL --path /data]
  query --export ID [--query 'limit=20&sort=ID']
  backup --out FILE
  restore --input FILE
  merchant prepare --export ID --release ID [--runtime FILE]
  merchant status
  merchant activate --id ID --expect GENERATION --reason TEXT
  merchant rollback [--to ID] --expect GENERATION --reason TEXT
  merchant run --expect GENERATION
  live prepare --input PROFILE.json
  live status | detail --id SERVICE
  live run --id SERVICE
  live buyer --id SERVICE --intent STABLE_INTENT [--received RECEIPT]
  live receive --id SERVICE --response ORIGINAL_RESPONSE.json

Plans use declared entity properties and typed filter clauses. Imports follow the
original nextLink and save every page before continuing. --pages sets the work
per invocation; unfinished imports retain their original continuation for resume.
Provider credentials are read from the named environment variable.
`;
function parse(args){
  const options={},words=[];
  for(let i=0;i<args.length;i++){
    if(!args[i].startsWith('--')){words.push(args[i]);continue;}
    const key=args[i].slice(2);if(Object.hasOwn(options,key)||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Option --'+key+' needs one value.');
    options[key]=args[++i];
  }
  return {options,words};
}
const jsonFile=async path=>JSON.parse(await readFile(resolve(path),'utf8'));
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){console.log(HELP);return;}
  const {options:o,words}=parse(args),[command,subcommand]=words;
  if(!o.workspace)throw new Error('--workspace is required.');
  const workspace=await openODataWorkspace({directory:resolve(o.workspace)});
  const abort=new AbortController(),interrupt=()=>abort.abort();
  process.once('SIGINT',interrupt);process.once('SIGTERM',interrupt);
  let persistent=false,result,live;
  try{
    switch(command){
      case 'init':case 'status':result=await workspace.state();break;
      case 'serve':{
        const [{startODataServer},{prepareODataLaunch,announceODataWorkspace}]=await Promise.all([import('./server.mjs'),import('./live/startup.mjs')]);
        const launch=await prepareODataLaunch({workspace,expectedIdentity:o['expected-workspace-identity'],
          liveId:o['live-service'],expectedLive:o['expected-live-identity']});
        const server=await startODataServer({workspace,port:o.port===undefined?8797:Number(o.port),liveServiceId:o['live-service']});
        try{console.log(JSON.stringify(await announceODataWorkspace({workspace,server,launch,liveRuntime:server.liveRuntime??null})));}
        catch(error){await server.close();throw error;}
        persistent=true;let closing=false;
        const close=()=>{if(closing)return;closing=true;void server.close().then(()=>process.exit(0),error=>{
          console.error(JSON.stringify({error:error.code||'ODATA_SHUTDOWN_FAILED',message:error.message}));process.exit(1);});};
        process.once('SIGINT',close);process.once('SIGTERM',close);return;
      }
      case 'connect':result=await workspace.connect({id:o.id,url:o.url,name:o.name,authEnv:o['auth-env'],signal:abort.signal});break;
      case 'schema':{const connection=(await workspace.state()).connections.find(value=>value.id===o.connection);if(!connection)throw new Error('Connection not found.');result=connection.catalog;break;}
      case 'refresh':result=await workspace.refreshConnection(o.connection);break;
      case 'plan':result=await workspace.plan({id:o.id,connectionId:o.connection,name:o.name,query:await jsonFile(o.input)});break;
      case 'review-plan':result=await workspace.reviewPlan({id:o.id,note:o.note});break;
      case 'capture':{const edition=await workspace.startCapture({planId:o.plan,label:o.label});
        console.error('Import edition '+edition.id);result=await workspace.capture(edition.id,{pageBudget:Number(o.pages||10000),signal:abort.signal});break;}
      case 'resume':result=await workspace.capture(o.id,{pageBudget:Number(o.pages||10000),signal:abort.signal});break;
      case 'rows':result=await workspace.rows(o.id);break;
      case 'review':result=await workspace.reviewEdition({id:o.id,decision:o.decision,note:o.note});break;
      case 'compare':result=await workspace.compare(o.before,o.after);break;
      case 'export':result=await workspace.exportEdition({id:o.id,name:o.name,fields:o.fields?.split(','),
        payment:o.payment?await jsonFile(o.payment):undefined,origin:o.origin,path:o.path||'/data'});break;
      case 'query':result=await workspace.queryExport({id:o.export,query:o.query||''});break;
      case 'backup':result=await workspace.backup();if(!o.out)throw new Error('backup requires --out.');break;
      case 'restore':result=await workspace.restore(await jsonFile(o.input));break;
      case 'merchant':{
        const {openODataPublisher}=await import('./publisher.mjs'),publisher=await openODataPublisher({workspace});
        if(subcommand==='prepare')result=await publisher.prepare({exportId:o.export,releaseId:o.release,runtime:o.runtime?await jsonFile(o.runtime):{port:0}});
        else if(subcommand==='status')result=await publisher.status();
        else if(subcommand==='activate')result=await publisher.activate({id:o.id,expectedGeneration:Number(o.expect),reason:o.reason});
        else if(subcommand==='rollback')result=await publisher.rollback({to:o.to,expectedGeneration:Number(o.expect),reason:o.reason});
        else if(subcommand==='run'){
          const runtime=await publisher.run({expectedGeneration:Number(o.expect)});
          console.log(JSON.stringify({release:runtime.release,url:runtime.url,mode:runtime.mode}));
          await runtime.completion;return;
        }
        else throw new Error('Unknown merchant command.');break;
      }
      case 'live':{
        const {openODataLiveOperations}=await import('./live-operations.mjs');live=await openODataLiveOperations({workspace});
        if(subcommand==='prepare')result=await live.prepare(await jsonFile(o.input));
        else if(subcommand==='status')result=await live.status();
        else if(subcommand==='detail')result=await live.detail(o.id);
        else if(subcommand==='buyer')result=await live.buyer({id:o.id,intentId:o.intent,receivedId:o.received});
        else if(subcommand==='receive')result=await live.receive({id:o.id,bodyBase64:(await readFile(resolve(o.response))).toString('base64')});
        else if(subcommand==='run'){
          console.log(JSON.stringify(await live.start({id:o.id}),null,2));
          if(!abort.signal.aborted)await new Promise(resolve=>abort.signal.addEventListener('abort',resolve,{once:true}));return;
        }else throw new Error('Unknown live operation.');break;
      }
      default:throw new Error('Unknown command; use --help.');
    }
    if(o.out){await writeNew(resolve(o.out),formatted(result));console.log(JSON.stringify({created:resolve(o.out)}));}
    else if(result!==undefined)console.log(JSON.stringify(result,null,2));
    return result;
  }finally{
    process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',interrupt);
    try{await live?.close();}finally{if(!persistent)await workspace.close();}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(JSON.stringify({error:error.code||'ODATA_COMMAND_FAILED',message:error.message}));process.exitCode=1;});

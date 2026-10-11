#!/usr/bin/env node
// MIT. Research queries, retained editions, review and delivery through the original buyer.
import {parseArgs} from 'node:util';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readBytes,readJson,parseJson,writeBytes,privateDirectory} from '../node/store.mjs';
import {openResearchWorkspace,requestUrl,MAX_PAGE_BYTES,ResearchError} from './workspace.mjs';
import {startResearchWorkspace} from './server.mjs';

const HELP='Research workspace\n\n'+
 'query-save --workspace DIR --file QUERY.json [--expected-revision N]\n'+
 'queries --workspace DIR\n'+
 'edition-create --workspace DIR --query-id ID --edition-id ID [--query-revision N --label TEXT]\n'+
 'editions|inspect --workspace DIR [--edition-id ID]\n'+
 'receive --workspace DIR --edition-id ID (--response FILE | --result ORIGINAL_BUYER_RESULT.json) [--request FILE --buyer-result FILE --source-url URL]\n'+
 'gather --workspace DIR --edition-id ID --product ID ( --merchant-config FILE --budget-dir DIR | --buyer-profile FILE --client FILE [--client-origin ORIGIN] )\n'+
 'decide --workspace DIR --edition-id ID --record-id URL --status include|exclude|undecided [--notes FILE --tags TEXT --expected-revision N]\n'+
 'copy-decisions|compare --workspace DIR --before ID --after ID [--expected-revision N]\n'+
 'report --workspace DIR --edition-id ID --out FILE [--before ID]\n'+
 'export --workspace DIR --edition-id ID --out DIR [--without-pages --without-native]\n'+
 'serve --workspace DIR [--port 8469] [same retrieval options as gather]\n\n'+
 'Gather follows the saved cursor chain to its terminal empty page. --max-pages N pauses after an explicit batch.\n'+
 'Each native page uses its existing original buyer intent on continuation. Query revisions create new editions.\n';
const stringOptions=['workspace','file','expected-revision','query-id','query-revision','edition-id','label','response','result','request',
 'buyer-result','source-url','product','merchant-config','budget-dir','buyer-profile','client','client-origin','record-id','status','notes',
 'tags','before','after','out','port','max-pages'];
const requireOption=(condition,message)=>{if(!condition)throw new ResearchError('COMMAND_OPTIONS_INVALID',message);};
function integer(value,fallback,{min=0,max=Number.MAX_SAFE_INTEGER}={}){
  if(value===undefined)return fallback;
  requireOption(/^\d+$/.test(value)&&Number.isSafeInteger(Number(value))&&Number(value)>=min&&Number(value)<=max,'Use an integer within the option range.');
  return Number(value);
}
async function retrievalFor(v){
  const {openResearchRetrieval}=await import('./retrieval.mjs');
  return openResearchRetrieval({merchantConfig:v['merchant-config']?resolve(v['merchant-config']):undefined,
    budgetDirectory:v['budget-dir']?resolve(v['budget-dir']):undefined,productId:v.product,
    buyerProfile:v['buyer-profile']?resolve(v['buyer-profile']):undefined,clientFile:v.client?resolve(v.client):undefined,
    clientOrigin:v['client-origin']});
}
export async function main(args=process.argv.slice(2)){
  const {values:v,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:Object.fromEntries([
    ...stringOptions.map(k=>[k,{type:'string'}]),...['help','without-pages','without-native'].map(k=>[k,{type:'boolean'}])])});
  const command=positionals[0];
  if(v.help||!command){process.stdout.write(HELP);return;}
  requireOption(positionals.length===1&&typeof v.workspace==='string',HELP);
  if(command==='serve'){
    let retrieval,app;
    try{
      if(v['merchant-config']||v['buyer-profile'])retrieval=await retrievalFor(v);
      app=await startResearchWorkspace({workspace:resolve(v.workspace),port:integer(v.port,8469,{max:65535}),retrieval});
    }catch(error){await retrieval?.close();throw error;}
    process.stdout.write('Research workspace: '+app.url+'\n');
    let closing=false;
    const stop=async()=>{if(closing)return;closing=true;await app.close();};
    process.once('SIGINT',()=>stop().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;}));
    process.once('SIGTERM',()=>stop().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode=1;}));
    return app;
  }
  const workspace=await openResearchWorkspace(resolve(v.workspace));let result,retrieval;
  try{
    if(command==='query-save'){
      requireOption(v.file,'Use --file QUERY.json.');
      const input=await readJson(resolve(v.file),65536);
      result=await workspace.saveQuery({id:input.id,label:input.label,entity:input.entity,parameters:input.parameters,
        expectedRevision:integer(v['expected-revision'],input.expectedRevision??0)});
    }else if(command==='queries')result=await workspace.listQueries();
    else if(command==='edition-create'){
      requireOption(v['query-id']&&v['edition-id'],'Use --query-id and --edition-id.');
      const edition=await workspace.createEdition({id:v['edition-id'],queryId:v['query-id'],queryRevision:integer(v['query-revision'],undefined,{min:1}),label:v.label});
      result={record:edition.record,query:edition.query,coverage:edition.coverage};
    }else if(command==='editions')result=await workspace.listEditions();
    else if(command==='inspect'){
      const edition=await workspace.edition(v['edition-id']);
      result={record:edition.record,query:edition.query,coverage:edition.coverage,analysis:edition.analysis,decisions:edition.decisions,pages:edition.pages,pending:edition.pending};
    }else if(command==='receive'){
      requireOption(Boolean(v.response)!==Boolean(v.result),'Choose --response FILE or --result ORIGINAL_BUYER_RESULT.json.');
      requireOption(!v['buyer-result']||v.response,'--buyer-result accompanies --response.');
      const edition=await workspace.edition(v['edition-id'],{records:false});
      const request=v.request?await readJson(resolve(v.request),65536):{entity:edition.query.entity,parameters:{...edition.query.parameters,cursor:edition.coverage.nextCursor}};
      const options={editionId:edition.record.id,request,source:{kind:'IMPORTED_RESPONSE',url:v['source-url']??requestUrl(request)}};
      result=v.result?await workspace.receiveResultFile(resolve(v.result),options):await workspace.receivePage({...options,
        responseBytes:await readBytes(resolve(v.response),MAX_PAGE_BYTES),
        nativeRecord:v['buyer-result']?parseJson(await readBytes(resolve(v['buyer-result']),4194304)):null});
    }else if(command==='gather'){
      const edition=await workspace.edition(v['edition-id'],{records:false});retrieval=await retrievalFor(v);
      requireOption(retrieval.acceptsEntity(edition.query.entity),'Choose a retrieval product matching this edition entity.');
      const gathered=await workspace.gatherEdition({editionId:edition.record.id,fetchPage:retrieval.fetchPage,
        maxPages:integer(v['max-pages'],Infinity,{min:1}),onPage:({page,edition:e})=>{
          process.stderr.write(JSON.stringify({editionId:e.record.id,page:page.index,records:page.records,coverage:e.coverage})+'\n');
        }});
      result={record:gathered.record,query:gathered.query,coverage:gathered.coverage,retrieval:await retrieval.snapshot()};
    }else if(command==='decide'){
      const edition=await workspace.edition(v['edition-id'],{records:false});
      const notes=v.notes?new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(resolve(v.notes),40000)):'';
      result=await workspace.setDecision({editionId:edition.record.id,id:v['record-id'],expectedRevision:integer(v['expected-revision'],edition.decisions.revision),
        decision:{status:v.status,notes,tags:(v.tags??'').split(',').map(t=>t.trim()).filter(Boolean)}});
    }else if(command==='copy-decisions'){
      const edition=await workspace.edition(v.after,{records:false});
      result=await workspace.copyDecisions({fromEdition:v.before,toEdition:v.after,expectedRevision:integer(v['expected-revision'],edition.decisions.revision)});
    }else if(command==='compare')result=await workspace.compare(v.before,v.after);
    else if(command==='report'){
      requireOption(v.out,'Use --out FILE.');
      const output=resolve(v.out),html=await workspace.report(v['edition-id'],{compareWith:v.before});
      await privateDirectory(dirname(output));await writeBytes(output,Buffer.from(html));
      result={path:output,bytes:Buffer.byteLength(html)};
    }else if(command==='export'){
      requireOption(v.out,'Use --out DIR.');
      result=await workspace.export(v['edition-id'],resolve(v.out),{includePages:!v['without-pages'],includeNative:!v['without-native']});
    }else throw new ResearchError('COMMAND_UNKNOWN',HELP);
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }finally{await retrieval?.close();await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RESEARCH_COMMAND_FAILED',message:error.message})+'\n');process.exitCode=1;});
}

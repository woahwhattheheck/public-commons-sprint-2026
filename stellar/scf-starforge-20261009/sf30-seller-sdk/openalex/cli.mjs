#!/usr/bin/env node
// MIT. Review, export, operate and retrieve research through the original service.
import {parseArgs} from 'node:util';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile,readdir} from 'node:fs/promises';
import {readOpenAlexMerchant,merchantOpenApi,merchantReview,json,sha256,fail} from './config.mjs';
import {startOpenAlexMerchant,openAlexNativeFactory} from './merchant.mjs';
import {createOpenAlexSource} from './source.mjs';
import {exportSellerClient,inspectSellerClientExport,adoptSellerClientExport} from '../developer/client-export.mjs';
import {generateSellerClient} from '../developer/client-generator.mjs';
import {privateDirectory,readBytes,readJson,writeBytes,writeJson,exists} from '../../sf88-operator-buyer-cli/node/store.mjs';

export async function exportOpenAlexMerchant(compiled,destination){
  const out=await privateDirectory(resolve(destination)),plan={schema:'stellar-forge.openalex-export-plan.v1',inputSha256:compiled.inputSha256};
  async function exact(name,content){
    const bytes=Buffer.isBuffer(content)?content:Buffer.from(content),path=join(out,name);
    if(await exists(path)){if(!(await readBytes(path,bytes.length)).equals(bytes))fail('The export contains another merchant revision.',409);return;}
    await writeBytes(path,bytes,{exclusive:true});
  }
  await exact('export-plan.json',json(plan));
  const members={'merchant.json':json(compiled.config),'review.json':json(merchantReview(compiled)),
    'seller-openapi.json':json(merchantOpenApi(compiled,'NATIVE_X402'))};
  for(const [name,content] of Object.entries(members))await exact(name,content);
  const clientDirectory=join(out,'client');
  let client=await inspectSellerClientExport({directory:clientDirectory});
  if(client.state==='NOT_FOUND')client=await exportSellerClient({openapi:join(out,'seller-openapi.json'),out:clientDirectory});
  else if(client.state==='INCOMPLETE'){
    const openapi=await readBytes(join(out,'seller-openapi.json'),16777216),generated=generateSellerClient(openapi);
    for(const [name,value] of [['seller-client.mjs',generated.javascript],['seller-client.d.mts',generated.declarations],
      ['seller-openapi.json',openapi],['package.json',generated.packageJson],['README.md',generated.readme]])
      await exact('client/'+name,Buffer.from(value));
    client=await inspectSellerClientExport({directory:clientDirectory});
  }
  if(client.state==='LEGACY_FILES_RETAINED')client=await adoptSellerClientExport({directory:clientDirectory,expectedFilesSha256:client.filesSha256});
  if(client.state!=='COMPLETE')fail('The generated customer client export is incomplete.',503);
  const manifest={schema:'stellar-forge.openalex-merchant-export.v1',inputSha256:compiled.inputSha256,
    files:Object.fromEntries(Object.entries(members).map(([name,value])=>[name,{bytes:Buffer.byteLength(value),sha256:sha256(value)}])),clientFilesSha256:client.filesSha256};
  await exact('manifest.json',json(manifest));
  return {directory:out,configPath:join(out,'merchant.json'),openapiPath:join(out,'seller-openapi.json'),clientDirectory,manifest,client};
}
function numeric(value,fallback,max=65535){
  if(value===undefined)return fallback;
  if(!/^\d+$/.test(value)||Number(value)>max)fail('Use an integer command option.');
  return Number(value);
}
const HELP='openalex review|export|serve|gather --config FILE\n'+
 'review: print the compiled products, source budget and payment terms\n'+
 'export: --out DIR; retain merchant, OpenAPI and original generated customer client\n'+
 'serve: --budget-dir DIR --port N [--operations-port N --facilitator URL --allow-local-facilitator]\n'+
 'gather: --budget-dir DIR --workspace DIR --query-id ID --edition-id ID --product ID; resume the saved query to its terminal cursor\n';
export async function main(args=process.argv.slice(2)){
  const {values:v,positionals}=parseArgs({args,allowPositionals:true,strict:true,options:{
    config:{type:'string'},out:{type:'string'},'budget-dir':{type:'string'},port:{type:'string'},'operations-port':{type:'string'},
    facilitator:{type:'string'},'allow-local-facilitator':{type:'boolean'},'availability-dir':{type:'string'},
    'history-dir':{type:'string'},workspace:{type:'string'},'query-id':{type:'string'},'edition-id':{type:'string'},
    product:{type:'string'},'max-pages':{type:'string'},help:{type:'boolean'}
  }});
  const command=positionals[0];
  if(v.help||!command){process.stdout.write(HELP);return;}
  if(!['review','export','serve','gather'].includes(command)||positionals.length!==1||!v.config)fail(HELP);
  const compiled=await readOpenAlexMerchant(v.config);
  if(command==='review'){process.stdout.write(json(merchantReview(compiled)));return;}
  if(command==='export'){if(!v.out)fail('Use --out DIR.');process.stdout.write(json(await exportOpenAlexMerchant(compiled,v.out)));return;}
  if(!v['budget-dir'])fail('Use the shared provider --budget-dir DIR.');
  if(command==='serve'){
    const nativeFactory=await openAlexNativeFactory(v.facilitator,{allowLocalFacilitator:v['allow-local-facilitator']??false});
    const service=await startOpenAlexMerchant(compiled,{budgetDirectory:resolve(v['budget-dir']),nativeFactory,
      port:numeric(v.port,8432),operationsPort:v['operations-port']===undefined?undefined:numeric(v['operations-port']),
      availabilityDirectory:v['availability-dir']?resolve(v['availability-dir']):undefined,historyDirectory:v['history-dir']?resolve(v['history-dir']):undefined});
    process.stdout.write(json(await service.snapshot()));
    let closing=false;const stop=async()=>{if(closing)return;closing=true;await service.close();};
    process.once('SIGTERM',()=>stop().then(()=>process.exit(0)));process.once('SIGINT',()=>stop().then(()=>process.exit(0)));
    return service;
  }
  if(!v.workspace||!v['query-id']||!v['edition-id']||!v.product)fail('Use --workspace, --query-id, --edition-id and --product.');
  const {openResearchWorkspace}=await import('../../sf88-operator-buyer-cli/research/workspace.mjs');
  const workspace=await openResearchWorkspace(resolve(v.workspace));let source;
  try{
    const query=await workspace.query(v['query-id']),product=compiled.products.find(p=>p.id===v.product);
    if(!product||product.kind!=='list'||product.entity!==query.entity)fail('Choose a list product matching this query entity.');
    await workspace.createEdition({id:v['edition-id'],queryId:query.id,queryRevision:query.revision,label:query.label});
    source=await createOpenAlexSource(compiled,{budgetDirectory:resolve(v['budget-dir'])});
    const result=await workspace.gatherEdition({editionId:v['edition-id'],maxPages:v['max-pages']===undefined?Infinity:numeric(v['max-pages'],undefined,1000000),
      fetchPage:async({request,signal})=>{
        const response=await source.request(product.id,request.parameters,{signal});
        if(response.status!==200){const error=response.body?.error??'OPENALEX_HTTP_'+response.status;fail('OpenAlex returned '+response.status+'. Inspect the current source budget and request.',response.status,error);}
        return {bytes:response.body,source:{kind:'OPENALEX_API',url:response.source.url,retrievedAt:response.source.retrievedAt,headers:response.headers}};
      },onPage:({page,edition})=>{process.stderr.write(json({editionId:edition.record.id,page:page.index,records:page.records,coverage:edition.coverage}));}});
    process.stdout.write(json({record:result.record,query:result.query,coverage:result.coverage,budget:await source.budget.snapshot()}));
  }finally{await source?.close();await workspace.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  main().catch(error=>{process.stderr.write(json({error:error.code??'OPENALEX_COMMAND_FAILED',message:error.message}));process.exitCode=1;});
}

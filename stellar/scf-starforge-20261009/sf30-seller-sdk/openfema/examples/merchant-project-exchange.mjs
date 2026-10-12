// MIT. One complete merchant mapping, customer review, file receiving and archive operation.
import {mkdir,readFile,writeFile,rename,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {acquireStateLease} from '../../../merchant-fleet-gateway/state-lease.mjs';
import {privateSupportDirectory} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {openOpenFemaClient,inspectOpenFemaFiles,downloadOpenFemaFiles,reopenOpenFemaFiles} from '../mcp-client.mjs';

const SCHEMA='stellar-forge.openfema-merchant-exchange-run.v1';
const fail=message=>Object.assign(new Error(message),{code:'OPENFEMA_MERCHANT_EXCHANGE'});
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
async function optional(path){try{return JSON.parse(await readFile(path,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function save(path,value){const temporary=path+'.'+randomUUID()+'.partial';await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);}
function accepted(response){if(response?.ok!==true)throw Object.assign(fail(response?.native?.message??'Inspect the original operation before continuing.'),{original:response});return response.native;}

export async function runMerchantProjectExchange(options){
  const {url,workspace,versionId,mappingPackage,customerFilePackage,operationId,reviewer,mappingNote,reviewNote='',rowNumbers=[],tokenEnv='MCP_ACCESS_TOKEN'}=options;
  if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(operationId??'')||!Array.isArray(rowNumbers)||rowNumbers.length>10000||
    new Set(rowNumbers).size!==rowNumbers.length||rowNumbers.some(n=>!Number.isSafeInteger(n)||n<2||n>250001))
    throw fail('Keep a stable operation ID up to120 characters and distinct original CSV data-row numbers.');
  if(typeof options.directory!=='string'||!options.directory.startsWith('/')||resolve(options.directory)==='/')throw fail('Choose an absolute private receiving directory.');
  const directory=resolve(options.directory);await mkdir(directory,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  await privateSupportDirectory(directory);if(await realpath(directory)!==directory)throw fail('Choose the canonical private receiving path.');
  const state=join(directory,'exchange-state');await mkdir(state,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
  await privateSupportDirectory(state);const lease=await acquireStateLease(state);
  try{
    const connection={url,workspace,tokenEnv,...(options.environment?{environment:options.environment}:{})},client=await openOpenFemaClient(connection);
    const schema=await client.call('schema'),nativeSchema=accepted(schema);
    const plan={schema:SCHEMA,operationId,workspace,workspaceId:nativeSchema.workspaceId,versionId,mappingPackage,customerFilePackage,reviewer,mappingNote,reviewNote,rowNumbers};
    const planPath=join(state,'plan.json'),prior=await optional(planPath);
    if(prior&&stable(prior)!==stable(plan))throw fail('This receiving directory belongs to its original complete exchange plan.');
    if(!prior)await save(planPath,plan);
    const receipts={};
    async function action(step,name,payload){
      lease.assertHeld();
      const requestPath=join(state,step+'-request.json');let request=await optional(requestPath);
      const intended={action:name,payload,operationId:operationId+':'+step};
      if(request){
        if(stable({action:request.action,payload:request.payload,operationId:request.operationId})!==stable(intended))
          throw fail('Keep the exact previously retained '+step+' request.');
      }else{
        const view=accepted(await client.call('view'));
        request={...intended,expectedRevision:view.revision};await save(requestPath,request);
      }
      const response=await client.action(name,payload,{operationId:request.operationId,expectedRevision:request.expectedRevision});
      await save(join(state,step+'-response.json'),response);const native=accepted(response);
      receipts[step]={operationId:request.operationId,reused:native.reused,result:native.result};
      return {result:native.result,response};
    }
    const downloads=[];
    async function receive(step,selection){
      const selected={...connection,...selection,expectedWorkspaceId:plan.workspaceId};
      const inspected=await inspectOpenFemaFiles(selected),target=join(directory,step);
      const result=await downloadOpenFemaFiles({...selected,directory:target,expectedManifestSha256:inspected.manifestSha256});
      const reopened=await reopenOpenFemaFiles({directory:target,expectedManifestSha256:inspected.manifestSha256});
      downloads.push({step,selection,directory:target,manifestSha256:inspected.manifestSha256,result,reopened});
      return target;
    }
    const mapping=(await action('mapping','delivery.mapping.save',{mappingPackage})).result;
    await receive('mapping-file',{kind:'mapping',id:mapping.id});
    await action('mapping-review','delivery.mapping.review',{mappingId:mapping.id,expectedMappingSha256:mapping.mappingSha256,reviewer,note:mappingNote});
    const before=(await action('initial-delivery','delivery.export',{mappingId:mapping.id,versionId})).result;
    await receive('initial-delivery-file',{kind:'export',id:before.export.id});
    const reconciliation=(await action('customer-receiving','delivery.reconcile',{deliveryId:before.id,customerFilePackage})).result;
    await receive('customer-reconciliation-document',{kind:'reconciliation',id:reconciliation.id});
    await receive('customer-reconciliation-files',{kind:'export',id:reconciliation.export.id});
    let reviewedVersionId=versionId,review=null;
    if(rowNumbers.length){
      review=(await action('analyst-review','delivery.review.apply',{reconciliationId:reconciliation.id,versionId,rowNumbers,reviewer,note:reviewNote})).result;
      reviewedVersionId=review.versionId;
    }
    const after=(await action('reviewed-delivery','delivery.export',{mappingId:mapping.id,versionId:reviewedVersionId,customerReconciliationId:reconciliation.id})).result;
    await receive('reviewed-delivery-document',{kind:'delivery',id:after.id});
    await receive('reviewed-delivery-files',{kind:'export',id:after.export.id});
    const comparison=(await action('delivery-comparison','delivery.compare',{beforeDeliveryId:before.id,afterDeliveryId:after.id})).result;
    await receive('delivery-comparison-document',{kind:'delivery-comparison',id:comparison.id});
    await receive('delivery-comparison-files',{kind:'export',id:comparison.export.id});
    const archived=await action('workspace-archive','workspace.export',{});
    if(archived.response.workspaceArchive?.state!=='COMPLETE')throw Object.assign(fail(archived.response.workspaceArchive?.message??'Finish this original workspace archive receiving operation.'),{original:archived.response});
    await receive('complete-workspace',archived.response.workspaceArchive.selection);
    const result={schema:SCHEMA,state:'COMPLETE',operationId,workspace,workspaceId:plan.workspaceId,versionId,reviewedVersionId,
      mapping,initialDelivery:before,reconciliation,review,reviewedDelivery:after,comparison,workspaceArchive:archived.response.workspaceArchive,
      downloads,operations:receipts,completedAt:new Date().toISOString(),
      restoration:'Use openfema restore --archive complete-workspace/OpenFEMA_Complete_Workspace.zip --workspace NEW_ABSOLUTE_PRIVATE_DIRECTORY, then reopen that original workspace.'};
    await save(join(directory,'merchant-exchange-result.json'),result);return result;
  }finally{await lease.close();}
}
const HELP='merchant-project-exchange --url MCP_URL --workspace ALIAS --version ORIGINAL_VERSION\n  --mapping-package ALIAS --customer-file-package ALIAS --operation ORIGINAL_ID\n  --reviewer NAME --mapping-note TEXT --out ABSOLUTE_PRIVATE_DIRECTORY\n  [--rows 2,17 --review-note TEXT] [--token-env MCP_ACCESS_TOKEN]\n\nUse the existing source edition and portfolio. Files are host-declared complete inputs.\nThe same command reopens the exact requests and downloads in its original directory.\n';
export async function main(args=process.argv.slice(2)){
  if(!args.length||args.includes('--help')){process.stdout.write(HELP);return;}
  const required=['--url','--workspace','--version','--mapping-package','--customer-file-package','--operation','--reviewer','--mapping-note','--out'];
  const allowed=new Set([...required,'--rows','--review-note','--token-env']),values={};
  for(let i=0;i<args.length;i+=2){
    if(!allowed.has(args[i])||Object.hasOwn(values,args[i])||!args[i+1]||args[i+1].startsWith('--'))throw fail('Use unique complete options from --help.');
    values[args[i]]=args[i+1];
  }
  for(const key of required)if(!values[key])throw fail(key+' is required.');
  if(values['--rows']&&!/^[0-9]+(?:,[0-9]+)*$/.test(values['--rows']))throw fail('Use the original CSV data-row numbers separated by commas.');
  const rowNumbers=values['--rows']?values['--rows'].split(',').map(Number):[];
  if(rowNumbers.length&&!values['--review-note'])throw fail('Add the actual analyst review note for these selected rows.');
  const result=await runMerchantProjectExchange({url:values['--url'],workspace:values['--workspace'],versionId:values['--version'],
    mappingPackage:values['--mapping-package'],customerFilePackage:values['--customer-file-package'],operationId:values['--operation'],
    reviewer:values['--reviewer'],mappingNote:values['--mapping-note'],directory:values['--out'],rowNumbers,reviewNote:values['--review-note'],
    tokenEnv:values['--token-env']??'MCP_ACCESS_TOKEN'});
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write((error.code??'OPENFEMA_MERCHANT_EXCHANGE')+': '+error.message+'\n');process.exitCode=1;});

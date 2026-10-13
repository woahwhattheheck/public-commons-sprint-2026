#!/usr/bin/env node
// MIT. One complete customer-agent journey using an original retained source edition.
import {mkdir,writeFile,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {StellarcarbonWorkspace} from '../stellarcarbon-statements/store.mjs';
import {GiveCreditWorkspace} from '../cfce-givecredit-statements/store.mjs';
import {readCarbonCustomerConfiguration} from './configuration.mjs';
import {MerchantCarbonCustomerWorkspaces} from './merchant.mjs';
import {need,readJSON,privateDirectory,fileDigest} from './files.mjs';

export async function receiveCustomerAgent({sourceFile,outputDirectory,fromDate='2025-11-01',beforeDate='2025-12-01'}){
 const output=resolve(outputDirectory),sourcePath=resolve(sourceFile);await privateDirectory(resolve(output,'..'));
 await mkdir(output,{mode:0o700});await privateDirectory(output);
 const sourceIdentity=await fileDigest(sourcePath),original=await readJSON(sourcePath);
 need(original.schema==='stellar-forge.stellarcarbon-source-edition.v1','CARBON_ORIGINAL_SOURCE','Select the complete original retained Carbon edition.');
 const customerDirectory=join(output,'customer'),donorDirectory=join(output,'donors'),exportsDirectory=join(output,'exports');
 await mkdir(exportsDirectory,{mode:0o700});
 const customer=await StellarcarbonWorkspace.create(customerDirectory,{name:'Original Carbon customer-agent receiving'});
 const customerId=customer.state.workspaceId;await customer.close();
 const donor=await GiveCreditWorkspace.create(donorDirectory,{name:'Original GiveCredit customer-agent receiving'});
 const donorId=donor.state.workspaceId;await donor.close();
 const connection={schema:'stellar-forge.carbon-customer-connection.v1',workspaces:{
  customer:{kind:'stellarcarbon',directory:customerDirectory,workspaceId:customerId,mode:'owned',files:{source:sourcePath}},
  donors:{kind:'givecredit',directory:donorDirectory,workspaceId:donorId,mode:'owned',files:{}}},
  destinations:{'customer-received':join(output,'customer-received'),'donors-received':join(output,'donors-received')}};
 const connectionPath=join(output,'connection.json');await writeFile(connectionPath,JSON.stringify(connection,null,2)+'\n',{flag:'wx',mode:0o600});
 const configuration=await readCarbonCustomerConfiguration(connectionPath),events=[],files=[];let lost=false,runtime,phase='start',failure;
 const fetchImpl=async(url,options)=>{
  const response=await fetch(url,options);
  if(!lost&&options?.method==='POST'&&String(url).includes('/api/operations/statement')){
   lost=true;await response.arrayBuffer();throw Object.assign(new Error('Original response intentionally lost after native completion.'),{code:'RECEIVING_RESPONSE_LOST'});
  }return response;
 };
 async function call(tool,args){const full=await runtime.call('merchant_carbon_'+tool,args),result=full.result??full;events.push({tool,args,result});return result;}
 async function state(workspace){return (await call('view',{workspace,view:'state'})).value;}
 async function save(workspace,action,value,requestId){const current=await state(workspace);return call('save',{workspace,action,value,requestId,revision:current.revision,actor:'Original source receiving'});}
 async function download(workspace,input){
  const result=await call('export',{workspace,...input}),receipt=result.receipt,digest=createHash('sha256');
  const target=join(output,workspace+'-'+input.exportId+'.bin'),file=await open(target,'wx',0o600);let offset=0,readId,bytes=0;
  try{for(;;){const chunk=await call('file_read',{workspace,exportId:input.exportId,expectedSha256:receipt.sha256,offset,limit:65536,...(readId?{readId}:{})});
    const value=Buffer.from(chunk.data,'base64');digest.update(value);bytes+=value.length;await file.writeFile(value);
    if(chunk.nextOffset===null)break;offset=chunk.nextOffset;readId=chunk.readId;}await file.sync();}
  finally{await file.close();}
  const sha256=digest.digest('hex');need(bytes===receipt.bytes&&sha256===receipt.sha256,'CARBON_RECEIVING_BYTES','Every complete browser-independent export must retain its exact original bytes.');
  files.push({path:target,bytes,sha256,exportId:input.exportId,workspace});return receipt;
 }
 try{
  runtime=new MerchantCarbonCustomerWorkspaces({carbonCustomerWorkspaces:configuration,exportsDirectory},{fetchImpl});
  phase='original source and schema';await call('open',{workspace:'customer'});await call('contract',{workspace:'customer'});
  let current=await state('customer');
  const imported=await call('import',{workspace:'customer',format:'source',sourceFile:'source',label:'Retained original '+original.metadata.completedAt,
   requestId:'receive-original-carbon',revision:current.revision,actor:'Original source receiving'});
  const editionId=imported.native.edition.id;
  const page=(await call('view',{workspace:'customer',view:'contributions',query:{editionId,fromDate,beforeDate,limit:100}})).value;
  need(page.items.length>0,'CARBON_RECEIVING_PERIOD','Select a period containing an original contribution.');
  const first=page.items[0],record=(await save('customer','customer',{name:'Source recipient '+first.recipient,reference:first.recipient},'receive-source-customer')).native.customer;
  const project=(await save('customer','project',{customerId:record.id,name:fromDate+' contributions'},'receive-source-project')).native.project;
  await save('customer','assignment',{kind:'RECIPIENT',value:first.recipient,customerId:record.id,projectId:project.id,note:'Explicit receiving assignment to the recorded source recipient.'},'receive-source-assignment');
  const specification={title:'Original recipient contributions',editionId,customerId:record.id,projectId:project.id,fromDate,beforeDate};
  const preview=await call('preview',{workspace:'customer',kind:'statement',value:specification});
  phase='same original request after lost native response';
  try{await save('customer','statement',specification,'receive-statement');throw new Error('Expected original response-loss observation.');}
  catch(error){need(error.code==='RECEIVING_RESPONSE_LOST','CARBON_RECEIVING_REPLY','Observe the deliberately lost original response.');}
  const observed=await call('operation',{workspace:'customer',requestId:'receive-statement'});
  need(observed.native?.found,'CARBON_RECEIVING_NATIVE_OPERATION','The completed native statement must be present after the lost response.');
  const recovered=await call('resume',{workspace:'customer',requestId:'receive-statement'});
  const statementId=recovered.native.statementId??recovered.native.operation?.result?.statementId;
  const firstVersion=(await call('view',{workspace:'customer',view:'statement',query:{id:statementId,version:1}})).value;
  need(firstVersion.totals.carbon===preview.value.totals.carbon,'CARBON_RECEIVING_STATEMENT','The original saved statement agrees with its reviewed source.');
  await save('customer','statement',{...specification,id:statementId,expectedVersion:1,note:'A second explicit saved version retains the first.'},'receive-statement-v2');
  phase='whole exports and cross-workspace source';
  for(const name of ['statement.json','statement.html','contributions.csv','allocations.csv','retirements.csv'])
   await download('customer',{kind:'statement',statementId,version:2,name,exportId:'statement-'+name.replace('.','-')});
  await download('customer',{kind:'source',editionId,exportId:'complete-carbon-source'});
  await call('open',{workspace:'donors'});await call('contract',{workspace:'donors'});current=await state('donors');
  const joined=await call('import',{workspace:'donors',format:'carbon-source',sourceWorkspace:'customer',sourceExport:'complete-carbon-source',network:'mainnet',
   label:'Original source received from customer desk',requestId:'receive-givecredit-carbon',revision:current.revision,actor:'Original source receiving'});
  const sourceView=(await call('view',{workspace:'donors',view:'edition',query:{editionId:joined.native.edition.id}})).value;
  need(sourceView.kind==='carbon','CARBON_RECEIVING_SOURCE_KIND','The original carbon edition keeps its distinct source kind.');
  phase='complete independent receiving and cold reopen';
  await download('customer',{kind:'handover',exportId:'customer-handover'});
  await call('receive',{workspace:'customer',destination:'customer-received',sourceExport:'customer-handover',requestId:'receive-customer-copy'});
  await call('receive',{workspace:'customer',destination:'customer-received',sourceExport:'customer-handover',requestId:'receive-customer-copy'});
  await download('donors',{kind:'handover',exportId:'donor-handover'});
  await call('receive',{workspace:'donors',destination:'donors-received',sourceExport:'donor-handover',requestId:'receive-donor-copy'});
  await call('open',{workspace:'customer-received'});await call('open',{workspace:'donors-received'});
  await save('customer-received','customer',{id:record.id,expectedVersion:record.version,name:record.name+' — independent receiving'},'receive-edit-customer');
  await save('donors-received','settings',{name:'Original GiveCredit source — independent receiving'},'receive-edit-donors');
  need((await state('customer')).customers.find(r=>r.id===record.id).name===record.name,'CARBON_RECEIVING_INDEPENDENCE','The original customer remains unchanged by receiving edits.');
  await runtime.close();
  runtime=new MerchantCarbonCustomerWorkspaces({carbonCustomerWorkspaces:configuration,exportsDirectory});
  await call('open',{workspace:'customer-received'});await call('open',{workspace:'donors-received'});
  const reopened=await state('customer-received'),reopenedDonors=await state('donors-received');
  need(reopened.statements.find(s=>s.id===statementId).versions.length===2&&reopenedDonors.editions.length===1,
   'CARBON_RECEIVING_REOPEN','Both original source and saved statement versions survive cold independent reopen.');
  phase='complete';
 }catch(error){failure={code:error.code||'CARBON_RECEIVING_ERROR',message:error.message};throw error;}
 finally{
  let closeError=null;try{await runtime?.close();}catch(error){closeError={code:error.code||'CARBON_CLOSE_ERROR',message:error.message};}
  const result={schema:'stellar-forge.carbon-customer-agent-receiving.v1',phase,source:{path:sourcePath,...sourceIdentity},events,files,error:failure??closeError};
  await writeFile(join(output,'receiving.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});
  if(closeError&&!failure)throw Object.assign(new Error(closeError.message),{code:closeError.code});
 }
 return {directory:output,phase,files:files.length,events:events.length};
}
export async function main(args=process.argv.slice(2)){
 const input={};for(let i=0;i<args.length;i+=2){need(['--source','--output','--from','--before'].includes(args[i])&&args[i+1],'CARBON_RECEIVING_OPTIONS','Use --source ORIGINAL.json --output NEW_PRIVATE_DIR [--from DATE --before DATE].');input[args[i]]=args[i+1];}
 need(input['--source']&&input['--output'],'CARBON_RECEIVING_OPTIONS','Choose the whole original source and new private output.');
 const result=await receiveCustomerAgent({sourceFile:input['--source'],outputDirectory:input['--output'],fromDate:input['--from'],beforeDate:input['--before']});process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code,message:error.message}})+'\n');process.exitCode=1;});

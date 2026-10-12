// MIT. Original SF82 merchant, SF88 Dataset, SF36 finalization and SF100 delivery.
import {join,resolve} from 'node:path';
import {privateDirectory,readJson,atomicJson} from '../postgres/publisher/files.mjs';
import {readOriginalFile,selectedObservationRows,normalizeSourceQuery} from './source.mjs';
import {optionalJson,exactFile,now} from './provider.mjs';
import {need,isRecord,canonical,digest,hash,jsonBytes,operationId} from './model.mjs';
import {activateDbnomicsRelease,runDbnomicsRelease} from './release.mjs';
const positive=(n,max)=>Number.isSafeInteger(n)&&n>=1&&n<=max;
function settings(value){
 need(isRecord(value)&&Object.keys(value).every(key=>['id','configFile','operatorWorkspace','pageSize','maxPages',
   'maxTotalAtomic','maxPageBytes','acceptIndex'].includes(key)),'Use the original native customer receiving settings.');
 operationId(value.id);
 need(typeof value.configFile==='string'&&value.configFile.startsWith('/')&&typeof value.operatorWorkspace==='string'&&value.operatorWorkspace.startsWith('/'),
   'Use the original absolute buyer configuration and accounting workspace paths.');
 need(positive(value.pageSize,250)&&positive(value.maxPages,10000),'Choose the original page size and maximum pages.');
 need(typeof value.maxTotalAtomic==='string'&&/^[1-9][0-9]*$/.test(value.maxTotalAtomic),'Supply the original reviewed total atomic spend ceiling.');
 const maxPageBytes=value.maxPageBytes??1048576,acceptIndex=value.acceptIndex??0;
 need(positive(maxPageBytes,128*1024*1024)&&Number.isSafeInteger(acceptIndex)&&acceptIndex>=0,'Use the original response capacity and offer index.');
 return {...value,configFile:resolve(value.configFile),operatorWorkspace:resolve(value.operatorWorkspace),maxPageBytes,acceptIndex};
}
function expectedRows(retained,query,dataset){
 const normalized=normalizeSourceQuery(query,retained.model),columns=dataset.columns;
 need(columns&&columns.observation_id?.type==='string','Native customer receiving requires the original observation identity column.');
 const rows=selectedObservationRows(retained.model,normalized).map(({row})=>Object.fromEntries(Object.entries(columns).map(([name,spec])=>
   [name,spec.type==='boolean'?row[name]==='true':row[name]])));
 const byId=new Map(rows.map(row=>[row.observation_id,row]));need(byId.size===rows.length,'The source observation identity repeats.');
 return byId;
}
function compareRows(rows,expected){
 need(rows.length===expected.size,'The purchased dataset has another original row population.','DBNOMICS_CUSTOMER_ROW_COUNT',409);
 const seen=new Set();
 for(const row of rows){
   const id=row.observation_id;
   need(typeof id==='string'&&!seen.has(id)&&expected.has(id)&&canonical(row)===canonical(expected.get(id)),
     'A purchased row differs from its original reviewed source.','DBNOMICS_CUSTOMER_SOURCE_CHANGED',409);seen.add(id);
 }
 return rows.length;
}
export async function receiveDbnomicsCustomer({workbench,runId,release,prepared,config,directory,handover,signal,print=()=>{}}={}){
 config=settings(config);
 need(workbench&&isRecord(release)&&typeof release.releaseDirectory==='string'&&release.id&&prepared?.snapshot,
   'Prepare and stage this original merchant release first.');
 const folder=resolve(directory);await privateDirectory(folder,true);
 const run=workbench.publisher.run(runId),plan=workbench.publisher.plan(run.plan),candidate=await workbench.publisher.candidate(runId);
 need(run.state==='PUBLISHED'&&run.data.publication.snapshot===prepared.snapshot&&candidate.manifest.dataset.snapshot===prepared.snapshot,
   'Choose the same original published merchant snapshot.','DBNOMICS_CUSTOMER_PUBLICATION_CHANGED',409);
 const retained=await workbench.capture(plan.data.sourceQuery.captureId),expected=expectedRows(retained,plan.data.sourceQuery,plan.data.dataset);
 need(expected.size>0&&expected.size===prepared.rowCount&&config.pageSize<=plan.data.dataset.maxLimit&&
   Math.ceil(expected.size/config.pageSize)<=config.maxPages,'The selected native page limits cannot contain the complete source.');
 const buyerSettings=await readJson(config.configFile,131072);
 const binding={schema:'stellar-forge.dbnomics-native-customer.v1',config,buyerSettingsSha256:digest(buyerSettings),
   release:{directory:resolve(release.releaseDirectory),id:release.id,origin:release.origin,path:release.path??'/data',
     activationOptions:release.activationOptions??null,runOptions:release.runOptions??null},
   projectId:workbench.settings.id,runId,snapshot:prepared.snapshot,captureSha256:retained.captureSha256,
   sourceQuerySha256:digest(plan.data.sourceQuery),handoverSha256:hash(jsonBytes(handover))};
 let state=await optionalJson(join(folder,'customer.json'),16*1024*1024);
 if(state)need(state.schema===binding.schema&&state.bindingSha256===digest(binding)&&canonical(state.binding)===canonical(binding),
   'Continue the original customer intent with its original source, account and limits.','DBNOMICS_CUSTOMER_BINDING_CHANGED',409);
 else{state={schema:binding.schema,id:config.id,binding,bindingSha256:digest(binding),createdAt:now(),state:'READY',steps:{}};await atomicJson(folder,'customer.json',state);}
 const save=async()=>{state.updatedAt=now();await atomicJson(folder,'customer.json',state);};
 const step=async(name,action)=>{
   if(state.steps[name])return state.steps[name];
   need(!signal?.aborted,'The original customer receiving operation was interrupted.','DBNOMICS_CUSTOMER_INTERRUPTED',409);
   state.phase=name;state.state='RUNNING';await save();print({operation:config.id,phase:name,checkpoint:join(folder,'customer.json')});
   const result=await action();state.steps[name]=result;await save();return result;
 };
 const [{Buyer,DatasetDelivery},{readDatasetBuyerOffer,prepareDatasetBuyer}]=await Promise.all([
   import('../../sf88-operator-buyer-cli/node/index.mjs'),import('../dataset-refresh/buyer-handoff.mjs')]);
 let merchant;
 try{
   if(!state.steps.delivery){
     const {readReleaseState}=await import('../../sf82-seller-pilot/releases.mjs');
     const activation=await step('activation',async()=>{
       const options=release.activationOptions;
       need(isRecord(options)&&Number.isSafeInteger(options.expectedGeneration)&&options.expectedGeneration>=0,
         'Supply the original reviewed SF82 activation generation.');
       const current=await readReleaseState(resolve(release.releaseDirectory));
       if(!state.activationIntent){
         need(current.generation===options.expectedGeneration,
           'Review the current original release generation.','DBNOMICS_RELEASE_GENERATION_CHANGED',409);
         state.activationIntent={expectedGeneration:options.expectedGeneration,beforeActive:current.active,target:release.id,
           reason:options.reason??'activate'};await save();
       }
       const intended=state.activationIntent,last=current.history.at(-1);
       if(current.generation===intended.expectedGeneration+1&&current.active===intended.target&&
         last?.generation===current.generation&&last.operation==='activate'&&last.from===intended.beforeActive&&
         last.to===intended.target&&last.reason===intended.reason)
         return {changed:true,state:current,recovered:true};
       need(current.generation===intended.expectedGeneration&&current.active===intended.beforeActive,
         'Continue the recorded activation against its original generation.','DBNOMICS_RELEASE_GENERATION_CHANGED',409);
       return activateDbnomicsRelease(resolve(release.releaseDirectory),release.id,options);
     });
     const current=await readReleaseState(resolve(release.releaseDirectory));
     need(current.active===release.id&&current.generation===activation.state.generation&&
       (release.runOptions?.expectedGeneration===undefined||release.runOptions.expectedGeneration===current.generation),
       'The active merchant selection differs from this original receiving operation.','DBNOMICS_RELEASE_GENERATION_CHANGED',409);
     merchant=await runDbnomicsRelease(resolve(release.releaseDirectory),{...release.runOptions,
       expectedGeneration:current.generation,handleSignals:false});
     need(merchant.mode==='NATIVE_X402','The actual native merchant mode is required.','DBNOMICS_NATIVE_MERCHANT_REQUIRED',409);
     await atomicJson(folder,'merchant-session.json',{url:merchant.url,mode:merchant.mode,releaseId:release.id,startedAt:now()});
     const selection=await step('buyerSelection',async()=>{
       const resource=new URL(release.path??'/data',release.origin).href;
       const offer=await readDatasetBuyerOffer({seller:merchant.url,resource,snapshot:prepared.snapshot,
         query:'limit='+config.pageSize+'&sort=series_id'});
       need(offer.mode==='NATIVE_X402','The actual native Buyer offer is required.');
       const selected=prepareDatasetBuyer(offer,{intentId:config.id,acceptIndex:config.acceptIndex,offerSha256:offer.offerSha256});
       const file=await exactFile(folder,'buyer-config.json',jsonBytes(selected.config));
       return {configFile:join(folder,'buyer-config.json'),configSha256:file.sha256,snapshot:offer.snapshot,url:offer.url,
         offerSha256:offer.offerSha256,accepts:offer.accepts,expectedRows:prepared.rowCount};
     });
     const buyer=await new Buyer(buyerSettings).ready();let dataset=buyer.dataset(config.id);
     async function openOriginal(){
       const original=await optionalJson(join(dataset.directory,'dataset.json'),16*1024*1024);
       if(!original)return false;
       need(original.id===config.id&&original.source?.kind==='config'&&original.expectedSnapshot===prepared.snapshot&&
         canonical(original.limits)===canonical({maxPages:config.maxPages,maxTotalAtomic:config.maxTotalAtomic,
           maxRows:prepared.rowCount,maxPageBytes:config.maxPageBytes}),
         'The existing Dataset session belongs to another original selection.','DBNOMICS_CUSTOMER_SESSION_CHANGED',409);
       const selected=await readJson(selection.configFile,1024*1024);
       need(hash(await readOriginalFile(selection.configFile))===selection.configSha256,'The prepared original Buyer config changed.');
       const expectedProfile=await buyer._profile(selected);
       need(canonical(await readJson(join(dataset.directory,'config.json')))===canonical(expectedProfile),
         'The existing Buyer profile changed.','DBNOMICS_CUSTOMER_PROFILE_CHANGED',409);
       await dataset.initialize({signal});return true;
     }
     if(!await openOriginal()){
       try{dataset=await buyer.createDataset({id:config.id,config:selection.configFile,maxPages:config.maxPages,
         maxTotalAtomic:config.maxTotalAtomic,maxRows:prepared.rowCount,maxPageBytes:config.maxPageBytes,
         expectedSnapshot:prepared.snapshot});}
       catch(error){
         if(error.code!=='DATASET_ALREADY_EXISTS_USE_OPEN')throw error;
         dataset=buyer.dataset(config.id);need(await openOriginal(),'The original Dataset session was not retained.');
       }
     }
     await step('pages',async()=>{
       let result=await dataset.inspect({signal});
       if(result.native.status!=='COMPLETE'){
         need(result.native.status!=='RUNNING','The original Dataset acquisition is still running.','DBNOMICS_CUSTOMER_RUNNING',409);
         result=await dataset.run({signal});
       }
       need(result.native.status==='COMPLETE'&&result.native.snapshot===prepared.snapshot&&result.native.acquiredRows===prepared.rowCount,
         'Continue the original native Dataset session.','DBNOMICS_CUSTOMER_PAGES_PENDING',409);
       return result;
     });
     await step('accounting',async()=>{
       const reports=[];
       for await(const report of dataset.finalizeAll({workspaceDirectory:config.operatorWorkspace,signal})){
         reports.push(report);await atomicJson(folder,'accounting-current.json',{reports});
       }
       const last=reports.at(-1);
       need(last&&!last.native.interrupted&&last.native.range.nextOffset===null&&!last.process.errorCode&&
         reports.flatMap(row=>row.native.entries).every(row=>['FINALIZED','IDEMPOTENT_FINALIZED'].includes(row.outcome)),
         'Continue finalization in the original accounting workspace.','DBNOMICS_CUSTOMER_ACCOUNTING_PENDING',409);
       return {reports};
     });
     await step('delivery',async()=>{
       const delivered=await dataset.deliver(join(folder,'buyer-delivery'),{signal});
       const rows=await delivered.readRows({limit:256*1024*1024,maxRows:1000000,signal});
       const comparedRows=compareRows(rows,expected),companions=[];
       for(const [name,bytes] of [['dbnomics-capture.json',retained.captureBytes],
         ['dbnomics-source-handover.json',jsonBytes(handover)],['dbnomics-source-query.json',jsonBytes(plan.data.sourceQuery)]]){
         companions.push({...await exactFile(join(folder,'buyer-delivery'),name,bytes),path:join(folder,'buyer-delivery',name)});
       }
       return {report:delivered.report,manifest:delivered.manifest,comparedRows,captureSha256:retained.captureSha256,companions};
     });
   }
   const original=await DatasetDelivery.open(state.steps.delivery.report);
   const rows=await original.readRows({limit:256*1024*1024,maxRows:1000000,signal});
   need(original.manifest.dataset.snapshot===prepared.snapshot,'The received native snapshot changed.');
   const comparedRows=compareRows(rows,expected);
   for(const file of state.steps.delivery.companions){
     const body=await readOriginalFile(file.path,256*1024*1024);need(body.length===file.bytes&&hash(body)===file.sha256,'A source companion changed.');
   }
   state.steps.reopen={snapshot:original.manifest.dataset.snapshot,rows:comparedRows,captureSha256:retained.captureSha256};
   state.state='COMPLETE';state.phase='complete';delete state.error;await save();
   print({operation:config.id,state:state.state,rows:comparedRows,checkpoint:join(folder,'customer.json')});
   return {id:config.id,state:state.state,checkpoint:join(folder,'customer.json'),snapshot:prepared.snapshot,
     rows:comparedRows,delivery:state.steps.delivery,accounting:state.steps.accounting,reopen:state.steps.reopen};
 }catch(error){
   state.state='CONTINUE_ORIGINAL_OPERATION';state.error={code:error.code??'DBNOMICS_CUSTOMER_INTERRUPTED',message:error.message,at:now()};
   await save();throw error;
 }finally{await merchant?.close();}
}

// MIT. Resumable original source -> publisher -> SF82 -> SF88 -> SF100 receiving.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { bytes,digest,identity,readJson,readPrivate,createFile,atomicJson,privateDirectory,stamp } from '../postgres/publisher/files.mjs';
import { openEurostatWorkspace } from './workspace.mjs';
import { readOriginalFile } from './source.mjs';
import { need,object,stable,cellRow,selectedCellIndexes,normalizeQuery } from './model.mjs';
import { prepareEurostatRelease,stageEurostatRelease,activateEurostatRelease,runEurostatRelease } from './release.mjs';
import { readDatasetBuyerOffer,prepareDatasetBuyer } from '../dataset-refresh/buyer-handoff.mjs';
import { Buyer,DatasetDelivery } from '../../sf88-operator-buyer-cli/node/index.mjs';
async function optional(path){try{return await readJson(path,8*1024*1024);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function exactFile(directory,name,content){
  const path=join(directory,name);
  try{await createFile(path,content);}catch(e){if(e.code!=='EEXIST')throw e;need((await readPrivate(path,Math.max(1,content.length))).equals(content),'EUROSTAT_RECEIVER_ARTIFACT_CHANGED');}
  return {path,bytes:content.length,sha256:digest(content)};
}
export async function receiveEurostat({directory,config,signal,print=()=>{}}={}){
  need(config?.schema==='stellar-forge.eurostat-receiving-config.v1'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,69}$/.test(config.id??''),
    'EUROSTAT_RECEIVING_CONFIG');
  need(object(config.source)&&object(config.query)&&object(config.publication)&&object(config.release)&&object(config.buyer),'EUROSTAT_RECEIVING_CONFIG');
  need(Number.isSafeInteger(config.pageSize)&&config.pageSize>=1&&config.pageSize<=1000,'EUROSTAT_RECEIVING_PAGE_SIZE');
  const sourceBody=await readOriginalFile(resolve(config.source.file));
  const buyerSettings=await readJson(resolve(config.buyer.configFile),131072);
  const bound={...config,source:{...config.source,file:resolve(config.source.file),bytes:sourceBody.length,sha256:digest(sourceBody)},
    buyer:{...config.buyer,configFile:resolve(config.buyer.configFile),configSha256:identity(buyerSettings)}};
  const workspace=await openEurostatWorkspace({directory:resolve(directory),create:true,targetDirectory:config.targetDirectory});
  const folder=join(workspace.directory,'receivers',config.id);await privateDirectory(folder,true);
  let state=await optional(join(folder,'receiver.json'));
  if(state)need(state.schema==='stellar-forge.eurostat-receiving.v1'&&state.configurationSha256===identity(bound)&&
    identity(state.configuration)===identity(bound),'EUROSTAT_RECEIVING_SELECTION_CHANGED');
  else {state={schema:'stellar-forge.eurostat-receiving.v1',id:config.id,configuration:bound,configurationSha256:identity(bound),
    runId:randomUUID(),createdAt:stamp(),state:'READY',steps:{}};await atomicJson(folder,'receiver.json',state);}
  const save=async()=>{state.updatedAt=stamp();await atomicJson(folder,'receiver.json',state);};
  const step=async(name,fn)=>{
    if(state.steps[name])return state.steps[name];need(!signal?.aborted,'EUROSTAT_RECEIVING_INTERRUPTED');
    state.phase=name;state.state='RUNNING';await save();print({operation:state.id,phase:name,runId:state.runId,checkpoint:join(folder,'receiver.json')});
    const result=await fn();state.steps[name]=result;await save();return result;
  };
  let merchant;
  try{
    const imported=await step('source',()=>workspace.importCapture({body:sourceBody,sourceUrl:config.source.sourceUrl,
      retrievedAt:config.source.retrievedAt,transport:config.source.transport??{kind:'operator-retained-original',httpStatus:null}}));
    const captured=await workspace.capture(imported.capture.id);
    const sourceQuery={captureId:captured.capture.id,selection:config.query.selection??{},includeMissing:config.query.includeMissing??true,
      review:config.query.review};
    await step('sourceReview',async()=>{
      const s=await workspace.publisher.source(),q=s.config.queries[config.query.name];
      if(q){need(stable(q)===stable(normalizeQuery(sourceQuery,captured.cube)),'EUROSTAT_RECEIVING_QUERY_CHANGED');return {name:config.query.name,query:q,reused:true};}
      return workspace.saveQuery({name:config.query.name,query:sourceQuery,expectedHash:s.hash});
    });
    await step('briefing',async()=>{
      const r=await workspace.briefing(captured.capture.id,sourceQuery);
      const dest=join(folder,'economic-briefing');await privateDirectory(dest,true);
      const files=[];
      for(const [name,content]of [['briefing.html',Buffer.from(r.html)],['briefing.json',bytes(r.report)],
        ['observations.csv',Buffer.from(r.csv)],['original-response.json',captured.body]])
        files.push(await exactFile(dest,name,content));
      return {directory:dest,rows:r.report.rows,series:r.report.comparisons.length,files};
    });
    const planned=await step('plan',async()=>{
      const input=await workspace.planTemplate({query:config.query.name,title:config.id,name:config.title??'Eurostat unemployment edition'});
      input.dataset.defaultLimit=Math.min(50,config.pageSize);input.dataset.maxLimit=config.pageSize;
      const matches=[];let offset=0;
      while(true){const page=workspace.publisher.status({limit:100,plansOffset:offset});
        for(const p of page.plans)if(p.data?.title===config.id&&p.data.query===config.query.name&&
          p.data.retainedCapture?.captureId===captured.capture.id&&p.data.dataset.maxLimit===config.pageSize)matches.push(p);
        if(page.plans.length<100)break;offset+=page.plans.length;
      }
      need(matches.length<=1,'EUROSTAT_RECEIVING_PLAN_SELECTION');return matches[0]??workspace.publisher.savePlan(input);
    });
    await step('extraction',async()=>{
      let run;try{run=workspace.publisher.run(state.runId);}catch(e){if(e.code!=='RUN_NOT_FOUND')throw e;}
      if(!run)run=await workspace.publisher.startExtraction(planned.id,{id:state.runId}).completion;
      need(['READY','REVIEWED','PUBLISHED'].includes(run.state),'EUROSTAT_ORIGINAL_EXTRACTION_PENDING',run.error??'Continue the original extraction result.',409);
      return {runId:run.id,state:run.state};
    });
    await step('publication',async()=>{
      let run=workspace.publisher.run(state.runId);
      if(run.state==='PUBLICATION_UNKNOWN'){await workspace.publisher.recover(state.runId);run=workspace.publisher.run(state.runId);}
      if(run.state==='PUBLISHED')return run.data.publication;
      const target=await workspace.publisher.target();
      const review=await workspace.publisher.review(state.runId,{...config.publication,
        initialize:target.initializable===true,
        ...(target.connected?{expectedSnapshot:target.versions.current,expectedRevision:target.versions.revision}:{})});
      const result=await workspace.publisher.publish(state.runId,review.data.review.id);
      run=workspace.publisher.run(state.runId);need(run.state==='PUBLISHED','EUROSTAT_ORIGINAL_PUBLICATION_PENDING',undefined,409);
      return run.data.publication??result;
    });
    const prepared=await step('releasePackage',()=>prepareEurostatRelease({publisher:workspace.publisher,runId:state.runId,
      outputDirectory:resolve(config.release.outputDirectory),payment:config.release.payment,origin:config.release.origin,path:config.release.path??'/data'}));
    await step('releaseStage',()=>stageEurostatRelease({packageDirectory:prepared.directory,
      releaseDirectory:resolve(config.release.releaseDirectory),id:config.release.id,label:config.release.label??config.release.id,runtime:config.release.runtime}));
    await step('releaseActivation',()=>activateEurostatRelease(resolve(config.release.releaseDirectory),config.release.id,config.release.activationOptions));
    const buyer=await new Buyer(buyerSettings).ready();
    let dataset=buyer.dataset(config.buyer.id);
    if(!state.steps.delivery){
      merchant=await runEurostatRelease(resolve(config.release.releaseDirectory),{handleSignals:false,...config.release.runOptions});
      need(merchant.mode==='NATIVE_X402','EUROSTAT_NATIVE_MERCHANT_REQUIRED');
      await atomicJson(folder,'merchant-session.json',{url:merchant.url,mode:merchant.mode,releaseId:config.release.id,startedAt:stamp()});
      const acquisition=await step('buyerSelection',async()=>{
        const resource=new URL(config.release.path??'/data',config.release.origin).href;
        const offer=await readDatasetBuyerOffer({seller:merchant.url,resource,snapshot:prepared.snapshot,query:'limit='+config.pageSize+'&sort=cell_index'});
        need(offer.mode==='NATIVE_X402','EUROSTAT_NATIVE_BUYER_REQUIRED');
        const selected=prepareDatasetBuyer(offer,{intentId:config.buyer.id,acceptIndex:config.buyer.acceptIndex??0,offerSha256:offer.offerSha256});
        const file=await exactFile(folder,'buyer-config.json',bytes(selected.config));
        return {configFile:file.path,configSha256:file.sha256,snapshot:offer.snapshot,url:offer.url,offerSha256:offer.offerSha256,
          accepts:offer.accepts,expectedRows:prepared.rowCount};
      });
      const entry=await optional(join(dataset.directory,'dataset.json'));
      const existing=entry!==null;
      if(existing){
        need(entry.id===config.buyer.id&&entry.source?.kind==='config'&&entry.expectedSnapshot===prepared.snapshot&&
          stable(entry.limits)===stable({maxPages:config.buyer.maxPages,maxTotalAtomic:config.buyer.maxTotalAtomic,
            maxRows:prepared.rowCount,maxPageBytes:config.buyer.maxPageBytes??1048576}),'EUROSTAT_ORIGINAL_BUYER_BINDING_CHANGED');
        const expected=await buyer._profile(await readJson(acquisition.configFile));
        need(stable(await readJson(join(dataset.directory,'config.json')))===stable(expected),'EUROSTAT_ORIGINAL_BUYER_CONFIG_CHANGED');
        await dataset.initialize({signal});
      }
      if(!existing){
        try{dataset=await buyer.createDataset({id:config.buyer.id,config:acquisition.configFile,maxPages:config.buyer.maxPages,
          maxTotalAtomic:config.buyer.maxTotalAtomic,maxRows:prepared.rowCount,maxPageBytes:config.buyer.maxPageBytes??1048576,
          expectedSnapshot:prepared.snapshot});}
        catch(e){if(e.code!=='DATASET_ALREADY_EXISTS_USE_OPEN')throw e;dataset=buyer.dataset(config.buyer.id);await dataset.initialize({signal});}
      }
      await step('buyerPages',async()=>{
        let result=await dataset.inspect({signal});
        if(result.native.status!=='COMPLETE'){
          if(result.native.status==='RUNNING')throw Object.assign(new Error('The original native acquisition is still running.'),{code:'EUROSTAT_BUYER_RUNNING'});
          result=await dataset.run({signal});
        }
        need(result.native.status==='COMPLETE'&&result.native.snapshot===prepared.snapshot&&
          result.native.acquiredRows===prepared.rowCount,'EUROSTAT_ORIGINAL_BUYER_PENDING','Continue this original native dataset session.',409);
        return result;
      });
      await step('accounting',async()=>{
        const reports=[];for await(const r of dataset.finalizeAll({workspaceDirectory:resolve(config.buyer.operatorWorkspace),signal})){
          reports.push(r);await atomicJson(folder,'accounting-current.json',{reports});
        }
        const last=reports.at(-1);
        need(last&&!last.native.interrupted&&last.native.range.nextOffset===null&&!last.process.errorCode&&
          reports.flatMap(x=>x.native.entries).every(e=>['FINALIZED','IDEMPOTENT_FINALIZED'].includes(e.outcome)),
          'EUROSTAT_ORIGINAL_ACCOUNTING_PENDING');
        return {reports};
      });
      await step('delivery',async()=>{
        const delivered=await dataset.deliver(join(folder,'buyer-delivery'),{signal});
        const rows=await delivered.readRows({limit:256*1024*1024,maxRows:250000,signal});
        const indexes=selectedCellIndexes(captured.cube,config.query.selection??{},{includeMissing:config.query.includeMissing??true});
        need(rows.length===indexes.length,'EUROSTAT_DELIVERY_ROW_COUNT');
        for(let i=0;i<rows.length;i++){const expected=cellRow(captured.cube,indexes[i]);expected.cell_index=Number(expected.cell_index);
          need(stable(rows[i])===stable(expected),'EUROSTAT_DELIVERED_SOURCE_CHANGED');}
        await exactFile(join(folder,'buyer-delivery'),'eurostat-original-response.json',captured.body);
        await exactFile(join(folder,'buyer-delivery'),'eurostat-source-review.json',bytes(captured.capture));
        await exactFile(join(folder,'buyer-delivery'),'eurostat-source-handover.json',bytes(await workspace.exportSources()));
        return {report:delivered.report,manifest:delivered.manifest,comparedRows:rows.length,
          originalResponseSha256:captured.capture.response.sha256};
      });
    }
    await step('reopen',async()=>{
      const original=await DatasetDelivery.open(state.steps.delivery.report);
      const r=await original.readRows({limit:256*1024*1024,maxRows:250000,signal});
      return {rows:r.length,snapshot:original.manifest.dataset.snapshot,originalResponseSha256:digest(captured.body)};
    });
    state.state='COMPLETE';state.phase='complete';delete state.error;await save();print(state);
    return state;
  }catch(e){state.state='CONTINUE_ORIGINAL_OPERATION';state.error={code:e.code??'EUROSTAT_RECEIVING_INTERRUPTED',message:e.message,at:stamp()};
    await save();print({operation:state.id,phase:state.phase,error:state.error,checkpoint:join(folder,'receiver.json')});throw e;
  }finally{try{await merchant?.close();}finally{await workspace.close();}}
}

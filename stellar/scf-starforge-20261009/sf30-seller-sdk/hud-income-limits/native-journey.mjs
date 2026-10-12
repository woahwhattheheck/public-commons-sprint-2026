// MIT. One source-native operator journey over an existing public HUD capture.
// Invoke once through the host's accepted operation; preserve this workspace on
// failure and continue its recorded phase through the original application APIs.
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile,lstat } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { createHash } from 'node:crypto';
import { openHudApplication } from './application.mjs';
import { startHudServer } from './server.mjs';
import { openHudSourcePacket } from './release.mjs';
import { datasetControl } from '../dataset-refresh/service.mjs';
import { init as initDelivery,append as appendDelivery,finalize as finalizeDelivery } from '../../sf100-buyer-dataset-delivery/deliver.mjs';

const options={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  if(!['--capture-dir','--workspace','--output','--python'].includes(key)||!value||options[key])throw new TypeError('Use --capture-dir DIR --workspace NEW_DIR --output NEW_DIR [--python python3].');
  options[key]=value;
}
for(const key of ['--capture-dir','--workspace','--output'])if(!options[key])throw new TypeError(key+' is required.');
const directory=resolve(options['--workspace']),output=resolve(options['--output']),captures=resolve(options['--capture-dir']);
if(directory===output||directory===captures||output===captures)throw new TypeError('Keep source, native workspace and result directories distinct.');
const exists=async path=>{try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
if(await exists(directory)||await exists(output))throw new TypeError('This first operation requires new workspace/result directories. Continue any retained run from its progress.json and original workspace.');
await mkdir(output,{mode:0o700});
const report={schema:'stellar-forge.hud-native-journey.v1',startedAt:new Date().toISOString(),directory,output,captures,
  sourceContract:'Original HUD Section 8 FY2026 national workbook and HTTP captures',
  paymentMode:'Original CHALLENGE_ONLY seller; source pages use its authenticated private dataset controller',
  phases:[],activePhase:null};
const hash=b=>createHash('sha256').update(b).digest('hex');
const save=()=>writeFile(join(output,'progress.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
const phase=async(name,operation)=>{
  report.activePhase=name;await save();
  const result=await operation();report.phases.push({name,completedAt:new Date().toISOString(),...result});await save();
  process.stdout.write(JSON.stringify({name,...result})+'\n');return result;
};
let app,server,receiver;
try{
  app=await openHudApplication({directory,create:true,python:options['--python']??'python3'});
  const intake=await phase('retain the original national release',async()=>{
    const result=await app.importRelease({fiscalYear:2026,effectiveDate:'2026-05-01',reviewer:'HUD source operation',
      note:'Published FY2026 Section 8 Excel with original area definitions, methodology, index and HTTP captures.'},{sourceDirectory:captures});
    assert.equal(result.release.workbookSha256,'bbadf0a080112fc1492c7752692c041c6a4299aad0173873b732c3f892d9aee0');
    assert.equal(result.release.localities,4764);
    return {releaseId:result.release.releaseId,localities:result.release.localities,counties:result.release.counties,
      hudAreas:result.release.hudAreas,workbookSha256:result.release.workbookSha256};
  });
  let primary,runA,runB,snapshotA,snapshotB,firstPage,queryA;
  await phase('preserve original locality and cell identity',async()=>{
    const before=await app.status();
    await app.select({expectedRevision:before.revision,releaseId:intake.releaseId,selection:{counties:['17143','17179','17203']}});
    primary=await app.exportSelection();
    assert.equal(primary.rowCount,75);
    assert.equal(new Set(primary.observations.map(x=>x.locality_id)).size,3);
    for(const row of primary.observations){
      assert.equal(Number(row.source_value),row.published_income_usd);
      assert.match(row.source_cell,/^[A-Z]{1,2}[1-9][0-9]+$/);
      assert.equal(row.workbook_sha256,intake.workbookSha256);
      assert.equal(row.fiscal_year,2026);
      assert.equal(row.family_size===null,row.metric==='median_family_income');
    }
    const [county,count]=Object.entries(primary.release.projection.multiLocalityCounties)[0];
    assert.ok(count>1);
    const divided=await app.localities({selection:{counties:[county]},limit:100});
    assert.equal(divided.total,count);
    const self=await app.comparison({before:intake.releaseId,after:intake.releaseId});
    assert.deepEqual(self.counts,{added:0,removed:0,changed:0,unchanged:75});
    await writeFile(join(output,'public-selection.json'),JSON.stringify(primary,null,2)+'\n',{flag:'wx',mode:0o600});
    return {selectedCounties:['17143','17179','17203'],observations:75,localities:3,
      multiLocalityCounty:county,originalLocalities:count,firstCell:primary.observations[0].source_cell,
      firstPublishedValue:primary.observations[0].source_value};
  });
  async function extract(title){
    const plan=await app.savePlan({expectedRevision:(await app.status()).revision,title});
    const running=await app.extract(plan.id),completed=await running.completion;
    assert.equal(completed.state,'READY',JSON.stringify(completed));
    return running.id;
  }
  await phase('publish first complete selection and prepare the original buyer',async()=>{
    runA=await extract('FY2026 Peoria Tazewell Woodford original locality values');
    const reviewed=await app.operate('review',{id:runA,initialize:true,reviewer:'HUD source operation',
      note:'Exact 75 published observations for the three selected original counties and all family sizes.'});
    const published=await app.operate('publish',{id:runA,reviewId:reviewed.data.review.id});
    assert.equal(published.state,'PUBLISHED',JSON.stringify(published));snapshotA=published.data.publication.snapshot;
    await app.configureMerchant({expectedRevision:(await app.status()).revision,runId:runA,origin:'https://hud-native.example',
      path:'/hud/income-limits',port:0,payment:{scheme:'exact',network:'stellar:testnet',asset:'LOCAL_EXERCISE_ASSET',
      payTo:'LOCAL_EXERCISE_RECIPIENT',amount:'100',maxTimeoutSeconds:60}});
    const merchant=await app.startMerchant();assert.equal(merchant.mode,'CHALLENGE_ONLY');
    const challenge=await fetch(merchant.url+'/hud/income-limits?limit=20');assert.equal(challenge.status,402);await challenge.arrayBuffer();
    const publisher=await app.publisher(),offer=await publisher.buyerOffer(runA,'limit=20&sort=locality_id');
    const prepared=await app.operate('prepareBuyer',{id:runA,query:'limit=20&sort=locality_id',
      intentId:'hud-native-source-selection',acceptIndex:0,offerSha256:offer.offerSha256});
    assert.equal(prepared.snapshot,snapshotA);assert.equal(prepared.hud.rowCount,75);
    assert.equal(prepared.configText.includes(snapshotA),true);
    await writeFile(join(output,'original-sf88-buyer.json'),prepared.configText,{flag:'wx',mode:0o600});
    queryA=new URLSearchParams({limit:'20',sort:'locality_id',snapshot:snapshotA});
    firstPage=await datasetControl(app.targetDirectory,'preview',{query:queryA.toString()});
    assert.equal(firstPage.dataset.snapshot,snapshotA);assert.equal(firstPage.rows.length,20);assert.ok(firstPage.page.nextCursor);
    return {runId:runA,snapshot:snapshotA,rows:75,mode:merchant.mode,httpChallenge:challenge.status,
      sf88ConfigSha256:prepared.configSha256,firstPageRows:firstPage.rows.length};
  });
  await phase('refresh a distinct complete selection while retaining the first snapshot',async()=>{
    await app.select({expectedRevision:(await app.status()).revision,releaseId:intake.releaseId,
      selection:{counties:['17143','17179']}});
    runB=await extract('FY2026 Peoria Tazewell original locality values');
    const target=await(await app.publisher()).target();
    const reviewed=await app.operate('review',{id:runB,expectedSnapshot:target.versions.current,
      expectedRevision:target.versions.revision,reviewer:'HUD source operation',note:'Exact 50 published observations; retain the existing query contract.'});
    const published=await app.operate('publish',{id:runB,reviewId:reviewed.data.review.id});
    assert.equal(published.state,'PUBLISHED',JSON.stringify(published));snapshotB=published.data.publication.snapshot;
    assert.notEqual(snapshotA,snapshotB);
    const continued=new URLSearchParams(queryA);continued.set('cursor',firstPage.page.nextCursor);
    const second=await datasetControl(app.targetDirectory,'preview',{query:continued.toString()});
    assert.equal(second.dataset.snapshot,snapshotA);assert.equal(second.rows.length,20);
    const current=await datasetControl(app.targetDirectory,'preview',{query:'limit=20'});
    assert.equal(current.dataset.snapshot,snapshotB);assert.equal(current.dataset.rowCount,50);
    return {runId:runB,snapshot:snapshotB,rows:50,retainedSnapshot:snapshotA,retainedCursorRows:second.rows.length};
  });
  await phase('complete original source-page receiving through SF100',async()=>{
    const delivery=join(output,'source-page-delivery');await initDelivery(delivery);
    let cursor=null,index=0,rows=0;
    do{
      const query=new URLSearchParams(queryA);if(cursor)query.set('cursor',cursor);
      const page=await datasetControl(app.targetDirectory,'preview',{query:query.toString()});
      assert.equal(page.dataset.snapshot,snapshotA);rows+=page.rows.length;
      const path=join(output,'source-page-'+index+'.json'),evidence=join(output,'source-page-'+index+'-context.json');
      const raw=Buffer.from(JSON.stringify(page)+'\n');await writeFile(path,raw,{flag:'wx',mode:0o600});
      await writeFile(evidence,JSON.stringify({kind:'ORIGINAL_PRIVATE_DATASET_PREVIEW',snapshot:snapshotA,
        requestQuery:query.toString(),sha256:hash(raw)})+'\n',{flag:'wx',mode:0o600});
      await appendDelivery(delivery,{page:path,intent:'hud-source-preview-'+index,evidence,...(cursor?{cursor}:{})});
      cursor=page.page.nextCursor;index++;assert.ok(index<=10);
    }while(cursor!==null);
    const finalized=await finalizeDelivery(delivery);
    assert.equal(rows,75);
    const delivered=(await readFile(join(delivery,'dataset.jsonl'),'utf8')).trimEnd().split('\n').map(line=>JSON.parse(line));
    assert.equal(delivered.length,75);
    const keyed=new Map(primary.observations.map(row=>[row.locality_id+'|'+row.metric+'|'+(row.family_size??''),row]));
    for(const row of delivered)assert.deepEqual(row,keyed.get(row.locality_id+'|'+row.metric+'|'+(row.family_size??'')));
    return {pages:index,rows,sourceMode:'authenticated original operator preview',finalized,
      csvSha256:hash(await readFile(join(delivery,'dataset.csv')))};
  });
  await phase('stage, run, switch and roll back the shared SF82 dataset releases',async()=>{
    const target=await(await app.publisher()).target();
    await app.activate({snapshot:snapshotA,expectedSnapshot:target.versions.current,expectedRevision:target.versions.revision});
    await app.stopMerchant();
    await app.releaseLifecycle('stage',{runId:runA,id:'hud-initial',label:'Three original counties',runtime:{port:0}});
    await app.releaseLifecycle('stage',{runId:runB,id:'hud-selected',label:'Two original counties',runtime:{port:0}});
    let status=await app.releaseLifecycle('status');
    await app.releaseLifecycle('activate',{id:'hud-initial',expectedGeneration:status.state.generation});
    const initial=await app.releaseLifecycle('start');
    const challenge=await fetch(initial.url+'/hud/income-limits?limit=20');assert.equal(challenge.status,402);await challenge.arrayBuffer();
    assert.equal((await datasetControl(app.targetDirectory,'preview',{query:'limit=20'})).dataset.snapshot,snapshotA);
    await app.releaseLifecycle('stop');
    status=await app.releaseLifecycle('status');
    await app.releaseLifecycle('activate',{id:'hud-selected',expectedGeneration:status.state.generation});
    const selected=await app.releaseLifecycle('start');
    const selectedChallenge=await fetch(selected.url+'/hud/income-limits?limit=20');
    assert.equal(selectedChallenge.status,402);await selectedChallenge.arrayBuffer();
    // Seller release and dataset activation remain distinct original controllers.
    assert.equal((await datasetControl(app.targetDirectory,'preview',{query:'limit=20'})).dataset.snapshot,snapshotA);
    await app.releaseLifecycle('stop');status=await app.releaseLifecycle('status');
    await app.releaseLifecycle('rollback',{to:'hud-initial',expectedGeneration:status.state.generation});
    status=await app.releaseLifecycle('status');assert.equal(status.state.active,'hud-initial');assert.equal(status.runtime.state,'STOPPED');
    return {releases:['hud-initial','hud-selected'],modes:[initial.mode,selected.mode],httpChallenges:[402,402],
      active:status.state.active,generation:status.state.generation,runtime:status.runtime.state,datasetSnapshot:snapshotA};
  });
  await phase('transfer exact public sources and reopen the retained application',async()=>{
    const packet=await app.sourcePacket();
    await writeFile(join(output,'hud-public-source-packet.json'),JSON.stringify(packet)+'\n',{flag:'wx',mode:0o600});
    const opened=openHudSourcePacket(packet);
    receiver=await openHudApplication({directory:join(output,'receiver'),create:true,python:options['--python']??'python3'});
    const received=await receiver.importRelease(opened.metadata,{uploads:opened.uploads});
    assert.equal(received.release.releaseId,intake.releaseId);
    await receiver.select({expectedRevision:(await receiver.status()).revision,releaseId:intake.releaseId,
      selection:{counties:['17143','17179','17203']}});
    assert.deepEqual((await receiver.exportSelection()).observations,primary.observations);
    await receiver.close();receiver=null;
    await app.close();app=await openHudApplication({directory,python:options['--python']??'python3'});
    const reopened=await app.status();assert.equal(reopened.selectedRelease,intake.releaseId);
    assert.deepEqual(reopened.selection.counties,['17143','17179']);
    const handoff=await app.publicationHandoff(runA);assert.equal(handoff.candidate.snapshot,snapshotA);
    assert.equal(handoff.source.rowCount,75);
    await writeFile(join(output,'publication-handoff.json'),JSON.stringify(handoff,null,2)+'\n',{flag:'wx',mode:0o600});
    server=await startHudServer({application:app,port:0});
    assert.equal((await fetch(server.url+'/api/status')).status,403);
    const state=await fetch(server.url+'/api/status',{headers:{authorization:'Bearer '+server.token}});
    assert.equal(state.status,200);assert.equal((await state.json()).selectedRelease,intake.releaseId);
    for(const path of ['/','/browser.mjs','/style.css']){
      const asset=await fetch(server.url+path);assert.equal(asset.status,200);assert.ok((await asset.arrayBuffer()).byteLength>100);
    }
    const downloaded=await fetch(server.url+'/api/source-packet',{headers:{authorization:'Bearer '+server.token}});
    assert.equal(downloaded.status,200);assert.equal((await downloaded.json()).release.releaseId,intake.releaseId);
    await server.close();server=null;app=null;
    return {releaseId:intake.releaseId,originalDocuments:4,originalReceipts:4,receiverObservations:75,
      retainedRuns:[runA,runB],originalSnapshot:snapshotA,sourceSelection:['17143','17179'],
      authenticatedDeskStatus:200,unauthenticatedDeskStatus:403,servedAssets:3};
  });
  report.activePhase=null;report.completedAt=new Date().toISOString();report.state='COMPLETED';await save();
  await writeFile(join(output,'native-result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
}catch(error){
  report.state='FAILED';report.error={code:error.code??error.name,message:error.message,stack:error.stack};
  await save();process.stderr.write(JSON.stringify(report.error)+'\n');process.exitCode=1;
}finally{
  await receiver?.close().catch(()=>{});if(server)await server.close().catch(()=>{});else await app?.close().catch(()=>{});
}

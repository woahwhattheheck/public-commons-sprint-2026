// MIT. Complete the original interrupted WQX customer stage from its retained SF88 journal.
import assert from 'node:assert/strict';
import { readFile, lstat, realpath, readdir, mkdir, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { privateDirectory, readPrivateJson, atomicJson, withPrivateLock } from '../routescan/quota.mjs';
import { readBytes, writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';
import { canonicalJson, normalizeSelection, readCapture } from './provider.mjs';
import { joinCapture } from './samples.mjs';
import { summarizeWaterQuality } from './analysis.mjs';
import { openWaterQualityProject } from './project.mjs';
import { readQualityEdition, startQualityMerchant, qualityMerchantStatus, prepareQualityPurchase,
  resumeQualityPurchase, reopenQualityPurchase, exportQualityPurchase } from './merchant.mjs';
import { localFacilitator, localMerchantTransport } from './journey.mjs';
import { writeWaterQualityNativeCheckpoint } from './browser-resume.mjs';

const JOURNEY='starforge.wqx-water-quality-journey.v1';
const NATIVE='starforge.wqx-water-quality-native-complete.v1';
const CAPTURE='cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7';
const REVIEW='march-versus-january', EDITION='potomac-q1-water-quality', ROWS=1035;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const valueHash=value=>hash(canonicalJson(value));
const equal=(a,b,message)=>assert.equal(canonicalJson(a),canonicalJson(b),message);
const publicError=error=>({code:error?.code??error?.name??'WQX_NATIVE_RESUME_FAILED',
  message:String(error?.message??error).slice(0,1400),
  ...(error?.intentId?{intentId:error.intentId}:{}),
  ...(error?.inspection?{inspection:error.inspection}:{})});

async function optional(path,limit=1048576){
  try{return await readPrivateJson(path,limit);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function exists(path){
  try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function retainedBytes(path,limit=128*1048576){
  const info=await lstat(path);
  assert(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&await realpath(path)===path,
    'Use the original private regular source file: '+path);
  assert(info.size<=limit,'The retained member exceeds its source limit.');
  if(process.platform!=='win32')assert((info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid()),
    'The retained member must keep its original private ownership.');
  return readBytes(path,limit);
}
async function keepBytes(path,bytes){
  await privateDirectory(dirname(path));
  const prior=await exists(path);
  if(prior){const original=await retainedBytes(path,bytes.length);assert.deepEqual(original,bytes,
    'An existing original export differs: '+path);return false;}
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await retainedBytes(path,bytes.length),bytes);}
  return true;
}
async function copyOriginalTree(source,target){
  assert(await realpath(source)===source,'The original edition directory must not be a link.');
  await privateDirectory(target);
  for(const item of (await readdir(source,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const from=join(source,item.name),to=join(target,item.name);
    assert(!item.isSymbolicLink(),'An original edition member became a link.');
    if(item.isDirectory())await copyOriginalTree(from,to);
    else{assert(item.isFile(),'An original edition member changed type.');await keepBytes(to,await retainedBytes(from));}
  }
}
async function originalConfiguration(root){
  const config=await readPrivateJson(join(root,'local-fixture','buyer-config.json'));
  const profile=config.operatorProfile, fixture=join(root,'local-fixture');
  assert(config.stateDirectory===join(root,'buyer')&&typeof config.runtimeDirectory==='string',
    'Use the original SF88 runtime and buyer directory.');
  assert(profile?.operator?.actor==='wqx-journey'&&profile.operator.service==='wqx-water-quality'&&
    profile.operator.policy===join(fixture,'policy.json')&&profile.operator.ledger===join(fixture,'ledger.sqlite')&&
    profile.signerModule===join(fixture,'signer.mjs'),'Use the original local fixture operator, policy and ledger.');
  assert(profile.buyerTransport?.mode==='explicit-connect'&&profile.buyerTransport.origin==='https://wqx-journey.example',
    'Use the original owned WQX transport.');
  assert(config.environment?.NODE_EXTRA_CA_CERTS===join(fixture,'merchant-cert.pem'),'Use the original fixture certificate.');
  for(const name of ['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64']){
    const value=config.environment[name];
    assert(typeof value==='string'&&Buffer.from(value,'base64').length===32&&Buffer.from(value,'base64').toString('base64')===value,
      'The original fixture key is missing or changed.');
  }
  for(const file of ['policy.json','signer.mjs','merchant-key.pem','merchant-cert.pem'])
    await retainedBytes(join(fixture,file),1048576);
  const ledger=await exists(join(fixture,'ledger.sqlite'));
  assert(ledger?.isFile()&&!ledger.isSymbolicLink(),'Keep the original SF36 ledger.');
  return config;
}
function checkNative(checkpoint,root,config,snapshot,pageSize){
  assert(checkpoint.schema===NATIVE&&checkpoint.status==='NATIVE_COMPLETE'&&checkpoint.directory===root&&
    checkpoint.buyerConfigurationSha256===valueHash(config)&&checkpoint.resultSha256===valueHash(checkpoint.result),
    'The original native checkpoint binding changed.');
  equal(checkpoint.projectSnapshot,snapshot,'The original native project revision changed.');
  const result=checkpoint.result;
  assert(result.schema===JOURNEY&&result.status==='PASS'&&result.directory===root&&
    result.source?.captureSha256===CAPTURE&&result.source.observations===ROWS&&result.source.sourceRequests===0&&
    result.source.authoringCaptureRestored===true&&result.analysis?.reviewId===REVIEW&&result.edition?.rowCount===ROWS&&
    result.commerce?.deliveredResults===ROWS&&result.commerce.pages?.length===Math.ceil(ROWS/pageSize)&&
    result.commerce.purchases===Math.ceil(ROWS/pageSize)+2,'Complete all original native deliveries before browser receiving.');
  return result;
}

/** Recover completed requests and continue only the original sequence's unattempted requests.
 * Existing native attempts use Operation.recover(); uncertain attempts retain their original
 * wire/output checkpoint and are surfaced to the original operator, never resent here. */
export async function resumeWaterQualityNative({directory,pageSize=25,deferBrowser=false,signal}={}){
  const root=resolve(directory),info=await lstat(root);
  assert(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(root)===root,'Select the original journey directory.');
  await privateDirectory(root);
  assert(Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=100);
  return withPrivateLock(root,'native-resume.lock',async()=>{
    let project,receiver,facilitator,merchant,transport,stage='retained-operation',relocated=null,restoreTo=null;
    let sourceRequests=0,executed=0,recovered=0;
    const originalOnly={async request(){sourceRequests++;throw new Error('Continue from the retained original WQX capture.');}};
    const exportsDirectory=join(root,'exports'), fixture=join(root,'local-fixture');
    const progress=async extra=>{
      await atomicJson(root,'native-resume-progress.json',{schema:'starforge.wqx-native-resume-progress.v1',
        directory:root,at:new Date().toISOString(),stage,executed,recovered,...extra});
      process.stdout.write(JSON.stringify({stage,executed,recovered,...extra})+'\n');
    };
    try{
      signal?.throwIfAborted();
      const operation=await readPrivateJson(join(root,'journey-operation.json'));
      assert(operation.schema===JOURNEY&&operation.commerce==='ORIGINAL_LOCAL_PROTOCOL_FIXTURE',
        'Select the original local WQX operation.');
      if(operation.pageSize!==undefined)assert.equal(pageSize,operation.pageSize,'Keep the original page size.');
      const snapshot=await readPrivateJson(join(root,'project','revisions','1.json'));
      assert(snapshot.revision===1&&valueHash(snapshot.selection)===snapshot.selectionSha256,'The original project revision changed.');
      equal(snapshot.selection,normalizeSelection(operation.selection),'The original source selection changed.');
      const config=await originalConfiguration(root), checkpoint=await optional(join(root,'native-result.json'),16*1048576);
      if(checkpoint){
        const result=checkNative(checkpoint,root,config,snapshot,pageSize);
        if(!deferBrowser&&!await optional(join(root,'result.json'),16*1048576))await atomicJson(root,'result.json',result);
        return result;
      }
      project=await openWaterQualityProject(join(root,'project'),{transport:originalOnly});
      const review=await project.readReview(REVIEW);
      equal(review.requestedOptions,operation.reviewOptions,'Keep the original saved scientific decision.');
      restoreTo=join(root,'project','captures',review.captureId);
      const priorRelocated=join(root,'relocated-source-capture');
      if(!await exists(restoreTo)&&await exists(priorRelocated)){
        assert.equal((await readCapture(priorRelocated)).captureSha256,CAPTURE);
        await rename(priorRelocated,restoreTo);
      }
      const capture=await project.capture(review.captureId),edition=await project.readEdition(EDITION);
      assert(capture.status==='COMPLETE'&&capture.captureSha256===CAPTURE&&review.captureSha256===CAPTURE&&
        edition.captureSha256===CAPTURE&&edition.rowCount===ROWS,'Reopen the original complete review, capture and edition.');
      equal(capture.selection,snapshot.selection,'The original capture selection changed.');
      const buyer=await new Buyer({...config,environment:{...process.env,...config.environment}}).ready();
      const firstConfigPath=buyer.operation('wqx-journey-page-0001').configPath;
      const firstConfig=JSON.parse(await retainedBytes(firstConfigPath,65536));
      assert.equal(new URL(firstConfig.operation.url).searchParams.get('limit'),String(pageSize),'Keep the original first-page limit.');
      let model=await joinCapture(capture);
      assert.equal(model.rows.length,ROWS);assert.equal(model.activities.length,13);assert.equal(model.stations.length,1);
      assert.equal(model.issues.length,0);
      const expected=new Map(model.rows.map(row=>[JSON.stringify([row.id,row.source.sha256,row.source.index]),row]));
      assert.equal(expected.size,ROWS);
      const fullInventory=summarizeWaterQuality(model).inventory;
      assert.equal(fullInventory.selectedRows,ROWS);assert.equal(fullInventory.censored,452);
      assert.equal(fullInventory.qualified,146);assert.equal(fullInventory.estimated,10);
      const sourceSummary={operationId:capture.operationId,captureSha256:capture.captureSha256,selection:capture.selection,
        observations:model.rows.length,stations:model.stations.length,activities:model.activities.length,limits:model.summary.embeddedDetectionLimits,
        captureDirectory:restoreTo,resources:capture.resources.map(resource=>({profile:resource.profile,url:resource.url,
          status:resource.responseStatus,rows:resource.rowCount,bytes:resource.bytes,sha256:resource.sha256,receivedAt:resource.receivedAt}))};
      const ensureServices=async()=>{
        signal?.throwIfAborted();if(transport)return;
        facilitator=await localFacilitator();
        merchant=await startQualityMerchant({editionDirectory:edition.directory,port:0,facilitator:facilitator.url,allowLocalFacilitator:true});
        transport=await localMerchantTransport(fixture,merchant.url??merchant.merchantUrl,
          {reuse:true,proxyUrl:config.operatorProfile.buyerTransport.proxyUrl});
        equal(transport.buyerTransport,config.operatorProfile.buyerTransport,'Retain the original transport request binding.');
      };
      const deliver=async(prepared)=>{
        const value=await resumeQualityPurchase({buyer,prepared,editionDirectory:edition.directory,signal,beforeExecute:ensureServices});
        if(value.executed)executed++;else recovered++;
        assert.equal(value.result.native.mode,'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT');
        return value;
      };
      stage='original-native-pages';
      const unsigned=await optional(join(exportsDirectory,'unsigned-402.json'));
      assert(unsigned?.status===402&&unsigned.challenge?.x402Version===2,'Retain the original unsigned 402 observation.');
      const purchases=[],pages=[],delivered=new Set();let previous=null,pageNumber=0;
      do{
        signal?.throwIfAborted();pageNumber++;
        assert(pageNumber<=Math.ceil(ROWS/pageSize),'The original cursor exceeded the complete source row count.');
        const intentId='wqx-journey-page-'+String(pageNumber).padStart(4,'0');
        const prepared=await prepareQualityPurchase({editionDirectory:edition.directory,intentId,
          query:{limit:String(pageSize),sort:'date',...(previous?{cursor:previous.nextCursor}:{})},previous});
        const page=await deliver(prepared);
        assert.equal(page.metadata.snapshot,edition.snapshot);
        const file='purchased-results-'+String(pageNumber).padStart(4,'0')+'.json';
        const bytes=await page.result.bytes({limit:921600});
        assert.equal(hash(bytes),page.result.delivery.sha256);
        await keepBytes(join(exportsDirectory,file),bytes);
        for(const row of page.rows){
          const source=JSON.parse(row.source_json),key=JSON.stringify([row.id,source.sha256,source.index]),original=expected.get(key);
          assert(original&&!delivered.has(key),'Deliver each original source result exactly once.');
          for(const[name,value]of Object.entries(JSON.parse(row.values_json)))
            equal(value,original[name]??null,'Original normalized value '+name);
          equal(JSON.parse(row.record_json),original.record,'Retain every original Result field.');
          equal(JSON.parse(row.limits_json),original.limits,'Retain every reported detection limit.');
          equal(JSON.parse(row.station_records_json),original.stationRecords,'Retain every original Station join.');
          equal(JSON.parse(row.activity_records_json),original.activityRecords,'Retain every original Activity join.');
          delivered.add(key);
        }
        const record={intentId:page.intentId,file,status:page.result.status,metadata:page.metadata,
          response:{sha256:page.result.delivery.sha256,bytes:page.result.delivery.bytes},rows:page.rows.length};
        pages.push(record);purchases.push({intentId:page.intentId,metadata:page.metadata,sha256:page.result.delivery.sha256});
        previous=page.metadata;
        await progress({intentId,pageNumber,deliveredResults:delivered.size,nextCursor:previous.nextCursor});
      }while(previous.nextCursor!==null);
      assert.equal(delivered.size,ROWS);assert.equal(pageNumber,Math.ceil(ROWS/pageSize));
      expected.clear();model=null;
      stage='original-native-assets';
      const resource=capture.resources.find(item=>item.profile==='Result'&&item.dataAvailable);
      assert(resource,'The original Result source is missing.');
      const originalFile=edition.downloads.find(item=>item.path==='capture/'+resource.bodyFile);assert(originalFile);
      const sourcePurchase=await deliver(await prepareQualityPurchase({editionDirectory:edition.directory,
        intentId:'wqx-journey-original-csv',kind:'source',file:originalFile.path}));
      assert.equal(sourcePurchase.metadata.sha256,originalFile.sha256);
      assert.equal(sourcePurchase.metadata.contentType,originalFile.contentType);
      const sourceBytes=await sourcePurchase.result.bytes({limit:originalFile.bytes});
      assert.deepEqual(sourceBytes,await retainedBytes(join(edition.directory,originalFile.path),originalFile.bytes));
      await keepBytes(join(exportsDirectory,'purchased-original-result.csv'),sourceBytes);
      purchases.push({intentId:sourcePurchase.intentId,metadata:sourcePurchase.metadata,sha256:sourcePurchase.result.delivery.sha256});
      const editionPurchase=await deliver(await prepareQualityPurchase({editionDirectory:edition.directory,
        intentId:'wqx-journey-edition',kind:'edition'}));
      assert.equal(editionPurchase.value.editionId,edition.editionId);
      await keepBytes(join(exportsDirectory,'purchased-edition.json'),await editionPurchase.result.bytes({limit:16*1048576}));
      purchases.push({intentId:editionPurchase.intentId,metadata:editionPurchase.metadata,sha256:editionPurchase.result.delivery.sha256});
      assert.equal(purchases.length,Math.ceil(ROWS/pageSize)+2);
      if(facilitator)assert.equal(facilitator.counts.settled,executed,'Every newly executed fixture request has its original settlement response.');
      const nativeMerchantStatus=await qualityMerchantStatus(edition.directory);
      const counts={facilitator:{...(facilitator?.counts??{supported:0,verified:0,settled:0})},
        transport:{...(transport?.counts??{tunnels:0,requests:0,signedRequests:0})}};
      await transport?.close();transport=null;await merchant?.close();merchant=null;await facilitator?.close();facilitator=null;
      await progress({purchases:purchases.length,deliveredResults:delivered.size});
      stage='retained-private-review';
      const reports=[];
      for(const[format,file]of [['html',REVIEW+'-report.html'],['json',REVIEW+'-review.json'],
        ['csv',REVIEW+'-observations.csv'],['geojson',REVIEW+'-observations.geojson']]){
        const bytes=await retainedBytes(join(exportsDirectory,file));
        if(format==='json')equal(JSON.parse(bytes),review,'The retained analyst JSON changed.');
        reports.push({format,file,bytes:bytes.length,sha256:hash(bytes)});
      }
      const packed=JSON.parse(await retainedBytes(join(exportsDirectory,REVIEW+'-water-quality.json')));
      receiver=await openWaterQualityProject(join(root,'received-review'),{transport:originalOnly});
      const received=await receiver.receiveReviewBundle({bundle:packed});
      equal(received.review,review,'Reopen the original complete private receiving result.');
      assert.equal((await receiver.capture(review.captureId)).captureSha256,CAPTURE);
      const privateReview={archiveSha256:received.archiveSha256,files:received.files,bytes:received.bytes,directory:join(root,'received-review')};
      await receiver.close();receiver=null;await project.close();project=null;
      stage='portable-native-reopen';
      relocated=join(root,'relocated-source-capture');
      assert(!await exists(relocated),'Finish the original retained capture relocation first.');
      await rename(restoreTo,relocated);
      const exportedEdition=join(exportsDirectory,'water-quality-edition');
      await copyOriginalTree(edition.directory,exportedEdition);
      const portable=await readQualityEdition(exportedEdition);
      assert.equal(portable.editionId,edition.editionId);assert.equal(portable.snapshot,edition.snapshot);
      assert.equal((await readCapture(join(exportedEdition,'capture'))).captureSha256,CAPTURE);
      for(const purchase of purchases){
        const retained=await reopenQualityPurchase({buyer,intentId:purchase.intentId,editionDirectory:exportedEdition});
        assert(retained.result,'The original native delivery has no recoverable output.');
        assert.equal(retained.result.delivery.sha256,purchase.sha256);
        equal(retained.metadata,purchase.metadata,'The portable original metadata changed.');
      }
      const download=await exportQualityPurchase({buyer,intentId:'wqx-journey-original-csv',editionDirectory:exportedEdition});
      assert.equal(hash(download.bytes),originalFile.sha256);
      await rename(relocated,restoreTo);relocated=null;
      assert.equal(sourceRequests,0);
      stage='native-completion';
      const result={schema:JOURNEY,status:'PASS',completedAt:new Date().toISOString(),directory:root,
        sourceMode:'RETAINED_ORIGINAL_WQX_CAPTURE',sourceBundleSha256:null,
        source:{...sourceSummary,sourceRequests,authoringCaptureRestored:true},
        analysis:{reviewId:review.reviewId,reviewSha256:review.reviewSha256,wholeCaptureInventory:fullInventory,
          selectedReviewInventory:review.analysis.inventory,options:review.requestedOptions,
          comparableGroups:review.analysis.comparison.filter(value=>value.comparable).length},
        privateReview,
        edition:{editionId:edition.editionId,snapshot:edition.snapshot,rowCount:edition.rowCount,exportedDirectory:exportedEdition,
          memberBytes:edition.files.reduce((total,item)=>total+item.bytes,0),
          files:edition.files.map(({path,role,sha256,bytes})=>({path,role,sha256,bytes})),
          directDownloadBytes:edition.downloads.reduce((total,item)=>total+item.bytes,0)},
        commerce:{mode:'ORIGINAL_LOCAL_PROTOCOL_FIXTURE',nativeMerchantStatus,purchases:purchases.length,pages,
          deliveredResults:delivered.size,...counts,countsScope:'THIS_ORIGINAL_OPERATION_CONTINUATION',
          sourceFile:{path:originalFile.path,sha256:originalFile.sha256,bytes:originalFile.bytes},
          retainedBuyerReopenRequests:0,retainedBuyerReopenSettlements:0},
        continuation:{mode:'ORIGINAL_BUYER_JOURNAL',buyerConfigurationSha256:valueHash(config),pageSize,recovered,executed,
          originalIntentIds:purchases.map(value=>value.intentId)},reports,browser:null};
      await writeWaterQualityNativeCheckpoint({directory:root,result,projectSnapshot:snapshot});
      await progress({status:'NATIVE_COMPLETE',purchases:purchases.length,deliveredResults:delivered.size});
      if(!deferBrowser)await atomicJson(root,'result.json',result);
      return result;
    }catch(error){
      await atomicJson(root,'native-resume-failure.json',{status:'FAILED',stage,at:new Date().toISOString(),...publicError(error)}).catch(()=>{});
      throw error;
    }finally{
      await transport?.close();await merchant?.close();await facilitator?.close();await receiver?.close();await project?.close();
      if(relocated&&restoreTo&&!await exists(restoreTo)&&await exists(relocated))await rename(relocated,restoreTo);
    }
  });
}

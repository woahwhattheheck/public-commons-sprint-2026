// MIT. One durable Matomo workspace over the original provider and merchant paths.
import {readFile} from 'node:fs/promises';
import {openMatomoStore,readRetained} from './store.mjs';
import {createMatomoCaptures} from './capture.mjs';
import {createMatomoEditions} from './editions.mjs';
import {createMatomoComparisons} from './comparison.mjs';
import {createMatomoMerchant} from './merchant.mjs';
import {createMatomoHandover} from './operator-handover.mjs';
import {identifier,safeError} from './contract.mjs';
import {digest,fault} from '../postgres/publisher/files.mjs';
import {join} from 'node:path';
export async function openMatomoWorkspace({directory,create=false,source,sourceFile,environment=process.env,allowLoopback=false,python=environment.MATOMO_PYTHON??'python3',node=process.execPath}={}) {
  if(sourceFile){if(source)throw fault('MATOMO_ONE_SOURCE_REQUIRED');source=JSON.parse(await readFile(sourceFile,'utf8'));}
  const store=await openMatomoStore({directory,create,source,environment,allowLoopback});
  try{
    const captures=createMatomoCaptures(store),editions=createMatomoEditions(store,captures),comparisons=createMatomoComparisons(store,editions),merchant=createMatomoMerchant(store,editions,{environment}),handover=createMatomoHandover(store,merchant,editions,{environment,python,node});
    const operations=Object.freeze({
      discover:captures.discover,'resume-catalog':captures.resumeCatalog,capture:captures.captureReport,'resume-capture':captures.resumeCapture,
      edition:editions.prepare,'resume-edition':editions.resume,'review-edition':editions.review,
      compare:comparisons.compare,'resume-comparison':comparisons.resume,'review-comparison':comparisons.review,
      'configure-merchant':merchant.configure,'resume-merchant':merchant.resumeConfiguration,'save-merchant':merchant.save,
      'export-package':merchant.exportPackage,'recover-package':merchant.recoverPackage,
      'stage-release':merchant.stage,'select-release':merchant.select,'start-release':merchant.start,'stop-release':merchant.stop,'open-release-console':merchant.openConsole,
      'prepare-delivery':merchant.prepareDelivery,'recover-delivery':merchant.recoverDelivery,'review-delivery':merchant.reviewDelivery,'publish-delivery':merchant.publishDelivery,
      'prepare-handover':handover.prepare,'resume-handover':handover.resume,'receive-handover':handover.receive,'resume-receiving':handover.resumeReceiving,'reopen-receiving':handover.reopen,
    });
    const state=()=>({...store.state(),merchant:merchant.list(),...handover.list()});
    async function perform(name,input){if(!Object.hasOwn(operations,name))throw fault('MATOMO_OPERATION_NOT_FOUND',undefined,404);return operations[name](input);}
    async function sourceRead(id) {
      const row=store.db.prepare('SELECT * FROM requests WHERE id=?').get(identifier(id));
      if(!row)throw fault('MATOMO_SOURCE_READ_NOT_FOUND',undefined,404);
      const attempts=store.db.prepare('SELECT number,state,result FROM attempts WHERE request_id=? ORDER BY number').all(id).map(x=>({...x,result:x.result?JSON.parse(x.result):null}));
      return {id,kind:row.kind,owner:row.owner,input:JSON.parse(row.input),state:row.state,acceptedAttempt:row.accepted_attempt,attempts};
    }
    async function artifact(kind,id,options={}) {
      if(kind==='capture'){const value=await captures.manifest(id);return {content:value.raw,name:id+'-capture.json',mediaType:'application/json'};}
      if(kind==='edition'){const value=await editions.manifest(id);return {content:value.raw,name:id+'-edition.json',mediaType:'application/json'};}
      if(kind==='database'){const value=await editions.manifest(id,{database:true});return {path:value.database,name:id+'-edition.sqlite',mediaType:'application/vnd.sqlite3',sha256:value.value.database.sha256};}
      if(kind==='comparison'){const value=await comparisons.report(id);return {content:value.raw,name:id+'-comparison.json',mediaType:'application/json'};}
      if(kind==='findings')return {stream:comparisons.findingLines(id),name:id+'-findings.jsonl',mediaType:'application/x-ndjson'};
      if(kind==='delivery')return merchant.deliveryFile(id,options.kind);
      if(kind==='handover')return handover.file(id,options.kind??'archive');
      if(kind==='source'){
        const row=store.db.prepare('SELECT * FROM requests WHERE id=?').get(identifier(id));
        if(!row||!row.accepted_attempt)throw fault('MATOMO_ACCEPTED_READ_REQUIRED');
        const attempt=store.db.prepare('SELECT * FROM attempts WHERE request_id=? AND number=?').get(id,row.accepted_attempt);
        const result=JSON.parse(attempt.result),raw=await readRetained(join(store.directory,attempt.body_path),store.settings.source.maxResponseBytes);
        if(digest(raw)!==result.bodySha256||raw.length!==result.bodyBytes)throw fault('MATOMO_RETAINED_RESPONSE_CHANGED');
        return {content:raw,name:id+'.json',mediaType:'application/json'};
      }
      throw fault('MATOMO_ARTIFACT_NOT_FOUND',undefined,404);
    }
    let closing;
    const close=()=>{
      if(closing)return closing;
      const pending=store.close({beforeRelease:()=>merchant.close()});
      closing=pending;void pending.catch(()=>{if(closing===pending)closing=null;});return pending;
    };
    return Object.freeze({store,captures,editions,comparisons,merchant,handover,state,perform,sourceRead,artifact,close,operationNames:Object.keys(operations)});
  }catch(error){await store.close();throw error;}
}

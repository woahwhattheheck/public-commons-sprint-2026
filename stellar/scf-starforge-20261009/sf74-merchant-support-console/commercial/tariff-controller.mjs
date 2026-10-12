// MIT. Full tariff customer receiving on the original saved-case listener.
import {isAbsolute,resolve} from 'node:path';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {canonical,sha256,commercialError} from '../commercial-pricing.mjs';
import {commercialTariffSummary} from './tariff-source.mjs';
import {captureCommercialTariffReceivingSource,inspectCommercialTariffReceivingSource,
  attachCommercialTariffReceivingSource,inspectCommercialCaseTariff,downloadCommercialCaseTariff,
  restoreCommercialCaseTariff} from './tariff-receiving.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const PRICING=['pricingDirectory','pricingConfig','pricingSnapshot','pricingHistory'];
export const COMMERCIAL_TARIFF_ACTION_FIELDS=Object.freeze({
  status:[],catalog:PRICING,selection:[...PRICING,'selectionRequestId'],
  capture:[...PRICING,'selectionRequestId','backupRequestId','directory'],
  inspect:['directory','expectedSourceSha256'],
  attach:['directory','expectedSourceSha256','pricingRequestId','backupAttachmentRequestId',
    'tariffAttachmentRequestId','actor','bindingReason'],
  case:['revision','sourceId','quoteId','quoteSha256','monthlyRequests'],
  restore:['revision','sourceId','quoteId','quoteSha256','archive','directory'],
  download:['revision','sourceId','kind'],
});
const COMMON=['id','scope','expectedRevision'];
const fail=(code,message,status=422)=>{throw commercialError(code,message,status);};
function absolute(value,label){
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/'||value.includes('\0'))
    fail('COMMERCIAL_TARIFF_PATH','Use the original absolute private '+label+' path.');
  return value;
}
function fields(action,args){
  if(!args||typeof args!=='object'||Array.isArray(args)||!Object.hasOwn(COMMERCIAL_TARIFF_ACTION_FIELDS,action)||
      Object.keys(args).some(key=>![...COMMON,...COMMERCIAL_TARIFF_ACTION_FIELDS[action]].includes(key))||
      !UUID.test(args.id??''))
    fail('COMMERCIAL_TARIFF_REQUEST','Use the original selected case and tariff action fields.');
  if(args.expectedRevision!==undefined&&!HASH.test(args.expectedRevision))
    fail('COMMERCIAL_REVISION_REQUIRED','Keep the reviewed original case revision.');
}
function pricingOptions(args){
  const directory=absolute(args.pricingDirectory,'pricing directory'),config=absolute(args.pricingConfig,'seller configuration');
  if(Boolean(args.pricingSnapshot)===Boolean(args.pricingHistory))
    fail('COMMERCIAL_TARIFF_SOURCE_REQUIRED','Choose one original saved pricing snapshot or history file.');
  return {config,directory,...(args.pricingSnapshot?{snapshot:absolute(args.pricingSnapshot,'snapshot')}:
    {history:absolute(args.pricingHistory,'history')})};
}
async function authoring(args){
  const options=pricingOptions(args);
  const {openWorkspace}=await import('../../sf97-merchant-revenue-ops/workspace/model.mjs');
  const {openPlanningWorkspace}=await import('../../sf97-merchant-revenue-ops/planning/workspace.mjs');
  const {openTariffWorkspace}=await import('../../sf97-merchant-revenue-ops/tariffs/workspace.mjs');
  const model=await openWorkspace(options),planning=await openPlanningWorkspace({model,directory:options.directory});
  const tariffs=await openTariffWorkspace({model,directory:options.directory});
  return {model,planning,tariffs};
}
function sourceSummary(result){
  return {schema:result.schema,state:result.state,directory:result.directory,sourceSha256:result.sourceSha256,
    replayed:result.replayed===true,request:result.source.request,tariffFile:result.tariffFile,
    pricing:{directory:result.pricing.directory,sourceSha256:result.pricing.sourceSha256,
      sourceId:result.pricing.pricingSource.id,planId:result.pricing.pricingSource.planId,
      scenarioId:result.pricing.pricingSource.scenarioId,version:result.pricing.pricingSource.version,
      backup:result.pricing.source.backup},tariff:commercialTariffSummary(result.tariff)};
}
/** Only live promises are held here; the original native requests and saved case own durable recovery. */
export function openCommercialTariffController({store,casesDirectory}={}){
  const directory=absolute(casesDirectory,'case directory'),workspaceId=commercialWorkspaceId(directory);
  const commercial=openCaseCommercial({store,workspaceId}),active=new Map();
  let closing=false,closed;
  async function selected(action,args){
    fields(action,args);
    const scope={workspaceId,caseId:args.id};
    if(args.scope!==undefined&&canonical(args.scope)!==canonical(scope))
      fail('COMMERCIAL_SCOPE_CHANGED','Reopen the original merchant case and workspace.',409);
    const view=await commercial.read({id:args.id,...(args.revision?{revision:args.revision}:{})});
    return {scope,case:view.case,tariffSources:view.tariffSources??[]};
  }
  async function perform(action,args){
    if(action==='catalog'||action==='selection'){
      const opened=await authoring(args);
      if(action==='catalog'){
        const state=await opened.tariffs.state(),portfolio=await opened.tariffs.bundle();
        return {...state,selections:portfolio.selections.map(row=>({id:row.id,
          createdAt:row.intent.createdAt,planId:row.intent.selection.planId,
          comparisonId:row.intent.selection.comparisonId,
          status:row.result?.status??'PENDING',result:row.result}))};
      }
      if(!UUID.test(args.selectionRequestId??''))fail('COMMERCIAL_TARIFF_REQUEST','Choose the retained native pricing selection UUID.');
      const portfolio=await opened.tariffs.bundle({selectionRequestId:args.selectionRequestId});
      await opened.tariffs.inspectPortfolio(portfolio);
      return {portfolio,selection:portfolio.selections[0],plan:portfolio.plans[0]};
    }
    if(action==='capture'){
      const options={selectionRequestId:args.selectionRequestId,backupRequestId:args.backupRequestId,
        directory:absolute(args.directory,'tariff receiving source')};
      let retained;
      try{retained=await captureCommercialTariffReceivingSource(options);}
      catch(error){if(error.code!=='COMMERCIAL_TARIFF_WORKSPACE_REQUIRED')throw error;}
      if(retained)return sourceSummary(retained);
      return sourceSummary(await captureCommercialTariffReceivingSource({...options,...await authoring(args)}));
    }
    if(action==='inspect')return sourceSummary(await inspectCommercialTariffReceivingSource({
      directory:absolute(args.directory,'tariff receiving source'),expectedSourceSha256:args.expectedSourceSha256}));
    if(action==='attach')return attachCommercialTariffReceivingSource({store,casesDirectory:directory,id:args.id,
      expectedRevision:args.expectedRevision,directory:absolute(args.directory,'tariff receiving source'),
      expectedSourceSha256:args.expectedSourceSha256,pricingRequestId:args.pricingRequestId,
      backupAttachmentRequestId:args.backupAttachmentRequestId,tariffAttachmentRequestId:args.tariffAttachmentRequestId,
      actor:args.actor,bindingReason:args.bindingReason});
    const selection={store,casesDirectory:directory,id:args.id,revision:args.revision,
      sourceId:args.sourceId,quoteId:args.quoteId,quoteSha256:args.quoteSha256};
    if(action==='case')return inspectCommercialCaseTariff({...selection,monthlyRequests:args.monthlyRequests});
    if(action==='restore')return restoreCommercialCaseTariff({...selection,
      archive:absolute(args.archive,'retained pricing archive'),directory:absolute(args.directory,'restored pricing workspace')});
    if(action==='download')return downloadCommercialCaseTariff({store,casesDirectory:directory,id:args.id,
      revision:args.revision,sourceId:args.sourceId,kind:args.kind});
    fail('COMMERCIAL_TARIFF_ACTION_REQUIRED','Choose a complete original tariff action.');
  }
  async function call(action,args={}){
    if(closing)fail('COMMERCIAL_TARIFF_CLOSING','The original listener is draining its current tariff receiving work.',503);
    let before;
    try{before=await selected(action,args);}catch(error){error.requestState='REJECTED';throw error;}
    if(action==='status')return {...before,active:[...active.values()].filter(row=>row.id===args.id).map(
      ({action,startedAt,requestIds})=>({action,startedAt,requestIds}))};
    const key=action+':'+args.id+':'+(action==='capture'?args.backupRequestId:
      action==='attach'?args.tariffAttachmentRequestId:sha256(canonical(args)));
    const inputSha256=sha256(canonical(args)),prior=active.get(key);
    if(prior){
      if(prior.inputSha256!==inputSha256)fail('COMMERCIAL_TARIFF_REQUEST_CHANGED','This active original request has different inputs.',409);
      return prior.promise;
    }
    if(closing)fail('COMMERCIAL_TARIFF_CLOSING','The original listener is draining its current work.',503);
    const row={id:args.id,action,inputSha256,startedAt:new Date().toISOString(),
      requestIds:[args.backupRequestId,args.pricingRequestId,args.backupAttachmentRequestId,args.tariffAttachmentRequestId].filter(Boolean)};
    row.promise=(async()=>{
      try{
        const result=await perform(action,args),current=await selected(action,args);
        return {...current,action,result};
      }catch(error){
        if(['capture','attach','restore'].includes(action)&&!error.requestState)error.requestState='UNKNOWN';
        throw error;
      }
    })();
    active.set(key,row);
    try{return await row.promise;}finally{if(active.get(key)===row)active.delete(key);}
  }
  function close(){return closed??=(async()=>{closing=true;await Promise.allSettled([...active.values()].map(row=>row.promise));})();}
  return {workspaceId,call,close};
}

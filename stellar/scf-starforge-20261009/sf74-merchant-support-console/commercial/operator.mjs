// MIT. Same-case operator binding for original SF74 quotation and SF97 backup receiving.
import {resolve,isAbsolute} from 'node:path';
import {openCaseCommercial,commercialWorkspaceId} from '../case-commercial.mjs';
import {canonical,sha256,commercialError} from '../commercial-pricing.mjs';
import {
  inspectCommercialReceivingSource,attachCommercialReceivingSource,
  inspectCommercialCase,restoreCommercialPricingWorkspace,
} from './receiving.mjs';
import {commercialReceivingCli} from './receiving-cli.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const COMMON=['id','scope','expectedRevision'];
const FIELDS={
  status:[],
  capture:['pricingDirectory','pricingConfig','pricingSnapshot','pricingHistory','planId','scenarioId','backupRequestId','directory'],
  inspect:['directory','expectedSourceSha256'],
  attach:['directory','expectedSourceSha256','pricingRequestId','attachmentRequestId','actor','bindingReason'],
  'inspect-case':['revision','quoteId','quoteSha256','archiveSha256'],
  restore:['revision','quoteId','quoteSha256','archiveSha256','archive','directory'],
};
const fail=(code,message,status=422)=>{throw commercialError(code,message,status);};
function path(value,label){
  if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value==='/'||value.includes('\0'))
    fail('COMMERCIAL_RECEIVING_PATH','Use the original absolute private '+label+' path.');
  return value;
}
function fields(args,action){
  if(!args||typeof args!=='object'||Array.isArray(args)||!FIELDS[action]||
    Object.keys(args).some(key=>![...COMMON,...FIELDS[action]].includes(key)))
    fail('COMMERCIAL_RECEIVING_REQUEST','Use the original selected receiving action and fields.');
  if(!UUID.test(args.id??''))fail('COMMERCIAL_CASE_REQUIRED','Choose the original saved case UUID.');
  if(args.expectedRevision!==undefined&&!HASH.test(args.expectedRevision))
    fail('COMMERCIAL_REVISION_REQUIRED','Keep the original reviewed case revision.');
}
function sourceSummary(result){
  const {pricingSource,pricingText,pricing,...rest}=result;
  return {...rest,selection:{sourceId:pricingSource.id,planId:pricingSource.planId,
    scenarioId:pricingSource.scenarioId,version:pricingSource.version},
    review:{title:pricing.title,summary:pricing.summary,planLabel:pricing.planLabel,scenarioLabel:pricing.scenarioLabel,
      reviewSha256:pricing.reviewSha256,rows:pricing.rows,seller:pricing.seller,terms:pricing.terms,
      selected:pricing.selected,provenance:pricing.provenance}};
}
function captureArguments(args){
  for(const name of ['pricingDirectory','pricingConfig','directory'])path(args[name],name);
  if(Boolean(args.pricingSnapshot)===Boolean(args.pricingHistory))
    fail('COMMERCIAL_RECEIVING_SOURCE','Select one original saved snapshot or history file.');
  if(!UUID.test(args.planId??'')||!UUID.test(args.backupRequestId??''))
    fail('COMMERCIAL_RECEIVING_REQUEST','Keep the original plan and backup request UUIDs.');
  if(args.scenarioId!==undefined&&(typeof args.scenarioId!=='string'||!args.scenarioId||args.scenarioId.length>200))
    fail('COMMERCIAL_RECEIVING_SOURCE','Keep the original selected scenario identity.');
  const argv=['capture','--pricing-directory',args.pricingDirectory,'--pricing-config',args.pricingConfig,
    '--plan-id',args.planId,'--backup-request',args.backupRequestId,'--out',args.directory];
  if(args.pricingSnapshot)argv.push('--pricing-snapshot',path(args.pricingSnapshot,'snapshot'));
  else argv.push('--pricing-history',path(args.pricingHistory,'history'));
  if(args.scenarioId!==undefined)argv.push('--scenario-id',args.scenarioId);
  return argv;
}
/** Active promises only. Persistent operations remain in the original case and backup engines. */
export function openCommercialReceivingController({store,casesDirectory,environment=process.env}={}){
  const directory=path(casesDirectory,'case directory');
  if(!store?.read||!store?.save)throw new TypeError('The original saved-case store is required.');
  const workspaceId=commercialWorkspaceId(directory),commercial=openCaseCommercial({store,workspaceId});
  const active=new Map();let closing=false,closePromise;
  async function context(args,action){
    fields(args,action);
    const scope={workspaceId,caseId:args.id};
    if(args.scope!==undefined&&canonical(args.scope)!==canonical(scope))
      fail('COMMERCIAL_SCOPE_CHANGED','Reopen the same selected merchant case and workspace.',409);
    const view=await commercial.read({id:args.id,...(args.revision?{revision:args.revision}:{})});
    return {scope,case:view.case};
  }
  async function perform(action,args){
    if(action==='capture')return commercialReceivingCli(captureArguments(args),{environment});
    if(action==='inspect')return sourceSummary(await inspectCommercialReceivingSource({
      directory:path(args.directory,'receiving source'),expectedSourceSha256:args.expectedSourceSha256}));
    if(action==='attach')return attachCommercialReceivingSource({
      store,casesDirectory:directory,id:args.id,expectedRevision:args.expectedRevision,
      pricingRequestId:args.pricingRequestId,attachmentRequestId:args.attachmentRequestId,
      actor:args.actor,bindingReason:args.bindingReason,directory:path(args.directory,'receiving source'),
      expectedSourceSha256:args.expectedSourceSha256});
    const selection={store,casesDirectory:directory,id:args.id,revision:args.revision,
      quoteId:args.quoteId,quoteSha256:args.quoteSha256,archiveSha256:args.archiveSha256};
    if(action==='inspect-case')return inspectCommercialCase(selection);
    if(action==='restore')return restoreCommercialPricingWorkspace({...selection,
      archive:path(args.archive,'retained archive'),directory:path(args.directory,'restored workspace')});
    fail('COMMERCIAL_RECEIVING_ACTION','Choose an original receiving action.');
  }
  function operationKey(action,args){
    const identity=action==='capture'?args.backupRequestId:action==='attach'?args.attachmentRequestId:
      action==='restore'?canonical({quoteId:args.quoteId,archive:args.archive,directory:args.directory}):sha256(canonical(args));
    return action+':'+args.id+':'+identity;
  }
  async function call(action,args={}){
    if(closing)fail('COMMERCIAL_RECEIVING_CLOSING','The original merchant listener is draining its active receiving work.',503);
    const selected=await context(args,action);
    if(action==='status')return {...selected,active:[...active.values()].filter(row=>row.id===args.id).map(row=>({
      action:row.action,startedAt:row.startedAt,requestIds:row.requestIds}))};
    // Validate the capture's complete host selection before admitting its export.
    if(action==='capture')captureArguments(args);
    const key=operationKey(action,args),inputSha256=sha256(canonical(args)),prior=active.get(key);
    if(prior){
      if(prior.inputSha256!==inputSha256)
        fail('COMMERCIAL_RECEIVING_REQUEST_CHANGED','The active original request has different selected inputs.',409);
      return prior.promise;
    }
    // Recheck after awaited case access: closing may have begun while it was read.
    if(closing)fail('COMMERCIAL_RECEIVING_CLOSING','The original merchant listener is draining its active receiving work.',503);
    const row={id:args.id,action,inputSha256,startedAt:new Date().toISOString(),
      requestIds:[args.backupRequestId,args.pricingRequestId,args.attachmentRequestId].filter(Boolean),promise:null};
    row.promise=(async()=>{
      const result=await perform(action,args);
      const current=await context(args,action);
      return {...current,action,result};
    })();
    active.set(key,row);
    try{return await row.promise;}finally{if(active.get(key)===row)active.delete(key);}
  }
  function close(){
    return closePromise??=(async()=>{closing=true;await Promise.allSettled([...active.values()].map(row=>row.promise));})();
  }
  return {call,close,workspaceId};
}

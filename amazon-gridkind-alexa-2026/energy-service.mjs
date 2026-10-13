import {WorkspaceError,digest} from './workspace.mjs';
import {parseTariffCSV} from './tariff-source.mjs';
import {energySourceInput,previewEnergySource,reviewEnergy,inspectEnergySource,energyCSV,reviewCSV,energyHTML} from './energy-source.mjs';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function need(ok,message,status=400){if(!ok)throw new WorkspaceError(message,status);}
export function energyIntent(body){
 if(body.action==='save-source')return {action:body.action,source:energySourceInput(body.source),previewSha256:body.previewSha256};
 if(body.action==='save-review'){need(typeof body.title==='string'&&body.title.trim().length>0&&body.title.trim().length<=100,'Name the review.');return {action:body.action,sourceId:body.sourceId,weekId:body.weekId,title:body.title.trim(),note:body.note??'',previewSha256:body.previewSha256};}
 return null;
}
export function createEnergyService({store,check,view,committed}){
 function outcome(owner,body){
  need(UUID.test(body.requestId)&&UUID.test(body.context?.householdId),'Retain the original energy request and household.');
  const expected=digest(energyIntent(body)),prior=store.energyOutcome(owner,body.context.householdId,body.requestId);
  if(!prior)return null;need(prior.detail.requestSha256===expected,'This energy request already has a different outcome.',409);
  return {record:prior,requestSha256:expected,householdId:body.context.householdId,state:view(owner),replayed:true};
 }
 function limit(owner){need(Buffer.byteLength(JSON.stringify(store.exportHousehold(owner),null,2)+'\n')<=8*1024*1024,'The complete household would exceed its existing 8 MiB recovery limit. Nothing was saved. Retain this source separately or use another household.',413);}
 function action(owner,body){
  need(body&&typeof body==='object','Supply an energy operation.');
  const mutating=['save-source','save-review'].includes(body.action);
  if(mutating){const prior=outcome(owner,body);if(prior)return prior;}
  try{
   const live=check(owner,body,true);
   if(body.action==='headers'){const p=parseTariffCSV(body.csv);return {headers:p.headers,rows:p.records.length,state:view(owner)};}
   if(body.action==='preview-source')return {preview:previewEnergySource(body.source),state:view(owner)};
   let source,week,preview;
   if(['preview-review','save-review'].includes(body.action)){source=store.record(owner,live.householdId,body.sourceId);week=store.record(owner,live.householdId,body.weekId);preview=reviewEnergy(source,week,body);}
   if(body.action==='preview-review')return {preview,state:view(owner)};
   need(mutating,'Choose source preview/save or saved-plan review preview/save.');
   const requestSha256=digest(energyIntent(body));
   if(body.action==='save-source')preview=previewEnergySource(body.source);
   need(preview.sha256===body.previewSha256,'Preview these exact source fields and selections before saving.',409);
   const result=store.mutate(owner,body.context.revision,ctx=>{
    const prior=ctx.energyOutcome(body.requestId);if(prior){need(prior.detail.requestSha256===requestSha256,'Energy request identity conflict.',409);return {record:prior,replayed:true};}
    if(source)need(ctx.readRecord(source.id).sha256===source.sha256&&ctx.readRecord(week.id).sha256===week.sha256,'The selected source or plan changed.',409);
    const record=ctx.record({kind:body.action==='save-source'?'energy-source':'energy-review',
     scenario:week?.scenario??live.agent.view().scenario,parentId:source?.id??null,
     name:preview.title??preview.source.title,detail:body.action==='save-source'?{edition:preview,requestId:body.requestId,requestSha256}:{review:preview,requestId:body.requestId,requestSha256}});
    limit(owner);return {record,replayed:false};
   });
   committed(owner,live);return {...result,requestSha256,householdId:live.householdId,state:view(owner)};
  }catch(error){
   if(mutating){try{const prior=outcome(owner,body);if(prior)return prior;
    if([400,409,413].includes(error.status??400))error.energyOutcome={status:'not_committed',householdId:body.context.householdId,requestId:body.requestId,requestSha256:digest(energyIntent(body))};
   }catch{}}
   throw error;
  }
 }
 function exportRecord(owner,householdId,id,format){
  const record=store.record(owner,householdId,id);need(['energy-source','energy-review'].includes(record.kind),'Choose a saved energy source or review.');
  const source=record.kind==='energy-source'?record:store.record(owner,householdId,record.detail.review.binding.sourceId);
  const week=record.kind==='energy-review'?store.record(owner,householdId,record.detail.review.binding.weekId):null;
  const edition=inspectEnergySource(source.detail.edition);
  if(format==='source')return {text:edition.source.csv,mime:'text/csv',suffix:'original.csv'};
  if(format==='json')return {text:JSON.stringify({schema:'gridkind-energy-record/v1',record,source:record.kind==='energy-review'?source:null,week},null,2)+'\n',mime:'application/json',suffix:'json'};
  if(format==='rows')return {text:energyCSV(edition),mime:'text/csv',suffix:'source-rows.csv'};
  if(format==='csv'){need(record.kind==='energy-review','Choose a saved energy review.');return {text:reviewCSV(record.detail.review),mime:'text/csv',suffix:'hours.csv'};}
  if(format==='html')return {text:energyHTML(record,source,week),mime:'text/html',suffix:'html'};
  throw new WorkspaceError('Choose original source, source rows, complete JSON, hourly CSV or HTML.');
 }
 return {action,exportRecord};
}

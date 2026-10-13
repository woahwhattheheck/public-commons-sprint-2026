import {planWeek} from './weekly.mjs';
import {WorkspaceError,digest} from './workspace.mjs';
import {previewTariff,tariffWeekPreview,tariffSourceInput,parseTariffCSV,inspectTariff} from './tariff-source.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function need(ok,message,status=400){if(!ok)throw new WorkspaceError(message,status);}
function intent(body){
  if(body.action==='save')return {action:'save',source:tariffSourceInput(body.source),previewSha256:body.previewSha256};
  if(body.action==='apply')return {action:'apply',tariffId:body.tariffId,targetId:body.targetId,previewSha256:body.previewSha256};
  return null;
}
export function createTariffService({store,check,view,committed}){
  function existing(owner,body){
    const request=intent(body);
    need(request&&UUID.test(body.requestId)&&UUID.test(body.context?.householdId),'A tariff mutation requires its original request and household identities.');
    const found=store.tariffOutcome(owner,body.context.householdId,body.requestId);
    if(!found)return null;
    need(found.requestRecord.detail.requestSha256===digest(request),'This request identity already has a different saved tariff outcome.',409);
    return {...found,replayed:true,householdId:body.context.householdId,state:view(owner)};
  }
  function sizeLimit(owner){
    need(Buffer.byteLength(JSON.stringify(store.exportHousehold(owner),null,2)+'\n','utf8')<=8*1024*1024,
      'This tariff would exceed the complete household 8 MiB recovery limit. No changes were saved; use a separate household or a smaller original source.',413);
  }
  function action(owner,body){
    const mutating=['save','apply'].includes(body.action);
    if(mutating){const prior=existing(owner,body);if(prior)return prior;}
    try{
      const live=check(owner,body,true);
      if(body.action==='headers'){
        if(body.edition){const edition=inspectTariff(body.edition);return {headers:edition.headers,rows:edition.rows.length,source:tariffSourceInput(edition.source),state:view(owner)};}
        const parsed=parseTariffCSV(body.csv);return {headers:parsed.headers,rows:parsed.records.length,state:view(owner)};
      }
      if(body.action==='preview-source')return {preview:previewTariff(body.source),state:view(owner)};
      if(body.action==='preview-apply'){
        const tariff=store.record(owner,live.householdId,body.tariffId),target=store.record(owner,live.householdId,body.targetId);
        return {preview:tariffWeekPreview(tariff,target),state:view(owner)};
      }
      need(mutating,'Choose preview-source, save, preview-apply or apply.');
      const requestSha256=digest(intent(body));
      let result;
      if(body.action==='save'){
        const edition=previewTariff(body.source);
        need(body.previewSha256===edition.sha256,'Preview these exact original source fields before saving.',409);
        result=store.mutate(owner,body.context.revision,ctx=>{
          const prior=ctx.tariffOutcome(body.requestId);
          if(prior){need(prior.requestRecord.detail.requestSha256===requestSha256,'Request identity conflict.',409);return {...prior,replayed:true};}
          const record=ctx.record({kind:'tariff',scenario:live.agent.view().scenario,name:edition.source.title,
            detail:{edition,requestId:body.requestId,requestSha256}});
          sizeLimit(owner);return {requestRecord:record,record,replayed:false};
        });
      }else{
        const tariff=store.record(owner,live.householdId,body.tariffId),target=store.record(owner,live.householdId,body.targetId);
        const preview=tariffWeekPreview(tariff,target);
        need(preview.sha256===body.previewSha256,'Preview this exact saved tariff and week before applying.',409);
        need(preview.complete,'The selected week requires exactly one valid price for every nominal hour. Resolve missing, invalid or duplicate source rows in a new source edition.');
        const report=planWeek(preview.input);
        result=store.mutate(owner,body.context.revision,ctx=>{
          const prior=ctx.tariffOutcome(body.requestId);
          if(prior){need(prior.requestRecord.detail.requestSha256===requestSha256,'Request identity conflict.',409);return {...prior,replayed:true};}
          need(ctx.readRecord(tariff.id).sha256===tariff.sha256&&ctx.readRecord(target.id).sha256===target.sha256,'The selected source changed.',409);
          const requestRecord=ctx.record({kind:'tariff-application',scenario:target.scenario,parentId:tariff.id,
            name:('Apply tariff · '+target.label).slice(0,100),detail:{requestId:body.requestId,requestSha256,
              tariffId:tariff.id,tariffSha256:tariff.sha256,targetId:target.id,targetSha256:target.sha256,
              previewSha256:preview.sha256,selectedRows:preview.selectedRows}});
          const record=ctx.record({kind:'week',scenario:target.scenario,parentId:requestRecord.id,name:report.input.name,
            detail:{report,tariff:{applicationId:requestRecord.id,applicationSha256:requestRecord.sha256,
              tariffId:tariff.id,tariffSha256:tariff.sha256,targetId:target.id,targetSha256:target.sha256}}});
          sizeLimit(owner);return {requestRecord,record,replayed:false};
        });
      }
      committed(owner,live);
      return {...result,householdId:live.householdId,state:view(owner)};
    }catch(error){
      if(mutating){
        // Resolve a commit from another process after the failed revision check.
        // The exact request UUID survives a subsequent deliberate re-preview.
        try{const prior=existing(owner,body);if(prior)return prior;
          if([400,409,413].includes(error.status??400))error.tariffOutcome={status:'not_committed',
            householdId:body.context.householdId,requestId:body.requestId,requestSha256:digest(intent(body))};
        }catch{}
      }
      throw error;
    }
  }
  return {action};
}

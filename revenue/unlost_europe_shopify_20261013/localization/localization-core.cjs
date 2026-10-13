'use strict';
/* MIT. Merchant-localization workspaces. All copy and business observations are entered by the operator. */
function createLocalizationCore(sha){
  if(typeof sha?.sha256Utf8!=='function')throw Error('Use the complete original SHA module');
  const clone=x=>JSON.parse(JSON.stringify(x));
  const hash=x=>sha.sha256Utf8(JSON.stringify(x)).sha256;
  const fail=m=>{throw Error(m);};
  const text=(x,max=20000)=>typeof x==='string'&&x.length<=max?x:fail('A text field is absent or too long');
  const list=(x,max)=>Array.isArray(x)&&x.length<=max?x:fail('A collection is absent or too large');
  const id=x=>/^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,179}$/.test(x)?x:fail('Use a stable letters/numbers ID');
  const date=x=>typeof x==='string'&&/^\d{4}-\d\d-\d\dT/.test(x)&&Number.isFinite(Date.parse(x))?x:fail('Use an explicit ISO operation time');
  const url=x=>{text(x,2000);if(x&&!/^https?:\/\/[^\s<>]+$/i.test(x))fail('Use a full HTTP(S) page URL');return x;};
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const types=['product','collection','page','menu','policy','notification','theme','seo','other'];
  const statuses=['draft','ready_for_review','changes_requested','approved'];
  const projectFields=['targetLocale','currentTool','objective','productUrl','reviewer','tone','proposedStart','trialDays','commercialNotes','notes'];
  function project(input){
    const out={};for(const k of projectFields)out[k]=text(input[k]??'',k==='notes'||k==='commercialNotes'?12000:4000);
    url(out.productUrl);
    if(!['','formal','informal','merchant_choice'].includes(out.tone))fail('Choose an explicit tone');
    if(out.proposedStart&&!/^\d{4}-\d\d-\d\d$/.test(out.proposedStart))fail('Use a calendar date');
    if(out.trialDays&&(!/^\d+$/.test(out.trialDays)||Number(out.trialDays)<1||Number(out.trialDays)>365))fail('Trial length must be 1–365 days');
    return out;
  }
  function unit(input){
    const out={id:id(input.id),resourceType:input.resourceType,field:text(input.field,300),url:url(input.url??''),locale:text(input.locale,80),sourceText:text(input.sourceText,50000),translation:text(input.translation,50000),notes:text(input.notes??'',12000)};
    if(!types.includes(out.resourceType))fail('Choose a supported content type');
    if(!out.field.trim()||!out.locale.trim())fail('Each content item needs a field and target locale');
    if(!out.sourceText.trim())fail('Keep the actual source text with the content item');
    return out;
  }
  function glossary(input){
    const out={id:id(input.id),source:text(input.source,1000),target:text(input.target??'',1000),locale:text(input.locale??'',80),keepUnchanged:input.keepUnchanged===true,caseSensitive:input.caseSensitive===true,notes:text(input.notes??'',4000)};
    if(!out.source.trim())fail('A glossary item needs the actual source term');
    if(!out.keepUnchanged&&!out.target.trim())fail('Enter the target term or choose keep unchanged');
    return out;
  }
  function validate(s){
    if(!s||s.schema!=='tjlabs.merchant-localization.v1'||!Number.isSafeInteger(s.revision)||s.revision<0)fail('This is not a merchant-localization working file');
    id(s.id);date(s.createdAt);date(s.updatedAt);
    if(!s.selection||!Array.isArray(s.selection.leadIds)||!s.selection.leadIds.length||!['sample','paid'].includes(s.selection.kind))fail('The complete original edition is required');
    const ids=s.selection.leadIds; if(new Set(ids).size!==ids.length)fail('Repeated selected merchant');
    if(hash(s.research)!==s.researchSha256)fail('Original merchant research differs');
    if(s.research.length!==ids.length||new Set(s.research.map(x=>x.leadId)).size!==ids.length||s.research.some(x=>!ids.includes(x.leadId)))fail('Merchant source does not match the original selection');
    if(Object.keys(s.merchants).length!==ids.length)fail('Merchant workspaces do not match the selection');
    for(const mid of ids){
      const m=s.merchants[mid];if(!m)fail('Selected merchant is missing');
      project(m.project);list(m.units,2000);list(m.glossary,1000);list(m.snapshots,200);
      if(new Set(m.units.map(x=>x.id)).size!==m.units.length||new Set(m.glossary.map(x=>x.id)).size!==m.glossary.length)fail('Repeated content/glossary ID');
      for(const row of m.units){unit(row);if(!Number.isSafeInteger(row.sourceVersion)||row.sourceVersion<1||!Number.isSafeInteger(row.revision)||row.revision<1||!statuses.includes(row.review?.status))fail('Content history is invalid');date(row.updatedAt);if(row.review.binding&&typeof row.review.binding!=='string')fail('Review binding is invalid');}
      for(const row of m.glossary){glossary(row);if(!Number.isSafeInteger(row.revision)||row.revision<1)fail('Glossary revision is invalid');}
      for(const snap of m.snapshots){id(snap.id);text(snap.title,500);date(snap.at);if(hash(snap.content)!==snap.sha256)fail('A saved handover differs');}
    }
    list(s.history,20000);if(s.history.length!==s.revision)fail('Complete ordered history is required');
    if(new Set(s.history.map(x=>x.operationId)).size!==s.history.length)fail('Repeated operation history');
    s.history.forEach((h,i)=>{id(h.operationId);date(h.at);if(h.revision!==i+1||!ids.includes(h.merchantId)||typeof h.requestSha256!=='string')fail('History order differs');});
    return s;
  }
  function create({workspaceId,workingRecord,records,editionId,at}){
    id(workspaceId);date(at);
    const edition=workingRecord.editions.find(e=>e.id===editionId);
    if(!edition||!['sample','paid'].includes(edition.kind))fail('Choose one complete original edition');
    const ids=edition.leads.map(x=>x.id);
    const research=ids.map(leadId=>{
      const lead=workingRecord.leads.find(x=>x.id===leadId);if(!lead)fail('Original lead is missing');
      const record=records.find(x=>x.company_domain===lead.document.company_domain);
      if(!record)fail('Complete original research is missing for '+leadId);
      return{leadId,originalLead:clone(lead),record:clone(record)};
    });
    const merchants=Object.fromEntries(ids.map(mid=>[mid,{project:project({}),units:[],glossary:[],snapshots:[]}]));
    return validate({schema:'tjlabs.merchant-localization.v1',id:workspaceId,revision:0,createdAt:at,updatedAt:at,selection:{packId:workingRecord.pack.id,editionId,kind:edition.kind,leadIds:ids},research,researchSha256:hash(research),merchants,history:[]});
  }
  function terms(m,row){return m.glossary.filter(t=>(!t.locale||t.locale.toLowerCase()===row.locale.toLowerCase())&&(t.caseSensitive?row.sourceText.includes(t.source):row.sourceText.toLowerCase().includes(t.source.toLowerCase()))).map(t=>({source:t.source,target:t.target,locale:t.locale,keepUnchanged:t.keepUnchanged,caseSensitive:t.caseSensitive}));}
  function binding(m,row){return hash({sourceText:row.sourceText,translation:row.translation,locale:row.locale,field:row.field,resourceType:row.resourceType,url:row.url,tone:m.project.tone,terms:terms(m,row)});}
  function termFindings(m,row){
    const out=[];
    for(const t of terms(m,row)){
      const a=t.caseSensitive?row.sourceText:row.sourceText.toLowerCase();
      const b=t.caseSensitive?t.source:t.source.toLowerCase();
      if(!a.includes(b))continue;
      const expected=t.keepUnchanged?t.source:t.target;
      const translated=t.caseSensitive?row.translation:row.translation.toLowerCase();
      if(!translated.includes(t.caseSensitive?expected:expected.toLowerCase()))out.push({source:t.source,expected,keepUnchanged:t.keepUnchanged});
    }
    return out;
  }
  function stage(m,row){
    if(!row.translation.trim())return 'awaiting_translation';
    if(row.review.binding&&row.review.binding!==binding(m,row))return 'changed_since_review';
    if(row.review.status==='approved')return 'approved';
    return row.review.status;
  }
  function apply(original,request,at){
    validate(original);date(at);id(request.operationId);
    if(!original.selection.leadIds.includes(request.merchantId))fail('This merchant is outside the selected original edition');
    const intent={kind:request.kind,merchantId:request.merchantId,input:request.input};
    const digest=hash(intent),prior=original.history.find(x=>x.operationId===request.operationId);
    if(prior){if(prior.requestSha256!==digest)fail('This operation ID belongs to different entered work');return{state:clone(original),changed:false,replayed:true,originalRevision:prior.revision};}
    if(request.expectedRevision!==original.revision)fail('The workspace changed. Reopen the current working file and preserve your entered values before saving.');
    const s=clone(original),m=s.merchants[request.merchantId],input=request.input;
    let before=null,after=null;
    if(request.kind==='project.save'){before=clone(m.project);after=project(input);m.project=after;}
    else if(request.kind==='unit.save'){
      const value=unit(input),old=m.units.find(x=>x.id===value.id);before=old?clone(old):null;
      const relevant=old&&['resourceType','field','url','locale','sourceText','translation','notes'].every(k=>old[k]===value[k]);
      if(relevant)return{state:clone(original),changed:false,replayed:false};
      const sourceChanged=!old||old.sourceText!==value.sourceText||old.locale!==value.locale||old.field!==value.field||old.url!==value.url||old.resourceType!==value.resourceType;
      after={...value,sourceVersion:(old?.sourceVersion||0)+(sourceChanged?1:0),revision:(old?.revision||0)+1,updatedAt:at,review:old?clone(old.review):{status:'draft',reviewer:'',notes:'',at:null,binding:null}};
      if(old)Object.assign(old,after);else m.units.push(after);
    }else if(request.kind==='unit.remove'){
      const pos=m.units.findIndex(x=>x.id===input.id);if(pos<0)fail('That content item is absent');
      before=m.units[pos];m.units.splice(pos,1);
    }else if(request.kind==='glossary.save'){
      const value=glossary(input),old=m.glossary.find(x=>x.id===value.id);before=old?clone(old):null;
      after={...value,revision:(old?.revision||0)+1,updatedAt:at};
      if(old)Object.assign(old,after);else m.glossary.push(after);
    }else if(request.kind==='glossary.remove'){
      const pos=m.glossary.findIndex(x=>x.id===input.id);if(pos<0)fail('That glossary item is absent');
      before=m.glossary[pos];m.glossary.splice(pos,1);
    }else if(request.kind==='review.record'){
      const row=m.units.find(x=>x.id===input.id);if(!row)fail('Select the original content item');
      if(!statuses.includes(input.status))fail('Choose a review decision');
      if(!row.translation.trim())fail('Enter the actual proposed translation before review');
      const reviewer=text(input.reviewer,500),notes=text(input.notes??'',12000);
      if(!reviewer.trim())fail('Name the reviewer for this recorded decision');
      before=clone(row);row.review={status:input.status,reviewer,notes,at,binding:binding(m,row),termFindings:termFindings(m,row)};row.revision+=1;row.updatedAt=at;after=clone(row);
    }else if(request.kind==='handover.save'){
      id(input.id);if(m.snapshots.some(x=>x.id===input.id))fail('A handover with this ID already exists');
      const title=text(input.title,500);if(!title.trim())fail('Name this handover');
      const content={merchant:clone(s.research.find(x=>x.leadId===request.merchantId)),project:clone(m.project),units:clone(m.units),glossary:clone(m.glossary),stages:m.units.map(x=>({id:x.id,stage:stage(m,x),termFindings:termFindings(m,x)})),workspaceRevision:s.revision};
      after={id:input.id,title,at,content,sha256:hash(content)};m.snapshots.push(after);
    }else fail('Unknown localization operation');
    s.revision+=1;s.updatedAt=at;s.history.push({operationId:request.operationId,requestSha256:digest,revision:s.revision,at,kind:request.kind,merchantId:request.merchantId,before,after:clone(after)});
    return{state:validate(s),changed:true,replayed:false,originalRevision:s.revision};
  }
  function exportWorking(s){validate(s);const body=clone(s);return{schema:'tjlabs.merchant-localization-delivery.v1',workspace:body,sha256:hash(body)};}
  function receive(bundle,selection){
    if(!bundle||bundle.schema!=='tjlabs.merchant-localization-delivery.v1'||hash(bundle.workspace)!==bundle.sha256)fail('The complete working file differs');
    const s=validate(clone(bundle.workspace));
    if(selection&&!same(s.selection,selection))fail('This working file belongs to a different original merchant edition');
    return s;
  }
  const csvCell=v=>{let s=String(v??'');if(/^[\t\r]|^\s*[=+@-]/.test(s))s="'"+s;return'"'+s.replace(/"/g,'""')+'"';};
  function csv(s,merchantId){
    validate(s);const m=s.merchants[merchantId];if(!m)fail('Merchant is absent');
    const rows=[['Content ID','Type','Field','Source URL','Target locale','Source text','Entered translation','Source version','Review state','Reviewer','Review notes']];
    for(const r of m.units)rows.push([r.id,r.resourceType,r.field,r.url,r.locale,r.sourceText,r.translation,r.sourceVersion,stage(m,r),r.review.reviewer,r.review.notes]);
    return rows.map(r=>r.map(csvCell).join(',')).join('\r\n')+'\r\n';
  }
  function summary(s,merchantId){
    validate(s);const m=s.merchants[merchantId];if(!m)fail('Merchant is absent');
    const counts={total:m.units.length,awaiting_translation:0,changed_since_review:0,draft:0,ready_for_review:0,changes_requested:0,approved:0};
    let sourceWords=0;for(const r of m.units){counts[stage(m,r)]++;sourceWords+=r.sourceText.trim().split(/\s+/u).filter(Boolean).length;}
    return{...counts,sourceWords,glossary:m.glossary.length,handovers:m.snapshots.length};
  }
  return{create,validate,apply,exportWorking,receive,csv,summary,stage,termFindings,binding,hash,types,projectFields};
}
module.exports={createLocalizationCore};

import {currentStaffContext,staffDeskStorageKey,assertStaffRequestActor} from './staff-session.mjs';
import {mountEarlierStaffDesk} from './staff-desk-recovery.mjs';
// MIT. Complete issuer receiving and terms-to-plan operating desk.
const DB_NAME='sf47-issuer-terms-drafts-v1', STORE='desks', SCHEMA='stellar-forge.issuer-terms-desk.v1';
const MAX_DRAFT=32*1024*1024;
const clone=value=>structuredClone(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const pretty=value=>JSON.stringify(value,null,2);
const title=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/^./,v=>v.toUpperCase());
const selections=values=>values.map(value=>[value,title(value)]);
const tracks=['OPEN','INTEGRATION','RFP'];
const stages=['UNRECORDED','INTEREST_ACKNOWLEDGED','INVITED','SUBMITTED','AWARDED','DECLINED','WITHDRAWN'];
const pathGet=(value,path)=>path.split('.').reduce((part,key)=>part?.[key],value);
function pathSet(value,path,data){const keys=path.split('.').map(decodeURIComponent);if(keys.some(key=>['__proto__','constructor','prototype'].includes(key)))throw new Error('Use a documented editor field.');const last=keys.pop();let target=value;for(const key of keys){if(target[key]===null||typeof target[key]!=='object')throw new Error('Open the selected editor section before changing its fields.');target=target[key];}target[last]=data;}
const termsStores=new Map();
function termsStore(name){
  if(termsStores.has(name))return termsStores.get(name);
let database;
function openDatabase(){if(!database)database=new Promise((resolve,reject)=>{const request=indexedDB.open(name,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE,{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close an older issuer-draft tab and reopen this view.'));});return database;}
async function loadDesk(id){const db=await openDatabase();return new Promise((resolve,reject)=>{const request=db.transaction(STORE).objectStore(STORE).get(id);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error);});}
async function writeDesk(value,expected){if(new TextEncoder().encode(JSON.stringify(value)).length>MAX_DRAFT)throw new Error('Download this complete local draft before reducing its retained source inputs.');const db=await openDatabase();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),request=store.get(value.id);let error;request.onsuccess=()=>{const prior=request.result;if((prior?.sequence??0)!==expected||(prior&&prior.planId!==value.planId)){error=new Error('Another tab saved this local draft. Download your current fields and reopen the retained edition.');tx.abort();return;}store.put(value);};tx.oncomplete=()=>resolve(value);tx.onabort=tx.onerror=()=>reject(error||tx.error||new Error('The browser could not retain this local draft.'));});}
  const access={loadDesk,writeDesk};termsStores.set(name,access);return access;
}
function download(value,name,type='application/json'){const blob=value instanceof Blob?value:new Blob([typeof value==='string'?value:pretty(value)],{type});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function b64(buffer){const bytes=new Uint8Array(buffer);let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);}
const button=(label,action,attrs='',disabled=false)=>'<button type="button" data-terms-action="'+action+'" '+attrs+(disabled?' disabled data-fixed="true"':'')+'>'+esc(label)+'</button>';
const table=(head,rows)=>'<div class="terms-table" tabindex="0"><table><thead><tr>'+head.map(v=>'<th scope="col">'+esc(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+v+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function field(label,path,value,config={}){const attrs=' data-path="'+esc(path)+'"'+(config.required?' required':'')+(config.readonly?' readonly':'')+(config.nullable?' data-nullable="true"':'')+(config.integer?' data-integer="true"':'');let item;if(config.options)item='<select'+attrs+(config.multiple?' multiple size="5"':'')+'>'+[...config.options,...(config.multiple?(value||[]).filter(id=>!config.options.some(([key])=>key===id)).map(id=>[id,'Original selection · '+id]):[])].map(([key,label])=>'<option value="'+esc(key)+'"'+((config.multiple?(value||[]).includes(key):String(value??'')===String(key))?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select>';else if(config.area)item='<textarea'+attrs+' rows="'+(config.rows||3)+'" maxlength="32000">'+esc(value)+'</textarea>';else item='<input'+attrs+' type="'+(config.type||'text')+'" value="'+esc(value)+'"'+(config.type==='number'?' step="'+(config.integer?'1':'any')+'"':'')+'>';return '<label'+(config.wide?' class="terms-wide"':'')+'>'+esc(label)+item+(config.help?'<small>'+esc(config.help)+'</small>':'')+'</label>';}
const jsonEditor=(label,path,value,raw=null)=>'<label class="terms-wide">'+esc(label)+'<textarea data-json="'+esc(path)+'" rows="8">'+esc(raw===null?pretty(value):raw)+'</textarea></label>';
const details=(label,value)=>'<details><summary>'+esc(label)+'</summary><pre>'+esc(typeof value==='string'?value:pretty(value))+'</pre></details>';
function comparisonHtml(value){return table(['Field','Proposed','Issued','Comparison'],value.differences.map(row=>[esc(row.field),esc(row.proposed??'Unstated'),esc(row.issued??'Unstated'),esc(title(row.state))]));}
function metadataHtml(inspection){const m=inspection.metadata||{};return table(['Original field','Value'],[['Subject',m.subject],['From',m.from],['To',m.to],['CC',m.cc],['Date',m.date],['Message ID',m.messageId]].map(row=>row.map(esc)))+(inspection.warnings?.length?table(['Part','Source observation'],inspection.warnings.map(row=>[esc(row.path),esc(row.message)])):'')+(inspection.textParts||[]).map(part=>'<details'+(part.mediaType==='text/plain'?' open':'')+'><summary>'+esc(part.mediaType+' · '+part.path+' · '+part.bytes+' bytes')+'</summary><pre>'+esc(part.text??'')+'</pre>'+(part.decodeIssue?'<p>'+esc(part.decodeIssue)+'</p>':'')+'</details>').join('')+details('Complete original headers and MIME structure',{headers:inspection.headers,parts:inspection.parts});}
function nativePatch(plan){return {scenario_name:plan.scenario.scenario_name,award_request_usd:plan.scenario.award_request_usd,project_end_day:plan.scenario.project_end_day,milestones:plan.scenario.milestones.map(row=>Object.fromEntries(['tranche','submit_day','review_and_payment_lag_days','deliverable','measurable_proof'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,clone(row[key])]))),future_costs:plan.scenario.future_costs.map(row=>Object.fromEntries(['id','tranche','start_day','end_day','estimated_hours','assumed_hourly_rate_usd','amount_usd','category','remaining_work','measurable_proof'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,clone(row[key])])))};}

export function mountAwardTerms({container,current,api,saveApi=api,session={},mutationId,recordingActor,onCase,onSources,staffContext=currentStaffContext()}){
  const pinnedContext=staffContext?{...staffContext}:null;
  const {loadDesk,writeDesk}=termsStore(staffDeskStorageKey(DB_NAME,pinnedContext));
  if(!document.querySelector('link[data-sf47-award-terms]')){const link=document.createElement('link');link.rel='stylesheet';link.href=new URL('./award-terms.css',import.meta.url).href;link.dataset.sf47AwardTerms='';document.head.append(link);}
  const root=document.createElement('section');root.className='award-terms-desk';root.setAttribute('aria-label','Issuer correspondence and award terms');container.replaceChildren(root);
  const caseId=current.program.id,planId=current.program.planId,base='/api/operations/'+caseId;
  let active=true,busy=false,hostBusy=false,caseNow=current,index=null,desk=null,detail=null,inspection=null,messageDetail=null,termsPreview=null,planPreview=null,error='',storageFault=false,opening=0,serial=Promise.resolve(),stagedMessage=null;
  const available=()=>active&&root.isConnected,$=selector=>root.querySelector(selector);
  function showError(value){error=value?.message||String(value);if(available()){const target=$('[data-terms-error]');if(target)target.textContent=error;controls();}}
  async function retain(change){serial=serial.then(async()=>{if(storageFault)throw new Error('Download the current fields and reopen the retained local draft.');const next=clone(desk);change(next);next.sequence=desk.sequence+1;next.updatedAt=new Date().toISOString();try{await writeDesk(next,desk.sequence);}catch(exc){storageFault=true;throw exc;}desk=next;session.desk=desk;session.selection=desk.selection;return next;});return serial;}
  function controls(){if(!available())return;root.setAttribute('aria-busy',String(busy||hostBusy));root.querySelectorAll('button,input,textarea,select').forEach(el=>{el.disabled=busy||hostBusy||el.dataset.fixed==='true'||Boolean(desk?.pending&&!(el.dataset.termsAction&&['retry','download-draft','download-request','clear-rejected','refresh'].includes(el.dataset.termsAction)));});if(storageFault){const target=$('[data-terms-storage]');if(target)target.hidden=false;}}
  async function run(action){if(busy||hostBusy)return;busy=true;error='';controls();try{await action();}catch(exc){showError(exc);}finally{busy=false;if(available())controls();}}
  async function refresh(){const [next,listing]=await Promise.all([saveApi(base),saveApi(base+'/award-terms')]);if(next.program.id!==caseId||next.program.planId!==planId||listing.program.version!==next.program.version)throw new Error('The case changed during this read. Refresh its current complete source.');caseNow=next;index=listing;return next;}
  async function openTerms(id,revision,remember=true){const token=++opening;if(remember)await retain(next=>{next.selection={id,revision};});const result=await saveApi(base+'/award-terms/'+encodeURIComponent(id)+(revision?'?revision='+revision:''));if(!available()||token!==opening)return;detail=result;render();}
  function sourceOptions(){return (index?.sources||caseNow.sources||[]).map(row=>[row.id,row.filename+' · '+row.bytes+' bytes']);}
  function savedPanel(){const rows=index?.terms||[];return '<div class="terms-actions">'+button('New terms workspace','new-terms')+button('Refresh original case','refresh')+button('Original sources','sources')+button('Download local draft','download-draft')+button('Open complete local draft','open-local')+'</div><input type="file" data-terms-local-file accept=".json,application/json" hidden>'+(rows.length?table(['Workspace','Stage','Track','Edition','Saved','Open'],rows.map(row=>[esc(row.title),esc(title(row.stage)),esc(row.track),esc(row.revision),esc(row.savedAt),button('Open','open-terms','data-id="'+esc(row.id)+'" data-revision="'+row.revision+'"')])):'<p>Receive an issuer message or start the first terms workspace.</p>')+(desk.parkedDrafts?.length?'<details><summary>Other local drafts</summary>'+desk.parkedDrafts.map((row,i)=>button(row.document.title||'Local draft','restore-draft','data-index="'+i+'"')).join('')+'</details>':'');}
  function messagePanel(){
    const source=desk.messageInput,recorded=index?.correspondence||[];
    let html='<h3>Receive issuer correspondence</h3><p>Select the original EML or text file. Review its message and attachment representations, then retain the complete original with the selected attachments.</p><div class="terms-grid">'+
      '<label class="terms-wide">Original message<input type="file" data-message-file accept=".eml,.txt,message/rfc822,text/plain"></label>'+
      field('Source media type','messageInput.mediaType',source.mediaType,{options:[['message/rfc822','Email message (.eml)'],['text/plain','Plain text (.txt)']]} )+
      field('Observed at','messageInput.observedAt',source.observedAt,{required:true,help:'Original observation time with timezone.'})+
      field('Source URL','messageInput.sourceUrl',source.sourceUrl,{type:'url'})+
      field('Receiving note','messageNote',desk.messageNote,{area:true,wide:true})+'</div><p>'+esc(source.filename||'Choose an original message file.')+'</p><div class="terms-actions">'+button('Inspect original message','inspect-message','',!source.contentBase64)+'</div>';
    if(inspection){html+='<h4>Original message</h4>'+metadataHtml(inspection.inspection)+'<h4>Choose retained originals and attachments</h4>'+table(['Retain','Part','Original filename','Representation','Bytes','Source observation'],inspection.candidates.map(row=>[
      row.available?'<input type="checkbox" data-candidate="'+esc(row.path)+'" aria-label="Retain '+esc(row.filename)+'"'+(desk.selectedPaths.includes(row.path)?' checked':'')+(row.path==='original'?' disabled data-fixed="true"':'')+'>':'Unavailable',
      esc(row.path),esc(row.filename),esc(row.representation||row.mediaType),esc(row.bytes??''),esc(row.decodeIssue||row.issue||'')]))+
      '<div class="terms-actions">'+button('Retain message and selected attachments','receive-message','',caseNow.program.state!=='OPEN')+'</div>';}
    if(recorded.length)html+='<h4>Retained messages</h4>'+table(['Subject','Original date','Selected attachments','Open'],recorded.map(row=>[esc(row.subject||row.filename),esc(row.date),esc(row.attachmentCount),button('Open message','open-message','data-id="'+esc(row.sourceId)+'"')]));
    if(messageDetail)html+='<section><h4>Retained original correspondence</h4>'+metadataHtml(messageDetail.edition.inspection)+table(['Original part','Stored filename','Bytes','Download'],messageDetail.edition.selected.map(row=>[esc(row.path),esc(row.source.filename),esc(row.source.bytes),button('Download original','download-source','data-id="'+esc(row.source.id)+'" data-name="'+esc(row.source.filename)+'"')]))+'<div class="terms-actions">'+button('Use message details in terms draft','use-message')+'</div></section>';
    return html;
  }
  function termsPanel(){
    if(!desk.draft)return '<h3>Issuer terms</h3><p>Open an existing edition or start a new terms workspace.</p>';
    const d=desk.draft.document,options=sourceOptions();let html='<h3>Explicit issuer observation</h3><p>Record the stage and fields supported by the selected original message. Keep the proposed track and the issuer’s actual selection visible.</p><form data-terms-form><div class="terms-grid">'+
      field('Workspace name','draft.document.title',d.title,{required:true,wide:true})+
      field('Proposed track','draft.document.proposalTrack',d.proposalTrack,{options:selections(tracks)})+
      field('Issuer-selected track','draft.document.issuerTrack',d.issuerTrack,{options:[['','Unstated'],...selections(tracks)],nullable:true})+
      field('Observed application stage','draft.document.stage',d.stage,{options:selections(stages)})+
      field('Issuer name','draft.document.issuer.name',d.issuer.name)+
      field('Original reference','draft.document.issuer.reference',d.issuer.reference,{required:d.stage!=='UNRECORDED'})+
      field('Issuer message date','draft.document.issuer.issuedOn',d.issuer.issuedOn,{type:'date',nullable:true,required:d.stage!=='UNRECORDED'})+
      field('Message identity','draft.document.issuer.messageId',d.issuer.messageId)+
      field('Original subject','draft.document.issuer.subject',d.issuer.subject,{wide:true})+
      field('Original issuer sources','draft.document.sourceIds',d.sourceIds,{options,multiple:true,wide:true})+
      '</div><h4>Selected round and published guidance</h4><div class="terms-grid">'+
      field('Round name','draft.document.round.label',d.round.label)+
      field('Full-submission deadline','draft.document.round.deadlineOn',d.round.deadlineOn,{type:'date',nullable:true})+
      field('Deadline source','draft.document.round.deadlineBasis',d.round.deadlineBasis,{options:selections(['UNSTATED','PUBLIC_SCHEDULE','ISSUER_MESSAGE'])})+
      field('Submission form URL','draft.document.round.formUrl',d.round.formUrl,{type:'url'})+
      field('Selected published guidance','draft.document.guidanceSourceIds',d.guidanceSourceIds,{options,multiple:true,wide:true})+
      '</div><h4>Issued award terms</h4>';
    html+=d.award===null?'<p>Award terms are empty. Add the terms only when receiving the issuer’s award decision.</p>'+button('Add issued award fields','enable-award','',d.stage!=='AWARDED'):
      '<div class="terms-grid">'+field('Award agreement reference','draft.document.award.reference',d.award.reference)+
      field('Issued amount (USD)','draft.document.award.amountUsd',d.award.amountUsd,{nullable:true,help:'Exact decimal USD; leave unstated values empty.'})+
      field('Actual acceptance date','draft.document.award.acceptedOn',d.award.acceptedOn,{type:'date',nullable:true})+
      field('Issued duration (days)','draft.document.award.durationDays',d.award.durationDays,{type:'number',integer:true,nullable:true})+
      field('Complete conditions','draft.document.award.conditions',d.award.conditions,{area:true,wide:true})+'</div>'+
      d.award.tranches.map((row,i)=>'<fieldset><legend>Issued tranche '+row.tranche+'</legend><div class="terms-grid">'+
        field('Relative submission day','draft.document.award.tranches.'+i+'.submitDay',row.submitDay,{type:'number',integer:true,nullable:true})+
        field('Issuer deliverable','draft.document.award.tranches.'+i+'.deliverable',row.deliverable,{area:true,wide:true})+
        field('Issuer completion condition','draft.document.award.tranches.'+i+'.successCriteria',row.successCriteria,{area:true,wide:true})+
        field('Tranche decision sources','draft.document.award.tranches.'+i+'.sourceIds',row.sourceIds,{options,multiple:true,wide:true})+'</div>'+button('Remove unstated tranche','remove-tranche','data-index="'+i+'"')+'</fieldset>').join('')+
      '<div class="terms-actions">'+button('Add issued tranche','add-tranche','',d.award.tranches.length>=3)+button('Keep award terms empty','clear-award')+'</div>';
    if(d.award){const m=d.award.metric;html+='<h4>Explicit issuer outcome condition</h4>'+(m===null?button('Add stated metric and window','enable-metric'):'<div class="terms-grid">'+
      field('Metric name','draft.document.award.metric.name',m.name,{required:true,wide:true})+
      field('Target','draft.document.award.metric.target',m.target,{nullable:true})+
      field('Unit','draft.document.award.metric.unit',m.unit)+
      field('Aggregation','draft.document.award.metric.aggregation',m.aggregation,{options:selections(['TOTAL','AVERAGE','MINIMUM','COUNT','CUSTOM'])})+
      field('Comparison','draft.document.award.metric.comparison',m.comparison,{options:selections(['AT_LEAST','AT_MOST','EQUAL','CUSTOM'])})+
      field('Network','draft.document.award.metric.network',m.network)+
      field('Recorded ratification','draft.document.award.metric.ratification',m.ratification,{options:selections(['UNSTATED','PROPOSED','RATIFIED'])})+
      field('Window start','draft.document.award.metric.windowStart',m.windowStart,{type:'date',nullable:true})+
      field('Window end','draft.document.award.metric.windowEnd',m.windowEnd,{type:'date',nullable:true})+
      field('Inclusive calendar days','draft.document.award.metric.calendarDays',m.calendarDays,{type:'number',integer:true,nullable:true})+
      field('Metric decision sources','draft.document.award.metric.sourceIds',m.sourceIds,{options,multiple:true,wide:true})+
      field('Complete metric definition','draft.document.award.metric.definition',m.definition,{area:true,wide:true})+'</div>'+button('Remove unstated metric','clear-metric'));}
    html+='<h4>Field-to-source interpretation</h4>'+d.fieldSources.map((row,i)=>'<fieldset><legend>Source selection '+(i+1)+'</legend><div class="terms-grid">'+
      field('Term or field','draft.document.fieldSources.'+i+'.field',row.field,{required:true})+
      field('Selected sources','draft.document.fieldSources.'+i+'.sourceIds',row.sourceIds,{options,multiple:true})+
      field('Selected source passage','draft.document.fieldSources.'+i+'.excerpt',row.excerpt,{area:true,wide:true})+
      field('Receiving interpretation','draft.document.fieldSources.'+i+'.note',row.note,{area:true,wide:true})+'</div>'+button('Remove field selection','remove-field-source','data-index="'+i+'"')+'</fieldset>').join('')+
      button('Add source selection','add-field-source')+
      '<div class="terms-grid">'+field('Receiving notes','draft.document.note',d.note,{area:true,wide:true})+
      field('Save note','termsNote',desk.termsNote,{area:true,wide:true,required:true})+'</div></form>'+
      '<div class="terms-actions">'+button('Preview complete comparison','preview-terms','',caseNow.program.state!=='OPEN')+
      button('Save reviewed edition','save-terms','',!termsPreview||caseNow.program.state!=='OPEN')+button('Download complete inputs','export-terms-inputs')+'</div>';
    if(termsPreview)html+='<section><h4>Reviewed proposal comparison</h4>'+comparisonHtml(termsPreview.comparison)+'</section>';
    return html;
  }

  function planPanel(){
    if(!detail)return '<h3>Commission the delivery plan</h3><p>Open a saved issuer edition before preparing its original native planning inputs.</p>';
    let html='<h3>Commission the delivery plan</h3><p>Selected terms: '+esc(detail.edition.document.title)+' · edition '+detail.edition.revision+'. The complete calculation uses the existing planner and its original amendment review.</p><div class="terms-actions">'+button('Prepare complete native plan','seed-plan')+button('Open selected terms','tab-terms')+'</div>';
    const inputs=desk.planInputs;if(!inputs)return html;
    if(inputs.termsId!==detail.edition.id||inputs.termsRevision!==detail.edition.revision)html+='<p class="terms-notice">This retained plan draft belongs to another terms edition. Its selection remains in the complete inputs.</p>';
    const patch=inputs.patch,planning=inputs.planning;
    html+='<form data-plan-form><div class="terms-grid">'+field('Planning basis','planInputs.basis',inputs.basis,{options:[['PROPOSAL','Reviewed internal proposal'],['ISSUER_TERMS','Original issued award terms']]})+
      field('Planning review date','planInputs.asOfDate',inputs.asOfDate,{type:'date',required:true})+
      field('Reason for the selected plan','planInputs.reason',inputs.reason,{area:true,required:true,wide:true})+
      field('Plan name','planInputs.patch.scenario_name',patch.scenario_name,{required:true,wide:true})+
      field('Requested / issued amount (USD)','planInputs.patch.award_request_usd',patch.award_request_usd,{required:true})+
      field('Delivery duration (days)','planInputs.patch.project_end_day',patch.project_end_day,{type:'number',integer:true,required:true})+
      field('Selected planning calendar start','planInputs.planning.calendarStart',planning.calendarStart,{type:'date',nullable:true,help:'This planning choice stays separate from actual payment dates.'})+
      field('Working capital (USD)','planInputs.planning.capitalUsd',planning.capitalUsd,{nullable:true})+
      field('Working-capital basis','planInputs.planning.capitalNote',planning.capitalNote,{area:true,wide:true})+
      '</div><div class="terms-actions">'+button('Copy explicitly issued fields into this draft','copy-issued','',!detail.edition.document.award)+'</div><h4>Complete work packages</h4>'+
      patch.future_costs.map((row,i)=>'<fieldset><legend>'+esc(row.id)+' · tranche '+row.tranche+'</legend><div class="terms-grid">'+
        field('Start day','planInputs.patch.future_costs.'+i+'.start_day',row.start_day,{type:'number',integer:true})+
        field('End day','planInputs.patch.future_costs.'+i+'.end_day',row.end_day,{type:'number',integer:true})+
        field('Estimated hours','planInputs.patch.future_costs.'+i+'.estimated_hours',row.estimated_hours)+
        field('Hourly rate (USD)','planInputs.patch.future_costs.'+i+'.assumed_hourly_rate_usd',row.assumed_hourly_rate_usd??'')+
        field('Pricing mode','planInputs.planning.pricing.'+row.id.replaceAll('.','%2E'),planning.pricing[row.id],{options:[['hours','Hours × rate'],['fixed','Fixed amount']]})+
        field('Fixed amount (USD)','planInputs.patch.future_costs.'+i+'.amount_usd',row.amount_usd)+
        field('Remaining delivery work','planInputs.patch.future_costs.'+i+'.remaining_work',row.remaining_work,{area:true,wide:true})+
        field('Measurable completion criterion','planInputs.patch.future_costs.'+i+'.measurable_proof',row.measurable_proof,{area:true,wide:true,required:true})+'</div></fieldset>').join('')+
      '<h4>Tranche submissions</h4>'+patch.milestones.map((row,i)=>'<fieldset><legend>Tranche '+row.tranche+'</legend><div class="terms-grid">'+
        field('Planned submission day','planInputs.patch.milestones.'+i+'.submit_day',row.submit_day,{type:'number',integer:true})+
        field('Modeled review and payment lag (days)','planInputs.patch.milestones.'+i+'.review_and_payment_lag_days',row.review_and_payment_lag_days,{type:'number',integer:true})+
        field('Deliverable','planInputs.patch.milestones.'+i+'.deliverable',row.deliverable,{area:true,wide:true})+
        field('Completion criterion','planInputs.patch.milestones.'+i+'.measurable_proof',row.measurable_proof,{area:true,wide:true})+'</div></fieldset>').join('')+
      '<h4>People, capacity and allocations</h4><div class="terms-grid">'+
      jsonEditor('Complete contributor selection','planInputs.planning.contributors',planning.contributors,desk.jsonEdits?.['planInputs.planning.contributors']??null)+
      jsonEditor('Complete work-package assignments','planInputs.planning.assignments',planning.assignments,desk.jsonEdits?.['planInputs.planning.assignments']??null)+
      field('Complete planning notes','planInputs.planning.notes',planning.notes,{area:true,wide:true})+'</div>'+
      '<details><summary>Full native inputs and package mappings</summary><p>Use the original native schema when changing package identities or supplying mappings for retained operating records.</p>'+
      jsonEditor('Complete native commissioning inputs','planInputs',inputs,desk.jsonEdits?.['planInputs']??null)+button('Apply edited native JSON','apply-plan-json')+'</details></form>'+
      '<div class="terms-actions">'+button('Preview complete native plan','preview-plan','',caseNow.program.state!=='OPEN')+button('Download planning inputs','export-plan-inputs')+'</div>';
    if(planPreview){const candidate=planPreview,a=candidate.amendment,conflicts=a.compatibility.blockers||a.compatibility.conflicts||[];
      html+='<section><h4>Complete reviewed plan</h4><p>Native planning revision '+candidate.selectedPlan.revision+' · USD '+esc(candidate.selectedPlan.scenario.award_request_usd)+' · '+candidate.selectedPlan.scenario.project_end_day+' days · '+candidate.selectedPlan.scenario.future_costs.length+' work packages.</p>'+
      comparisonHtml(candidate.comparison)+table(['Selected change','Before','After'],a.changes.map(row=>[esc(row.path),esc(typeof row.before==='object'?pretty(row.before):row.before),esc(typeof row.after==='object'?pretty(row.after):row.after)]))+
      (conflicts.length?table(['Original reference','Receiving item'],conflicts.map(row=>[esc(row.id||row.costId||row.code),esc(row.message)])):'<p>The original record compatibility calculation accepts this planning selection.</p>')+
      details('Complete native budget, capacity and payment calculation',candidate.selectedPlan.report)+
      details('Recorded work, invoices, exposure and payment clocks',a)+
      '<form data-commission-form><div class="terms-grid">'+field('Planning review statement','reviewStatement',desk.reviewStatement,{area:true,wide:true,required:true})+
      field('Commissioning note','commissionNote',desk.commissionNote,{area:true,wide:true,required:true})+'</div><label class="terms-check"><input type="checkbox" data-apply-plan'+(desk.applyPlan?' checked':'')+'>Apply this reviewed planning selection to the existing case.</label></form><div class="terms-actions">'+
      button('Save, review and commission the complete plan','commission-plan','',!a.compatibility.compatible||caseNow.program.state!=='OPEN')+'</div></section>';}
    return html;
  }
  function historyPanel(){
    if(!detail)return '<h3>Original editions and handover</h3><p>Open a saved terms workspace.</p>';
    const e=detail.edition;return '<h3>'+esc(e.document.title)+'</h3><p>Edition '+e.revision+' · '+esc(title(e.document.stage))+' · saved '+esc(e.savedAt)+'</p><div class="terms-actions">'+button('Revise selected terms','revise-terms')+button('Prepare delivery plan','seed-plan')+button('Download complete case and issuer selection','export-case')+'</div>'+
      comparisonHtml(e.comparison)+table(['Edition','Stage','Case version','Saved','Open'],detail.history.map(row=>[esc(row.revision),esc(title(row.stage)),esc(row.caseVersion),esc(row.savedAt),button('Open edition','open-terms','data-id="'+esc(row.id)+'" data-revision="'+row.revision+'"')]))+
      '<h4>Commissioned native plans</h4>'+(detail.commissioning?.length?detail.commissioning.map(row=>'<details><summary>Planning revision '+row.edition.selectedPlan.revision+' · case version '+row.edition.caseVersion+' · '+esc(row.edition.savedAt)+'</summary><p>'+esc(row.edition.reviewStatement)+'</p>'+details('Complete original selection and review',row.edition)+'</details>').join(''):'<p>This terms selection has no commissioned planning record yet.</p>')+
      details('Complete retained issuer edition',e)+details('Original source selection',e.source.sources);
  }
  function render(){if(!available())return;if(!desk){root.innerHTML='<p>Opening the retained issuer workspace…</p>';return;}
    root.innerHTML='<header><h2>Issuer correspondence and award terms</h2><p>'+esc(caseNow.program.name)+' · case version '+caseNow.program.version+' · planning revision '+caseNow.program.planRevision+'</p></header>'+
      '<p data-terms-error role="alert">'+esc(error)+'</p><section data-terms-storage class="terms-notice"'+(storageFault?'':' hidden')+'><p>The visible fields are still available. Download the draft before reopening browser storage.</p>'+button('Download current draft','download-draft')+button('Download and reopen retained draft','reload-local')+'</section>'+
      (desk.pending?'<section class="terms-notice"><h3>Retained operation</h3><p>'+esc(desk.pending.error?.message||'The original request is retained for receiving its result.')+'</p><div class="terms-actions">'+button('Resume the same operation','retry')+button('Download original request','download-request')+(desk.pending.error?.rejected?button('Return to retained draft','clear-rejected'):'')+'</div></section>':'')+
      savedPanel()+'<nav class="terms-tabs" aria-label="Issuer receiving sections">'+[['messages','Correspondence'],['terms','Terms editor'],['plan','Delivery plan'],['history','Editions and handover']].map(([id,label])=>button(label,'tab','data-tab="'+id+'"'+(desk.tab===id?' aria-current="page"':''))).join('')+'</nav>'+
      ({messages:messagePanel,terms:termsPanel,plan:planPanel,history:historyPanel}[desk.tab]||messagePanel)();
    controls();
  }
  function visibleDraft(){
    const value=clone(desk);
    for(const el of root.querySelectorAll('[data-path]')){
      let v=el.multiple?[...el.selectedOptions].map(o=>o.value):el.value;
      if(v===''&&el.dataset.nullable)v=null;else if(el.dataset.integer)v=v===''?null:Number(v);
      try{pathSet(value,el.dataset.path,v);}catch{}
    }
    for(const el of root.querySelectorAll('[data-json]')){value.jsonEdits??={};value.jsonEdits[el.dataset.json]=el.value;}
    const candidates=[...root.querySelectorAll('[data-candidate]')];
    if(candidates.length)value.selectedPaths=candidates.filter(el=>el.checked).map(el=>el.dataset.candidate);
    const apply=root.querySelector('[data-apply-plan]');if(apply)value.applyPlan=apply.checked;
    if(stagedMessage)value.messageInput={...value.messageInput,...clone(stagedMessage)};
    return value;
  }
  async function newTerms(){if(desk.pending)throw new Error('Receive the retained operation before creating another terms workspace.');const value=await saveApi(base+'/award-terms-seed',{expectedVersion:caseNow.program.version});await retain(next=>{if(next.draft)next.parkedDrafts.push(next.draft);next.draft=value.inputs;next.tab='terms';next.termsNote='';});termsPreview=null;render();}
  async function reviseTerms(){if(!detail)throw new Error('Open a saved issuer edition.');await retain(next=>{if(next.draft&&next.draft.id!==detail.edition.id)next.parkedDrafts.push(next.draft);next.draft={id:detail.edition.id,expectedRevision:detail.history[0].revision,document:clone(detail.edition.document)};next.tab='terms';next.termsNote='';});termsPreview=null;render();}
  async function seedPlan(){if(!detail)throw new Error('Open a saved issuer edition first.');const value=await saveApi(base+'/award-terms-plan-seed',{expectedVersion:caseNow.program.version,termsId:detail.edition.id,termsRevision:detail.edition.revision});await retain(next=>{if(next.planInputs)next.priorPlanInputs=next.planInputs;next.planInputs=value.inputs;next.jsonEdits={};next.planInputs.patch=nativePatch(value.nativePlan);next.nativePlan=value.nativePlan;next.tab='plan';next.reviewStatement='';next.commissionNote='';next.applyPlan=false;});planPreview=null;render();}
  async function issue(endpoint,body,kind){await serial;if(desk.pending)throw new Error('Receive the original pending operation before preparing another save.');body.requestId=await mutationId('issuer-terms:'+caseId,body);await retain(next=>{next.pending={caseId,planId,endpoint,body:clone(body),kind,startedAt:new Date().toISOString(),error:null};});render();if(!available())return;await sendPending();}
  async function sendPending(){await serial;const pending=clone(desk.pending);if(!pending||pending.caseId!==caseId||pending.planId!==planId)throw new Error('Open the original case for this retained operation.');let result;try{assertStaffRequestActor(pending.body,pinnedContext);result=await saveApi(pending.endpoint,pending.body);}catch(exc){await retain(next=>{if(next.pending?.body.requestId===pending.body.requestId)next.pending.error={message:exc.message,code:exc.code||null,status:exc.status||null,rejected:[409,413,422].includes(exc.status)&&Boolean(exc.code)&&exc.code!=='REQUEST_CONFLICT'};});if(available())render();throw exc;}
    if(result.id!==caseId||!Number.isInteger(result.version))throw new Error('Keep the original request until its case result can be received.');
    await retain(next=>{if(next.pending?.body.requestId!==pending.body.requestId)throw new Error('The retained operation changed while receiving its response.');next.receipts.push({requestId:pending.body.requestId,result:clone(result),receivedAt:new Date().toISOString()});next.receipts=next.receipts.slice(-12);if(pending.kind==='terms'&&result.awardTerms){next.selection={id:result.awardTerms.id,revision:result.awardTerms.revision};if(next.draft?.id===result.awardTerms.id)next.draft.expectedRevision=result.awardTerms.revision;next.tab='history';}if(pending.kind==='message'){next.messageSourceId=result.correspondence.sourceId;next.messageInput.contentBase64='';next.selectedPaths=['original'];next.tab='messages';}if(pending.kind==='plan'){next.tab='history';next.applyPlan=false;}next.pending=null;});
    termsPreview=null;planPreview=null;inspection=null;const next=await refresh();if(available()){if(desk.selection)await openTerms(desk.selection.id,desk.selection.revision,false);if(pending.kind==='message')messageDetail=await saveApi(base+'/issuer-correspondence/'+desk.messageSourceId);render();await onCase?.(next,result);}
  }
  function checkLocalDraft(value){
    const object=item=>item!==null&&typeof item==='object'&&!Array.isArray(item);
    const check=(condition,message)=>{if(!condition)throw new Error(message);};
    check(object(value)&&value.schema===SCHEMA&&value.id===caseId&&value.planId===planId,
      'Open the complete issuer draft for this original case and plan.');
    check(['messages','terms','plan','history'].includes(value.tab)&&object(value.messageInput)
      &&Array.isArray(value.parkedDrafts)&&Array.isArray(value.selectedPaths)&&Array.isArray(value.receipts)
      &&Array.isArray(value.rejectedRequests),'Keep the complete original issuer editor and its retained history.');
    for(const key of ['filename','mediaType','contentBase64','observedAt','sourceUrl'])
      check(typeof value.messageInput[key]==='string','Retain every original message field.');
    const original=value.messageInput.contentBase64;
    check(original.length<=Math.ceil(8*1024*1024/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(original),
      'Retain a complete original message within 8 MiB.');
    if(original){let bytes;try{bytes=atob(original);}catch{throw new Error('Retain the complete original message bytes.');}
      check(bytes.length<=8*1024*1024,'Retain a complete original message within 8 MiB.');}
    check(value.selectedPaths.every(path=>typeof path==='string'),'Keep the original selected message parts.');
    for(const key of ['messageNote','termsNote','commissionNote','reviewStatement'])
      check(typeof value[key]==='string','Retain the complete original receiving and review notes.');
    check(typeof value.applyPlan==='boolean','Retain the original reviewed plan selection.');
    for(const item of [value.draft,...value.parkedDrafts].filter(item=>item!==null)){
      check(object(item)&&(item.id===null||typeof item.id==='string')&&Number.isInteger(item.expectedRevision)
        &&item.expectedRevision>=0&&object(item.document),'An editable issuer edition is incomplete.');
      const d=item.document;
      check(object(d.issuer)&&object(d.round)&&Array.isArray(d.fieldSources)&&Array.isArray(d.sourceIds)
        &&Array.isArray(d.guidanceSourceIds)&&tracks.includes(d.proposalTrack)&&stages.includes(d.stage)
        &&(d.award===null||object(d.award)&&Array.isArray(d.award.tranches)),
        'Retain the complete original issuer fields and source selections.');
    }
    if(value.selection!==null)check(object(value.selection)&&typeof value.selection.id==='string'
      &&Number.isInteger(value.selection.revision)&&value.selection.revision>=1,'The selected saved issuer edition is incomplete.');
    if(value.pending!==null){
      const p=value.pending,body=p?.body;
      check(object(p)&&p.caseId===caseId&&p.planId===planId&&object(body)
        &&typeof body.requestId==='string'&&body.requestId.trim().length>0&&typeof body.actor==='string'
        &&Number.isInteger(body.expectedVersion)&&body.expectedVersion>=1
        &&({message:base+'/issuer-correspondence-receive',terms:base+'/command',plan:base+'/award-terms-commission'})[p.kind]===p.endpoint
        &&(p.kind!=='terms'||body.action==='award-terms.save'),
        'Retain the exact original issuer operation, request body and receiving path.');
      assertStaffRequestActor(body,pinnedContext);
    }
    if(value.jsonEdits!==undefined)check(object(value.jsonEdits)&&Object.values(value.jsonEdits).every(text=>typeof text==='string'),
      'Retain every unfinished JSON editor field.');
    return clone(value);
  }
  async function openLocalDraft(value){
    if(!available())return;
    const received=checkLocalDraft(value);
    await serial;if(!available())return;
    if(desk.pending)throw new Error('Receive the current original operation before opening another issuer draft. Its complete download remains available.');
    download(visibleDraft(),'Issuer_Terms_Before_Opening.json');
    await retain(next=>{if(!available())throw new Error('Reopen the intended issuer desk before receiving its editable copy.');Object.assign(next,received);next.jsonEdits??={};});
    termsPreview=null;planPreview=null;inspection=null;detail=null;messageDetail=null;stagedMessage=null;opening++;render();
    await refresh();
    if(desk.selection)await openTerms(desk.selection.id,desk.selection.revision,false);
    if(desk.messageSourceId)messageDetail=await saveApi(base+'/issuer-correspondence/'+desk.messageSourceId);
    if(available())render();
  }
  async function openLocalFile(file){
    if(!file)return;
    if(file.size>MAX_DRAFT)throw new Error('Open the complete issuer editor within 32 MiB.');
    const raw=await file.text();if(!available())return;await openLocalDraft(JSON.parse(raw));
  }
  function fieldValue(el){if(el.multiple)return [...el.selectedOptions].map(o=>o.value);if(el.value===''&&el.dataset.nullable)return null;if(el.dataset.integer)return el.value===''?null:Number(el.value);return el.value;}
  root.addEventListener('input',event=>{const el=event.target;if(!desk)return;if(el.dataset.json){planPreview=null;retain(next=>{next.jsonEdits??={};next.jsonEdits[el.dataset.json]=el.value;}).catch(showError);return;}if(!el.dataset.path)return;const path=el.dataset.path,value=fieldValue(el);if(path.startsWith('draft.'))termsPreview=null;if(path.startsWith('planInputs.'))planPreview=null;if(path.startsWith('messageInput.'))inspection=null;retain(next=>pathSet(next,path,value)).then(()=>{if(available()){const saved=$('[data-terms-action="save-terms"]');if(saved&&!termsPreview){saved.disabled=true;saved.dataset.fixed='true';}const received=$('[data-terms-action="receive-message"]');if(received&&!inspection){received.disabled=true;received.dataset.fixed='true';}}}).catch(showError);});
  root.addEventListener('change',event=>{const el=event.target;if(!desk)return;if(el.dataset.candidate){const path=el.dataset.candidate;retain(next=>{next.selectedPaths=el.checked?[...new Set([...next.selectedPaths,path])]:next.selectedPaths.filter(v=>v!==path);}).catch(showError);}if(el.hasAttribute('data-apply-plan'))retain(next=>{next.applyPlan=el.checked;}).catch(showError);
    if(el.hasAttribute('data-terms-local-file')){const file=el.files?.[0];el.value='';run(()=>openLocalFile(file));}
    if(el.hasAttribute('data-message-file'))run(async()=>{const file=el.files?.[0];if(!file)return;if(!file.size||file.size>8*1024*1024)throw new Error('Select a nonempty original source up to 8 MiB.');const content=b64(await file.arrayBuffer());stagedMessage={filename:file.name,contentBase64:content};await retain(next=>{next.messageInput={...next.messageInput,...clone(stagedMessage)};next.selectedPaths=['original'];});stagedMessage=null;inspection=null;render();});
    if(el.dataset.path&&['draft.document.stage','draft.document.issuerTrack','draft.document.proposalTrack'].includes(el.dataset.path))serial.then(()=>{if(available())render();}).catch(showError);
  });
  root.addEventListener('click',event=>{const target=event.target.closest('[data-terms-action]');if(!target)return;event.preventDefault();const action=target.dataset.termsAction;
    if(action==='download-draft'){download(visibleDraft(),'Issuer_Terms_Local_Draft.json');return;}
    if(action==='download-request'){download(desk.pending,'Issuer_Terms_Original_Request.json');return;}
    if(action==='open-local'){if(!busy&&!hostBusy&&!desk.pending)$('[data-terms-local-file]').click();return;}
    run(async()=>{
      if(action==='reload-local'){download(visibleDraft(),'Issuer_Terms_Current_Fields.json');desk=await loadDesk(caseId);stagedMessage=null;storageFault=false;serial=Promise.resolve();termsPreview=null;planPreview=null;render();return;}
      await serial;
      if(action==='sources'){await onSources?.();return;}
      if(action==='tab'||action==='tab-terms'){await retain(next=>{next.tab=action==='tab-terms'?'terms':target.dataset.tab;});render();return;}
      if(action==='refresh'){await refresh();if(desk.selection)await openTerms(desk.selection.id,desk.selection.revision,false);render();return;}
      if(action==='new-terms'){await newTerms();return;}
      if(action==='open-terms'){await retain(next=>{next.tab='history';});await openTerms(target.dataset.id,Number(target.dataset.revision));return;}
      if(action==='revise-terms'){await reviseTerms();return;}
      if(action==='restore-draft'){const index=Number(target.dataset.index);await retain(next=>{const chosen=next.parkedDrafts.splice(index,1)[0];if(next.draft)next.parkedDrafts.push(next.draft);next.draft=chosen;next.tab='terms';});termsPreview=null;render();return;}
      if(action==='inspect-message'){inspection=await saveApi(base+'/issuer-correspondence-inspect',{expectedVersion:caseNow.program.version,input:clone(desk.messageInput)});render();return;}
      if(action==='receive-message'){if(!inspection)throw new Error('Inspect the complete selected message.');if(!desk.messageNote.trim())throw new Error('Enter the receiving note.');await issue(base+'/issuer-correspondence-receive',{expectedVersion:caseNow.program.version,actor:recordingActor(),note:desk.messageNote,input:clone(desk.messageInput),selectedPaths:clone(desk.selectedPaths),expectedInspectionSha256:inspection.inspectionSha256},'message');return;}
      if(action==='open-message'){messageDetail=await saveApi(base+'/issuer-correspondence/'+target.dataset.id);await retain(next=>{next.messageSourceId=target.dataset.id;});render();return;}
      if(action==='download-source'){const response=await saveApi(base+'/sources/'+target.dataset.id,undefined,{download:true});download(await response.blob(),target.dataset.name,response.headers?.get('content-type')||'application/octet-stream');return;}
      if(action==='use-message'){if(!messageDetail)throw new Error('Open a retained original message.');if(!desk.draft)await newTerms();const metadata=messageDetail.edition.inspection.metadata||{};await retain(next=>{Object.assign(next.draft.document.issuer,{name:metadata.from||'',reference:metadata.messageId||metadata.subject||'',messageId:metadata.messageId||'',subject:metadata.subject||'',issuedOn:metadata.dateUtc?metadata.dateUtc.slice(0,10):null});next.draft.document.sourceIds=[...new Set([...next.draft.document.sourceIds,...messageDetail.edition.selected.map(row=>row.source.id)])];next.tab='terms';});termsPreview=null;render();return;}
      if(action==='enable-award'){await retain(next=>{next.draft.document.award={reference:'',amountUsd:null,acceptedOn:null,durationDays:null,conditions:'',tranches:[],metric:null};});termsPreview=null;render();return;}
      if(action==='clear-award'){await retain(next=>{next.draft.document.award=null;});termsPreview=null;render();return;}
      if(action==='add-tranche'){await retain(next=>{const rows=next.draft.document.award.tranches;const tranche=[1,2,3].find(v=>!rows.some(row=>row.tranche===v));if(tranche)rows.push({tranche,submitDay:null,deliverable:'',successCriteria:'',sourceIds:[]});rows.sort((a,b)=>a.tranche-b.tranche);});termsPreview=null;render();return;}
      if(action==='remove-tranche'){await retain(next=>next.draft.document.award.tranches.splice(Number(target.dataset.index),1));termsPreview=null;render();return;}
      if(action==='enable-metric'){await retain(next=>{next.draft.document.award.metric={name:'',target:null,unit:'',aggregation:'CUSTOM',comparison:'AT_LEAST',network:'',windowStart:null,windowEnd:null,calendarDays:null,ratification:'UNSTATED',sourceIds:[],definition:''};});termsPreview=null;render();return;}
      if(action==='clear-metric'){await retain(next=>{next.draft.document.award.metric=null;});termsPreview=null;render();return;}
      if(action==='add-field-source'){await retain(next=>next.draft.document.fieldSources.push({field:'',sourceIds:[],excerpt:'',note:''}));termsPreview=null;render();return;}
      if(action==='remove-field-source'){await retain(next=>next.draft.document.fieldSources.splice(Number(target.dataset.index),1));termsPreview=null;render();return;}
      if(action==='preview-terms'){if(!$('[data-terms-form]').reportValidity())return;termsPreview=await saveApi(base+'/award-terms-preview',{expectedVersion:caseNow.program.version,inputs:clone(desk.draft)});render();return;}
      if(action==='save-terms'){if(!termsPreview)throw new Error('Preview the complete current terms first.');if(!desk.termsNote.trim())throw new Error('Enter the edition save note.');await issue(base+'/command',{expectedVersion:caseNow.program.version,actor:recordingActor(),note:desk.termsNote,action:'award-terms.save',data:{inputs:clone(desk.draft),expectedPreviewSha256:termsPreview.previewSha256}},'terms');return;}
      if(action==='export-terms-inputs'){download(desk.draft,'Issuer_Terms_Inputs.json');return;}
      if(action==='seed-plan'){await seedPlan();return;}
      if(action==='copy-issued'){const award=detail.edition.document.award;if(!award)throw new Error('Open a saved edition with issued award terms.');await retain(next=>{if(award.amountUsd!==null)next.planInputs.patch.award_request_usd=award.amountUsd;if(award.durationDays!==null)next.planInputs.patch.project_end_day=award.durationDays;for(const issued of award.tranches){const row=next.planInputs.patch.milestones.find(v=>v.tranche===issued.tranche);if(!row)continue;if(issued.submitDay!==null)row.submit_day=issued.submitDay;if(issued.deliverable)row.deliverable=issued.deliverable;if(issued.successCriteria)row.measurable_proof=issued.successCriteria;}});planPreview=null;render();return;}
      if(action==='apply-plan-json'){const el=$('[data-json="planInputs"]');const value=JSON.parse(el.value);await retain(next=>{next.planInputs=value;next.jsonEdits={};});planPreview=null;render();return;}
      if(action==='preview-plan'){if(!$('[data-plan-form]').reportValidity())return;const edits=[...root.querySelectorAll('[data-json]')].filter(el=>el.dataset.json!=='planInputs').map(el=>[el.dataset.json,JSON.parse(el.value)]);await retain(next=>{for(const [path,value] of edits){pathSet(next,path,value);if(next.jsonEdits)delete next.jsonEdits[path];}});planPreview=await saveApi(base+'/award-terms-plan-preview',{expectedVersion:caseNow.program.version,inputs:clone(desk.planInputs)});render();return;}
      if(action==='commission-plan'){if(!planPreview)throw new Error('Review the complete current native plan first.');if(!$('[data-commission-form]').reportValidity())return;if(!desk.applyPlan)throw new Error('Select applying this reviewed plan.');await issue(base+'/award-terms-commission',{expectedVersion:caseNow.program.version,actor:recordingActor(),note:desk.commissionNote,inputs:clone(desk.planInputs),expectedPreviewSha256:planPreview.previewSha256,reviewStatement:desk.reviewStatement,acknowledgeBaselineChange:true},'plan');return;}
      if(action==='export-plan-inputs'){download(desk.planInputs,'Issuer_Terms_Native_Planning_Inputs.json');return;}
      if(action==='export-case'){if(!detail)throw new Error('Open the saved issuer selection.');const response=await saveApi(base+'/award-terms/'+detail.edition.id+'/export.zip?revision='+detail.edition.revision+'&expectedVersion='+caseNow.program.version,undefined,{download:true});download(await response.blob(),'SCF_Issuer_Terms_Complete_Case.zip','application/zip');return;}
      if(action==='retry'){await sendPending();return;}
      if(action==='clear-rejected'){if(!desk.pending?.error?.rejected)throw new Error('Receive the original operation result before clearing it.');await retain(next=>{next.rejectedRequests.push(next.pending);next.pending=null;});termsPreview=null;planPreview=null;await refresh();render();return;}
    });
  });
  const earlier=mountEarlierStaffDesk({root,staffContext:pinnedContext,title:'Issuer terms',
    readCopy:()=>termsStore(DB_NAME).loadDesk(caseId),isBusy:()=>busy||hostBusy||!desk,
    setDeskBusy:value=>{busy=value;if(value)controls();else render();},filename:'Issuer_Terms_Earlier_Local_Draft.json',
    describeCopy:value=>(value.messageInput?.filename||value.draft?.document?.title||'Original issuer workspace')+' · '+(value.pending?'original operation pending':'complete editable issuer fields'),
    openCopy:openLocalDraft
  });
  async function openSavedWorkflow(selection){
    await ready;
    if(!available())throw new Error('Open this original issuer-terms desk before selecting a saved edition.');
    if(busy||desk.pending)throw new Error('Finish the retained issuer request before opening another saved edition.');
    if(selection?.kind!=='award-terms'||typeof selection.id!=='string'||!Number.isSafeInteger(selection.revision)||selection.revision<1)
      throw new Error('Select an original issuer-terms identity and revision.');
    if(selection.caseId!==undefined&&selection.caseId!==caseId||selection.expectedVersion!==undefined&&selection.expectedVersion!==caseNow.program.version)
      throw new Error('Refresh the original case before opening this saved issuer edition.');
    busy=true;error='';controls();
    try{
      await serial;
      const token=++opening,result=await saveApi(base+'/award-terms/'+encodeURIComponent(selection.id)+'?revision='+selection.revision);
      if(!available()||token!==opening)throw new Error('The original issuer desk changed while its edition was opening.');
      if(result?.edition?.id!==selection.id||result.edition.revision!==selection.revision)
        throw new Error('The returned issuer edition differs from the selected original revision.');
      await retain(next=>{next.selection={id:selection.id,revision:selection.revision};next.tab='history';});
      detail=result;render();
      return {outcome:'opened',caseId,kind:'award-terms',id:selection.id,revision:selection.revision};
    }catch(problem){showError(problem);throw problem;}
    finally{busy=false;if(available())controls();}
  }
  const ready=(async()=>{desk=await loadDesk(caseId);if(desk&&(desk.schema!==SCHEMA||desk.planId!==planId))throw new Error('Open the original case for the retained local issuer draft.');if(!desk){desk={schema:SCHEMA,id:caseId,planId,sequence:0,updatedAt:new Date().toISOString(),tab:'messages',selection:session.selection||null,draft:null,parkedDrafts:[],planInputs:null,nativePlan:null,priorPlanInputs:null,messageInput:{filename:'',mediaType:'message/rfc822',contentBase64:'',observedAt:new Date().toISOString(),sourceUrl:''},messageNote:'',selectedPaths:['original'],messageSourceId:null,termsNote:'',commissionNote:'',reviewStatement:'',applyPlan:false,pending:null,receipts:[],rejectedRequests:[],jsonEdits:{}};render();await retain(()=>{});}if(!available())return;session.desk=desk;render();if(session.selection&&(session.selection.id!==desk.selection?.id||session.selection.revision!==desk.selection?.revision))await retain(next=>{next.selection=clone(session.selection);next.tab='history';});session.desk=desk;render();await refresh();if(desk.selection)await openTerms(desk.selection.id,desk.selection.revision,false);if(desk.messageSourceId)messageDetail=await saveApi(base+'/issuer-correspondence/'+desk.messageSourceId);if(available())render();})().catch(exc=>{if(available())showError(exc);throw exc;});
  render();
  return {ready,openSavedWorkflow,dispose(){earlier.dispose();active=false;opening++;},setHostBusy(value){hostBusy=Boolean(value);controls();}};
}

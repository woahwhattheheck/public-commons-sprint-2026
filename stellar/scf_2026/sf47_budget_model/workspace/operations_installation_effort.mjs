// Phase effort inside the original saved Installation.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title=value=>String(value??'').replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());
const copy=value=>structuredClone(value);
const number=value=>value===null||value===undefined||value===''?'Unentered':String(value);
const hours=value=>number(value)+(value===null||value===undefined||value===''?'':' h');
const text=value=>typeof value==='object'&&value!==null?JSON.stringify(value,null,2):String(value??'');
const paragraph=value=>'<p class="installation-note">'+esc(value)+'</p>';
const table=(heads,rows)=>'<div class="installation-table"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function field(label,path,value,options={}){
  const attr=' data-installation-effort-field="'+esc(path)+'"'+(options.required?' required':'');
  const opts=options.options?options.options.map(row=>[...row]):null;
  if(opts){for(const selected of options.multiple?(value||[]):[value])if(selected!==null&&selected!==undefined&&selected!==''&&!opts.some(([id])=>String(id)===String(selected)))opts.push([selected,String(selected)+' · saved selection']);}
  const input=opts?'<select'+attr+(options.multiple?' multiple size="4"':'')+'>'+opts.map(([id,name])=>'<option value="'+esc(id)+'"'+(options.multiple?(value||[]).includes(id)?' selected':'':String(value??'')===String(id)?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select>':
    options.area?'<textarea'+attr+' rows="'+(options.rows||3)+'" maxlength="'+(options.max||8000)+'">'+esc(Array.isArray(value)?value.join('\n'):value)+'</textarea>':
    '<input'+attr+' type="'+(options.type||'text')+'" value="'+esc(value)+'"'+(options.type==='number'?' min="0" step="'+(options.integer?'1':'0.0001')+'"':'')+' maxlength="'+(options.max||4000)+'">';
  return '<label'+(options.wide?' class="installation-wide"':'')+'><span>'+esc(label)+'</span>'+input+(options.help?'<small>'+esc(options.help)+'</small>':'')+'</label>';
}
function assign(object,path,value){
  const bits=path.split('.');let row=object;
  for(const key of bits.slice(0,-1))row=row[key];
  row[bits.at(-1)]=value;
}
const commercialEffort=value=>!!value?.document?.commercial;
const effortUnit=value=>commercialEffort(value)?'task':'phase';
function commercialSource(source){
  const binding=source?.commercial;if(!binding)return '';
  const rows=[['Original Merchant case',binding.caseId],['Quotation family',binding.caseKey],
    ['Sealed quote',binding.quoteId],['Quote SHA-256',binding.quoteSha256],
    ['Accepted response',binding.acceptanceId],['Response SHA-256',binding.acceptanceSha256],
    ['Accepted scope SHA-256',binding.scopeSha256],['Original source file',binding.sourceId],
    ['Source SHA-256',binding.sourceSha256]];
  return '<details class="installation-effort-source"><summary>Original accepted quotation and delivery scope</summary>'+
    table(['Original selection','Retained value'],rows.map(([label,value])=>[esc(label),'<code>'+esc(value)+'</code>']))+
    (source.scope?'<pre>'+esc(text(source.scope))+'</pre>':'')+'</details>';
}
function phaseRows(value){return value.effortContext?.phaseSource?.phases||[];}
function workRows(value){return value.effortContext?.workInventory||[];}
function workLabel(row){
  return (row.description||row.id)+' · '+(row.contributorName||row.contributorId||'Unassigned contributor')+
    ' · '+hours(row.hours)+' · '+title(row.state);
}
function draftReview(value,phaseId){
  return value.effortReviewDrafts&&Object.hasOwn(value.effortReviewDrafts,phaseId)?value.effortReviewDrafts[phaseId]:{remainingHours:'',note:'',sourceIds:[]};
}
function originalTermChoices(plan){
  const result=[];
  function visit(value,path,names){
    if(path){
      const preview=Array.isArray(value)?value.length+' original entries':value&&typeof value==='object'?Object.keys(value).length+' original fields':text(value);
      result.push([path,names.join(' / ')+' · '+preview.slice(0,180)]);
    }
    if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){
      visit(child,path+'/'+key.replaceAll('~','~0').replaceAll('/','~1'),[...names,title(key)]);
    }
  }
  visit(plan,'',[]);
  return result;
}
function selectedTermRows(plan,paths){
  return paths.map(path=>{
    let value=plan;
    for(const key of path.split('/').slice(1).map(part=>part.replaceAll('~1','/').replaceAll('~0','~')))value=value&&typeof value==='object'&&Object.hasOwn(value,key)?value[key]:undefined;
    return [esc(path.split('/').slice(1).map(title).join(' / ')),'<pre>'+esc(value===undefined?'Original term absent from the current plan.':text(value))+'</pre>'];
  });
}
function phaseSummary(phase,commercial=false){
  if(commercial)return 'Recorded '+hours(phase.recordedHours)+' · internally accepted '+hours(phase.acceptedHours)+
    ' · reviewed remainder '+hours(phase.remainingHours)+' · projected total '+hours(phase.projectedTotalHours);
  return 'Quoted '+hours(phase.quotedHours)+' · recorded '+hours(phase.recordedHours)+
    ' · accepted '+hours(phase.acceptedHours)+' · reviewed remainder '+hours(phase.remainingHours);
}
export function installationEffortFields({draft:value,caseValue,editable,actor,button}){
  const effort=value.document.effort,context=value.effortContext,phases=phaseRows(value);
  const commercial=commercialEffort(value),unit=effortUnit(value),units=unit+'s';
  const eligible=!!value.installationId&&!!(value.document.workshare||value.document.commercial);
  const date=effort?.asOfDate||value.effortAsOfDate||new Date().toISOString().slice(0,10);
  const action=(label,name,attrs='',disabled=false)=>button(label,name,attrs,disabled||!editable);
  let html='<fieldset class="installation-effort" data-installation-effort-panel><legend>'+(commercial?'Delivery task effort':'Phase effort and support hours')+'</legend>'+
    (commercial?'<p>Assign original recorded work to the accepted delivery tasks, then review the effort still needed. The accepted quote binds task definitions and fees; quoted task effort remains unspecified.</p>':
      '<p>Assign the original recorded work to delivery phases. Review the effort still needed and track support against the original included hours and calendar terms.</p>')+
    '<div class="installation-fields">'+field('Review work through','asOfDate',date,{type:'date',help:'The report keeps later work and work spanning this date visible.'})+'</div>'+
    '<div class="installation-actions">'+action(commercial?'Read current work and accepted tasks':'Read current work and phases','effort-read','',!eligible)+'</div>';
  if(!eligible)return html+paragraph(value.installationId?'Receive the original accepted quotation or commercial Workshare to review its delivery effort here.':'Save the complete installation once, then open its saved edition to assign original work to its delivery tasks or phases.')+'</fieldset>';
  if(!effort)return html+paragraph('Read the current work and original '+units+' to prepare this installation’s effort review.')+'</fieldset>';
  html+='<div class="installation-fields">'+field('Effort review notes','note',effort.note||'',{area:true,wide:true})+'</div>';
  if(!context)return html+paragraph('Read current work and '+units+' to reopen the source inventory for this retained draft.')+'</fieldset>';
  if(context.source?.version!==caseValue.program.version)
    html+=paragraph('The operating case has changed since this inventory was opened. Read current work and '+units+' before using corrected work or applying remaining-hour reviews.');
  if(commercial){
    html+=commercialSource(context.phaseSource);
    html+=paragraph(context.phaseSource.effortBasis||'Quoted task effort is unspecified. Recorded work and reviewed remaining effort retain their original quantities.');
  }
  const phaseOptions=phases.map(row=>[row.phaseId,row.title+' · '+(commercial?'accepted task '+row.phaseId:hours(row.quotedHours))]);
  const inventory=workRows(value),byWork=new Map(inventory.map(row=>[row.id,row]));
  const reportByPhase=new Map((context.report?.effort?.phases||[]).map(row=>[row.phaseId,row]));
  html+='<h4>Original work allocations</h4><p>Split one original work record across '+units+' as needed. The native report checks its total assigned hours across current installations.</p>';
  if(!inventory.length)html+=paragraph(commercial?'This case has no recorded work available to allocate. Review the complete accepted task definitions and enter remaining estimates where known.':'This case has no recorded work available to allocate. The original phase estimates and support terms can still be reviewed.');
  html+=(effort.allocations||[]).map((row,index)=>{
    const work=byWork.get(row.workId),moved=!!work&&work.workContentSha256!==row.workContentSha256;
    let works=[['','Select original work'],...inventory.map(item=>[item.id,workLabel(item)])];
    if(row.workId&&!work)works.push([row.workId,row.workId+' · original record is unavailable in this inventory']);
    const p='allocations.'+index+'.';
    return '<div class="installation-entry" data-effort-allocation="'+index+'"><h4>Allocation '+(index+1)+'</h4><div class="installation-fields">'+
      field('Original work record',p+'workId',row.workId,{options:works,wide:true,required:true})+
      field('Original delivery '+unit,p+'phaseId',row.phaseId,{options:[['','Select original '+unit],...phaseOptions],required:true})+
      field('Hours assigned to this '+unit,p+'hours',row.hours,{type:'number',required:true,help:'Use the quantity that belongs to this '+unit+'.'})+
      field('Allocation explanation',p+'note',row.note,{area:true,wide:true})+'</div>'+
      (work?paragraph('Original work: '+hours(work.hours)+'. Assigned in this installation: '+hours(work.selectedAllocatedHours)+
        '; assigned in other installations: '+hours(work.otherAllocatedHours)+'; unassigned: '+hours(work.unallocatedHours)+'. Quantities are from the last complete source review.'):'')+
      (moved?paragraph('The original work record has a correction. Review its current details and explicitly use the corrected record for this allocation.')+
        action('Use corrected work record','effort-rebind','data-index="'+index+'"'):'')+
      action('Remove allocation','effort-remove-allocation','data-index="'+index+'"')+'</div>';
  }).join('')+'<div class="installation-actions">'+action('Add work allocation','effort-add-allocation','',!inventory.length||!phases.length)+'</div>';
  if(inventory.length)html+='<details class="installation-effort-inventory"><summary>Original work and current assignments</summary>'+
    table(['Original work','Contributor / state','Recorded quantity','Here / other installations / unassigned'],inventory.map(row=>[
      esc(row.description||row.id)+'<small>'+esc(row.id)+'</small>',esc(row.contributorName||row.contributorId||'Unassigned')+'<br>'+esc(title(row.state)),
      esc(hours(row.hours)),esc(hours(row.selectedAllocatedHours))+' / '+esc(hours(row.otherAllocatedHours))+' / '+esc(hours(row.unallocatedHours))
    ]))+'</details>';
  html+='<h4>Reviewed remaining hours</h4><p>Enter an explicit estimate for each '+unit+' you are reviewing. Applying it records the current original work, the reviewer and the time used as its basis.</p>'+
    '<div class="installation-fields">'+field('Remaining-work reviewer','reviewMeta.reviewedBy',value.effortReviewMeta?.reviewedBy??actor,{required:true})+
    field('Review time','reviewMeta.reviewedAt',value.effortReviewMeta?.reviewedAt||new Date().toISOString(),{required:true,help:'ISO timestamp with timezone.'})+'</div>';
  html+=phases.map(phase=>{
    const row=reportByPhase.get(phase.phaseId),pending=draftReview(value,phase.phaseId),existing=(effort.reviews||[]).find(item=>item.phaseId===phase.phaseId&&item.remainingHours!==null);
    const key=encodeURIComponent(phase.phaseId).replaceAll('.','%2E');
    return '<details class="installation-entry" data-effort-phase="'+esc(phase.phaseId)+'"><summary>'+esc(phase.title)+
      (commercial?' · quoted effort unspecified':' · quoted '+esc(hours(phase.quotedHours)))+(existing?' · reviewed remainder '+esc(hours(existing.remainingHours)):' · remainder unentered')+'</summary>'+
      (row?paragraph(phaseSummary(row,commercial)+(row.remainingReviewCurrent===false&&existing?'. The saved review has an older work basis.':'')):'')+
      (commercial?table(['Accepted task','Original value'],[
        ['Task ID','<code>'+esc(phase.taskId||phase.phaseId)+'</code>'],
        ['Acceptance check',esc(phase.checkId)+' · '+esc(title(phase.checkState))],
        ['Observed by / at',esc(phase.checkOperator||'Unentered')+' / '+esc(phase.checkObservedAt||'Unentered')],
        ['Original dependencies',esc((phase.dependsOn||[]).join(', ')||'None')],
        ['Definition SHA-256','<code>'+esc(phase.definitionSha256)+'</code>']
      ])+'<details><summary>Complete original task definition</summary><pre>'+esc(text(phase.terms))+'</pre></details>':'')+
      '<div class="installation-fields">'+field('Remaining hours to review','reviewDrafts.'+key+'.remainingHours',pending.remainingHours,{type:'number',help:'Zero is an explicit completed-effort estimate. Leave blank to keep this '+unit+'’s existing review.'})+
      field('Why this remaining estimate fits the delivery','reviewDrafts.'+key+'.note',pending.note,{area:true})+
      field('Original files supporting this review','reviewDrafts.'+key+'.sourceIds',pending.sourceIds,{options:caseValue.sources.map(row=>[row.id,row.filename]),multiple:true,wide:true})+'</div>'+
      (existing?paragraph('Current review by '+existing.reviewedBy+' at '+existing.reviewedAt+'. '+existing.note)+
        action('Clear remaining-hour review','effort-clear-review','data-phase="'+esc(phase.phaseId)+'"'):'')+'</details>';
  }).join('')+'<div class="installation-actions">'+action('Apply reviewed remaining hours','effort-apply-reviews','',!phases.length)+
    (hasUnappliedEffortReviews(value)?action('Clear entered estimates','effort-clear-entered-reviews'):'')+'</div>';
  if(!commercial)html+='<h4>Original support allowances</h4><p>Map the included hours and calendar window to the retained commercial source. The report uses the selected phase’s actual acceptance observation as the anchor.</p>'+
    '<details class="installation-effort-source"><summary>Read complete original commercial plan and support terms</summary><pre>'+esc(JSON.stringify(context.phaseSource?.plan||{},null,2))+'</pre></details>'+
    (effort.supportWindows||[]).map((row,index)=>{
      const p='supportWindows.'+index+'.',changed=!!row.sourcePlanSha256&&row.sourcePlanSha256!==context.phaseSource.planSha256;
      return '<details class="installation-entry" open><summary>Support allowance '+(index+1)+'</summary><div class="installation-fields">'+
        field('Allowance reference',p+'id',row.id,{required:true})+
        field('Support delivery phases',p+'phaseIds',row.phaseIds,{options:phaseOptions,multiple:true,required:true})+
        field('Included support hours',p+'includedHours',row.includedHours,{type:'number',required:true})+
        field('Calendar days after the anchor',p+'calendarDays',row.calendarDays,{type:'number',integer:true,required:true})+
        field('Actual delivery phase used as the anchor',p+'anchorPhaseId',row.anchorPhaseId,{options:[['','Select anchor phase'],...phaseOptions],required:true})+
        field('Original window begins after',p+'anchorKind',row.anchorKind,{options:[['ACCEPTANCE','Acceptance'],['HANDOFF','Handoff']],required:true})+
        field('Original terms that define this allowance',p+'sourcePaths',row.sourcePaths,{options:originalTermChoices(context.phaseSource.plan),multiple:true,wide:true,required:true,help:'Select the original included hours, calendar window and delivery trigger.'})+
        field('Source mapping reviewed by',p+'reviewedBy',row.reviewedBy,{required:true})+
        field('Source mapping reviewed at',p+'reviewedAt',row.reviewedAt,{required:true,help:'ISO timestamp with timezone.'})+
        field('Why these original terms define this allowance',p+'note',row.note,{area:true,wide:true,required:true})+'</div>'+
        (row.sourcePaths?.length?table(['Selected original term','Current original value'],selectedTermRows(context.phaseSource.plan,row.sourcePaths)):'')+
        (changed?paragraph('The commercial plan has a later edition. Review the original terms above and explicitly adopt the current plan for this allowance.')+action('Use current support terms','effort-rebind-support','data-index="'+index+'"'):'')+
        action('Remove support allowance','effort-remove-support','data-index="'+index+'"')+'</details>';
    }).join('')+'<div class="installation-actions">'+action('Add support allowance','effort-add-support','',!phases.length)+'</div>';
  if(context.report?.effort)html+=installationEffortReport(context.report.effort,{heading:'Last complete effort review'});
  return html+'</fieldset>';
}
export function captureInstallationEffort(root,value){
  const panel=root.querySelector('[data-installation-effort-panel]');if(!panel)return;
  for(const input of panel.querySelectorAll('[data-installation-effort-field]')){
    const path=input.dataset.installationEffortField;
    let selected=input.multiple?[...input.selectedOptions].map(item=>item.value):input.value;
    if(path==='asOfDate'){
      value.effortAsOfDate=selected;
      if(value.document.effort)value.document.effort.asOfDate=selected;
      continue;
    }
    if(path.startsWith('reviewMeta.')){
      value.effortReviewMeta??={};value.effortReviewMeta[path.slice(11)]=selected;continue;
    }
    if(path.startsWith('reviewDrafts.')){
      const parts=path.split('.'),phaseId=decodeURIComponent(parts[1]);value.effortReviewDrafts??={};
      if(!Object.hasOwn(value.effortReviewDrafts,phaseId))Object.defineProperty(value.effortReviewDrafts,phaseId,{value:{remainingHours:'',note:'',sourceIds:[]},enumerable:true,writable:true,configurable:true});
      value.effortReviewDrafts[phaseId][parts[2]]=selected;continue;
    }
    const effort=value.document.effort;if(!effort)continue;
    if(input.type==='number')selected=selected===''?null:path.endsWith('.calendarDays')?Number(selected):selected;
    if(path.endsWith('.sourcePaths')&&!Array.isArray(selected))selected=selected.split('\n').map(line=>line.trim()).filter(Boolean);
    const match=/^allocations\.(\d+)\.workId$/.exec(path);
    if(match){
      const allocation=effort.allocations[Number(match[1])];
      if(allocation.workId!==selected){
        allocation.workId=selected;
        allocation.workContentSha256=workRows(value).find(row=>row.id===selected)?.workContentSha256||'';
      }
    }else assign(effort,path,selected);
  }
}
export function changeInstallationEffort(value,action,target,actor){
  const effort=value.document.effort;if(!effort)throw new Error('Read current work and '+effortUnit(value)+'s first.');
  if(commercialEffort(value)&&/^effort-(?:add|remove|rebind)-support$/.test(action))
    throw new Error('The accepted task scope has no quoted support allowance. Review recurring service terms in their original workflow.');
  const index=Number(target.dataset.index);
  if(action==='effort-clear-entered-reviews')value.effortReviewDrafts={};
  else if(action==='effort-add-allocation')effort.allocations.push({workId:'',phaseId:'',hours:null,workContentSha256:'',note:''});
  else if(action==='effort-remove-allocation')effort.allocations.splice(index,1);
  else if(action==='effort-add-support')effort.supportWindows.push({id:'support-'+crypto.randomUUID().slice(0,8),phaseIds:[],includedHours:null,
    anchorPhaseId:'',anchorKind:'ACCEPTANCE',calendarDays:null,sourcePaths:[],sourcePlanSha256:value.effortContext.phaseSource.planSha256,reviewedBy:actor,reviewedAt:new Date().toISOString(),note:''});
  else if(action==='effort-remove-support')effort.supportWindows.splice(index,1);
  else if(action==='effort-rebind-support'){
    const window=effort.supportWindows[index];if(!window)throw new Error('Reopen the support allowance.');
    window.sourcePlanSha256=value.effortContext.phaseSource.planSha256;
    window.reviewedBy=window.reviewedBy||actor;window.reviewedAt=new Date().toISOString();
  }
  else if(action==='effort-clear-review'){
    effort.reviews=effort.reviews.filter(row=>row.phaseId!==target.dataset.phase);
    if(value.effortReviewDrafts)delete value.effortReviewDrafts[target.dataset.phase];
  }else if(action==='effort-rebind'){
    const allocation=effort.allocations[index],work=workRows(value).find(row=>row.id===allocation?.workId);
    if(!allocation||!work)throw new Error('Read the original work record before using its correction.');
    allocation.workContentSha256=work.workContentSha256;
  }else throw new Error('Unknown delivery effort action.');
  value.dirty=true;
}
export function applyInstallationEffortReviews(value,report,actor){
  const phases=new Map((report?.effort?.phases||[]).map(row=>[row.phaseId,row]));
  const proposed=Object.entries(value.effortReviewDrafts||{}).filter(([,row])=>row.remainingHours!==''&&row.remainingHours!==null&&row.remainingHours!==undefined);
  if(!proposed.length)throw new Error('Enter the remaining hours for at least one original '+effortUnit(value)+'.');
  const reviewedBy=(value.effortReviewMeta?.reviewedBy??actor).trim();
  const reviewedAt=value.effortReviewMeta?.reviewedAt||new Date().toISOString();
  if(!reviewedBy)throw new Error('Enter the remaining-work reviewer.');
  if(!/(?:Z|[+-]\d\d:\d\d)$/.test(reviewedAt)||!Number.isFinite(Date.parse(reviewedAt)))throw new Error('Enter the review time as an ISO timestamp with timezone.');
  const prepared=proposed.map(([phaseId,row])=>{
    const phase=phases.get(phaseId),remainingHours=Number(row.remainingHours);
    if(!phase?.reviewBasisSha256)throw new Error('Read the original '+effortUnit(value)+' and current work before applying its remaining estimate.');
    if(!Number.isFinite(remainingHours)||remainingHours<0)throw new Error('Remaining hours must be zero or a positive number.');
    if(!row.note?.trim())throw new Error('Explain the remaining-hour estimate for '+(phase.title||phaseId)+'.');
    return {phaseId,remainingHours:String(row.remainingHours).trim(),reviewedBy,reviewedAt,basisSha256:phase.reviewBasisSha256,note:row.note.trim(),sourceIds:copy(row.sourceIds||[])};
  });
  const replace=new Map(prepared.map(row=>[row.phaseId,row]));
  value.document.effort.reviews=(value.document.effort.reviews||[]).map(row=>replace.get(row.phaseId)||row);
  for(const row of prepared)if(!value.document.effort.reviews.some(item=>item.phaseId===row.phaseId))value.document.effort.reviews.push(row);
  for(const row of prepared)delete value.effortReviewDrafts[row.phaseId];
  value.dirty=true;
  return prepared.length;
}
export function installationEffortReport(report,{heading}={}){
  if(!report)return '';
  const phases=report.phases||[],commercial=report.sourceKind==='COMMERCIAL';
  heading??=commercial?'Delivery task effort':'Phase effort and support hours';
  let html='<section class="installation-effort-report"><h4>'+esc(heading)+'</h4>'+
    '<p>Work through '+esc(report.asOfDate)+' · '+esc(title(report.status))+
    (report.readyForPlanning?' · Reviewed remaining hours are ready for planning.':'')+'</p>'+
    (commercial?paragraph(report.effortBasis||'Quoted task effort is unspecified. Recorded work, internally accepted work and reviewed remaining estimates are kept separately.')+commercialSource(report)+
      (report.summary?table(['Recorded / internally accepted','Reviewed remainder / projected total','Unassigned / overallocated Work','Reviewed current tasks'],[[
        esc(hours(report.summary.recordedHours))+' / '+esc(hours(report.summary.acceptedHours)),
        esc(hours(report.summary.reviewedRemainingHours))+' / '+esc(hours(report.summary.projectedTotalHours)),
        esc(hours(report.summary.unallocatedSelectedWorkHours))+' / '+esc(hours(report.summary.overallocatedWorkHours)),
        esc(number(report.summary.reviewedPhases))+' / '+esc(number(report.summary.totalPhases))
      ]]):''):'')+
    table(commercial?['Accepted task','Allocated','Recorded / internally accepted','Reviewed remainder','Projected total']:['Original phase','Quoted / allocated','Recorded / accepted','Reviewed remainder','Projected overrun'],phases.map(row=>[
      esc(row.title||row.phaseId)+(commercial&&row.retired?'<small>Retained earlier task</small>':''),commercial?esc(hours(row.allocatedHours)):esc(hours(row.quotedHours))+' / '+esc(hours(row.allocatedHours)),
      esc(hours(row.recordedHours))+' / '+esc(hours(row.acceptedHours)),
      esc(hours(row.remainingHours))+(row.remainingReviewCurrent===false?'<small>Review the current work basis.</small>':''),
      esc(hours(commercial?row.projectedTotalHours:row.projectedOverrunHours))
    ]));
  if((report.findings||[]).length)html+=table(['Review item','Current finding'],report.findings.map(row=>[esc(row.phaseId||row.workId||row.field||row.code||row.kind||'Effort'),esc(row.message||text(row))]));
  if(!commercial&&(report.supportWindows||[]).length)html+='<h4>Support usage and original calendar windows</h4>'+
    table(['Original allowance','Included / recorded','Unused allowance / overrun','Original anchor and window','Assessment'],report.supportWindows.map(row=>[
      esc(row.id),esc(hours(row.includedHours))+' / '+esc(hours(row.recordedHours)),
      esc(hours(row.includedHoursBalance))+' / '+esc(hours(row.recordedOverrunHours)),
      esc(row.anchor?.startDate||'Awaiting original acceptance')+'<br>'+esc(row.windowEndDate||'')+'<br>'+esc(number(row.calendarDays))+' calendar days',
      esc(title(row.status))+(row.message?'<p>'+esc(row.message)+'</p>':'')
    ]));
  for(const window of commercial?[]:report.supportWindows||[]){
    html+='<details><summary>'+esc(window.id)+' · original terms and support work</summary>'+
      table(['Original term','Retained source value'],(window.sourceTerms||[]).map(row=>[esc(row.path.split('/').slice(1).map(title).join(' / ')),'<pre>'+esc(text(row.value))+'</pre>']))+
      table(['Recorded support span','Assigned hours','Window assessment'],(window.attributions||[]).map(row=>[
        esc(row.workId)+'<br>'+esc(row.startDate)+' to '+esc(row.endDate),esc(hours(row.hours)),esc(title(row.classification))+(row.sourceChanged?'<small>Original work has a correction.</small>':'')
      ]))+
      paragraph('Reviewed remaining support: '+hours(window.reviewedRemainingHours)+'. Projected overrun: '+hours(window.projectedOverrunHours)+'.')+'</details>';
  }
  if(commercial){
    const retired=phases.filter(row=>row.retired);
    if(retired.length)html+='<details><summary>Retained earlier tasks and their accepted source</summary>'+retired.map(row=>
      '<h5>'+esc(row.title||row.phaseId)+'</h5>'+paragraph('Task '+row.phaseId+' · original acceptance check '+row.checkId)+
      commercialSource({commercial:row.originalCommercial})+
      '<pre>'+esc(text(row.terms))+'</pre>').join('')+'</details>';
  }
  const noteworthy=phases.filter(row=>[row.voidHours,row.sourceChangedHours,row.afterAsOfHours,row.spansAsOfHours].some(n=>Number(n)>0));
  if(noteworthy.length)html+='<details><summary>Corrections and work around the review date</summary>'+
    table([commercial?'Task':'Phase','Voided','Changed source','After review date','Spans review date'],noteworthy.map(row=>[
      esc(row.title||row.phaseId),esc(hours(row.voidHours)),esc(hours(row.sourceChangedHours)),esc(hours(row.afterAsOfHours)),esc(hours(row.spansAsOfHours))
    ]))+'</details>';
  return html+'</section>';
}

export function installationEffortPlanningPanel({state,caseValue,button,canOpenForecast}){
  if(!state.open)return '';
  const options=[['','Select saved forecast'],...(caseValue.forecasts||[]).map(row=>[row.id,(row.name||row.id)+' · '+(row.asOfDate||'')])];
  const select=(label,key,value,rows,attrs='')=>'<label><span>'+esc(label)+'</span><select data-effort-planning-field="'+esc(key)+'" '+attrs+'>'+rows.map(([id,name])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>';
  const forecasts=state.forecast,commercial=forecasts?.inputs?.commercial||[];
  const choices=[['','Keep the saved remaining hours'],...(state.installationChoices||[]).map(row=>[row.id,row.name+' · edition '+row.revision])];
  let html='<section class="installation-preview installation-effort-planning" aria-label="Remaining work forecast"><div class="installation-heading"><div><h3>Remaining work forecast</h3><p>Bring the reviewed phase estimates into the complete original operating forecast.</p></div>'+
    '<div class="installation-actions">'+button('Close','effort-planning-close')+'</div></div><div class="installation-fields">'+
    select('Original saved operating forecast','forecastId',state.forecastId||'',options)+'</div><div class="installation-actions">'+
    button('Read saved forecast','effort-planning-read','',!state.forecastId)+'</div>';
  if(forecasts){
    html+=paragraph('Original forecast: '+forecasts.inputs.name+'. Review date: '+forecasts.inputs.asOfDate+
      '. Select saved installation editions reviewed through the same date.')+
      '<div class="installation-fields"><label class="installation-wide"><span>Name for the complete successor forecast</span><input data-effort-planning-field="name" maxlength="300" value="'+esc(state.name||'')+'"></label>'+
      '<label class="installation-wide"><span>Reason for the remaining-work forecast</span><textarea data-effort-planning-field="note" rows="3" maxlength="12000">'+esc(state.note||'')+'</textarea></label></div>'+
      table(['Original customer work','Saved remaining hours','Reviewed installation edition'],commercial.map(row=>[
        esc(row.title||row.name||row.caseRef||row.id)+'<small>'+esc(row.caseRef||row.id)+'</small>',
        esc(hours(row.remainingHours)),
        select('Installation for '+(row.title||row.name||row.caseRef||row.id),'task.'+encodeURIComponent(row.id),state.taskInstallations?.[row.id]||'',choices)
      ]))+
      (commercial.length?'':paragraph('This saved forecast has no original commercial work to receive phase estimates.'))+
      '<div class="installation-actions">'+button(canOpenForecast?'Open remaining-work forecast':'Download complete remaining-work forecast','effort-planning-open','',!commercial.length||!Object.values(state.taskInstallations||{}).some(Boolean))+'</div>';
  }
  if(state.lastSelection)html+='<details><summary>Last prepared remaining-work handover</summary>'+
    table(['Original task','Reviewed installation edition','Previous / reviewed remaining hours'],(state.lastSelection.effort||[]).map(row=>[
      esc(row.taskId),esc(row.installationId)+' · '+esc(row.installationRevision),
      esc(hours(row.originalRemainingHours))+' / '+esc(hours(row.remainingHours))
    ]))+'</details>';
  return html+'</section>';
}
export function captureInstallationEffortPlanning(root,state){
  for(const input of root.querySelectorAll('[data-effort-planning-field]')){
    const key=input.dataset.effortPlanningField;
    if(key.startsWith('task.')){state.taskInstallations??={};Object.defineProperty(state.taskInstallations,decodeURIComponent(key.slice(5)),{value:input.value,enumerable:true,writable:true,configurable:true});}
    else state[key]=input.value;
  }
}

export function hasUnappliedEffortReviews(value){
  return Object.values(value?.effortReviewDrafts||{}).some(row=>
    row.remainingHours!==''&&row.remainingHours!==null&&row.remainingHours!==undefined||
    !!row.note?.trim()||!!row.sourceIds?.length);
}

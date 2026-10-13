/** Saved Installation phase planning in the original Portfolio editor. */
const list=value=>Array.isArray(value)?value:[];
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const scale=100000000n;
function amount(value){const m=String(value??'').match(/^(\d+)(?:\.(\d{0,8}))?$/);return m?BigInt(m[1])*scale+BigInt((m[2]||'').padEnd(8,'0')):null;}
function decimal(value){return (value/scale).toString()+((value%scale)?'.'+(value%scale).toString().padStart(8,'0').replace(/0+$/,''):'');}
function sum(values){const numbers=values.map(amount);return numbers.every(x=>x!==null)?numbers.reduce((a,b)=>a+b,0n):null;}
function observed(value){if(!value)return 'Not entered';const parsed=new Date(value);return Number.isNaN(parsed.getTime())?String(value):new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}).format(parsed);}
function date(value){if(!value)return 'Not entered';const match=String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);return match?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z')):String(value);}
const button=(label,action,attrs='')=>'<button type="button" data-portfolio-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
function input(label,value,attrs='',type='text',help=''){return '<label>'+esc(label)+'<input type="'+type+'" value="'+esc(value??'')+'" '+attrs+'>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';}
function area(label,value,attrs='',help=''){return '<label class="portfolio-wide">'+esc(label)+'<textarea rows="2" '+attrs+'>'+esc(value??'')+'</textarea>'+(help?'<small>'+esc(help)+'</small>':'')+'</label>';}
function table(head,rows){return '<div class="portfolio-table"><table><thead><tr>'+head.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function readable(value){if(value===null||value===undefined)return 'Not entered';if(typeof value==='string')return value;if(Array.isArray(value))return value.map(readable).join('; ');if(plain(value))return Object.entries(value).map(([key,entry])=>key.replace(/[_-]/g,' ')+': '+readable(entry)).join('; ');return String(value);}
export function installationIdentity(value){return [value?.installationId,value?.installationRevision,value?.installationSha256].join(':');}
export function mergeInstallationCandidates(current,incoming){const merged=new Map(list(current).map(x=>[installationIdentity(x),x]));for(const candidate of list(incoming))merged.set(installationIdentity(candidate),candidate);return [...merged.values()];}
export function candidateForPlan(candidates,plan){return list(candidates).find(x=>installationIdentity(x)===installationIdentity(plan))||null;}
export function validateInstallationPlans(plans,label='Installation phase plans'){
  if(!Array.isArray(plans))throw new Error(label+' needs its complete array.');
  const tasks=new Set();
  for(const plan of plans){
    if(!plain(plan)||typeof plan.taskId!=='string'||typeof plan.installationId!=='string'||!Number.isInteger(plan.installationRevision)||typeof plan.installationSha256!=='string'||!Array.isArray(plan.deliveryPhaseIds)||!Array.isArray(plan.phases))throw new Error('Each installation phase plan needs its saved edition, delivery boundary and complete phase array.');
    if(tasks.has(plan.taskId))throw new Error('Choose one installation phase plan for each original customer task.');tasks.add(plan.taskId);
    const ids=new Set();
    for(const phase of plan.phases){if(!plain(phase)||typeof phase.phaseId!=='string'||ids.has(phase.phaseId)||!plain(phase.effortHours)||!Array.isArray(phase.dependsOn))throw new Error('Each phase needs its original ID, effort assignments and complete dependency array.');ids.add(phase.phaseId);}
    if(plan.deliveryPhaseIds.some(id=>typeof id!=='string'||!ids.has(id)))throw new Error('Select delivery milestones from this installation’s original phases.');
  }
}
export function installationClosure(plan){
  const phases=new Map(list(plan.phases).map(x=>[x.phaseId,x])),found=new Set(),pending=[...list(plan.deliveryPhaseIds)];
  while(pending.length){const id=pending.pop();if(found.has(id)||!phases.has(id))continue;found.add(id);pending.push(...list(phases.get(id).dependsOn));}
  return found;
}
export function installationPlanSummary(plan,expected){
  const total=sum(list(plan.phases).map(x=>x.remainingHours)),source=amount(expected);
  return total===null?'Remaining phase hours need review':decimal(total)+' / '+(expected??'unentered')+' original remaining hours'+(source!==null&&total!==source?' — reconcile total':'');
}
export function renderInstallationPlanning({profile,inputs,candidates,choices,taskName,taskHours}){
  const plans=list(inputs.installationPlans),rows=list(inputs.tasks).filter(t=>t.id.startsWith('commercial/')||plans.some(p=>p.taskId===t.id));
  if(!rows.length)return '<p class="portfolio-muted">This forecast has no selected customer work to divide into installation phases.</p>';
  return '<p>Use the phases from a saved customer installation to assign the same remaining work across people and dates. Choose which phase completes delivery; later support keeps its own resource allocation.</p><div class="portfolio-actions">'+button('Refresh saved installations','refresh-installations')+'</div>'+rows.map(task=>{
    const plan=plans.find(x=>x.taskId===task.id),current=plan?candidateForPlan(candidates,plan):null;
    const matching=list(candidates).filter(c=>!c.unavailable&&list(c.matchingTaskIds).includes(task.id));
    if(current&&!matching.some(c=>installationIdentity(c)===installationIdentity(current)))matching.push(current);
    const key=profile+'|'+task.id,selected=Object.hasOwn(choices,key)?choices[key]:(plan?installationIdentity(plan):'');
    const available=matching.some(c=>installationIdentity(c)===selected&&c.selectionAvailable!==false);
    const options='<option value="">Choose a saved installation edition</option>'+matching.map(c=>'<option value="'+esc(installationIdentity(c))+'"'+(installationIdentity(c)===selected?' selected':'')+(c.selectionAvailable===false?' disabled':'')+'>'+esc((c.name||c.title||c.installationId)+' · edition '+c.installationRevision+(c.selectionAvailable===false?' · retained edition':c.stage?' · '+c.stage:''))+'</option>').join('');
    const pick='<div class="portfolio-installation-picker"><label>Saved installation<select data-portfolio-installation-choice="'+esc(task.id)+'">'+options+'</select></label>'+button(plan?'Use selected installation edition':'Use installation phases','use-installation','data-task-id="'+esc(task.id)+'"'+(available?'':' disabled data-portfolio-disabled="true"'))+(plan?button('Use aggregate work instead','remove-installation','data-task-id="'+esc(task.id)+'"'):'')+'</div>';
    let body='<article class="portfolio-installation-plan" data-installation-plan="'+esc(task.id)+'"><h5>'+esc(taskName(task.id))+'</h5><p class="portfolio-muted">'+esc(taskHours(task.id)??'Unentered')+' remaining hours in the original forecast.</p>'+pick;
    if(!matching.length){const originals=list(candidates).filter(candidate=>!candidate.unavailable&&candidate.selectionAvailable!==false);body+='<p class="portfolio-muted">A matching installation needs the original operating forecast’s exact Workshare case reference and commissioning source. Review those fields in Operating forecast, save and select that forecast edition, then refresh this list. Save the Workshare installation in this case if it has not yet been added.</p>'+(originals.length?'<details><summary>Available original installation references</summary>'+table(['Saved installation','Workshare case reference','Commissioning source'],originals.map(candidate=>[esc(candidate.name||candidate.title||candidate.installationId),esc(candidate.caseId),esc(candidate.sourceId)]))+'</details>':'');}
    if(!plan)return body+'</article>';
    const closure=installationClosure(plan),phaseSources=list(current?.phases),sources=new Map(phaseSources.map(p=>[p.phaseId,p]));
    body+='<p class="portfolio-phase-balance" data-portfolio-plan-balance>'+esc(installationPlanSummary(plan,taskHours(task.id)))+'</p>';
    if(!current)body+='<p class="portfolio-note">The complete phase input is retained. Refresh its saved installation source to display the original scope and acceptance observations.</p>';
    if(current?.selectionAvailable===false)body+='<p class="portfolio-note">This plan retains an earlier installation edition. Select a current saved edition to refresh its source before saving a revised plan.</p>';
    if(current?.unavailable)body+='<p class="portfolio-note">'+esc(current.unavailable.message||'This saved edition needs its original source.')+'</p>';
    body+='<div class="portfolio-delivery-boundary"><strong>Delivery milestone</strong><p>Choose the phase or phases that complete the customer’s delivery promise. Their predecessors are included automatically. Other phases, including later support, still consume capacity.</p><div class="portfolio-boundary-options">'+plan.phases.map(phase=>{
      const source=sources.get(phase.phaseId)||{},selected=list(plan.deliveryPhaseIds).includes(phase.phaseId);
      return '<label class="portfolio-check"><input type="checkbox" data-portfolio-phase-plan="'+esc(task.id)+'" data-phase-id="'+esc(phase.phaseId)+'" data-phase-boundary'+(selected?' checked':'')+'>'+esc(source.title||phase.phaseId)+'</label>';
    }).join('')+'</div>'+area('Basis for the delivery milestone',plan.deliveryBoundaryNote,'data-portfolio-phase-plan="'+esc(task.id)+'" data-phase-plan-key="deliveryBoundaryNote"','Record the customer term or reviewed delivery decision that defines this boundary.')+'</div>';
    body+=plan.phases.map(phase=>{
      const source=sources.get(phase.phaseId)||{},attrs='data-portfolio-phase-plan="'+esc(task.id)+'" data-phase-id="'+esc(phase.phaseId)+'"',mandatory=list(source.dependsOn);
      const total=sum(Object.values(phase.effortHours||{})),remaining=amount(phase.remainingHours);
      const assignments=total===null?'Assignments incomplete':decimal(total)+' / '+(phase.remainingHours??'unentered')+' remaining hours'+(remaining!==null&&total!==remaining?' — reconcile total':'');
      const additional=list(phase.dependsOn).filter(id=>!mandatory.includes(id)),options=plan.phases.filter(p=>p.phaseId!==phase.phaseId&&!mandatory.includes(p.phaseId));
      const observations=source.checkState?'<p class="portfolio-muted">Saved acceptance observation: '+esc(source.checkState)+(source.checkOperator?' · '+esc(source.checkOperator):'')+(source.checkObservedAt?' · '+esc(observed(source.checkObservedAt)):'')+'. Review remaining effort separately.</p>':'';
      return '<details class="portfolio-phase"><summary><span>'+esc(source.title||phase.phaseId)+'</span><small><span data-phase-delivery-scope="'+esc(phase.phaseId)+'">'+esc(closure.has(phase.phaseId)?'Within delivery milestone':'Outside delivery milestone')+'</span> · <span data-phase-effort-summary="'+esc(phase.phaseId)+'">'+esc(assignments)+'</span></small></summary><p class="portfolio-muted">Original scope: '+esc(source.quotedHours??'unentered')+' hours'+(source.owner?' · owner '+esc(readable(source.owner)):'')+(source.coordinationOwner?' · task assignee '+esc(source.coordinationOwner):'')+'. Original stated duration: '+esc(source.businessDays===null||source.businessDays===undefined?'not specified':source.businessDays+' working days')+'.</p>'+observations+'<div class="portfolio-fields">'+input('Remaining phase hours',phase.remainingHours,attrs+' data-phase-key="remainingHours" min="0" step="0.00000001"','number','Review the amount still to do; the saved acceptance state does not fill this value.')+input('Minimum remaining working duration',phase.minBusinessDays,attrs+' data-phase-key="minBusinessDays" min="0" step="1"','number','Enter 0 when no remaining minimum duration applies.')+input('Phase release date',phase.releaseDate,attrs+' data-phase-key="releaseDate"','date')+input('Phase due date',phase.dueDate,attrs+' data-phase-key="dueDate"','date')+input('Phase priority',phase.priority,attrs+' data-phase-key="priority" step="1" placeholder="Use task priority"','number','Leave blank to use the parent customer task priority.')+'<label>Additional predecessors<select multiple size="3" '+attrs+' data-phase-dependencies'+(sources.has(phase.phaseId)?'':' disabled data-portfolio-disabled="true"')+'>'+options.map(p=>'<option value="'+esc(p.phaseId)+'"'+(additional.includes(p.phaseId)?' selected':'')+'>'+esc(sources.get(p.phaseId)?.title||p.phaseId)+'</option>').join('')+'</select></label>'+area('Remaining work or date assumption',phase.note,attrs+' data-phase-key="note"')+'</div>'+(mandatory.length?'<p class="portfolio-muted">Original predecessors: '+mandatory.map(id=>esc(sources.get(id)?.title||id)).join(', ')+'. These source dependencies remain in the plan.</p>':'')+'<h5>Remaining effort by resource</h5>'+(inputs.resources.length?'<div class="portfolio-effort-grid">'+inputs.resources.map(r=>input(r.name||r.id,phase.effortHours?.[r.id],attrs+' data-phase-resource="'+esc(r.id)+'" min="0" step="0.00000001"','number')).join('')+'</div>':'<p class="portfolio-muted">Add a role or person in Resource availability to assign phase effort.</p>')+'<details class="portfolio-phase-terms"><summary>Original phase terms</summary><p>'+esc(readable(source.terms||{}))+'</p></details></details>';
    }).join('');
    body+=area('Installation planning assumptions',plan.note,'data-portfolio-phase-plan="'+esc(task.id)+'" data-phase-plan-key="note"');
    if(current)body+='<details><summary>Saved installation and customer terms</summary><p>'+esc((current.name||current.title||current.installationId)+' · edition '+current.installationRevision)+'</p><p>'+esc(readable(current.schedule||{}))+'</p><p>'+esc(readable(current.commercial||{}))+'</p></details>';
    return body+'</article>';
  }).join('');
}
export function renderInstallationPlanResults(plans,taskName){
  if(!list(plans).length)return '';
  return '<section class="portfolio-phase-results"><h4>Installation delivery and remaining support</h4><p>Delivery dates follow the reviewed milestone and its predecessors. The complete finish includes all remaining phases and their resource allocation.</p>'+list(plans).map(plan=>{
    const rows=list(plan.phases);
    return '<article><h5>'+esc(taskName(plan.taskId))+'</h5>'+table(['Delivery begins','Delivery milestone','All remaining work finishes','Original quoted hours','Remaining hours'],[[esc(date(plan.deliveryStartDate)),esc(date(plan.deliveryFinishDate)),esc(date(plan.allWorkFinishDate)),esc(plan.quotedHours),esc(plan.remainingHours)]])+'<p>'+esc(plan.deliveryBoundaryNote||'Delivery milestone basis remains unentered.')+'</p>'+table(['Phase','Source owner','Current assignee','Delivery scope','Remaining hours','Starts','Finishes','Phase due'],rows.map(phase=>[esc(phase.title||phase.phaseId),esc(readable(phase.owner||'Not entered')),esc(phase.coordinationOwner||'Unassigned'),phase.deliveryScope?'Included':'Separate remaining work',esc(phase.remainingHours??'Not entered'),esc(date(phase.startDate)),esc(date(phase.finishDate)),esc(date(phase.dueDate))]))+'</article>';
  }).join('')+'</section>';
}

export function updateInstallationSummaries(root,plan,expected){
  const article=[...root.querySelectorAll('[data-installation-plan]')].find(node=>node.dataset.installationPlan===plan.taskId);
  if(!article)return;
  const balance=article.querySelector('[data-portfolio-plan-balance]');if(balance)balance.textContent=installationPlanSummary(plan,expected);
  const closure=installationClosure(plan);
  for(const node of article.querySelectorAll('[data-phase-delivery-scope]'))node.textContent=closure.has(node.dataset.phaseDeliveryScope)?'Within delivery milestone':'Outside delivery milestone';
  for(const node of article.querySelectorAll('[data-phase-effort-summary]')){
    const phase=plan.phases.find(row=>row.phaseId===node.dataset.phaseEffortSummary);if(!phase)continue;
    const total=sum(Object.values(phase.effortHours||{})),remaining=amount(phase.remainingHours);
    node.textContent=total===null?'Assignments incomplete':decimal(total)+' / '+(phase.remainingHours??'unentered')+' remaining hours'+(remaining!==null&&total!==remaining?' — reconcile total':'');
  }
}

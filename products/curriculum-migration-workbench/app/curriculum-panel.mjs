/* Optional curriculum planner panel for the existing workbench.
 * Parent owns workspace loading, saving and concurrency checks.
 */
import {planCurriculumCase,decideCurriculumPlan,curriculumPortfolio,curriculumReviewRows} from './curriculum-migration.mjs';

export function mountCurriculumPlanner(container,{getWorkspace,onWorkspace,actor,now=()=>new Date().toISOString()}){
  if(!container?.ownerDocument||typeof getWorkspace!=='function'||typeof onWorkspace!=='function')throw new Error('A container and existing workspace callbacks are required.');
  const doc=container.ownerDocument;
  let selectedCase=null,selectedPlan=null,draftMappings=[],draftNamespaces={original:'',candidate:''},draftNote='',busy=false,disposed=false,page=0,filter='all',syncDraftState=()=>{};
  const root=doc.createElement('section');root.className='curriculum-planner';
  const style=doc.createElement('style');
  style.textContent='.curriculum-planner{font:14px/1.5 system-ui,sans-serif;color:#202020;background:#fff;border:1px solid #bcbcbc;padding:20px;max-width:100%;box-sizing:border-box}.curriculum-planner *{box-sizing:border-box}.curriculum-planner h2{font-size:20px;margin:0 0 8px}.curriculum-planner h3{font-size:16px;margin:20px 0 8px}.curriculum-planner p{margin:8px 0}.curriculum-planner button,.curriculum-planner input,.curriculum-planner select,.curriculum-planner textarea{font:inherit;color:inherit;background:#fff;border:1px solid #999;border-radius:2px;padding:7px;min-height:36px}.curriculum-planner button{cursor:pointer;background:#f3f3f3}.curriculum-planner button:disabled{cursor:default;opacity:.5}.curriculum-planner button:focus-visible,.curriculum-planner input:focus-visible,.curriculum-planner select:focus-visible,.curriculum-planner textarea:focus-visible{outline:2px solid #111;outline-offset:2px}.curriculum-planner label{display:flex;flex-direction:column;gap:4px;min-width:0}.curriculum-planner .cp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}.curriculum-planner .cp-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:12px 0}.curriculum-planner .cp-mapping{display:grid;grid-template-columns:90px minmax(100px,1fr) minmax(100px,1fr) minmax(150px,2fr) auto;gap:8px;margin:8px 0}.curriculum-planner .cp-table-wrap{overflow:auto;border:1px solid #ccc}.curriculum-planner table{border-collapse:collapse;width:100%;text-align:left}.curriculum-planner th,.curriculum-planner td{padding:8px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}.curriculum-planner th{background:#f3f3f3;font-weight:600}.curriculum-planner pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;max-height:420px;overflow:auto;background:#f5f5f5;padding:12px}.curriculum-planner .cp-status{padding:8px 12px;border:1px solid #aaa;background:#f7f7f7;margin:12px 0;white-space:pre-wrap}.curriculum-planner .cp-muted{color:#555}.curriculum-planner textarea{width:100%;min-height:84px}.curriculum-planner .cp-summary{display:flex;gap:12px;flex-wrap:wrap}.curriculum-planner .cp-summary span{border:1px solid #ccc;padding:8px 12px}.curriculum-planner input,.curriculum-planner select{max-width:100%;min-width:0}@media(max-width:650px){.curriculum-planner{padding:12px}.curriculum-planner .cp-mapping{grid-template-columns:1fr 1fr}.curriculum-planner .cp-mapping label:nth-child(4){grid-column:1/-1}.curriculum-planner .cp-mapping button{grid-column:1/-1}}';
  container.append(style,root);
  function el(tag,text,className){
    const node=doc.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;
  }
  function field(label,input){const node=el('label');node.append(el('span',label),input);return node;}
  function input(value,placeholder=''){const node=el('input');node.type='text';node.value=value??'';node.placeholder=placeholder;return node;}
  function select(values,value){
    const node=el('select');for(const item of values){const option=el('option',item.label);option.value=item.value;node.append(option);}node.value=value;return node;
  }
  function button(label,fn){const node=el('button',label);node.type='button';node.disabled=busy;node.addEventListener('click',fn);return node;}
  function detail(label,value){
    const d=el('details'),s=el('summary',label);d.append(s);let loaded=false;
    d.addEventListener('toggle',()=>{if(d.open&&!loaded){d.append(el('pre',JSON.stringify(value,null,2)));loaded=true;}});
    return d;
  }
  function context(){
    const name=typeof actor==='function'?actor():actor;
    if(typeof name!=='string'||!name.trim())throw new Error('Enter the operating engineer in the workspace.');
    return {actor:name,at:now()};
  }
  function announce(message,error=false){
    let status=root.querySelector('[data-curriculum-status]');
    if(!status){status=el('div',undefined,'cp-status');status.dataset.curriculumStatus='true';root.prepend(status);}
    status.setAttribute('role',error?'alert':'status');status.textContent=message;
  }
  async function save(operation){
    if(busy||disposed)return;
    busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{
      const before=getWorkspace(),expectedRevision=before.revision,workspaceId=before.id;
      const next=operation(before);
      // Parent must reject if its workspace has advanced since this observed revision.
      await onWorkspace(next,{workspaceId,expectedRevision});
      if(disposed)return;
      const saved=getWorkspace();
      if(saved.id!==next.id||saved.revision!==next.revision)throw new Error('The workspace was not saved at the expected revision. Refresh before continuing.');
      busy=false;render();announce('Saved to the current workspace.');
    }catch(error){busy=false;if(!disposed){render();announce(error.message||String(error),true);}}
  }
  function loadDraft(c){
    const p=c?.curriculumPlans?.at(-1);selectedPlan=p?.id??null;draftMappings=JSON.parse(JSON.stringify(p?.mappings||[]));draftNamespaces={original:p?.input.namespaces.original||'',candidate:p?.input.namespaces.candidate||''};draftNote='';page=0;
  }
  function render(){
    if(disposed)return;
    syncDraftState=()=>{};
    root.replaceChildren();
    root.append(el('h2','Curriculum migration'),el('p','Compare retained bulk response editions, review every occurrence and save an engineering decision.','cp-muted'));
    let w,portfolio;
    try{w=getWorkspace();portfolio=curriculumPortfolio(w);}catch(error){announce(error.message||String(error),true);return;}
    const cases=w.cases.filter(c=>c.operationKey==='BULK');
    if(!cases.length){root.append(el('p','Create a BULK case and retain its original and candidate responses in the workspace.'));return;}
    if(!cases.some(c=>c.id===selectedCase)){selectedCase=cases[0].id;loadDraft(cases[0]);}
    const c=cases.find(c=>c.id===selectedCase),state=portfolio.find(r=>r.caseId===c.id),plans=c.curriculumPlans||[];
    const activePlan=plans.find(p=>p.id===selectedPlan)||plans.at(-1);
    if(activePlan)selectedPlan=activePlan.id;
    const caseSelect=select(cases.map(x=>({value:x.id,label:x.name||x.id})),c.id);
    caseSelect.addEventListener('change',()=>{selectedCase=caseSelect.value;loadDraft(cases.find(x=>x.id===selectedCase));render();});
    root.append(field('Bulk case',caseSelect),el('p','Source: '+c.sourceEditionId+' · Candidate: '+c.targetEditionId+' · Latest plan state: '+state.state+' · Latest decision: '+state.decision));
    const namespaces=draftNamespaces;
    const originalNamespace=input(namespaces.original,'Enter the source identifier namespace');
    const candidateNamespace=input(namespaces.candidate,'Enter the candidate identifier namespace');
    originalNamespace.addEventListener('input',()=>{draftNamespaces.original=originalNamespace.value;syncDraftState();});
    candidateNamespace.addEventListener('input',()=>{draftNamespaces.candidate=candidateNamespace.value;syncDraftState();});
    const grid=el('div',undefined,'cp-grid');
    grid.append(field('Original namespace',originalNamespace),field('Candidate namespace',candidateNamespace));root.append(grid);
    root.append(detail('Current field transformations',c.mappings));
    root.append(el('h3','Explicit occurrence mappings'),el('p','Unique valid identities match automatically. Select source and candidate occurrences explicitly when identities differ or repeat. Record the reason for each selection.','cp-muted'));
    const mappingList=el('div');root.append(mappingList);
    function drawMappings(){
      mappingList.replaceChildren();
      draftMappings.forEach((mapping,index)=>{
        const row=el('div',undefined,'cp-mapping');
        const kind=select([{value:'unit',label:'Unit'},{value:'lesson',label:'Lesson'}],mapping.kind);
        const from=input(mapping.from,'/sequence/0'),to=input(mapping.to,'/sequence/0'),reason=input(mapping.reason,'Engineering reason');
        kind.addEventListener('change',()=>{mapping.kind=kind.value;syncDraftState();});
        from.addEventListener('input',()=>{mapping.from=from.value;syncDraftState();});
        to.addEventListener('input',()=>{mapping.to=to.value;syncDraftState();});
        reason.addEventListener('input',()=>{mapping.reason=reason.value;syncDraftState();});
        row.append(field('Kind',kind),field('Original pointer',from),field('Candidate pointer',to),field('Reason',reason),
          button('Remove',()=>{draftMappings.splice(index,1);drawMappings();syncDraftState();}));
        mappingList.append(row);
      });
    }
    drawMappings();
    const actions=el('div',undefined,'cp-actions');
    actions.append(button('Add occurrence mapping',()=>{draftMappings.push({kind:'unit',from:'',to:'',reason:''});drawMappings();syncDraftState();}),
      button('Create migration plan',()=>save(before=>{
        const next=planCurriculumCase(before,c.id,{namespaces:{original:originalNamespace.value,candidate:candidateNamespace.value},mappings:draftMappings},context());
        selectedPlan=next.cases.find(x=>x.id===c.id).curriculumPlans.at(-1).id;page=0;return next;
      })));
    root.append(actions);
    if(!activePlan){root.append(el('p','Save both successful bulk responses, select their namespaces, then create the first plan.'));return;}
    root.append(el('h3','Retained plans'));
    const planSelect=select(plans.map(p=>({value:p.id,label:p.id+' · '+p.status+' · '+p.at})),activePlan.id);
    planSelect.addEventListener('change',()=>{selectedPlan=planSelect.value;const chosen=plans.find(p=>p.id===selectedPlan);draftMappings=JSON.parse(JSON.stringify(chosen.mappings));draftNamespaces={...chosen.input.namespaces};draftNote='';page=0;render();});
    root.append(field('Plan edition',planSelect));
    const summary=activePlan.comparison.summary,strip=el('div',undefined,'cp-summary');
    for(const [label,value] of [['Plan',activePlan.status],['Matched units',summary.matchedUnits],['Matched lessons',summary.matchedLessons],['Unmatched',summary.unmatchedOccurrences],['Ambiguous',summary.ambiguousIdentities],['Wire changes',summary.wireDifferences]])strip.append(el('span',label+': '+value));
    root.append(strip);
    const review=curriculumReviewRows(activePlan);
    root.append(el('h3','Review'));
    const sections=['all',...new Set(review.map(r=>r.section))];
    if(!sections.includes(filter))filter='all';
    const filterSelect=select(sections.map(s=>({value:s,label:s==='all'?'All findings':s})),filter);
    filterSelect.addEventListener('change',()=>{filter=filterSelect.value;page=0;render();});
    root.append(field('Finding category',filterSelect));
    const rows=review.filter(r=>filter==='all'||r.section===filter),pageSize=50,pages=Math.max(1,Math.ceil(rows.length/pageSize));
    page=Math.max(0,Math.min(page,pages-1));
    const wrap=el('div',undefined,'cp-table-wrap'),table=el('table'),head=el('thead'),tr=el('tr');
    for(const label of ['Category','Source / path','Finding','Details'])tr.append(el('th',label));head.append(tr);table.append(head);
    const tbody=el('tbody');
    for(const row of rows.slice(page*pageSize,(page+1)*pageSize)){
      const line=el('tr');
      line.append(el('td',row.section+(row.lane?' / '+row.lane:'')),el('td',row.path??row.pointer??row.originalPointer??row.kind??''));
      line.append(el('td',row.message??row.code??row.kind??'Review retained source'));
      const data=el('td');data.append(detail('Inspect',row));line.append(data);tbody.append(line);
    }
    if(!rows.length){const line=el('tr'),cell=el('td','No findings in this category.');cell.colSpan=4;line.append(cell);tbody.append(line);}
    table.append(tbody);wrap.append(table);root.append(wrap);
    const pagination=el('div',undefined,'cp-actions');
    const prev=button('Previous',()=>{page--;render();}),next=button('Next',()=>{page++;render();});
    prev.disabled=busy||page===0;next.disabled=busy||page>=pages-1;
    pagination.append(prev,el('span',rows.length+' findings · Page '+(page+1)+' of '+pages),next);root.append(pagination);
    root.append(detail('Complete selected responses and schema identities',activePlan.input),
      detail('Occurrence matches and relationship changes',activePlan.comparison),
      detail('Plan decisions',(c.curriculumDecisions||[]).filter(d=>d.planId===activePlan.id)));
    root.append(el('h3','Engineering decision'));
    const note=el('textarea');note.value=draftNote;note.addEventListener('input',()=>draftNote=note.value);note.placeholder='Record the migration decision and any required changes.';root.append(field('Decision note',note));
    const decisions=el('div',undefined,'cp-actions');
    const draftMatches=()=>draftNamespaces.original===activePlan.input.namespaces.original&&draftNamespaces.candidate===activePlan.input.namespaces.candidate&&
      JSON.stringify(draftMappings.map(m=>[m.kind,m.from,m.to,m.reason]))===JSON.stringify(activePlan.mappings.map(m=>[m.kind,m.from,m.to,m.reason]));
    const draftStatus=el('p',undefined,'cp-muted');
    for(const [outcome,label] of [['accepted','Accept reviewed plan'],['changes-required','Require changes']])decisions.append(button(label,()=>{
      if(!draftMatches()){announce('Create a plan for the changed namespaces or mappings before deciding.',true);return;}
      save(before=>decideCurriculumPlan(before,c.id,{planId:activePlan.id,outcome,note:note.value},context()));
    }));
    syncDraftState=()=>{
      const unchanged=draftMatches();
      decisions.querySelectorAll('button').forEach(b=>b.disabled=busy||!unchanged);
      draftStatus.textContent=unchanged?'Decision applies to the selected saved plan '+activePlan.id+'.':'Namespaces or mappings have unsaved changes. Create a migration plan to review those inputs.';
    };
    root.append(draftStatus,decisions);syncDraftState();
    if(state.state==='CHANGED')root.append(el('p','The current response or edition changed after this plan. Create a new plan before recording a current decision.','cp-status'));
  }
  render();
  return {refresh:render,destroy(){disposed=true;root.remove();style.remove();}};
}

// Issuer findings and immutable correction rounds inside original Completion.
const clone=x=>structuredClone(x);
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=x=>String(x??'').toLowerCase().replaceAll('_',' ');
const uuid=prefix=>prefix+'-'+crypto.randomUUID().replaceAll('-','');
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const inputKeys=['roundId','previousReviewId','outcomeId','expectedOutcomeSha256','document'];
const findingKeys=['id','request','basis','costIds','ownerIds','state','dueOn','completedOn','response','workIds','deploymentIds','sourceIds'];
const arrayKeys=['costIds','ownerIds','workIds','deploymentIds','sourceIds'];
const textKeys=['id','request','basis','state','response'];
export function validateCompletionCorrectionInputs(inputs){
  if(!exact(inputs,inputKeys)||!/^corrections-[a-f0-9]{32}$/.test(inputs.roundId)||
    !(inputs.previousReviewId===null||/^review-[a-f0-9]{32}$/.test(inputs.previousReviewId))||
    !/^outcome-[a-f0-9]{32}$/.test(inputs.outcomeId)||!/^[a-f0-9]{64}$/.test(inputs.expectedOutcomeSha256)||
    !exact(inputs.document,['title','findings','note'])||typeof inputs.document.title!=='string'||
    typeof inputs.document.note!=='string'||!Array.isArray(inputs.document.findings)||inputs.document.findings.length>100)
    throw Error('Choose the complete original correction input structure.');
  const ids=new Set();
  for(const row of inputs.document.findings){
    if(!exact(row,findingKeys)||textKeys.some(k=>typeof row[k]!=='string')||
      !/^finding-[a-f0-9]{32}$/.test(row.id)||ids.has(row.id)||
      arrayKeys.some(k=>!Array.isArray(row[k])||row[k].some(x=>typeof x!=='string')||new Set(row[k]).size!==row[k].length)||
      !['OPEN','IN_PROGRESS','ADDRESSED','NOT_APPLICABLE'].includes(row.state)||
      ['dueOn','completedOn'].some(k=>row[k]!==null&&typeof row[k]!=='string'))
      throw Error('Retain complete editable correction rows and their original identities.');
    ids.add(row.id);
  }
  return inputs;
}
const structural=validateCompletionCorrectionInputs;
function download(blob,name){const a=document.createElement('a'),u=URL.createObjectURL(blob);a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),10000);}
const jsonDownload=(x,name)=>download(new Blob([JSON.stringify(x,null,2)+'\n'],{type:'application/json'}),name);
const button=(name,action,attrs='',disabled=false)=>'<button type="button" data-completion-action="correction-'+action+'" '+attrs+(disabled?' disabled data-completion-fixed="true"':'')+'>'+esc(name)+'</button>';
function field(name,key,value,{options=null,multiple=false,type='text',area=false,attrs=''}={}){
  const attribute=' data-correction-field="'+esc(key)+'" '+attrs;
  const input=options?'<select'+attribute+(multiple?' multiple size="4"':'')+'>'+options.map(([id,title])=>'<option value="'+esc(id)+'"'+((multiple?value.includes(id):String(value??'')===String(id))?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select>':
    area?'<textarea'+attribute+' rows="3">'+esc(value)+'</textarea>':'<input'+attribute+' type="'+type+'" value="'+esc(value)+'">';
  return '<label>'+esc(name)+input+'</label>';
}
const values=el=>el.multiple?[...el.selectedOptions].map(x=>x.value):el.type==='date'?(el.value||null):el.value;
function sourceCompare(value){
  if(!value)return '';
  return '<details><summary>Complete original and current package comparison</summary><p>Original plan '+esc(value.originalPlanContentSha256)+'<br>Current plan '+esc(value.currentPlanContentSha256)+'</p>'+
    value.packages.map(x=>'<details><summary>'+esc(x.costId)+' · '+(x.changed?'changed':'unchanged')+'</summary><div class="completion-fields"><div><h5>Original submitted package / assignment</h5><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify({package:x.original,assignment:x.originalAssignment},null,2))+'</pre></div><div><h5>Current package / assignment</h5><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify({package:x.current,assignment:x.currentAssignment},null,2))+'</pre></div></div></details>').join('')+'</details>';
}
function reportMarkup(report){
  if(!report)return '';
  return '<div class="completion-preview"><h4>'+ (report.readyForPreparation?'Correction responses ready for preparation':'Correction findings retained')+'</h4>'+
    '<p>'+report.findingCount+' findings · '+report.addressed+' addressed · '+report.notApplicable+' operator assessments of non-applicability</p>'+
    (report.issues.length?'<ul>'+report.issues.map(x=>'<li>'+esc(x.findingId||'Round')+': '+esc(x.message)+'</li>').join('')+'</ul>':'')+
    '<p>This assessment does not record issuer acceptance or extend a payment deadline.</p>'+sourceCompare(report.comparison)+'</div>';
}
export function completionCorrections({getCase,session,api,mutate,clearPreview,selectEvidence,adoptCase}){
  if(!session.corrections)session.corrections={drafts:{},selectedRoundId:'',outcomeId:'',reviewId:'',review:null,notice:'',rebase:null};
  const state=session.corrections;
  const current=()=>getCase();
  const prefix=()=>'/api/operations/'+current().program.id;
  const draft=()=>state.drafts[state.selectedRoundId]||null;
  const history=()=>current().reviews.filter(x=>x.purpose==='TRANCHE_CORRECTIONS');
  const choices=(items,selected,key='name')=>{
    const rows=items.map(x=>[x.id,x[key]||x.id]);for(const id of selected)if(!rows.some(x=>x[0]===id))rows.push([id,id+' · unavailable in current case']);return rows;
  };
  function mark(){const d=draft();if(d){d.dirty=true;d.preview=null;}clearPreview();}
  function rowMarkup(row,index){
    const c=current(),attrs='data-finding="'+esc(row.id)+'" data-completion-write="true"';
    const original=draft()?.seed?.originalPreparation?.completion?.packages||[];
    const costs=c.plan.scenario.future_costs.map(x=>({id:x.id,name:x.id+' · '+x.remaining_work}));
    const previous=draft()?.seed?.inputs?.document?.findings||[];
    return '<details class="completion-item" data-correction-finding="'+esc(row.id)+'" open><summary><strong>Finding '+(index+1)+'</strong> · '+esc(label(row.state))+'</summary><div class="completion-fields">'+
      field('Original issuer finding','request',row.request,{area:true,attrs})+
      field('Source reference and attribution','basis',row.basis,{area:true,attrs})+
      field('Current original work packages','costIds',row.costIds,{options:choices(costs,row.costIds),multiple:true,attrs})+
      field('Accountable contributors','ownerIds',row.ownerIds,{options:choices(c.records.contributors,row.ownerIds),multiple:true,attrs})+
      field('Correction state','state',row.state,{options:['OPEN','IN_PROGRESS','ADDRESSED','NOT_APPLICABLE'].map(x=>[x,label(x)]),attrs})+
      field('Internal target date','dueOn',row.dueOn,{type:'date',attrs})+
      field('Actual addressed date','completedOn',row.completedOn,{type:'date',attrs})+
      field('Response / non-applicability basis','response',row.response,{area:true,attrs})+
      field('Original work records','workIds',row.workIds,{options:choices(c.records.work,row.workIds,'description'),multiple:true,attrs})+
      field('Original deployments','deploymentIds',row.deploymentIds,{options:choices(c.records.deployments,row.deploymentIds),multiple:true,attrs})+
      field('Original correction sources','sourceIds',row.sourceIds,{options:choices(c.sources,row.sourceIds,'filename'),multiple:true,attrs})+
      '</div><p class="completion-small">An internal target is separate from the original payment deadline. Attach original files through the existing Sources section.</p>'+
      button('Remove unsaved finding','remove','data-finding="'+esc(row.id)+'"',previous.some(x=>x.id===row.id))+'</details>';
  }
  function markup(){
    const c=current(),d=draft(),saved=state.review,selected=saved?.corrections;
    const outcomes=c.records.outcomes.filter(x=>x.completion&&x.state==='CHANGES_REQUESTED'&&x.tranche===session.tranche);
    const rows=history().filter(x=>x.completionTranche===session.tranche);
    return '<section data-completion-corrections><h3>Issuer findings and correction rounds</h3>'+
      '<p>Start from the actual changes-requested decision. Retain each original finding, its accountable owner, correction and selected evidence. A saved edition can be selected on the original completion preparation below.</p>'+
      '<div class="completion-fields">'+field('Original changes-requested form','outcomeId',state.outcomeId,{options:[['','Select the original issuer outcome'],...outcomes.map(x=>[x.id,x.completion.formReference+' · '+x.date])]})+
      field('Saved correction edition','reviewId',state.reviewId,{options:[['','Select an immutable edition'],...rows.map(x=>[x.id,x.correctionTitle+' · edition '+x.correctionRevision+' · '+x.id])]})+
      field('Retained working copy','selectedRoundId',state.selectedRoundId,{options:[['','Select retained draft'],...Object.entries(state.drafts).map(([id,x])=>[id,x.inputs.document.title+' · '+(x.dirty?'unsaved':'saved basis')])]})+'</div>'+
      '<div class="completion-actions">'+button('New round from issuer decision','new','data-completion-write="true"',!state.outcomeId)+
      button('Open saved correction edition','open','',!state.reviewId)+button('Edit selected edition','edit','data-completion-write="true"',!state.reviewId)+
      button('Download complete correction package','export','',!state.reviewId)+
      button('Use selected edition in preparation','select','',!state.reviewId)+
      button('Restore complete correction draft','import')+'</div>'+
      (state.notice?'<p role="status">'+esc(state.notice)+'</p>':'')+
      (d?'<section><h4>Preserved correction working copy</h4><p>'+esc(d.inputs.roundId)+' · case version '+d.baseVersion+
        (d.baseVersion!==c.program.version?' · current case changed; compare before saving':'')+'</p>'+
        '<details><summary>Complete original issuer decision and submitted preparation</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify({outcome:d.seed.sourceOutcome,preparation:d.seed.originalPreparation},null,2))+'</pre></details>'+
        '<div class="completion-fields">'+field('Correction round title','title',d.inputs.document.title,{attrs:'data-completion-write="true"'})+
        field('Correction review date','asOfDate',d.asOfDate,{type:'date',attrs:'data-completion-write="true"'})+
        field('Round note','note',d.inputs.document.note,{area:true,attrs:'data-completion-write="true"'})+'</div>'+
        d.inputs.document.findings.map(rowMarkup).join('')+
        '<div class="completion-actions">'+button('Add issuer finding','add','data-completion-write="true"',d.inputs.document.findings.length>=100)+
        button('Compare current source','compare')+button('Preview correction edition','preview','',d.baseVersion!==c.program.version||!d.inputs.document.findings.length)+
        button('Save correction edition','save','data-completion-write="true"',!d.preview||d.preview.caseVersion!==c.program.version)+
        button('Download complete correction draft','download')+'</div>'+reportMarkup(d.preview?.report)+'</section>':'')+
      (state.rebase?'<section class="completion-preview"><h4>Explicit current-source comparison</h4><p>Your edited document remains unchanged. Review the full current issuer source and latest correction edition before adopting these current tokens.</p>'+
        '<pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(state.rebase,null,2))+'</pre>'+
        button('Keep edited findings and retain new findings from this displayed current basis','rebase','data-completion-write="true"')+'</section>':'')+
      (selected?'<section><h4>Saved immutable correction edition '+selected.revision+'</h4><p>'+esc(selected.inputs.document.title)+'</p>'+
        reportMarkup(selected.report)+'<details><summary>Complete retained edition and original source</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(JSON.stringify(saved,null,2))+'</pre></details></section>':'')+'</section>';
  }
  function input(el){
    const key=el.dataset.correctionField;if(!key)return false;
    if(['outcomeId','reviewId','selectedRoundId'].includes(key))return false;
    const d=draft();if(!d)return true;
    if(el.dataset.finding){const row=d.inputs.document.findings.find(x=>x.id===el.dataset.finding);if(row)row[key]=values(el);}
    else if(key==='asOfDate')d.asOfDate=el.value;
    else d.inputs.document[key]=el.value;
    mark();return true;
  }
  function change(el){
    const key=el.dataset.correctionField;
    if(!['outcomeId','reviewId','selectedRoundId'].includes(key))return false;
    state[key]=el.value;if(key==='reviewId')state.review=null;if(key==='selectedRoundId')state.rebase=null;return true;
  }
  async function open(id){
    const value=await api(prefix()+'/reviews/'+encodeURIComponent(id));
    if(value.purpose!=='TRANCHE_CORRECTIONS')throw Error('Select a complete original correction edition.');
    state.reviewId=id;state.review=value;return value;
  }
  async function loadSeed(outcomeId,reviewId=null){
    const c=current(),body={expectedVersion:c.program.version,outcomeId,...(reviewId?{reviewId}:{})};
    return api(prefix()+'/completion-corrections-seed',body);
  }
  async function action(name,target){
    if(!name.startsWith('correction-'))return false;
    const a=name.slice(11),c=current(),d=draft();
    if(a==='new'||a==='edit'){
      let oid=target?.dataset.outcome||state.outcomeId,reviewId=null;
      if(a==='edit'){const selected=await open(state.reviewId);oid=selected.corrections.sourceOutcome.id;reviewId=selected.id;}
      const seed=await loadSeed(oid,reviewId),id=seed.inputs.roundId;
      if(!state.drafts[id])state.drafts[id]={inputs:clone(seed.inputs),baseVersion:seed.caseVersion,
        asOfDate:session.asOfDate,seed,preview:null,dirty:false,retained:[]};
      else state.notice='Reopened the existing full working copy; its edits were not replaced.';
      state.selectedRoundId=id;state.rebase=null;return true;
    }
    if(a==='open'){await open(state.reviewId);return true;}
    if(a==='select'){
      const value=await open(state.reviewId);
      if(value.corrections.sourceOutcome.tranche!==session.tranche)throw Error('Select this tranche’s original correction edition.');
      selectEvidence(value.id);state.notice='Selected this exact immutable correction edition for the existing completion preview.';return true;
    }
    if(a==='export'){const r=await api(prefix()+'/completion-corrections/'+encodeURIComponent(state.reviewId)+'/export.zip',undefined,{download:true});download(await r.blob(),state.reviewId+'-corrections.zip');return true;}
    if(a==='import'){await importDraft();return true;}
    if(!d)throw Error('Open the original correction working copy first.');
    if(a==='add'){
      if(d.inputs.document.findings.length>=100)throw Error('Retain at most 100 complete findings.');
      d.inputs.document.findings.push({id:uuid('finding'),request:'',basis:'',costIds:[],ownerIds:[],state:'OPEN',dueOn:null,completedOn:null,response:'',workIds:[],deploymentIds:[],sourceIds:[]});mark();return true;
    }
    if(a==='remove'){
      const id=target.dataset.finding;
      if(d.seed.inputs.document.findings.some(x=>x.id===id))throw Error('Retain saved findings and explain corrections in a new edition.');
      d.inputs.document.findings=d.inputs.document.findings.filter(x=>x.id!==id);mark();return true;
    }
    if(a==='preview'){
      if(d.baseVersion!==c.program.version)throw Error('Compare the current source before reviewing the retained draft.');
      d.preview=await api(prefix()+'/completion-corrections-preview',{expectedVersion:d.baseVersion,inputs:clone(d.inputs),asOfDate:d.asOfDate});return true;
    }
    if(a==='save'){
      if(!d.preview||d.preview.caseVersion!==c.program.version)throw Error('Preview this complete current correction edition first.');
      await mutate('completion.corrections.save',{inputs:clone(d.inputs),asOfDate:d.asOfDate,expectedPreviewSha256:d.preview.previewSha256},d.baseVersion);return true;
    }
    if(a==='download'){
      jsonDownload({schema:'stellar-forge.sf47-completion-correction-draft.v1',caseId:c.program.id,planContentSha256:c.plan.contentSha256,draft:clone(d),
        pending:session.pending?.payload?.action==='completion.corrections.save'?clone(session.pending.payload):null},d.inputs.roundId+'-complete-draft.json');return true;
    }
    if(a==='compare'){
      const fresh=await api(prefix()),rows=fresh.reviews.filter(x=>x.purpose==='TRANCHE_CORRECTIONS'&&x.correctionRoundId===d.inputs.roundId).sort((a,b)=>b.correctionRevision-a.correctionRevision);
      const latest=rows[0]?await api(prefix()+'/reviews/'+encodeURIComponent(rows[0].id)):null;
      const seed=await api(prefix()+'/completion-corrections-seed',{expectedVersion:fresh.program.version,outcomeId:d.inputs.outcomeId,...(latest?{reviewId:latest.id}:{})});
      state.rebase={caseVersion:fresh.program.version,planContentSha256:fresh.plan.contentSha256,currentCase:fresh,currentSeed:seed,currentEdition:latest,
        originalInputs:clone(d.inputs)};state.notice='Read the actual current case and full latest saved edition. Edited input remains preserved.';await adoptCase(fresh);return true;
    }
    if(a==='rebase'){
      const comparison=state.rebase;
      if(!comparison||JSON.stringify(comparison.originalInputs)!==JSON.stringify(d.inputs))throw Error('Compare again after editing the retained draft.');
      const fresh=await api(prefix());
      if(fresh.program.version!==comparison.caseVersion)throw Error('The displayed source changed again. Compare the current source.');
      const latest=comparison.currentEdition,oldIds=new Set(d.inputs.document.findings.map(x=>x.id));
      const additional=latest?.corrections.inputs.document.findings.filter(x=>!oldIds.has(x.id))||[];
      if(comparison.currentSeed.currentOutcome&&JSON.stringify(comparison.currentSeed.currentOutcome)!==JSON.stringify(d.seed.sourceOutcome))
        throw Error('The original issuer decision changed. Preserve this round; select the actual new changes-requested decision for a new round.');
      d.retained.push({inputs:clone(d.inputs),baseVersion:d.baseVersion,seed:clone(d.seed)});
      d.inputs.document.findings.push(...clone(additional));
      d.inputs.previousReviewId=latest?.id||null;d.baseVersion=comparison.caseVersion;d.seed=comparison.currentSeed;
      d.preview=null;d.dirty=true;state.rebase=null;clearPreview();state.notice='Retained edited findings on the explicitly reviewed current basis. Preview before saving.';return true;
    }
    throw Error('Unknown original correction control.');
  }
  async function importDraft(){
    const file=await new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept='application/json,.json';input.addEventListener('change',()=>resolve(input.files?.[0]||null),{once:true});input.addEventListener('cancel',()=>resolve(null),{once:true});input.click();});
    if(!file)return;
    if(file.size>128*1024*1024)throw Error('Retain the complete file; correction editor recovery supports up to 128 MiB.');
    const value=JSON.parse(await file.text()),c=current();
    if(!object(value)||value.schema!=='stellar-forge.sf47-completion-correction-draft.v1'||value.caseId!==c.program.id||
      !object(value.draft)||!object(value.draft.seed)||!object(value.draft.seed.sourceOutcome)||
      !object(value.draft.seed.originalPreparation)||!Array.isArray(value.draft.retained)||!Number.isInteger(value.draft.baseVersion)||
      typeof value.draft.asOfDate!=='string')throw Error('Choose a complete retained correction draft for this original case.');
    structural(value.draft.inputs);structural(value.draft.seed.inputs);
    if(value.draft.seed.inputs.roundId!==value.draft.inputs.roundId||value.draft.seed.sourceOutcome.id!==value.draft.inputs.outcomeId)
      throw Error('The retained original source and draft identities differ.');
    if(value.pending)throw Error('Recover the original pending request in its original case before restoring this editable draft.');
    const fresh=await api(prefix());
    if(fresh.program.id!==value.caseId)throw Error('The original case changed during receiving.');
    const existing=state.drafts[value.draft.inputs.roundId];
    if(existing&&JSON.stringify(existing)!==JSON.stringify(value.draft))
      throw Error('A different complete working copy already exists. Download it and reconcile the two inputs before replacing it.');
    // All input/source shapes used by the editor have been staged before selection changes.
    const staged=clone(value.draft);staged.preview=null;staged.dirty=true;
    state.drafts[value.draft.inputs.roundId]=staged;state.selectedRoundId=value.draft.inputs.roundId;
    state.rebase=null;state.notice='Reopened the complete retained draft. Its original base is preserved; compare current source before saving.';
  }
  async function accepted(next,payload,result){
    if(payload.action!=='completion.corrections.save')return false;
    const saved=await api('/api/operations/'+next.program.id+'/reviews/'+encodeURIComponent(result.recordId));
    if(saved.purpose!=='TRANCHE_CORRECTIONS'||saved.corrections.previewSha256!==payload.data.expectedPreviewSha256)
      throw Error('The saved correction differs from the original accepted request.');
    const id=saved.corrections.inputs.roundId,d=state.drafts[id];
    if(d&&JSON.stringify(d.inputs)===JSON.stringify(payload.data.inputs)){
      const seed={schema:saved.corrections.schema,caseId:next.program.id,caseVersion:next.program.version,
        inputs:{...clone(saved.corrections.inputs),previousReviewId:saved.id},sourceOutcome:clone(saved.corrections.sourceOutcome),
        originalPreparation:clone(saved.corrections.originalPreparation),currentOutcome:clone(next.records.outcomes.find(x=>x.id===saved.corrections.sourceOutcome.id)),
        currentHeadReviewId:saved.id,packages:clone(next.plan.scenario.future_costs)};
      Object.assign(d,{inputs:clone(seed.inputs),seed,baseVersion:next.program.version,preview:null,dirty:false});
    }
    state.reviewId=saved.id;state.review=saved;state.selectedRoundId=id;state.rebase=null;
    state.notice='Saved and reopened the exact immutable correction edition. Actual resubmission uses the original completion form controls.';
    return true;
  }
  function evidence(candidate){const selected=candidate?.correctionEvidence;if(!selected)return '';return '<section><h4>Selected issuer correction edition</h4><p>'+esc(selected.review.corrections.inputs.document.title)+' · edition '+selected.review.corrections.revision+' · '+esc(selected.reviewId)+'</p>'+reportMarkup(selected.report)+'</section>';}
  return {markup,input,change,action,accepted,evidence};
}

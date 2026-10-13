import {createMappingReconciliationDesk, validateMappingReconciliationWork} from './operations_installation_mapping_reconciliation.mjs';
// Customer source-edition comparison and explicit successor composition.
// Mounted by the original Source Desk; its journal owns every write and recovery.
const WORK='stellar-forge.installation-source-edition-work.v1';
const COMPARE='stellar-forge.installation-source-edition-comparison.v1';
const PLAN='stellar-forge.installation-source-edition-plan.v1';
const TRANSITION='stellar-forge.installation-source-edition-transition.v1';
const PAGE=40;
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const clone=x=>structuredClone(x);
const idOK=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(x);
const refOK=x=>object(x)&&idOK(x.draftId)&&Number.isSafeInteger(x.revision)&&x.revision>0&&/^[a-f0-9]{64}$/.test(x.sha256||'');
const rows=x=>Array.isArray(x)?x:[];
function revision(text){
  if(!/^[1-9][0-9]*$/.test(text)||!Number.isSafeInteger(Number(text))||Number(text)>10000)
    throw new Error('Enter the exact retained source revision, from 1 to 10000.');
  return Number(text);
}
function selection(text){
  let value;try{value=JSON.parse(text);}catch{throw new Error('Keep the complete explicit mapping as a JSON object, or null for an unmapped draft.');}
  if(value!==null&&!object(value))throw new Error('The complete mapping must be an object or null.');
  function exactNumbers(item){
    if(typeof item==='number'&&!Number.isSafeInteger(item))
      throw new Error('Keep exact decimal amounts as text and whole counts within their native integer range.');
    if(item&&typeof item==='object')for(const child of Object.values(item))exactNumbers(child);
  }
  exactNumbers(value);
  return value;
}
function assertComparison(value,caseId){
  if(!object(value)||value.schema!==COMPARE||value.caseId!==caseId||
     !refOK(value.source?.ref)||!refOK(value.target?.ref)||
     !object(value.source?.draft)||!object(value.target?.draft)||
     value.source.draft.caseId!==caseId||value.target.draft.caseId!==caseId||
     value.source.draft.id!==value.source.ref.draftId||value.target.draft.id!==value.target.ref.draftId||
     value.source.draft.revision!==value.source.ref.revision||value.target.draft.revision!==value.target.ref.revision||
     !Array.isArray(value.source.draft.files)||!Array.isArray(value.target.draft.files)||
     !Array.isArray(value.files)||!Array.isArray(value.selectionChanges)||!object(value.preparations)||
     !Array.isArray(value.preparations.files)||!Array.isArray(value.preparations.reportChanges)||
     !/^[a-f0-9]{64}$/.test(value.sha256||''))
    throw new Error('Retain the complete comparison for both original draft revisions.');
  return value;
}
function assertPlan(value,caseId){
  if(!object(value)||value.schema!==PLAN||value.caseId!==caseId||!refOK(value.source)||!refOK(value.target)||
     !Array.isArray(value.files)||!object(value.mapping)||!Array.isArray(value.resultFiles)||
     !Array.isArray(value.findings)||!Object.hasOwn(value,'selection')||
     !/^[a-f0-9]{64}$/.test(value.sha256||''))
    throw new Error('Retain the complete server preview before saving the successor.');
  return value;
}
export function validateSourceEditionWork(value,{caseId,draftId}){
  if(value===null||value===undefined)return;
  if(!object(value)||value.schema!==WORK||value.targetDraftId!==draftId||
     !['sourceDraftId','sourceRevisionText','sourcePreparationId','targetPreparationId','mappingMode','mappingText'].every(k=>typeof value[k]==='string')||
     !object(value.choices)||!object(value.views)||typeof value.dirty!=='boolean'||
     !['','source','target','explicit','reconcile'].includes(value.mappingMode))
    throw new Error('Keep the complete customer-edition fields and original target draft.');
  for(const entry of Object.values(value.choices))if(!object(entry)||!['','retain','replace','remove'].includes(entry.choice)||typeof entry.targetFileId!=='string')
    throw new Error('Keep every explicit retained-file decision.');
  for(const entry of Object.values(value.views))if(!object(entry)||typeof entry.search!=='string'||!Number.isSafeInteger(entry.page)||entry.page<0)
    throw new Error('Keep the original customer-edition table position and search.');
  validateMappingReconciliationWork(value.mappingWork,{caseId,draftId});
  if(value.comparison)assertComparison(value.comparison,caseId);
  if(value.plan)assertPlan(value.plan,caseId);
  if(value.applied&&(!object(value.applied)||value.applied.schema!==TRANSITION||value.applied.caseId!==caseId||value.applied.draftId!==draftId))
    throw new Error('Keep the complete recorded source-edition transition.');
}
export function createSourceEditionDesk(H){
  const E=H.esc,P=H.pretty;
  const heading=(title,description,actions='')=>'<div class="source-desk-heading"><div><h3>'+E(title)+'</h3><p>'+E(description)+'</p></div><div class="source-desk-actions">'+actions+'</div></div>';
  function initial(){
    const draft=H.draft(),other=H.heads().find(x=>x.id!==draft.id);
    return {schema:WORK,targetDraftId:draft.id,sourceDraftId:other?.id||draft.id,
      sourceRevisionText:String(other?.revision||Math.max(1,draft.revision-1)),sourcePreparationId:'',targetPreparationId:'',
      comparison:null,comparisonInput:null,choices:{},mappingMode:'',mappingText:'',
      plan:null,planInput:null,views:{},dirty:false,applied:null,appliedPlan:null};
  }
  function work(create=false){
    const state=H.state();
    if(!state.editionWork&&create&&H.draft()){state.editionWork=initial();H.changed();}
    return state.editionWork;
  }
  function needWork(){const value=work(true);if(!value)throw new Error('Open an original source draft first.');return value;}
  function reviewEditable(){
    if(H.readonly())throw new Error('The operating workspace is currently read only.');
    if(H.pending())throw new Error('Recover the original source request before changing its edition review.');
    if(H.historic())throw new Error('Open the current target draft to compose its successor. Historical revisions remain available as source inputs.');
  }
  function fields(w){
    const target=H.currentDraft();
    if(!target||target.id!==w.targetDraftId)throw new Error('Reopen this review in its original target draft.');
    if(!idOK(w.sourceDraftId))throw new Error('Choose the original source draft.');
    return {source:{draftId:w.sourceDraftId,revision:revision(w.sourceRevisionText)},
      targetRevision:target.revision,sourcePreparationId:w.sourcePreparationId.trim()||null,targetPreparationId:w.targetPreparationId.trim()||null};
  }
  function comparisonCurrent(w){
    if(!w?.comparison||!w.comparisonInput)return false;
    try{return H.stable(w.comparisonInput)===H.stable(fields(w))&&w.comparison.target.ref.draftId===H.currentDraft()?.id&&w.comparison.target.ref.revision===H.currentDraft()?.revision;}
    catch{return false;}
  }
  function fileChoices(w){
    if(!comparisonCurrent(w))throw new Error('Compare the current target revision with the exact source revision again before previewing.');
    const source=w.comparison.source.draft,target=w.comparison.target.draft;
    const files=source.files.map(f=>{
      const choice=w.choices[f.id];
      if(!choice||!['retain','replace','remove'].includes(choice.choice))throw new Error('Choose Retain, Replace or Remove for '+f.filename+'.');
      const targetFileId=choice.choice==='replace'?choice.targetFileId:null;
      if(choice.choice==='replace'&&!target.files.some(t=>t.id===targetFileId))throw new Error('Choose the exact replacement file for '+f.filename+'.');
      return {sourceFileId:f.id,choice:choice.choice,targetFileId};
    });
    return files;
  }
  const mappings=createMappingReconciliationDesk({...H,editionWork:()=>needWork(),
    comparisonCurrent:()=>comparisonCurrent(work()),fileChoices:()=>fileChoices(work())});
  function planBody(w){
    const files=fileChoices(w);
    if(!['source','target','explicit'].includes(w.mappingMode))throw new Error('Choose which complete mapping the successor will use.');
    return {source:clone(w.comparison.source.ref),target:clone(w.comparison.target.ref),files,
      mapping:{mode:w.mappingMode,selection:w.mappingMode==='explicit'?selection(w.mappingText):null}};
  }
  function canPreview(){try{planBody(work());return true;}catch{return false;}}
  function planCurrent(w){
    if(!w?.plan||!w.planInput||!comparisonCurrent(w))return false;
    try{return H.stable(w.planInput)===H.stable(planBody(w))&&w.plan.target.revision===H.currentDraft()?.revision&&w.plan.target.draftId===H.currentDraft()?.id;}
    catch{return false;}
  }
  function button(label,action,attrs='',disabled=false,mutates=false){
    return H.btn(label,action,attrs+(mutates?' data-source-edit':''),disabled);
  }
  function field(label,key,value,{options,area=false,help='',data='',edit=true}={}){
    const attrs=' data-source-edition-field="'+E(key)+'"'+(edit?' data-source-edit':'')+' '+data;
    let input;
    if(options){
      const choices=[...options];if(value!==''&&!choices.some(x=>String(x[0])===String(value)))choices.push([value,'Retained value · '+value]);
      input='<select'+attrs+'>'+choices.map(([v,t])=>'<option value="'+E(v)+'"'+(String(v)===String(value)?' selected':'')+'>'+E(t)+'</option>').join('')+'</select>';
    }else if(area)input='<textarea'+attrs+' rows="16" spellcheck="false">'+E(value)+'</textarea>';
    else input='<input'+attrs+' value="'+E(value)+'">';
    return '<label'+(area?' class="source-desk-wide"':'')+'><span>'+E(label)+'</span>'+input+(help?'<small>'+E(help)+'</small>':'')+'</label>';
  }
  function detail(title,value,open=false){
    return '<details'+(open?' open':'')+'><summary>'+E(title)+'</summary><pre>'+E(P(value))+'</pre></details>';
  }
  function meta(file,side=null,output=false){
    if(!file)return '<span>Absent</span>';
    return '<strong>'+E(file.filename||file.path||file.id||'Original file')+'</strong><br>'+E(file.bytes??'')+' bytes'+
      (file.sha256?'<br><code>'+E(file.sha256)+'</code>':'')+
      (file.id?'<br>File ID: <code>'+E(file.id)+'</code>':'')+
      (file.mediaType?'<br>'+E(file.mediaType):'')+
      (file.sourceUrl?'<br>'+E(file.sourceUrl):'')+
      (file.observedAt?'<br>'+E(file.observedAt):'')+detail('Complete file metadata',file)+
      (side?button('Download complete original','edition-original-file','data-side="'+E(side)+'" data-filename="'+E(file.filename)+'"'+(output?' data-output="true"':'')):'');
  }
  function shownValue(present,value){return present?'<pre>'+E(P(value))+'</pre>':'<span>Absent</span>';}
  function tableView(key,title,all,heads,rowFn,searchFn){
    const w=needWork(),view=w.views[key]||{search:'',page:0},needle=view.search.trim().toLocaleLowerCase();
    const filtered=needle?all.filter(x=>String(searchFn(x)).toLocaleLowerCase().includes(needle)):all;
    const totalPages=Math.max(1,Math.ceil(filtered.length/PAGE)),page=Math.min(view.page,totalPages-1),start=page*PAGE,selected=filtered.slice(start,start+PAGE);
    return '<section><h4>'+E(title)+'</h4>'+
      '<div class="source-desk-fields">'+field('Find within '+title,'search',view.search,{edit:false,data:'data-source-edition-view="'+E(key)+'"',help:'Search applies to all '+all.length+' rows. Complete downloads retain every row.'})+'</div>'+
      '<p>'+filtered.length+' matching of '+all.length+' total rows'+(filtered.length?' · showing '+(start+1)+'–'+(start+selected.length):'')+'</p>'+
      (selected.length?H.table(heads,selected.map(rowFn)):H.empty(all.length?'No rows match this search.':'There are no rows in this section.'))+
      '<div class="source-desk-actions">'+button('Previous','edition-page','data-view="'+E(key)+'" data-page="'+(page-1)+'"',page===0)+
      '<span>Page '+(page+1)+' of '+totalPages+'</span>'+button('Next','edition-page','data-view="'+E(key)+'" data-page="'+(page+1)+'"',page>=totalPages-1)+'</div></section>';
  }
  function changes(key,title,list){
    return tableView(key,title,list,['JSON pointer','Previous value','Target value'],x=>[
      '<code>'+E(x.pointer||'/')+'</code>',shownValue(x.beforePresent,x.before),shownValue(x.afterPresent,x.after)
    ],x=>(x.pointer||'/')+' '+P(x.before)+' '+P(x.after));
  }
  function comparisonView(w){
    const c=w.comparison;if(!c)return H.empty('Choose an exact source edition, then compare it with this saved target draft.');
    const stale=!comparisonCurrent(w);
    return heading('Complete edition comparison',
      'Source '+c.source.ref.draftId+' revision '+c.source.ref.revision+' → target '+c.target.ref.draftId+' revision '+c.target.ref.revision,
      button('Download full comparison','edition-download-comparison'))+
      (stale?H.hint('This retained comparison uses earlier inputs or a previous target head. Its complete results remain below. Compare the current inputs to enable preview and save.'):'')+
      detail('Exact source and target revision identities',{source:c.source.ref,target:c.target.ref,comparisonSha256:c.sha256})+
      tableView('files','Original source files',c.files,['Receiving filename','Change','Source edition','Target edition'],x=>[
        E(x.filename),E(x.status),meta(x.source,'source'),meta(x.target,'target')
      ],x=>P(x))+
      changes('mapping','Complete mapping changes',c.selectionChanges)+
      '<details><summary>Both complete saved mappings</summary>'+detail('Source mapping',c.source.draft.selection??null)+detail('Target mapping',c.target.draft.selection??null)+'</details>'+
      heading('Prepared output comparison','Choose preparation IDs above to compare their original complete output files and report. A saved mapping and a native prepared package have separate identities.')+
      detail('Selected preparation identities',{source:c.preparations.source,target:c.preparations.target})+
      tableView('outputs','Prepared output files',c.preparations.files,['Output filename','Change','Source preparation','Target preparation'],x=>[
        E(x.filename),E(x.status),meta(x.source,'source',true),meta(x.target,'target',true)
      ],x=>P(x))+
      changes('reports','Preparation report changes',c.preparations.reportChanges);
  }
  function choicesView(w){
    const c=w.comparison;if(!c)return '';
    const source=rows(c.source.draft.files),target=rows(c.target.draft.files);
    const decided=source.filter(x=>['retain','replace','remove'].includes(w.choices[x.id]?.choice)).length;
    const counts=Object.fromEntries(['retain','replace','remove'].map(k=>[k,source.filter(x=>w.choices[x.id]?.choice===k).length]));
    const sourceIds=new Set(source.map(x=>x.id)),newTargets=target.filter(x=>!sourceIds.has(x.id));
    return heading('Build the successor','Choose what happens to every file in the source edition. Each choice is explicit; '+decided+' of '+source.length+' source files have a decision.')+
      H.hint('Retain copies the exact original bytes and provenance. Replace uses one exact file already retained in the target. Remove drops the prior source binding. New target files remain in the successor.')+
      '<p>Retain '+counts.retain+' · Replace '+counts.replace+' · Remove '+counts.remove+' · Undecided '+(source.length-decided)+'</p>'+
      tableView('choices','Per-file decisions',source,['Original source file','Successor decision','Replacement file'],f=>{
        const entry=w.choices[f.id]||{choice:'',targetFileId:''};
        return [meta(f,'source'),field('Decision for '+f.filename,'choice',entry.choice,{data:'data-file-id="'+E(f.id)+'"',options:[
          ['','Choose one'],['retain','Retain exact prior file'],['replace','Replace with target file'],['remove','Remove prior file']
        ]}),entry.choice==='replace'?field('Replacement for '+f.filename,'targetFileId',entry.targetFileId,{
          data:'data-file-id="'+E(f.id)+'"',options:[['','Choose exact replacement'],...target.map(t=>[t.id,t.filename+' · '+t.bytes+' bytes · '+t.sha256])]
        }):'<span>'+E(entry.choice==='retain'?'Prior original file is retained.':entry.choice==='remove'?'Prior file is removed from this successor.':'Choose a decision.')+'</span>'];
      },f=>P(f)+' '+(w.choices[f.id]?.choice||'undecided'))+
      '<details><summary>'+newTargets.length+' new target files remain retained</summary>'+
      (newTargets.length?H.table(['Target file'],newTargets.map(f=>[meta(f,'target')])):H.empty('There are no new target files.'))+'</details>'+
      '<div class="source-desk-fields">'+field('Complete mapping for successor','mappingMode',w.mappingMode,{options:[
        ['','Choose mapping'],['source','Carry forward source mapping'],['target','Use current target mapping'],['explicit','Use complete explicit JSON mapping'],['reconcile','Reconcile individual mapping fields']
      ],help:'Carry forward rewrites known native file descriptors, sourceFile bindings and programme filenames only. Original plan hashes, hours and other values remain available for review.'})+
      (w.mappingMode==='explicit'?field('Complete explicit mapping JSON','mappingText',w.mappingText,{area:true,help:'Paste the whole mapping object. Use null to save an unmapped draft. Your exact editor text is retained in the original working copy.'}):'')+'</div>'+
      (w.mappingMode==='reconcile'?mappings.render():
        '<div class="source-desk-actions">'+button('Preview complete successor','edition-preview','',!canPreview()||!H.editing(),true)+'</div>');
  }
  function planView(w){
    const plan=w.plan;if(!plan)return '';
    const current=planCurrent(w),dirtyMapping=H.mappingDirty();
    return heading('Successor preview','Review every resulting original file and the complete mapping before saving.',
      button('Download full successor preview','edition-download-plan'))+
      (!current?H.hint('The preview is retained from earlier choices or an earlier target revision. Preview the current choices to enable save.'):'')+
      '<p>'+plan.resultFiles.length+' complete files · '+plan.findings.length+' mapping findings</p>'+
      tableView('result','Resulting original files',plan.resultFiles,['Complete retained file'],f=>[meta(f)],f=>P(f))+
      detail('Complete successor mapping',plan.selection,true)+
      (plan.findings.length?H.table(['Finding','Location','Review'],plan.findings.map(f=>[E(f.code),'<code>'+E(f.pointer||'/')+'</code>',E(f.message)])):
        H.hint('The edition planner reported no mapping findings. Prepare the new mapping through the original native preparation workflow.'))+
      H.hint('Saving records an editable source revision. Mapping findings stay attached to its transition so you can resolve them in Source mapping before running native preparation. Previous prepared packages retain their original identities.')+
      (dirtyMapping?H.hint('You have unsaved mapping or Installation fields. Saving this successor archives their complete working copy and adopts the previewed mapping. You will be asked to confirm that replacement.'):'')+
      detail('Exact plan identity',{sha256:plan.sha256,selectionSha256:plan.selectionSha256,source:plan.source,target:plan.target})+
      '<div class="source-desk-actions">'+button('Save successor draft','edition-apply','',!current||!H.editing(),true)+'</div>';
  }
  function transitionView(w){
    const list=rows(H.draft()?.editionTransitions),latest=w?.applied||list.at(-1);
    if(!latest)return '';
    return heading('Saved source-edition transition','Revision '+latest.draftRevision+' records the complete file decisions, original inputs and mapping findings.',
      button('Download recorded transition','edition-download-transition')+button('Open source mapping','edition-open-mapping'))+
      detail('Complete recorded transition',latest,true)+
      (list.length>1?detail('All retained source-edition transitions',list):'');
  }
  function render(){
    if(!H.draft())return H.empty('Create or open an original source preparation to compare customer editions.');
    const w=needWork(),c=w.comparison,sourcePreps=rows(c?.source.draft.preparations),targetPreps=rows(H.draft().preparations);
    return heading('Customer source editions','Compare complete retained inputs, carry forward selected original files and mapping, then prepare the successor through the native Installation workflow.')+
      (H.historic()?H.hint('This is a retained historical target. Open the current draft to compose its successor; choose any retained revision as the source.'):'')+
      '<div class="source-desk-fields">'+field('Prior source draft','sourceDraftId',w.sourceDraftId,{options:H.heads().map(d=>[d.id,d.title+' · current revision '+d.revision])})+
      field('Exact prior source revision','sourceRevisionText',w.sourceRevisionText,{help:'Use a retained revision number. The target is the current saved revision '+H.currentDraft().revision+'.'})+
      field('Source preparation ID, optional','sourcePreparationId',w.sourcePreparationId,{options:[['','No source preparation'],...sourcePreps.map(p=>[p.id,p.id+' · '+(p.kind||p.state||'prepared source')])]})+
      field('Target preparation ID, optional','targetPreparationId',w.targetPreparationId,{options:[['','No target preparation'],...targetPreps.map(p=>[p.id,p.id+' · '+(p.kind||p.state||'prepared source')])]})+'</div>'+
      H.hint('Compare once to list the source revision’s preparation IDs. Selecting preparations and comparing again includes their original complete outputs.')+
      '<div class="source-desk-actions">'+button('Compare exact editions','edition-compare','',!H.editing(),true)+
      button('Download retained edition review','edition-download-review','',!w)+
      button('Start another edition review','edition-reset','',!H.editing(),true)+'</div>'+
      transitionView(w)+comparisonView(w)+choicesView(w)+planView(w);
  }
  function edit(target){
    if(mappings.edit(target))return true;
    if(!target?.matches?.('[data-source-edition-field]'))return false;
    const w=needWork(),key=target.dataset.sourceEditionField,view=target.dataset.sourceEditionView;
    if(key==='search'){
      if(!view||!['files','mapping','outputs','reports','choices','result'].includes(view))throw new Error('Choose an original comparison table.');
      w.views[view]={search:target.value,page:0};H.changed();return true;
    }
    reviewEditable();
    const fileId=target.dataset.fileId;
    if(fileId){
      if(!w.comparison?.source.draft.files.some(f=>f.id===fileId))throw new Error('Choose an original source file from this retained comparison.');
      if(!['choice','targetFileId'].includes(key))throw new Error('Choose an original per-file decision field.');
      const entry=w.choices[fileId]||(w.choices[fileId]={choice:'',targetFileId:''});
      entry[key]=target.value;
      if(key==='choice'&&target.value!=='replace')entry.targetFileId='';
    }else{
      if(!['sourceDraftId','sourceRevisionText','sourcePreparationId','targetPreparationId','mappingMode','mappingText'].includes(key))
        throw new Error('Choose an original customer-edition field.');
      const old=w[key];w[key]=target.value;
      if(key==='sourceDraftId'&&old!==target.value){
        const head=H.heads().find(d=>d.id===target.value);
        if(head)w.sourceRevisionText=String(head.id===H.currentDraft()?.id?Math.max(1,head.revision-1):head.revision);
        w.sourcePreparationId='';
      }
      if(key==='sourceRevisionText'&&old!==target.value)w.sourcePreparationId='';
    }
    w.dirty=true;H.changed();return true;
  }
  async function compare(){
    reviewEditable();const w=needWork(),input=fields(w);
    await H.parkWorking('Before comparing another complete customer source edition');
    const value=assertComparison(await H.api(w.targetDraftId,'/editions/compare',input),H.caseId);
    if(value.source.ref.draftId!==input.source.draftId||value.source.ref.revision!==input.source.revision||
       value.target.ref.draftId!==w.targetDraftId||value.target.ref.revision!==input.targetRevision)
      throw new Error('The comparison returned different original source or target revisions.');
    const prior=w.comparison,choices={};
    for(const f of value.source.draft.files){
      const original=prior?.source.draft.files.find(p=>p.id===f.id);
      choices[f.id]=original&&H.stable(original)===H.stable(f)&&w.choices[f.id]?clone(w.choices[f.id]):{choice:'',targetFileId:''};
    }
    w.comparison=value;w.comparisonInput=clone(input);w.choices=choices;w.views={};w.dirty=true;H.changed();
    H.state().notice='Compared both complete source editions. Choose each retained file and the complete successor mapping.';
  }
  async function preview(){
    reviewEditable();const w=needWork(),input=planBody(w);
    const value=assertPlan(await H.api(w.targetDraftId,'/editions/preview',input),H.caseId);
    if(H.stable(value.source)!==H.stable(input.source)||H.stable(value.target)!==H.stable(input.target)||
       H.stable(value.files)!==H.stable(input.files)||H.stable(value.mapping)!==H.stable(input.mapping))
      throw new Error('The successor preview differs from the complete original choices.');
    w.plan=value;w.planInput=clone(input);w.dirty=true;H.changed();
    H.state().notice='Previewed '+value.resultFiles.length+' complete files and '+value.findings.length+' mapping findings. Review the complete successor before saving.';
  }
  async function apply(){
    reviewEditable();H.requireEdit();const w=needWork();
    if(!planCurrent(w))throw new Error('Preview the current complete choices against the latest saved target revision.');
    const dirty=H.mappingDirty();
    if(dirty&&!confirm('Archive your complete unsaved mapping and Installation fields, then replace the current mapping with this successor preview?'))return;
    await H.parkWorking('Before applying complete customer source-edition successor');
    const plan=clone(w.plan);
    return H.issue('edition.apply',{plan},plan.target.revision);
  }
  function verifyReceipt(value,original){
    if(original?.body?.action==='mapping.apply'){mappings.verifyReceipt(value,original);return;}
    if(original?.body?.action!=='edition.apply')return;
    const transition=value.result;
    if(!transition||transition.schema!==TRANSITION||transition.state!=='EDITABLE_SOURCE_EDITION'||
       transition.caseId!==H.caseId||transition.draftId!==original.draftId||
       transition.requestId!==original.body.requestId||transition.planSha256!==original.body.data.plan.sha256||
       transition.draftRevision!==value.draft.revision)
      throw new Error('Keep the complete saved source-edition receipt with its original request.');
  }
  function adoptReceipt(value,original){
    if(original?.body?.action==='mapping.apply'){
      if(mappings.adoptReceipt(value,original)){
        const w=needWork();w.applied=clone(value.result.editionTransition);w.appliedPlan=clone(w.mappingWork.appliedPlan.editionPlan);
      }
      return;
    }
    if(original?.body?.action!=='edition.apply'||value.draft?.id!==H.state().draftId)return;
    verifyReceipt(value,original);
    const w=needWork(),transition=value.result;
    w.applied=clone(transition);w.appliedPlan=clone(original.body.data.plan);w.dirty=false;
    H.state().notice='Saved editable source revision '+value.draft.revision+'. Review its mapping findings, then prepare the complete native package.';
    H.state().tab='editions';
  }
  async function action(name,target){
    if(name.startsWith('edition-mapping-')||name.startsWith('edition-download-mapping-'))return mappings.action(name,target);
    const w=needWork();
    if(name==='edition-download-review')return H.download(P(w),'customer-source-edition-review.json');
    if(name==='edition-download-comparison'){
      if(!w.comparison)throw new Error('Compare the source editions first.');
      return H.download(P(w.comparison),'customer-source-edition-comparison.json');
    }
    if(name==='edition-download-plan'){
      if(!w.plan)throw new Error('Preview the complete successor first.');
      return H.download(P(w.plan),'customer-source-edition-plan.json');
    }
    if(name==='edition-download-transition'){
      const value=w.applied||rows(H.draft()?.editionTransitions).at(-1);
      if(!value)throw new Error('Open a retained source-edition transition first.');
      return H.download(P(value),'customer-source-edition-transition.json');
    }
    if(name==='edition-original-file'){
      const side=target.dataset.side,c=w.comparison;
      if(!c||!['source','target'].includes(side))throw new Error('Choose the complete original comparison file.');
      const output=target.dataset.output==='true',preparation=c.preparations[side];
      const available=output?rows(preparation?.files):c[side].draft.files;
      const file=available.find(f=>f.filename===target.dataset.filename);
      if(!file)throw new Error('The selected original file is absent from this exact edition.');
      if(output)return H.downloadOutput(c[side].ref,preparation.id,file);
      return H.downloadOriginal(c[side].ref,file);
    }
    if(name==='edition-page'){
      const view=target.dataset.view,page=Number(target.dataset.page);
      if(!['files','mapping','outputs','reports','choices','result'].includes(view)||!Number.isSafeInteger(page)||page<0)
        throw new Error('Choose a valid comparison page.');
      w.views[view]={search:w.views[view]?.search||'',page};H.changed();return;
    }
    if(name==='edition-open-mapping'){H.state().tab='mapping';H.changed();return;}
    if(name==='edition-compare')return compare();
    if(name==='edition-preview')return preview();
    if(name==='edition-apply')return apply();
    if(name==='edition-reset'){
      reviewEditable();await H.parkWorking('Before starting another customer source-edition review');
      H.state().editionWork=initial();H.changed();return;
    }
    throw new Error('Choose an installed customer source-edition action.');
  }
  return {render,edit,action,verifyReceipt,adoptReceipt,exactDraft:mappings.exactDraft,adoptNativeDraft:mappings.adoptNativeDraft,canPreview,canMappingPreview:mappings.canPreview,canMappingApply:mappings.canApply,canApply:()=>planCurrent(work()),isDirty:()=>!!work()?.dirty,reset:()=>{H.state().editionWork=null;}};
}

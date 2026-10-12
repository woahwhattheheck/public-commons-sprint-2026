// MIT. Batch receiving over the original Clinical owner, PRS records and action journal.
const $ = id => document.getElementById(id);
const json = value => JSON.stringify(value,null,2);
const text = value => value === null || value === undefined ? '—' : typeof value === 'object' ? json(value) : String(value);
const node = (tag,value,className) => {
  const element=document.createElement(tag);
  if(value!==undefined)element.textContent=text(value);
  if(className)element.className=className;
  return element;
};
const short = value => value ? String(value).slice(0,14) : '—';
const number = value => Number(value || 0).toLocaleString('en-US');
const hash = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const SHA = /^[0-9a-f]{64}$/;
const decisions = {'ready':'Ready for handover','follow-up':'Follow-up required','exclude':'Excluded'};
const maxFile=64*1024*1024,maxBatch=256*1024*1024;
function parsed(id,label,kind) {
  let value;
  try{value=JSON.parse($(id).value);}catch{throw new Error(label+' must be valid JSON.');}
  if(kind==='array'&&!Array.isArray(value))throw new Error(label+' must be an array.');
  if(kind==='object'&&(!value||typeof value!=='object'||Array.isArray(value)))throw new Error(label+' must be an object.');
  return value;
}
function fill(control,items,selected) {
  const previous=selected===undefined?control.value:selected;
  control.replaceChildren(...items.map(([value,label])=>{const item=node('option',label);item.value=value;return item;}));
  if(!items.length){const item=node('option','No retained selection');item.value='';control.append(item);}
  control.value=items.some(([value])=>value===previous)?previous:items[0]?.[0]||'';
}
function facts(target,entries) {
  target.replaceChildren(...entries.flatMap(([label,value])=>[node('dt',label),node('dd',value)]));
}
function table(target,headers,rows,empty) {
  target.replaceChildren();
  if(!rows.length){target.append(node('p',empty||'No records in this view.','empty'));return;}
  const t=node('table'),head=node('thead'),hr=node('tr'),body=node('tbody');
  headers.forEach(label=>hr.append(node('th',label)));head.append(hr);
  for(const row of rows){const tr=node('tr');for(const value of row){const td=node('td');td.append(value instanceof Node?value:node('span',value));tr.append(td);}body.append(tr);}
  t.append(head,body);target.append(t);
}
function details(label,value) {
  const element=node('details');element.append(node('summary',label),node('pre',json(value)));return element;
}

export function createBatchPanel({getState,perform,upload,api,download,handle,notice,params,selectSection,getPending}) {
  const storageKey='clinicaltrials-batch:'+location.origin;
  let intake=[],intakeBusy=false,locked=true,loaded=null,opened=null,requestedId='',readSequence=0,entrySequence=0;
  let lastBatchRevision='',lastDocumentList='',lastCaptureList='',formKey='';
  const localFiles=new Map();
  try{
    const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');
    if(saved&&Array.isArray(saved.entries)&&saved.entries.length<=1000){
      intake=saved.entries.filter(row=>row&&SHA.test(row.sha256)&&typeof row.key==='string').map(row=>({...row,error:null}));
      $('batch-name').value=saved.name||'';$('batch-reviewer').value=saved.reviewer||'';
      $('batch-note').value=saved.note||'';requestedId=saved.selectedBatchId||'';
    }
  }catch{}
  const current=()=>getState()||{};
  const records=()=>current().prs||[];
  const selected=()=>opened?.entry;
  function saveIntake() {
    try{sessionStorage.setItem(storageKey,JSON.stringify({entries:intake,name:$('batch-name').value,
      reviewer:$('batch-reviewer').value,note:$('batch-note').value,selectedBatchId:requestedId}));}catch{
      notice('This browser could not retain the intake selection locally. Download its manifest before closing.','error');
    }
  }
  function button(label,callback,{write=false}={}) {
    const control=node('button',label);control.type='button';
    if(write){control.dataset.write='';control.disabled=locked||intakeBusy;}
    control.addEventListener('click',()=>handle(callback));return control;
  }
  function uniqueKey(base) {
    let key=String(base||'entry').slice(0,145),suffix=1;
    while(intake.some(row=>row.key===key)){suffix++;key=String(base||'entry').slice(0,145)+' #'+suffix;}
    return key;
  }
  function documentFor(row) {
    const retained=records().find(document=>document.id===row.sha256);
    if(retained&&retained.report.schemaKind!==row.schema)return null;
    return retained;
  }
  function canRetain(row) {
    return !row.documentId&&localFiles.has(row.sha256+'\n'+row.file);
  }
  function adoptRetained() {
    for(const row of intake){
      const retained=documentFor(row);
      if(retained){row.documentId=retained.id;row.error=null;}
      else if(row.documentId&&!records().some(document=>document.id===row.documentId))row.documentId=null;
    }
  }
  function checkCapacity(rows) {
    if(rows.length>1000)throw new Error('This receiving scope exceeds 1,000 client entries.');
    const unique=new Map();
    for(const row of rows){if(!Number.isInteger(row.bytes)||row.bytes<1||row.bytes>maxFile)throw new Error('Each original XML must contain between 1 byte and 64 MiB.');unique.set(row.sha256,row.bytes);}
    if([...unique.values()].reduce((a,b)=>a+b,0)>maxBatch)throw new Error('The distinct original XML files exceed 256 MiB.');
  }
  function renderIntake() {
    adoptRetained();
    const ready=intake.filter(row=>row.documentId).length;
    const unique=new Set(intake.map(row=>row.sha256)).size;
    $('batch-intake-progress').textContent=intake.length?
      number(ready)+' of '+number(intake.length)+' client entries retained · '+number(unique)+' distinct input files'+
      (intakeBusy?' · Retaining the current original file…':''):
      'Choose original XML files or add documents already retained in this workspace.';
    table($('batch-intake-table'),['Client reference','Original file / schema','Bytes','Receiving status',''],intake.map(row=>{
      const reference=node('input');reference.value=row.key;reference.maxLength=160;reference.setAttribute('aria-label','Client reference for '+row.file);
      reference.disabled=intakeBusy;
      reference.addEventListener('change',()=>{
        const next=reference.value.trim();
        if(!next||intake.some(other=>other!==row&&other.key===next)){reference.value=row.key;notice('Use a nonempty, unique client reference.','error');return;}
        row.key=next;saveIntake();
      });
      const name=node('div');name.append(node('strong',row.label||row.file),node('div',row.file+' · '+row.schema,'help'),details('Exact original identity',row));
      let status=row.error|| (row.documentId?'Retained and inspected':canRetain(row)?'Ready to retain':'Reselect this exact file to continue');
      return [reference,name,number(row.bytes),status,button('Remove from intake',()=>{
        if(intakeBusy)throw new Error('Finish retaining the current original file first.');
        intake=intake.filter(other=>other!==row);saveIntake();renderIntake();controls(locked);
      })];
    }));
    controls(locked);
  }
  async function addFiles() {
    if(intakeBusy)throw new Error('Wait for the current file to finish.');
    const chosen=Array.from($('batch-files').files||[]);
    if(!chosen.length)return;
    const manifest=parsed('batch-manifest','Receiving manifest','object');
    if(!Array.isArray(manifest.entries))throw new Error('The receiving manifest needs an entries array.');
    for(const item of manifest.entries){
      if(!item||typeof item!=='object'||!item.file||!SHA.test(item.sha256||'')||!item.key)
        throw new Error('Every manifest entry needs a client key, exact file name and SHA256.');
      if(item.schema&&!['protocol','results'].includes(item.schema))throw new Error('Manifest schema must be protocol or results.');
      if(item.sourceLinks!==undefined&&!Array.isArray(item.sourceLinks))throw new Error('Manifest sourceLinks must be an array.');
    }
    intakeBusy=true;controls(locked);
    try{
      for(const file of chosen){
        if(file.size<1||file.size>maxFile)throw new Error(file.name+' is outside the 1 byte to 64 MiB XML range.');
        const sha256=await hash(await file.arrayBuffer());
        localFiles.set(sha256+'\n'+file.name,file);
        const matching=manifest.entries.filter(row=>row.file===file.name&&row.sha256===sha256);
        const sameName=manifest.entries.some(row=>row.file===file.name);
        if(sameName&&!matching.length)throw new Error('The selected '+file.name+' does not match the manifest SHA256.');
        const entries=matching.length?matching:[{key:uniqueKey(file.name),label:file.name,schema:$('batch-schema').value,sourceLinks:[]}];
        for(const item of entries){
          const schema=item.schema||$('batch-schema').value;
          const previous=matching.length?intake.find(row=>row.key===item.key):
            intake.find(row=>row.file===file.name&&row.sha256===sha256&&row.schema===schema);
          if(previous){
            if(previous.file!==file.name||previous.sha256!==sha256||previous.schema!==schema)
              throw new Error('Client reference '+item.key+' already belongs to different original bytes or schema.');
            if(matching.length){previous.label=item.label||file.name;previous.sourceLinks=item.sourceLinks||[];}
            previous.error=null;continue;
          }
          const row={key:String(item.key),file:file.name,label:item.label||file.name,schema,
            bytes:file.size,sha256,sourceLinks:item.sourceLinks||[],documentId:null,error:null};
          if(!row.key.trim()||row.key.length>160)throw new Error('Client references must contain 1 to 160 characters.');
          checkCapacity([...intake,row]);intake.push(row);
        }
        saveIntake();
      }
      notice('Selected original XML files are ready for retained inspection.');
    }finally{intakeBusy=false;saveIntake();renderIntake();}
  }
  async function retainFiles() {
    if(intakeBusy||locked||getPending?.())throw new Error('Finish or reconcile the current operation before retaining files.');
    adoptRetained();intakeBusy=true;renderIntake();
    try{
      for(const row of intake){
        if(row.documentId)continue;
        const existing=records().find(document=>document.id===row.sha256);
        if(existing&&existing.report.schemaKind!==row.schema)
          throw new Error(row.file+' is already retained under '+existing.report.schemaKind+'. Review the schema choice before continuing.');
        const file=localFiles.get(row.sha256+'\n'+row.file);
        if(!file)throw new Error('Reselect the original '+row.file+' with its saved SHA256 before continuing.');
        row.error=null;
        try{
          const result=await upload('/api/clinical/prs-upload',file,{'X-Clinical-Schema':row.schema,'X-Clinical-Sha256':row.sha256});
          if(result.id!==row.sha256||result.report.schemaKind!==row.schema)throw new Error('The original XML inspection returned a different source identity or schema.');
          row.documentId=result.id;saveIntake();renderIntake();
        }catch(error){row.error=error.message||String(error);saveIntake();throw error;}
      }
      notice('All selected XML files and original inspections are retained. Review the client references, then create the batch.');
    }finally{intakeBusy=false;saveIntake();renderIntake();}
  }
  function addRetained() {
    if(intakeBusy)throw new Error('Finish the current input operation first.');
    for(const option of Array.from($('batch-retained-documents').selectedOptions)){
      const record=records().find(row=>row.id===option.value);if(!record)continue;
      const row={key:uniqueKey(record.name),file:record.name,label:record.name,schema:record.report.schemaKind,
        bytes:record.report.bytes,sha256:record.id,sourceLinks:[],documentId:record.id,error:null};
      checkCapacity([...intake,row]);intake.push(row);
    }
    saveIntake();renderIntake();
  }
  function downloadManifest() {
    const content=json({schema:'stellar-forge.clinicaltrials-batch-intake.v1',name:$('batch-name').value,
      reviewer:$('batch-reviewer').value,note:$('batch-note').value,
      entries:intake.map(({key,file,sha256,label,schema,sourceLinks})=>({key,file,sha256,label,schema,sourceLinks}))})+'\n';
    const url=URL.createObjectURL(new Blob([content],{type:'application/json'})),link=node('a');
    link.href=url;link.download='disclosure-intake.json';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
  }
  function batchOptions(model) {
    const items=(model.batches||[]).map(batch=>[batch.id,batch.name+' · '+batch.entries+' entries · '+batch.state]);
    fill($('batch-select'),items,requestedId||$('batch-select').value);
    if(requestedId&&!items.some(([id])=>id===requestedId)){requestedId='';loaded=null;opened=null;}
  }
  async function readBatch(id=$('batch-select').value,{reloadEntry=false}={}) {
    if(!id){loaded=null;opened=null;renderBatch();return;}
    const sequence=++readSequence;requestedId=id;saveIntake();$('batch-select').value=id;
    const result=await api('/api/clinical/batch?'+params({batchId:id}));
    if(sequence!==readSequence)return;
    loaded=result;lastBatchRevision=result.id+':'+result.updatedAt;renderBatch();
    if(opened?.batchId===id&&result.entries.some(row=>row.id===opened.entry.id)){
      if(reloadEntry||opened.entry.contextSha256!==result.entries.find(row=>row.id===opened.entry.id).contextSha256||
         opened.entry.history.length!==result.entries.find(row=>row.id===opened.entry.id).history.length)await readEntry(opened.entry.id);
    }else{opened=null;formKey='';$('batch-entry').hidden=true;}
    controls(locked);
  }
  function renderBatch() {
    const batch=loaded;
    if(!batch){$('batch-summary').replaceChildren();$('batch-table').replaceChildren(node('p','Open a retained batch to review its client entries.','empty'));$('batch-entry').hidden=true;renderExports();return;}
    const s=batch.summary;
    facts($('batch-summary'),[['Batch',batch.name],['Receiving reviewer',batch.reviewer],
      ['Client entries / distinct inputs',number(s.entries)+' / '+number(s.uniqueInputs)],
      ['Ready / follow-up / excluded / pending',[s.ready,s.followUp,s.excluded,s.pending].map(number).join(' / ')],
      ['Original findings',number(s.findingCount)],['Last saved',batch.updatedAt]]);
    const filter=$('batch-filter').value,query=$('batch-search').value.trim().toLowerCase();
    const rows=batch.entries.filter(row=>(filter==='all'||filter==='findings'&&row.findings.length||
      filter==='pending'&&!row.review||row.review?.decision===filter)&&
      (!query||[row.key,row.label,...row.sourceLinks.map(link=>link.nctId)].join(' ').toLowerCase().includes(query)));
    table($('batch-table'),['Client reference / open','Selected document','Original inspection','Source links','Disposition','Findings'],
      rows.map(row=>[button(row.key,()=>readEntry(row.id)),row.label,
        row.inspection.schemaKind+' · '+(row.inspection.schemaValid?'XSD valid':'Review XML')+' · '+row.inspection.studies+' studies',
        row.sourceLinks.map(link=>link.nctId).join(', ')||'No explicit link',
        decisions[row.review?.decision]||'Awaiting review',number(row.findings.length)]),'No client entries match this view.');
    renderExports();
  }
  async function readEntry(id) {
    if(!loaded)throw new Error('Open the original batch first.');
    const sequence=++entrySequence,batchId=loaded.id;
    const result=await api('/api/clinical/batch-entry?'+params({batchId,entryId:id}));
    if(sequence!==entrySequence||batchId!==loaded?.id)return;
    opened=result;renderEntry(true);$('batch-entry').scrollIntoView({block:'start',behavior:'smooth'});
  }
  function rowPayload(extra={}) {
    if(!opened||opened.batchId!==loaded?.id)throw new Error('Read the retained batch entry first.');
    return {batchId:opened.batchId,entryId:opened.entry.id,expectedDocumentId:opened.entry.documentId,...extra};
  }
  async function change(action,extra={}) {
    const id=selected()?.id;
    const result=await perform(action,rowPayload(extra));
    if(result.batch){loaded=result.batch;lastBatchRevision=loaded.id+':'+loaded.updatedAt;}
    renderBatch();if(id)await readEntry(id);
    return result;
  }
  function renderLegacy(report) {
    const body=$('batch-legacy-rows');body.replaceChildren();
    const legacy=report.legacyElements||[];
    for(const item of legacy){
      const tr=node('tr');tr.dataset.elementId=item.elementId;
      const identity=node('div');identity.append(node('strong',item.ruleId),node('p',item.path||'','help'),
        details('Original occurrence and replacement fields',item));
      const choice=node('select');choice.dataset.choice='';
      fill(choice,[['','Choose a reviewed decision'],['keep','Keep with explanation'],['remove','Remove'],['replace','Replace']],'');
      const reason=node('textarea');reason.rows=2;reason.dataset.reason='';reason.maxLength=8192;reason.setAttribute('aria-label','Reason for '+item.ruleId);
      const replacement=node('textarea');replacement.rows=3;replacement.value='{}';replacement.dataset.replacement='';
      replacement.setAttribute('aria-label','Replacement fields for '+item.ruleId);
      replacement.disabled=true;choice.addEventListener('change',()=>{replacement.disabled=choice.value!=='replace';});
      for(const value of [identity,item.value,choice,reason,replacement]){const td=node('td');td.append(value instanceof Node?value:node('span',value));tr.append(td);}body.append(tr);
    }
    if(!legacy.length){const tr=node('tr'),td=node('td','The original inspection found no deprecated elements in this selected document.');td.colSpan=5;tr.append(td);body.append(tr);}
  }
  function renderPreview() {
    const target=$('batch-preview-result');target.replaceChildren();
    if(!opened)return;
    const latest=[...opened.entry.history].reverse().find(event=>event.action==='batch.preview');
    const preview=opened.preview;
    if(latest){
      const ids=latest.references;
      target.append(node('p','A composed candidate is retained. Read its original comparison and select it explicitly for this entry.'));
      target.append(button('Read retained composition',async()=>{
        const value=await api('/api/clinical/prs-preview?'+params({previewId:ids.previewId}));
        target.replaceChildren(node('p',value.complete?'Composition complete':'Composition has unresolved source units'),
          details('Original composition and candidate inspection',value),
          button('Use this composed candidate',async()=>{
            const reviewer=$('batch-candidate-reviewer').value.trim()||$('batch-preview-reviewer').value.trim();
            const note=$('batch-candidate-note').value.trim();
            if(!reviewer||!note)throw new Error('Enter the candidate reviewer and selection reason below before choosing this candidate.');
            await change('batch.select',{documentId:ids.candidateId,previewId:ids.previewId,reviewer,note});
            notice('The composed candidate is selected. Review its current findings and retain a new disposition.');
          },{write:true}));
      }));
      target.append(details('Retained candidate identifiers',ids));
    }
    if(preview)target.append(details('Composition selected for this entry',preview));
    if(!latest&&!preview)target.append(node('p','Prepare a composition to inspect the current incoming XML against a retained base.','help'));
  }
  function renderEntry(force=false) {
    if(!opened){$('batch-entry').hidden=true;return;}
    const {entry,document,original,plan,reconciliation}=opened;
    $('batch-entry').hidden=false;$('batch-entry-title').textContent=entry.key+' — '+entry.label;
    facts($('batch-entry-summary'),[['Original file',original.name],['Selected file',document.name],
      ['Schema / inspection',document.report.schemaKind+' / '+(document.report.schemaValid?'XSD valid':'Review XML')],
      ['Disposition',decisions[entry.review?.decision]||'Awaiting review'],
      ['Original study units',number(document.report.studies?.length)],['Explicit registry links',entry.sourceLinks.map(link=>link.nctId).join(', ')||'None selected']]);
    table($('batch-findings'),['Review area','Finding','Next decision'],entry.findings.map(finding=>[
      finding.kind,(()=>{const value=node('div');value.append(node('p',finding.message),details('Original finding details',finding.detail));return value;})(),
      finding.blocking?'Resolve before ready':'Review and record disposition',
    ]),'The original inspection has no unresolved findings for this selected entry.');
    const key=opened.batchId+':'+entry.id+':'+entry.contextSha256+':'+entry.history.length;
    if(force||key!==formKey){
      formKey=key;
      $('batch-decision').value=entry.review?.decision||'ready';
      $('batch-decision-reviewer').value=entry.review?.reviewer||loaded.reviewer;
      $('batch-decision-note').value=entry.review?.note||'';
      for(const id of ['batch-plan-reviewer','batch-preview-reviewer','batch-candidate-reviewer'])$(id).value=loaded.reviewer;
      $('batch-plan-rationale').value='';$('batch-candidate-note').value='';
      $('batch-source-links').value=json(entry.sourceLinks);
      if(reconciliation)$('batch-reconcile-plan').value=json(reconciliation.report.plan);
      else $('batch-reconcile-plan').value=json({studyLinks:[],fieldIds:[],recordLinks:[],idLinks:[],decisions:[],reviewer:loaded.reviewer,rationale:''});
      renderLegacy(document.report);
      $('batch-plan-details').textContent=plan?json(plan):'Prepare a plan from explicit occurrence decisions.';
      $('batch-reconciliation-details').textContent=reconciliation?json(reconciliation):'No original typed reconciliation is selected for this entry.';
      renderPreview();
    }
    const sameSchema=records().filter(record=>record.report.schemaKind===document.report.schemaKind);
    fill($('batch-preview-base'),sameSchema.map(record=>[record.id,record.name+' · '+short(record.id)]));
    fill($('batch-candidate-document'),sameSchema.map(record=>[record.id,record.name+' · '+short(record.id)]),entry.documentId);
    $('batch-entry-details').textContent=json(opened);
    controls(locked);
  }
  function renderExports() {
    const target=$('batch-exports');target.replaceChildren();
    const exports=loaded?.exports||[];
    if(!exports.length){target.append(node('p','Prepare a delivery from the selected batch to retain all originals, decisions and portable recovery files.','empty'));return;}
    for(const delivery of [...exports].reverse()){
      const section=node('article','', 'batch-delivery');section.append(node('h3',delivery.name+' · '+delivery.createdAt));
      section.append(node('p',number(delivery.summary.entries)+' entries · '+delivery.summary.state));
      const featured=['disclosure-batch.zip','HANDOVER.md','batch-register.csv','exceptions.csv','clinicaltrials-workspace.zip'];
      const actions=node('div',undefined,'actions');
      for(const name of featured){if(delivery.files.some(file=>file.name===name))
        actions.append(button(name,()=>download('/api/clinical/batch-export?'+params({exportId:delivery.id,file:name}),name)));}
      section.append(actions);
      const inventory=node('details');inventory.append(node('summary','Complete declared files and exact identities'));
      const wrap=node('div',undefined,'table-scroll');
      table(wrap,['Retained member','Bytes','SHA256',''],delivery.files.map(file=>[file.name,number(file.bytes),file.sha256,
        button('Download',()=>download('/api/clinical/batch-export?'+params({exportId:delivery.id,file:file.name}),file.name.split('/').at(-1)))]));
      inventory.append(wrap);section.append(inventory);target.append(section);
    }
  }
  function controls(value) {
    locked=value;
    $('batch-retain-files').disabled=locked||intakeBusy||!intake.some(row=>!row.documentId);
    $('batch-create').disabled=locked||intakeBusy||!intake.length||intake.some(row=>!row.documentId);
    $('batch-clear-queue').disabled=intakeBusy;
    $('batch-files').disabled=intakeBusy;$('batch-add-retained').disabled=intakeBusy||!records().length;
    $('batch-read').disabled=!current().batches?.length;
    $('batch-export').disabled=locked||intakeBusy||!loaded;
    $('batch-entry').querySelectorAll('[data-write]').forEach(control=>{control.disabled=locked||intakeBusy||!opened;});
    $('batch-apply-plan').disabled=locked||intakeBusy||!opened?.plan||opened.plan.documentId!==selected()?.documentId;
    $('batch-plan-form').querySelector('[type=submit]').disabled=locked||intakeBusy||!(opened?.document.report.legacyElements||[]).length;
  }
  function render(model) {
    batchOptions(model);
    const docKey=(model.prs||[]).map(record=>record.id).join('|');
    if(docKey!==lastDocumentList){
      lastDocumentList=docKey;const selectedIds=new Set(Array.from($('batch-retained-documents').selectedOptions).map(option=>option.value));
      $('batch-retained-documents').replaceChildren(...(model.prs||[]).map(record=>{
        const option=node('option',record.name+' · '+record.report.schemaKind+' · '+short(record.id));option.value=record.id;option.selected=selectedIds.has(record.id);return option;
      }));
    }
    const capKey=(model.captures||[]).map(capture=>capture.id).join('|');
    if(capKey!==lastCaptureList){lastCaptureList=capKey;
      fill($('batch-reconcile-capture'),(model.captures||[]).map(capture=>[capture.id,(capture.configuration?.name||capture.id)+' · '+number(capture.rowCount)+' studies']));
      $('batch-capture-hint').textContent=(model.captures||[]).length?
        'Use explicit captured NCT links. Open PRS tools for the complete typed reconciliation field catalog.':
        'No registry cohort is retained here. The batch can be received and reviewed independently; add explicit source links after a source capture is retained.';
    }
    renderIntake();renderBatch();if(opened)renderEntry();
    const id=requestedId||$('batch-select').value,summary=(model.batches||[]).find(batch=>batch.id===id);
    if(summary&&summary.id+':'+summary.updatedAt!==lastBatchRevision){
      // Only read committed records. A failed read is retried by the operator's Open button.
      lastBatchRevision=summary.id+':'+summary.updatedAt;handle(()=>readBatch(id,{reloadEntry:true}));
    }
  }
  const form=(id,callback)=>$(id).addEventListener('submit',event=>{event.preventDefault();handle(callback);});
  $('batch-open-prs').addEventListener('click',()=>selectSection('prs'));
  for(const id of ['batch-name','batch-reviewer','batch-note'])$(id).addEventListener('input',saveIntake);
  $('batch-files').addEventListener('change',()=>handle(addFiles));
  $('batch-retain-files').addEventListener('click',()=>handle(retainFiles));
  $('batch-add-retained').addEventListener('click',()=>handle(addRetained));
  $('batch-clear-queue').addEventListener('click',()=>{
    if(intakeBusy)return;intake=[];localFiles.clear();$('batch-files').value='';saveIntake();renderIntake();
  });
  $('batch-manifest-download').addEventListener('click',()=>handle(downloadManifest));
  form('batch-intake-form',async()=>{
    adoptRetained();if(!intake.length||intake.some(row=>!row.documentId))throw new Error('Retain every selected original input before creating the batch.');
    if(new Set(intake.map(row=>row.key)).size!==intake.length)throw new Error('Each client reference must be unique.');
    const result=await perform('batch.create',{name:$('batch-name').value,reviewer:$('batch-reviewer').value,note:$('batch-note').value,
      entries:intake.map(row=>({key:row.key,label:row.label,documentId:row.documentId,sourceLinks:row.sourceLinks}))});
    loaded=result;requestedId=result.id;lastBatchRevision=result.id+':'+result.updatedAt;saveIntake();
    batchOptions(current());renderBatch();controls(locked);notice('The receiving batch is retained with '+result.entries.length+' separate client references.');
  });
  $('batch-select').addEventListener('change',()=>handle(()=>readBatch()));
  $('batch-read').addEventListener('click',()=>handle(()=>readBatch(undefined,{reloadEntry:true})));
  $('batch-filter').addEventListener('change',renderBatch);$('batch-search').addEventListener('input',renderBatch);
  $('batch-current-xml').addEventListener('click',()=>handle(()=>{
    if(!selected())throw new Error('Open a batch entry first.');
    return download('/api/clinical/prs-file?'+params({documentId:selected().documentId,kind:'xml'}),opened.document.name);
  }));
  form('batch-review-form',async()=>{
    await change('batch.review',{expectedContextSha256:selected()?.contextSha256,decision:$('batch-decision').value,
      reviewer:$('batch-decision-reviewer').value,note:$('batch-decision-note').value});
    notice('The disposition is retained against the exact current document and source review.');
  });
  form('batch-plan-form',async()=>{
    const chosen=[];
    for(const row of $('batch-legacy-rows').querySelectorAll('[data-element-id]')){
      const action=row.querySelector('[data-choice]').value;if(!action)continue;
      const reason=row.querySelector('[data-reason]').value.trim();if(!reason)throw new Error('Give a reason for every selected occurrence decision.');
      let replacement;
      if(action==='replace'){
        try{replacement=JSON.parse(row.querySelector('[data-replacement]').value);}catch{throw new Error('Replacement fields must be valid JSON.');}
        if(!replacement||typeof replacement!=='object'||Array.isArray(replacement))throw new Error('Replacement fields must be an object.');
      }
      chosen.push({elementId:row.dataset.elementId,action,reason,...(replacement?{replacement}:{})});
    }
    if(!chosen.length)throw new Error('Choose at least one original occurrence and an explicit decision.');
    await change('batch.plan',{decisions:chosen,reviewer:$('batch-plan-reviewer').value,rationale:$('batch-plan-rationale').value});
    notice('The original modernization plan is retained for review before applying it.');
  });
  $('batch-apply-plan').addEventListener('click',()=>handle(async()=>{
    if(!opened?.plan)throw new Error('Prepare the original modernization plan first.');
    await change('batch.apply',{planId:opened.plan.id});
    notice('The original engine retained a separate candidate and comparison. Review the selected candidate and record a new disposition.');
  }));
  form('batch-preview-form',async()=>{
    await change('batch.preview',{baseDocumentId:$('batch-preview-base').value,reviewer:$('batch-preview-reviewer').value,
      rules:parsed('batch-preview-rules','Source interpretation rules','object')});
    notice('The original composition and candidate are retained. Read the comparison before explicitly selecting it.');
  });
  form('batch-candidate-form',async()=>{
    await change('batch.select',{documentId:$('batch-candidate-document').value,
      reviewer:$('batch-candidate-reviewer').value,note:$('batch-candidate-note').value});
    notice('The retained candidate is selected; prior XML and decisions remain in this entry’s history.');
  });
  form('batch-links-form',async()=>{
    await change('batch.links',{sourceLinks:parsed('batch-source-links','Original study links','array')});
    notice('Explicit original source links are retained. Review a new reconciliation and disposition against this context.');
  });
  form('batch-reconcile-form',async()=>{
    await change('batch.reconcile',{captureId:$('batch-reconcile-capture').value,plan:parsed('batch-reconcile-plan','Typed reconciliation plan','object')});
    notice('The original typed comparison and source identities are retained for this entry.');
  });
  $('batch-export').addEventListener('click',()=>handle(async()=>{
    if(!loaded)throw new Error('Open the selected batch first.');
    const result=await perform('batch.export',{batchId:loaded.id});
    await readBatch(loaded.id);notice('Complete batch handover retained with '+result.files.length+' declared files.');
  }));
  renderIntake();controls(true);
  return {render,controls};
}

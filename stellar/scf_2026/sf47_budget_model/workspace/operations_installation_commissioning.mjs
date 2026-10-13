// Borrow the existing Source Desk owner, browser journal, requests and file transport.
const RECEIVING = 'stellar-forge.installation-commissioning-receiving.v1';
const REQUIRED = ['commissioning-capture.json','commissioning-manifest.json',
  'commissioning-review.json','commissioning-source.json','original-workshares.json'];
const SNAPSHOT = 'commissioning-account-snapshot.json';
const clone = value => JSON.parse(JSON.stringify(value));
const rows = value => Array.isArray(value) ? value : [];
const name = value => value?.filename ?? value?.name ?? '';
const isArchive = file => /\.tar$/i.test(name(file)) || file?.mediaType === 'application/x-tar';
const display = value => value === null || value === undefined || value === '' ? '—' : String(value);

export function createCommissioningReceivingDesk(owner) {
  const {esc,pretty,stable,header,table,empty,hint,btn,field} = owner;
  const state = () => owner.state();
  const draft = () => owner.draft();
  const work = () => state().commissioningWork;
  const originals = () => rows(owner.files());
  const details = (title,value) => '<details><summary>'+esc(title)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
  const identity = (label,id) => '<strong>'+esc(display(label))+'</strong><br><code>'+esc(display(id))+'</code>';
  const mutation = () => {
    owner.requireEdit();
    if(!work())throw new Error('Open the commissioning receiving selection first.');
    if(work().draftId!==state().draftId)throw new Error('Select the original commissioning draft.');
  };
  function initial() {
    const files=originals(), selected=REQUIRED.flatMap(filename=>{
      const matches=files.filter(file=>name(file)===filename);
      return matches.length===1?[matches[0].id]:[];
    });
    const captures=files.filter(file=>name(file)==='commissioning-capture.json');
    return {draftId:state().draftId,baseRevision:draft().revision,
      captureFileId:captures.length===1?captures[0].id:'',fileIds:selected,
      projectId:'',installationId:'',milestonePhases:[],includeAccountSnapshot:false,
      inspection:null,inspectionKey:null,preview:null,previewKey:null,receipt:null,dirty:false};
  }
  function open() {
    owner.requireEdit();
    if(!work()||work().draftId!==state().draftId)state().commissioningWork=initial();
    state().tab='commissioning';owner.changed();
  }
  function invalidate({source=false}={}) {
    const w=work();if(!w)return;
    w.preview=null;w.previewKey=null;
    if(source){w.inspection=null;w.inspectionKey=null;}
  }
  function changed(source=false) {
    work().dirty=true;invalidate({source});owner.changed();
  }
  function fileSelection() {
    const w=work(), ids=rows(w?.fileIds);
    if(!w?.captureFileId||!ids.includes(w.captureFileId))throw new Error('Select the original capture file and include it in the receiving files.');
    if(new Set(ids).size!==ids.length)throw new Error('Select each complete original file once.');
    const files=ids.map(id=>{
      const file=originals().find(row=>row.id===id);
      if(!file)throw new Error('A selected original file is absent from this source draft edition.');
      if(isArchive(file))throw new Error('Review and receive the original archive before selecting its capture members for Installation attachment.');
      return file;
    });
    for(const required of REQUIRED){
      if(files.filter(file=>name(file)===required).length!==1)
        throw new Error('Select exactly one complete '+required+' from this original capture.');
    }
    if(name(files.find(file=>file.id===w.captureFileId))!=='commissioning-capture.json')
      throw new Error('The capture selector must name commissioning-capture.json.');
    return {expectedRevision:draft().revision,captureFileId:w.captureFileId,fileIds:ids.slice()};
  }
  function sourceKey(selection=fileSelection()) {
    return stable({draftId:state().draftId,...selection,files:selection.fileIds.map(id=>{
      const f=originals().find(row=>row.id===id);
      return {id:f.id,filename:name(f),sha256:f.sha256,bytes:f.bytes};
    })});
  }
  function requireInspection() {
    const w=work();
    if(!w.inspection||w.inspectionKey!==sourceKey())throw new Error('Inspect the complete current source selection before reviewing the Installation mapping.');
    return w.inspection;
  }
  function installation() {
    return rows(work()?.inspection?.installations).find(row=>row.id===work()?.installationId);
  }
  function project() {
    return rows(work()?.inspection?.projects).find(row=>row.id===work()?.projectId);
  }
  function phases(value=installation()) {
    const binding=value?.workshare, checks=rows(binding?.phaseChecks);
    return checks.map(row=>({id:row.phaseId,checkId:row.checkId,
      label:rows(value?.checks).find(check=>check.id===row.checkId)?.title||row.phaseId,original:row})).filter(row=>typeof row.id==='string'&&row.id.length);
  }
  function payload() {
    const inspected=requireInspection(), w=work(), selected=installation(), selectedProject=project();
    if(!selectedProject)throw new Error('Choose an original saved commissioning project.');
    if(!selected)throw new Error('Choose the existing Installation that owns the original Workshare case.');
    if(selectedProject.caseId!==selected.workshare?.caseId)
      throw new Error('The selected commissioning project and Installation have different original Workshare case IDs.');
    const mapping=rows(w.milestonePhases).filter(row=>row.phaseId);
    if(!mapping.length)throw new Error('Map at least one saved milestone to an original Workshare phase.');
    const valid=phases(selected);
    for(const row of mapping){
      if(!Number.isSafeInteger(row.milestoneIndex)||!rows(selectedProject.milestones).some((m,i)=>(m.index??i)===row.milestoneIndex)||
         !valid.some(item=>item.id===row.phaseId))throw new Error('Choose an existing captured milestone and an original Workshare phase.');
    }
    const hasSnapshot=w.fileIds.some(id=>name(originals().find(f=>f.id===id))===SNAPSHOT);
    if(hasSnapshot&&!w.includeAccountSnapshot)throw new Error('Explicitly approve the complete private account snapshot or remove it from this receiving selection.');
    return {...fileSelection(),expectedVersion:inspected.version,projectId:w.projectId,
      installationId:w.installationId,expectedInstallationRevision:selected.revision,
      milestonePhases:clone(mapping),includeAccountSnapshot:Boolean(w.includeAccountSnapshot)};
  }
  function verifyResponse(value,selection) {
    if(value?.schema!==RECEIVING||value.caseId!==owner.caseId||value.draftId!==state().draftId||
       value.draftRevision!==selection.expectedRevision)
      throw new Error('The commissioning response differs from the selected original case and draft revision.');
    return value;
  }
  async function inspect() {
    mutation();const w=work(), selection=fileSelection(), key=sourceKey(selection);
    const value=await owner.api('/commissioning/inspect',clone(selection));
    if(!owner.available()||w!==work()||key!==sourceKey())return;
    verifyResponse(value,selection);
    if(!Array.isArray(value.files)||!Array.isArray(value.projects)||!Array.isArray(value.installations))
      throw new Error('The original commissioning inspection is incomplete.');
    for(const id of selection.fileIds){
      const expected=originals().find(file=>file.id===id), actual=value.files.find(file=>file.id===id);
      if(!actual||actual.sha256!==expected.sha256||actual.bytes!==expected.bytes||name(actual)!==name(expected))
        throw new Error('The inspected file identity differs from the complete retained original.');
    }
    w.inspection=clone(value);w.inspectionKey=key;w.baseRevision=selection.expectedRevision;
    w.preview=null;w.previewKey=null;
    if(!value.projects.some(item=>item.id===w.projectId))w.projectId='';
    if(!value.installations.some(item=>item.id===w.installationId))w.installationId='';
    w.dirty=true;state().notice='Verified the complete capture, saved review and original source identities. Choose the original project and Installation.';
    owner.changed();
  }
  async function preview() {
    mutation();const w=work(), selection=payload(), key=stable(selection);
    const value=await owner.api('/commissioning/preview',clone(selection));
    if(!owner.available()||w!==work()||key!==stable(payload()))return;
    verifyResponse(value,selection);
    if(typeof value.previewSha256!=='string'||!/^[0-9a-f]{64}$/.test(value.previewSha256)||
       value.selection?.projectId!==selection.projectId||value.selection?.installationId!==selection.installationId||
       value.selection?.expectedVersion!==selection.expectedVersion||
       value.selection?.expectedInstallationRevision!==selection.expectedInstallationRevision||
       stable(rows(value.selection?.fileIds).slice().sort())!==stable(selection.fileIds.slice().sort())||
       value.selection?.captureFileId!==selection.captureFileId||
       stable(rows(value.selection?.milestonePhases).slice().sort((a,b)=>a.milestoneIndex-b.milestoneIndex||a.phaseId.localeCompare(b.phaseId)))!==stable(selection.milestonePhases.slice().sort((a,b)=>a.milestoneIndex-b.milestoneIndex||a.phaseId.localeCompare(b.phaseId)))||
       value.selection?.includeAccountSnapshot!==selection.includeAccountSnapshot)
      throw new Error('The native preview differs from the complete reviewed receiving selection.');
    w.preview=clone(value);w.previewKey=key;w.dirty=true;
    state().notice='Reviewed exact source additions and original phase checks. Attach the reviewed source references when ready.';
    owner.changed();
  }
  function previewCurrent() {
    try{return Boolean(work()?.preview&&work().previewKey===stable(payload()));}catch{return false;}
  }

  const ARCHIVE_SCHEMA='stellar-forge.installation-commissioning-archive.v1';
  function archiveWork(){
    const w=work();
    if(!w)throw new Error('Open the commissioning receiving selection first.');
    if(!w.archive)w.archive={fileId:'',replaceFileIds:[],preview:null,previewKey:null,receipt:null,offset:0};
    return w.archive;
  }
  function archiveInput(){
    const a=archiveWork(), file=originals().find(row=>row.id===a.fileId);
    if(!file)throw new Error('Choose the complete original handover archive retained in this source draft.');
    return {expectedRevision:draft().revision,archiveFileId:file.id,replaceFileIds:rows(a.replaceFileIds).slice().sort()};
  }
  function archiveKey(){
    const input=archiveInput(), file=originals().find(row=>row.id===input.archiveFileId);
    return stable({...input,archive:{id:file.id,filename:name(file),sha256:file.sha256,bytes:file.bytes}});
  }
  function invalidateArchive(){
    const a=work()?.archive;if(a){a.previewKey=null;}
  }
  function archiveCurrent(){
    try{const a=archiveWork();return Boolean(a.preview&&a.previewKey===archiveKey());}catch{return false;}
  }
  async function inspectArchive(){
    mutation();const w=work(),a=archiveWork(),input=archiveInput(),key=archiveKey();
    const value=await owner.api('/commissioning/archive-inspect',clone(input));
    if(!owner.available()||w!==work()||a!==work().archive||key!==archiveKey())return;
    const original=originals().find(row=>row.id===input.archiveFileId);
    if(value?.schema!==ARCHIVE_SCHEMA||value.caseId!==owner.caseId||value.draftId!==state().draftId||
       value.draftRevision!==input.expectedRevision||!Array.isArray(value.members)||
       value.archive?.id!==original.id||value.archive?.sha256!==original.sha256||value.archive?.bytes!==original.bytes||
       value.selection?.archiveFileId!==original.id||value.selection?.expectedArchiveSha256!==original.sha256||
       stable(rows(value.selection?.replaceFileIds).slice().sort())!==stable(input.replaceFileIds)||
       typeof value.previewSha256!=='string'||!/^[0-9a-f]{64}$/.test(value.previewSha256))
      throw new Error('The archive review differs from the exact original retained archive or replacement selection.');
    a.preview=clone(value);a.previewKey=key;a.offset=0;
    w.dirty=true;state().notice=value.ready?
      'Reviewed every original archive member and the complete source capacity. Receive the exact reviewed archive when ready.':
      'The archive review identifies current source conflicts or capacity findings. Review their complete identities before receiving.';
    owner.changed();
  }
  async function receiveArchive(){
    mutation();const a=archiveWork();
    if(!archiveCurrent()||a.preview.ready!==true)throw new Error('Review a ready complete archive selection before receiving.');
    if(!String(state().note||'').trim())throw new Error('Enter the original source receiving reason before recording the archive.');
    const preview=clone(a.preview);
    if(!confirm('Receive this complete original archive into the current Source Desk edition, apply only the reviewed replacements, and open its suggested capture selection?'))return;
    return owner.issue('commissioning.archive.receive',{
      ...preview.selection,expectedPreviewSha256:preview.previewSha256
    },preview.draftRevision);
  }
  function adoptArchiveReceipt(result){
    if(result?.state!=='RECEIVED_COMMISSIONING_ARCHIVE')return false;
    if(!work()||work().draftId!==state().draftId)state().commissioningWork=initial();
    const w=work(),a=archiveWork();
    state().reconciliations??=[];
    state().reconciliations.push({
      reason:'commissioning_archive_received',draftId:state().draftId,reviewedRevision:draft().revision,
      editedCommissioningReceiving:{
        captureFileId:w.captureFileId,fileIds:clone(w.fileIds),projectId:w.projectId,
        installationId:w.installationId,milestonePhases:clone(w.milestonePhases),
        includeAccountSnapshot:w.includeAccountSnapshot,preview:clone(w.preview)
      },archiveSha256:result.archive?.sha256,at:new Date().toISOString()
    });
    const selected=result.receivingSelection;
    if(!selected||typeof selected.captureFileId!=='string'||!Array.isArray(selected.fileIds))
      throw new Error('The recorded archive is missing its original suggested receiving selection.');
    // This result has already committed. Keep its complete original receipt in
    // the parent journal before the surrounding desk persists/refreshes.
    a.receipt=clone(result);a.preview=null;a.previewKey=null;a.replaceFileIds=[];a.offset=0;
    w.captureFileId=selected.captureFileId;w.fileIds=clone(selected.fileIds);
    w.projectId='';w.installationId='';w.milestonePhases=[];w.includeAccountSnapshot=false;
    w.inspection=null;w.inspectionKey=null;w.preview=null;w.previewKey=null;w.baseRevision=draft().revision;w.dirty=false;
    state().tab='commissioning';
    state().notice='Received the complete original handover archive. Inspect its suggested original capture files to select the project and Installation.';
    return true;
  }
  function editArchive(target){
    if(!target.matches('[data-commissioning-archive],[data-commissioning-replacement]'))return false;
    if(!owner.editing())return true;
    mutation();const a=archiveWork();
    if(target.matches('[data-commissioning-archive]')){
      a.fileId=target.value;a.replaceFileIds=[];a.preview=null;a.previewKey=null;a.offset=0;
    }else{
      const id=target.dataset.commissioningReplacement;
      if(!originals().some(file=>file.id===id)||!rows(a.preview?.conflicts).some(conflict=>conflict.existing?.id===id))throw new Error('Choose an original current file explicitly identified by the archive review.');
      const ids=new Set(a.replaceFileIds);if(target.checked)ids.add(id);else ids.delete(id);
      a.replaceFileIds=[...ids].sort();invalidateArchive();
    }
    work().dirty=true;owner.changed();owner.render();return true;
  }
  function archiveView(){
    const a=work()?.archive||{fileId:'',replaceFileIds:[],preview:null,offset:0}, preview=a.preview;
    const archives=originals().filter(isArchive);
    let body='<section class="source-desk-inspection">'+header('Receive a complete merchant handover archive',
      'Keep the original handover.tar and review every exact member before adding its files to this original source draft.')+
      '<p>Retain the complete archive through Original files first. The existing complete-file upload limit is 8 MiB. Larger handovers can use the original individual-file receiving path below.</p>'+
      '<div class="source-desk-fields"><label><span>Original retained handover archive</span><select data-source-edit data-commissioning-archive><option value="">Select original archive</option>'+
      archives.map(file=>'<option value="'+esc(file.id)+'"'+(a.fileId===file.id?' selected':'')+'>'+esc(name(file))+' · '+esc(file.bytes)+' bytes · '+esc(file.sha256.slice(0,12))+'</option>').join('')+
      '</select></label></div><div class="source-desk-actions">'+
      btn('Review complete original archive','commissioning-archive-inspect','',!a.fileId||owner.historic())+'</div>';
    if(!archives.length)body+=hint('Use Original files to retain the exact merchant handover.tar, including its source reference and observation time.');
    if(preview){
      const members=rows(preview.members), offset=Math.min(a.offset||0,Math.max(0,Math.floor((members.length-1)/100)*100));
      const conflicts=members.filter(member=>member.existingFileId&&member.disposition==='CONFLICT');
      body+=table(['Original archive','Capture','Current source review','Capacity'],[[
        identity(name(preview.archive),preview.archive.id)+'<br><code>'+esc(preview.archive.sha256)+'</code>',
        identity(preview.capture?.label||preview.capture?.id,preview.capture?.id),
        preview.ready?'Ready to receive':'Review required',
        esc(preview.newBytes)+' new bytes<br>'+esc(preview.selectedBytes)+' selected bytes<br>'+esc(preview.storedBytesAfter)+' retained bytes after receiving'
      ]])+
      '<p>The complete original archive remains retained. Suggested later Installation attachments contain the required capture/source JSON and selected-cohort reports. The complete account snapshot requires its explicit later attachment choice.</p>';
      if(conflicts.length){
        body+='<h4>Review changed current filenames</h4>'+
          '<p>Choose each exact current file to replace in the next source draft edition. Earlier source revisions and their complete bytes remain retained.</p>'+
          table(['Replace current selection','Current original file','Incoming original member','Exact replacement identities'],
            conflicts.map(member=>{
              const old=originals().find(file=>file.id===member.existingFileId);
              return [
                '<input type="checkbox" data-source-edit data-commissioning-replacement="'+esc(member.existingFileId)+'"'+(a.replaceFileIds.includes(member.existingFileId)?' checked':'')+' aria-label="Replace current '+esc(name(old))+'">',
                identity(name(old),old?.id)+'<br>'+esc(old?.bytes)+' bytes',
                esc(member.originalMemberName)+'<br>'+esc(member.bytes)+' bytes',
                'Current <code>'+esc(old?.sha256)+'</code><br>Incoming <code>'+esc(member.sha256)+'</code>'
              ];
            }));
      }
      body+='<h4>Complete original archive inventory</h4>'+
        table(['Original member / receiving filename','Retained identity','Original role','Receiving disposition'],
          members.slice(offset,offset+100).map(member=>[
            '<strong>'+esc(member.originalMemberName)+'</strong><br>'+esc(member.filename),
            '<code>'+esc(member.sha256)+'</code><br>'+esc(member.bytes)+' bytes',
            esc(member.originalRole||member.originalType||member.mediaType)+(member.containsCompleteAccount?'<br><strong>Complete private account snapshot</strong>':''),
            esc(member.disposition)+(member.replaceSelected?'<br>Explicit replacement selected':'')+(member.disposition==='ARCHIVE_ONLY'?'<br>Exact member remains in the original archive':'')
          ]))+
        '<div class="source-desk-actions">'+btn('Previous members','commissioning-archive-previous','',offset===0)+
        '<span>'+esc(members.length?offset+1:0)+'–'+esc(Math.min(members.length,offset+100))+' of '+esc(members.length)+' original members</span>'+
        btn('Next members','commissioning-archive-next','',offset+100>=members.length)+'</div>'+
        (!archiveCurrent()?hint('The archive or replacement selection changed. Review the complete current selection again.'):'')+
        '<div class="source-desk-actions">'+btn('Receive reviewed original archive','commissioning-archive-receive','',!archiveCurrent()||preview.ready!==true||owner.historic())+
        btn('Download full archive review','commissioning-archive-review-download')+'</div>'+
        details('Original conflicts, removals and source limits',{conflicts:preview.conflicts,removedFiles:preview.removedFiles,limits:preview.limits})+
        details('Complete original archive review',preview);
    }
    if(a.receipt){
      body+='<h4>Recorded complete archive receiving</h4>'+
        table(['Original archive','Saved capture','Received files','Recorded by'],[[
          identity(name(a.receipt.archive),a.receipt.archive?.sha256),
          identity(a.receipt.capture?.label,a.receipt.capture?.id),
          esc(rows(a.receipt.files).length)+' complete native files',
          esc(a.receipt.actor)+'<br>'+esc(a.receipt.receivedAt)
        ]])+
        '<div class="source-desk-actions">'+btn('Inspect received capture selection','commissioning-inspect')+
        btn('Download archive receiving receipt','commissioning-archive-receipt-download')+'</div>'+
        details('Complete original archive receiving receipt',a.receipt);
    }
    return body+'</section>';
  }
  async function archiveAction(name){
    if(name==='commissioning-archive-inspect')return inspectArchive();
    if(name==='commissioning-archive-receive')return receiveArchive();
    if(name==='commissioning-archive-review-download'){
      if(!archiveWork().preview)throw new Error('Review the complete original archive first.');
      return owner.download(pretty(archiveWork().preview),'COMMISSIONING_ARCHIVE_PREVIEW.json');
    }
    if(name==='commissioning-archive-receipt-download'){
      if(!archiveWork().receipt)throw new Error('Open the recorded original archive receipt.');
      return owner.download(pretty(archiveWork().receipt),'COMMISSIONING_ARCHIVE_RECEIPT.json');
    }
    const a=archiveWork(),total=rows(a.preview?.members).length;
    if(name==='commissioning-archive-previous')a.offset=Math.max(0,(a.offset||0)-100);
    else if(name==='commissioning-archive-next')a.offset=Math.min(Math.max(0,Math.floor((total-1)/100)*100),(a.offset||0)+100);
    else throw new Error('Choose an existing archive receiving action.');
    owner.changed();
  }

  async function attach() {
    mutation();if(!previewCurrent())throw new Error('Review the complete current Installation receiving selection first.');
    if(!String(state().note||'').trim())throw new Error('Enter the original Installation save reason in the Source Desk reason field before attaching.');
    const preview=clone(work().preview);
    if(!confirm('Attach these exact retained capture files and phase source references to the original Installation?'))return;
    return owner.issue('commissioning.attach',{
      ...preview.selection,expectedPreviewSha256:preview.previewSha256
    },preview.draftRevision);
  }
  function adoptReceipt(result) {
    if(adoptArchiveReceipt(result))return;
    if(result?.state!=='ATTACHED_COMMISSIONING')return;
    if(!work()||work().draftId!==state().draftId)state().commissioningWork=initial();
    work().receipt=clone(result);work().dirty=false;work().baseRevision=draft().revision;
    invalidate({source:true});state().tab='commissioning';
    state().notice='Attached the reviewed commissioning files and source references to Installation revision '+result.installation.revision+'.';
  }
  function onDraftAccepted({replace=false}={}) {
    const w=work();if(!w)return;
    if(w.draftId!==state().draftId){state().commissioningWork=null;return;}
    if(w.baseRevision!==draft().revision){invalidate({source:true});invalidateArchive();}
  }
  function rebase() {
    if(work()){work().baseRevision=draft().revision;invalidate({source:true});invalidateArchive();}
  }
  function edit(target) {
    if(editArchive(target))return true;
    if(!target.matches('[data-commissioning-field],[data-commissioning-file],[data-commissioning-phase],[data-commissioning-snapshot]'))return false;
    if(!owner.editing())return true;
    mutation();const w=work();
    if(target.matches('[data-commissioning-file]')){
      const id=target.dataset.commissioningFile;
      const selectedFile=originals().find(file=>file.id===id);
      if(!selectedFile)throw new Error('Select an existing complete file.');
      if(isArchive(selectedFile))throw new Error('Use the complete archive review above; attach its verified capture members.');
      const ids=new Set(w.fileIds);if(target.checked)ids.add(id);else ids.delete(id);
      w.fileIds=[...ids];changed(true);
    }else if(target.matches('[data-commissioning-snapshot]')){
      w.includeAccountSnapshot=target.checked;changed(false);
    }else if(target.matches('[data-commissioning-phase]')){
      const index=Number(target.dataset.commissioningPhase), row=w.milestonePhases.find(item=>item.milestoneIndex===index);
      if(row)row.phaseId=target.value;else w.milestonePhases.push({milestoneIndex:index,phaseId:target.value});
      changed(false);
    }else{
      const key=target.dataset.commissioningField;
      if(!['captureFileId','projectId','installationId'].includes(key))throw new Error('Select an original commissioning field.');
      w[key]=target.value;
      if(key!=='captureFileId')w.milestonePhases=[];
      if(key==='captureFileId'&&target.value&&!w.fileIds.includes(target.value))w.fileIds.push(target.value);
      changed(key==='captureFileId');
    }
    owner.render();return true;
  }
  function select(label,key,value,options) {
    return '<label><span>'+esc(label)+'</span><select data-source-edit data-commissioning-field="'+key+'">'+
      options.map(([id,title])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';
  }
  function amount(value,currency) {
    return esc(display(value))+(currency?.code?' '+esc(currency.code):typeof currency==='string'?' '+esc(currency):'');
  }
  function sourcesView(value) {
    return table(['Original file','Exact retained identity','Source additions'],rows(value).map(file=>[
      identity(name(file),file.id)+'<br>'+esc(file.originalRole||file.mediaType||file.originalType||'')+(file.generated?'<br><strong>Generated receiving association</strong>':''),
      '<code>'+esc(file.sha256)+'</code><br>'+esc(file.bytes)+' bytes<br>'+esc(file.sourceUrl||'')+'<br>'+esc(file.observedAt||''),
      file.reusedSourceId?'Existing source <code>'+esc(file.reusedSourceId)+'</code>':
        file.generated?'Native milestone / phase / source association':file.containsCompleteAccount?'Complete private account snapshot':'Original retained source'
    ]));
  }
  function reviewView(value) {
    if(!value)return '';
    return '<section class="source-desk-review">'+header('Reviewed Installation source additions',
      'The native review binds the exact draft, case version, Installation edition and original Workshare.')+
      table(['Saved capture','Original project','Current Installation','Source capacity'],[[
        identity(value.capture?.label||value.capture?.id,value.capture?.id),
        identity(value.project?.name,value.project?.id||value.project?.projectId),
        identity(value.installation?.name,value.installation?.id)+'<br>Revision '+esc(value.installation?.revision),
        esc(value.newSourceCount)+' new sources · '+esc(value.newBytes)+' new bytes'
      ]])+sourcesView(value.sources)+
      table(['Saved milestone','Original Workshare phase','Original check','Retained operator observation'],
        rows(value.milestonePhases).map(row=>[
          'Milestone '+esc(row.milestoneIndex+1)+' · '+esc(row.milestone?.condition||''),
          identity(row.phase?.name||row.phase?.title||row.phaseId,row.phaseId),
          identity(row.check?.criterion||row.check?.label||row.checkId,row.checkId),
          details('Complete original check, unchanged',row.check)
        ]))+
      (rows(value.findings).length?details('Exact native receiving findings',value.findings):hint('The native review returned no receiving findings.'))+
      '<p>Attachment adds the reviewed source references and the native receiving association to receiving and the selected phase checks. Original acceptance observations, dates, recording operators, payment selections and commercial terms remain under their original workflows.</p>'+
      '<div class="source-desk-actions">'+btn('Attach reviewed commissioning sources','commissioning-attach','',!previewCurrent())+
        btn('Download complete receiving preview','commissioning-preview-download')+'</div>'+
      details('Complete immutable native review',value)+'</section>';
  }
  function receiptView(value) {
    if(!value)return '';
    return '<section class="source-desk-review">'+header('Recorded commissioning receiving',
      'Original source attachment and Installation edition are retained by the existing request journal.')+
      table(['Capture / project','Saved Installation','Original case version','Recorded source references'],[[
        identity(value.capture?.label||value.capture?.id,value.projectId),
        identity(value.installation?.id,value.installation?.sha256)+'<br>Revision '+esc(value.installation?.revision),
        esc(value.version),esc(rows(value.sources).length)+' original files'
      ]])+
      '<div class="source-desk-actions">'+btn('Download complete attachment receipt','commissioning-receipt-download')+'</div>'+
      details('Complete recorded receiving result',value)+'</section>';
  }
  function render() {
    const w=work(), saved=draft(), historical=owner.historic();
    const retained=rows(saved?.attachments).filter(item=>item.state==='ATTACHED_COMMISSIONING'||item.result?.state==='ATTACHED_COMMISSIONING'||item.schema===RECEIVING);
    let body=header('Receive saved commissioning into an Installation',
      'Inspect the saved capture, select its original project, and map milestones to the existing Workshare phase checks.');
    if(!w||w.draftId!==state().draftId)return body+
      hint('Retain the complete original handover.tar or the five capture/source JSON files using Original files. The original case retains every attachment and its source identities.')+
      '<div class="source-desk-actions">'+btn('Open commissioning receiving selection','commissioning-open','',historical)+'</div>'+
      (retained.length?details('Original commissioning attachment history',retained):'');
    const selected=new Set(w.fileIds), files=originals();
    body+=archiveView();
    body+='<p>The complete private account snapshot contains every original receivables customer and ledger record. Include it only through the explicit selection below. Selected-cohort reports and the five required capture/source files can be received separately.</p>'+
      '<div class="source-desk-fields">'+select('Original commissioning capture','captureFileId',w.captureFileId,
        [['','Select retained capture'],...files.filter(file=>name(file)==='commissioning-capture.json').map(file=>[file.id,name(file)+' · '+file.sha256.slice(0,12)])])+'</div>'+
      table(['Receive file','Original name and role','Complete identity'],files.map(file=>[
        '<input type="checkbox" data-source-edit data-commissioning-file="'+esc(file.id)+'"'+(selected.has(file.id)?' checked':'')+(isArchive(file)?' disabled data-source-fixed="true"':'')+' aria-label="Receive '+esc(name(file))+'">',
        '<strong>'+esc(name(file))+'</strong><br>'+(REQUIRED.includes(name(file))?'Required original capture/source':name(file)===SNAPSHOT?'Complete private account snapshot':isArchive(file)?'Complete archive · use the archive review above':'Optional original or report'),
        '<code>'+esc(file.sha256)+'</code><br>'+esc(file.bytes)+' bytes'
      ]))+
      '<label><input type="checkbox" data-source-edit data-commissioning-snapshot'+(w.includeAccountSnapshot?' checked':'')+'> Explicitly include the complete private account snapshot if selected above</label>'+
      '<div class="source-desk-actions">'+btn('Inspect selected original capture','commissioning-inspect','',historical)+'</div>';
    const inspected=w.inspection;
    if(inspected){
      body+='<section class="source-desk-inspection">'+header('Verified capture and source cohort',
        'Choose exact original identities. No customer, milestone acceptance or payment is inferred from review status.')+
        details('Verified capture and file identities',{capture:inspected.capture,files:inspected.files,scope:inspected.scope})+
        '<div class="source-desk-fields">'+select('Original saved project','projectId',w.projectId,
          [['','Select saved project'],...rows(inspected.projects).map(row=>[row.id,row.name+' · '+display(row.caseId)])])+
        select('Existing native Installation','installationId',w.installationId,
          [['','Select original Installation'],...rows(inspected.installations).map(row=>[row.id,row.name+' · '+display(row.workshare?.caseId)+' · revision '+row.revision])])+'</div>';
      const p=project(), target=installation();
      if(p)body+=table(['Original project case','Saved customer','Commercial and cash attribution'],[[
        esc(p.caseId),esc(p.customerId),details('Saved selected-project totals',p.totals)]]);
      if(target)body+=details('Complete current Installation and original Workshare',{installation:target.id,revision:target.revision,
        workshare:target.workshare,checks:target.checks,receiving:target.receiving,payment:target.payment});
      if(p&&target){
        const choices=phases(target);
        body+=table(['Saved milestone','Original dated source review','Receive into original Workshare phase'],
          rows(p.milestones).map((milestone,index)=>{
            const n=milestone.index??index, selected=w.milestonePhases.find(row=>row.milestoneIndex===n)?.phaseId||'';
            return ['Milestone '+esc(n+1)+' · '+esc(milestone.condition||''),details('Complete captured milestone',milestone),
              '<select data-source-edit data-commissioning-phase="'+n+'"><option value="">Leave unmapped</option>'+
                choices.map(phase=>'<option value="'+esc(phase.id)+'"'+(phase.id===selected?' selected':'')+'>'+esc(phase.label)+' · '+esc(phase.checkId)+'</option>').join('')+'</select>'];
          }));
        if(!choices.length)body+=hint('This Installation has no original Workshare phase-check bindings. Open the existing Installation receiving workflow to establish its original binding.');
        body+='<div class="source-desk-actions">'+btn('Review exact Installation attachment','commissioning-preview','',historical||!choices.length)+'</div>';
      }
      body+='</section>';
    }
    body+=reviewView(w.preview)+receiptView(w.receipt);
    if(retained.length)body+=details('Original commissioning attachment history',retained);
    if(rows(saved?.commissioningArchives).length)body+=details('Original complete archive receiving history',saved.commissioningArchives);
    return body;
  }
  async function action(name) {
    if(name.startsWith('commissioning-archive-'))return archiveAction(name);
    if(name==='commissioning-open')return open();
    if(name==='commissioning-inspect')return inspect();
    if(name==='commissioning-preview')return preview();
    if(name==='commissioning-attach')return attach();
    if(name==='commissioning-preview-download'){
      if(!work()?.preview)throw new Error('Review the original attachment first.');
      return owner.download(pretty(work().preview),'COMMISSIONING_INSTALLATION_PREVIEW.json');
    }
    if(name==='commissioning-receipt-download'){
      if(!work()?.receipt)throw new Error('Open a recorded original receiving result.');
      return owner.download(pretty(work().receipt),'COMMISSIONING_INSTALLATION_RECEIPT.json');
    }
    throw new Error('Choose an existing commissioning receiving action.');
  }
  return {open,render,edit,action,adoptReceipt,onDraftAccepted,rebase};
}

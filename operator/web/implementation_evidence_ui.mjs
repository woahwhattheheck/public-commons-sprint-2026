import {clone,esc,validatePlan,implementationSourceRefs} from './implementation_core.mjs';
import {openEvidenceVault,captureEvidence,inspectEvidence,getEvidenceFile,createEvidencePreview,exportEvidenceBundle,importEvidenceBundle,downloadEvidenceBlob} from './implementation_evidence.mjs';

const button=(action,label,extra='')=>'<button type="button" data-iw-evidence="'+esc(action)+'" '+extra+'>'+esc(label)+'</button>';
const byId=(plan,id)=>(plan.source_links||[]).find(row=>row.id===id);
const fileRows=plan=>(plan.source_links||[]).filter(row=>row.kind==='local_file');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const size=n=>Number.isFinite(n)?n.toLocaleString()+' bytes':'Size unavailable';
const title=(collection,row)=>collection==='tasks'?row.title:collection==='visits'?(row.planned_date||row.visited_at||'Visit')+' · '+row.id:row.sample_id||row.id;
function assertValid(plan){const errors=validatePlan(plan);if(errors.length)throw Error(errors.map(e=>e.path+': '+e.message).join('\n'));}

export function attachImplementationEvidence(workbench){return new EvidencePanel(workbench);}
class EvidencePanel {
  constructor(w){
    this.w=w;this.vaultPromise=null;this.available=new Map();this.busy=false;this.preview=null;this.closed=false;
    this.click=e=>{const b=e.target.closest('[data-iw-evidence]');if(!b||!w.root.contains(b))return;e.preventDefault();this.run(()=>this.act(b)).catch(error=>w.fail(error));};
    this.change=e=>{if(e.target.matches('[data-iw-evidence-bundle]')){const f=e.target.files?.[0];e.target.value='';if(f)this.run(()=>this.openBundle(f)).catch(error=>w.fail(error));}};
    this.submit=e=>{if(e.target.matches('[data-iw-evidence-form]')){e.preventDefault();this.run(()=>this.capture(e.target)).catch(error=>w.fail(error));}};
    this.close=()=>this.revokePreview();
    w.root.addEventListener('click',this.click);w.root.addEventListener('change',this.change);w.root.addEventListener('submit',this.submit);w.root.addEventListener('close',this.close,true);
  }
  async vault(){if(!this.vaultPromise)this.vaultPromise=openEvidenceVault().catch(error=>{this.vaultPromise=null;throw error;});return this.vaultPromise;}
  async run(fn){if(this.busy)throw Error('The current file operation is still running.');this.busy=true;this.w.root.setAttribute('aria-busy','true');try{return await fn();}finally{this.busy=false;this.w.root.removeAttribute('aria-busy');}}
  stamp(){return {generation:this.w.generation,plan:clone(this.w.plan)};}
  unchanged(stamp){return !this.closed&&!this.w.gone&&this.w.generation===stamp.generation&&equal(this.w.plan,stamp.plan);}
  requireUnchanged(stamp){if(!this.unchanged(stamp))throw Error('The plan changed while the file operation ran. Original files are retained; reopen the selected plan before continuing.');}
  beforeRender(){this.revokePreview();}
  revokePreview(){if(this.preview){this.preview.revoke();this.preview=null;}}
  recordButton(collection,id){return button('add','Files','data-collection="'+esc(collection)+'" data-id="'+esc(id)+'"');}
  body(){
    const w=this.w,rows=fileRows(w.plan);
    return '<section class="iw-evidence"><div class="iw-section-head"><h3>Original files and complete handover</h3>'+button('add','Add original files')+'</div><p>Keep photographs, laboratory reports and working documents with their work records. A complete file package includes this plan and every original attachment.</p><div class="iw-actions">'+button('export','Export plan + files ZIP')+button('open','Open plan + files ZIP')+button('check','Check file availability')+(w.native?button('native-export','Native plan + files ZIP')+button('native-save','Save plan + files to native'):'')+'</div>'+w.table(['Original file','Linked records','Stored in this browser',''],rows.map(link=>[
      '<b>'+esc(link.label||link.original_filename)+'</b><small>'+esc(link.original_filename||link.id)+' · '+esc(size(link.size_bytes))+'</small>',
      this.references(link.id).map(esc).join('<br>')||'Plan source register',
      esc(this.available.get(link.id)===true?'Available':this.available.get(link.id)===false?'Original file needed':'Unchecked'),
      button('download','Download original','data-id="'+esc(link.id)+'"')+button('preview','Preview image','data-id="'+esc(link.id)+'"')
    ]),'No original files attached.')+'<p class="iw-muted">JSON retains file metadata and record links. The ZIP carries the original file bytes as well. Browser storage may be cleared; export the complete package after fieldwork.</p><input hidden type="file" accept=".zip,application/zip" data-iw-evidence-bundle>'+(w.native?this.nativeDownloads():'')+'</section>';
  }
  nativeDownloads(){
    const rows=(this.w.downloads||[]).filter(row=>typeof row.url==='string'&&/^\/api\/file\/[A-Za-z0-9_-]+$/.test(row.url));
    return rows.length?'<h4>Saved native downloads</h4>'+this.w.table(['File','Size',''],rows.map(row=>[esc(row.label||row.filename),esc(size(row.bytes)),'<a href="'+esc(row.url)+'" download="'+esc(row.filename||'download')+'">Download</a>'])):'';
  }
  references(id){
    const result=[];for(const collection of ['tasks','visits','activities','observations','sites','monitoring_plans','candidates'])for(const row of this.w.plan[collection]||[])if(implementationSourceRefs(row).includes(id))result.push(collection.replaceAll('_',' ')+' · '+(row.label||row.title||row.sample_id||row.id));
    for(const row of this.w.plan.field12_lab_imports||[])if(implementationSourceRefs(row).includes(id))result.push('Original laboratory import · '+(row.operation_id||row.id||'retained revision'));
    return result;
  }
  openCapture(collection='',id=''){
    const w=this.w,choices=[['','Plan source register']];
    for(const key of ['tasks','visits','activities'])for(const row of w.plan[key])choices.push([key+':'+row.id,key.replace(/s$/,'')+' · '+title(key,row)]);
    const selected=collection&&id?collection+':'+id:'';
    this.revokePreview();w.dialog('<form data-iw-evidence-form><h3>Add original files</h3><div class="iw-form-grid"><label class="iw-field"><span>Files</span><input type="file" name="evidence_files" multiple required><small>Choose original photographs, laboratory reports or documents. Files retain their original bytes.</small></label><label class="iw-field"><span>Attach to</span><select name="evidence_target">'+choices.map(([value,label])=>'<option value="'+esc(value)+'" '+(value===selected?'selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label><label class="iw-field"><span>Label (optional)</span><input name="evidence_label"><small>For several files, the original filename is included in each label.</small></label></div><div class="iw-actions"><button type="submit">Attach files to draft</button><button type="button" data-impl="close-dialog">Cancel</button></div><p class="iw-muted">Save the draft after attaching files. Use the complete ZIP for transfer to another browser or workstation.</p></form>');
  }
  async capture(form){
    const files=Array.from(form.elements.evidence_files.files||[]);if(!files.length)throw Error('Choose at least one original file.');
    const stamp=this.stamp(),next=clone(stamp.plan),vault=await this.vault(),label=form.elements.evidence_label.value.trim(),target=form.elements.evidence_target.value;
    let record=null;if(target){const at=target.indexOf(':'),collection=target.slice(0,at),id=target.slice(at+1);if(!['tasks','visits','activities'].includes(collection))throw Error('Choose a task, visit or activity.');record=next[collection].find(row=>row.id===id);if(!record)throw Error('The selected record is no longer in this plan.');}
    for(const file of files){
      const captured=await captureEvidence(next,file,{vault,label:label?(files.length>1?label+' · '+file.name:label):undefined});
      const old=byId(next,captured.source_link.id);if(!old)next.source_links.push(captured.source_link);
      if(record){if(!record.evidence_refs)record.evidence_refs=[];if(!record.evidence_refs.includes(captured.source_link.id))record.evidence_refs.push(captured.source_link.id);}
      this.available.set(captured.source_link.id,true);
    }
    this.requireUnchanged(stamp);if(!form.isConnected||!form.closest('dialog')?.open)throw Error('Original bytes are retained. Reopen Add original files to attach them to this draft.');this.w.root.querySelector('dialog[open]')?.close();this.w.commitLocal(next,files.length+' original file'+(files.length===1?'':'s')+' attached to the draft. Save or export the complete file package.');
  }
  async check(){
    const stamp=this.stamp(),rows=await inspectEvidence(stamp.plan,{vault:await this.vault()});if(!this.unchanged(stamp))return;
    for(const row of rows)this.available.set(row.source_link.id,row.available);
    this.w.message=rows.every(row=>row.available)?'All attached original files are available in this browser.':rows.filter(row=>!row.available).length+' original files are needed. Open the complete ZIP or add the matching original files.';
    this.w.render();
  }
  async original(id,preview=false){
    const link=byId(this.w.plan,id);if(!link||link.kind!=='local_file')throw Error('Choose a retained original file.');
    const stamp=this.stamp(),vault=await this.vault();await this.ensureAvailable([link],stamp);
    if(preview){
      const result=await createEvidencePreview(link,{vault});if(!this.unchanged(stamp)||this.w.root.querySelector('dialog[open]')){result?.revoke();throw Error('Close the current record before opening an image preview.');}if(!result){this.w.status('This file is available as an original download. Image previews support PNG, JPEG, GIF and WebP.');return;}
      this.revokePreview();this.preview=result;
      this.w.dialog('<h3>'+esc(link.label||link.original_filename)+'</h3><img class="iw-evidence-preview" src="'+esc(result.url)+'" alt="'+esc(link.label||link.original_filename)+'"><p>'+esc(link.original_filename)+' · '+esc(size(link.size_bytes))+'</p><div class="iw-actions">'+button('download','Download original','data-id="'+esc(id)+'"')+'<button type="button" data-impl="close-dialog">Close</button></div>');
    }else{const file=await getEvidenceFile(link,{vault});this.requireUnchanged(stamp);downloadEvidenceBlob(file.blob,file.filename);}
  }
  async exportBrowser(){
    const stamp=this.stamp();assertValid(stamp.plan);await this.ensureAvailable(fileRows(stamp.plan),stamp);
    const bundle=await exportEvidenceBundle(stamp.plan,{vault:await this.vault()});this.requireUnchanged(stamp);downloadEvidenceBlob(bundle.blob,bundle.filename);this.w.status('Complete plan and original files exported in '+bundle.filename+'.');
  }
  async openBundle(file){
    if(this.w.pending)throw Error('Finish the retained native operation before opening a file package.');
    const stamp=this.stamp(),result=await importEvidenceBundle(file,{vault:await this.vault()});this.requireUnchanged(stamp);this.adopt(result.plan);
    for(const link of fileRows(result.plan))this.available.set(link.id,true);
    this.w.message='Complete plan and '+result.manifest.files.length+' original files opened. The originating native revision is retained.';this.w.tab='handover';this.w.render();
  }
  adopt(document){
    assertValid(document);const w=this.w,existing=w.offlineCopies[document.id];
    if(existing?.dirty&&!equal(existing.document,document))w.preserveDraft(existing.document,'before-file-package-import');
    w.closeSampleQC?.();w.cache();w.generation++;w.downloads=[];w.reports=[];w.plan=clone(document);w.nativePlan=null;w.importedFile=true;w.dirty=true;w.pending=null;w.history=[];
    w.briefingIntake=null;w.labIntake=null;w.labDispatch=null;w.observationFlow=null;w.observationReceipts=clone(existing?.observationReceipts||[]);w.resultView={};w.selectionDraft=null;w.selectionPreviewTurn++;w.cache();
  }
  async act(b){
    const action=b.dataset.iwEvidence;
    if(action==='add'){this.openCapture(b.dataset.collection,b.dataset.id);return;}
    if(action==='open'){this.w.root.querySelector('[data-iw-evidence-bundle]').click();return;}
    if(action==='check'){await this.check();return;}
    if(action==='download'||action==='preview'){await this.original(b.dataset.id,action==='preview');return;}
    if(action==='export'){await this.exportBrowser();return;}
    if(action==='native-save'){await this.saveNative();return;}
    if(action==='native-export'){if(this.w.dirty||!this.w.nativePlan)throw Error('Save this native plan and its field changes before exporting its retained file package.');await this.w.queue('implementation.evidence.export',{id:this.w.plan.id,revision:this.w.plan.revision});return;}
  }
  async ensureAvailable(links,stamp){const rows=await inspectEvidence(stamp.plan,{vault:await this.vault()});const wanted=new Set(links.map(link=>link.id)),missing=rows.filter(row=>wanted.has(row.source_link.id)&&!row.available);if(missing.length)await this.hydrateNative(missing.map(row=>row.source_link),stamp);}
  async hydrateNative(links,stamp){
    const w=this.w;if(!w.native)throw Error('Original files needed: '+links.map(link=>link.original_filename||link.id).join(', ')+'. Open their complete ZIP or attach the matching originals.');
    let downloads=w.downloads||[];
    if(links.some(link=>!downloads.some(row=>row.sha256===link.sha256&&row.bytes===link.size_bytes))){
      const detail=await w.read('/api/implementation/detail',{id:stamp.plan.id,...(stamp.plan.revision>0?{revision:stamp.plan.revision}:{})});this.requireUnchanged(stamp);downloads=detail._downloads||[];w.downloads=downloads;
    }
    const vault=await this.vault();
    for(const link of links){
      const ticket=downloads.find(row=>row.sha256===link.sha256&&row.bytes===link.size_bytes);
      if(!ticket||typeof ticket.url!=='string'||!/^\/api\/file\/[A-Za-z0-9_-]+$/.test(ticket.url))throw Error('Original file needed: '+(link.original_filename||link.id)+'. Open its complete ZIP or attach the matching original.');
      let response=await fetch(ticket.url,{credentials:'same-origin'});if(response.status===401){await w.host.api('/api/session',{method:'POST',body:{}});this.requireUnchanged(stamp);response=await fetch(ticket.url,{credentials:'same-origin'});}if(!response.ok)throw Error('The native original file could not be downloaded ('+response.status+'). Reopen the authenticated workspace and try again.');
      const bytes=await response.arrayBuffer();this.requireUnchanged(stamp);
      if(bytes.byteLength!==link.size_bytes)throw Error('The downloaded file size differs from its original source record.');
      const captured=await captureEvidence(stamp.plan,new File([bytes],link.original_filename,{type:link.media_type||'application/octet-stream'}),{vault});
      if(captured.source_link.sha256!==link.sha256||captured.source_link.size_bytes!==link.size_bytes)throw Error('The downloaded file differs from its original source record.');
      this.available.set(link.id,true);
    }
  }
  async saveNative(){
    const w=this.w;if(!w.native)throw Error('Open the native workspace to save a native file package.');
    if(w.pending)throw Error('Finish the retained native operation before saving the file package.');
    const stamp=this.stamp();assertValid(stamp.plan);await this.ensureAvailable(fileRows(stamp.plan),stamp);
    const bundle=await exportEvidenceBundle(stamp.plan,{vault:await this.vault()});this.requireUnchanged(stamp);
    const file=new File([bundle.blob],bundle.filename,{type:'application/zip'});
    const upload=await w.host.api('/api/upload',{method:'POST',raw:file,filename:file.name});this.requireUnchanged(stamp);
    if(!upload||typeof upload.id!=='string')throw Error('The native upload did not return a retained file ID.');
    await w.queue('implementation.evidence.import',{id:stamp.plan.id,upload_id:upload.id});
  }
  async saveIfNeeded(){
    const w=this.w;if(!w.native||!fileRows(w.plan).length)return false;
    const saved=new Map(fileRows(w.nativePlan||{}).map(link=>[link.id,link]));
    if(!w.importedFile&&fileRows(w.plan).every(link=>{const old=saved.get(link.id);return old&&old.reference===link.reference&&old.sha256===link.sha256&&old.size_bytes===link.size_bytes;}))return false;
    await this.run(()=>this.saveNative());return true;
  }
  detach(){this.closed=true;this.revokePreview();this.w.root.removeEventListener('click',this.click);this.w.root.removeEventListener('change',this.change);this.w.root.removeEventListener('submit',this.submit);this.w.root.removeEventListener('close',this.close,true);this.vaultPromise?.then(vault=>vault.close()).catch(()=>{});}
}

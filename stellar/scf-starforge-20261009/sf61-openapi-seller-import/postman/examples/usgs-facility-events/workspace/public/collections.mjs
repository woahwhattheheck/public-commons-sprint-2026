// MIT. Saved buyer collections through the original Facility customer service.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>String(value??'').slice(0,12);
const count=value=>Number(value??0).toLocaleString('en-GB');
const field=(name,title,value='',attributes='')=>'<label>'+escape(title)+'<input name="'+name+'" value="'+escape(value)+'" '+attributes+'></label>';
const area=(name,title,value='',maximum=4000)=>'<label>'+escape(title)+'<textarea name="'+name+'" maxlength="'+maximum+'" rows="3">'+escape(value)+'</textarea></label>';
const hashCache=new WeakMap();
async function fileIdentity(file,progress){
  if(hashCache.has(file))return hashCache.get(file);
  const promise=new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./collection-hash-worker.mjs',import.meta.url),{type:'module'});
    const finish=(fn,value)=>{worker.terminate();fn(value);};
    worker.onmessage=event=>{
      const value=event.data;
      if(value.type==='progress')progress(value);
      else if(value.type==='complete')finish(resolve,value);
      else if(value.type==='error')finish(reject,new Error(value.error));
    };
    worker.onerror=event=>finish(reject,new Error(event.message||'The original archive could not be read.'));
    worker.postMessage({file});
  });
  hashCache.set(file,promise);
  try{return await promise;}catch(error){hashCache.delete(file);throw error;}
}
export function createCollectionPanel(context){
  const active=new Map(),views=new Map();
  const key=id=>context.projectId()+':'+id;
  function view(id){
    const name=key(id);
    if(!views.has(name))views.set(name,{id,query:'',offset:0,result:null,selected:new Set()});
    return views.get(name);
  }
  async function load(id){
    const selected=view(id);
    selected.result=await context.api(context.route('collections/'+id)+'?'+new URLSearchParams({
      query:selected.query,offset:String(selected.offset),limit:'50'}));
    return selected;
  }
  function links(entry){
    return '<div class="actions">'+context.fileLink('collections/'+entry.id+'/archive','Download complete original archive')+
      context.fileLink('collections/'+entry.id+'/manifest','Download exact original manifest')+'</div>';
  }
  function summary(entry){
    return '<h3>'+escape(entry.collection.name)+' · original revision '+entry.collection.revision+'</h3>'+
      '<p>'+count(entry.memberCount)+' original members · '+count(entry.archiveBytes)+' archive bytes · received by '+
      escape(entry.operator)+' on '+escape(entry.receivedAt)+'</p><pre>'+escape(entry.collection.note)+'</pre>'+
      (entry.note?'<p>Receiving note: '+escape(entry.note)+'</p>':'')+
      '<details><summary>Complete collection identity</summary><dl><dt>Archive SHA-256</dt><dd class="mono">'+escape(entry.archiveSha256)+
      '</dd><dt>Exact manifest SHA-256</dt><dd class="mono">'+escape(entry.manifestSha256)+
      '</dd><dt>Original collection</dt><dd>'+escape(entry.collection.id)+' / r'+entry.collection.revision+
      '</dd><dt>Receiving edition</dt><dd class="mono">'+escape(entry.id)+'</dd></dl></details>';
  }
  function memberSelection(id){
    const selected=view(id),result=selected.result;
    if(!result)return '<p>Open a retained collection to review its original members.</p>';
    const form='buyer-collection-sources-'+id,filter='buyer-collection-filter-'+id;
    return '<div class="collection-members"><h3>Choose original event responses</h3>'+
      '<form id="'+filter+'" data-collection="'+id+'">'+field('query','Find a filename, intent or original annotation',selected.query,'type="search" maxlength="2000"')+
      '<div class="actions"><button type="submit">Search collection</button></div></form>'+
      '<form id="'+form+'" data-collection="'+id+'"><p class="hint">'+selected.selected.size+
      ' original responses selected across all pages (maximum 16). The whole collection stays in this workspace.</p>'+
      '<div class="table-wrap"><table><thead><tr><th>Select</th><th>Original file / response</th><th>Buyer / delivery</th><th>Original review</th></tr></thead><tbody>'+
      result.items.map(({member,eligible,selectionNote})=>'<tr><td><input type="checkbox" data-buyer-member="'+member.id+'" data-collection="'+id+
        '" aria-label="Select '+escape(member.name)+'"'+(selected.selected.has(member.id)?' checked':'')+
        (eligible?'':' data-unavailable="true"')+'></td><td>'+escape(member.name)+'<small>'+
        count(member.bytes)+' bytes · '+escape(member.contentType)+'</small><p>'+escape(selectionNote)+'</p>'+
        '<details><summary>Complete original member</summary><pre>'+escape(JSON.stringify(member,null,2))+'</pre></details></td>'+
        '<td>'+escape(member.buyerStatus??'No buyer status in the supplied collection')+'<small>HTTP '+escape(member.httpStatus??'unspecified')+
        ' · '+escape(member.deliveryStatus)+'</small><p class="mono">'+escape(member.intentId)+'</p><small>'+
        escape(member.paymentTerms?.network)+' · maximum atomic amount '+escape(member.paymentTerms?.maxAtomic)+'</small></td>'+
        '<td><pre>'+escape(member.annotation?.note)+'</pre><p>'+escape((member.annotation?.tags??[]).join(', '))+
        '</p><small>Original annotation revision '+escape(member.annotation?.revision)+'</small></td></tr>').join('')+
      '</tbody></table></div><div class="pagination"><span>'+(result.total?result.offset+1:0)+'–'+
      Math.min(result.offset+result.limit,result.total)+' of '+result.total+'</span>'+
      '<button type="button" data-action="buyer-collection-previous" data-id="'+id+'"'+(result.offset===0?' data-unavailable="true"':'')+'>Previous</button>'+
      '<button type="button" data-action="buyer-collection-next" data-id="'+id+'"'+(result.offset+result.limit>=result.total?' data-unavailable="true"':'')+'>Next</button></div>'+
      '<div class="grid">'+field('operator','Receiving operator',context.state().project.operator,'maxlength="200" required')+
      area('note','Source-selection note')+'</div><div class="actions"><button type="submit" class="primary" data-collection-submit="'+id+
      '"'+(!selected.selected.size?' data-unavailable="true"':'')+'>Retain selected responses for reporting</button>'+
      '<button type="button" data-page="editions">Open report preparation</button></div></form></div>';
  }
  function page(){
    const entries=context.state().collections??[],id=active.get(context.projectId());
    return '<section class="panel buyer-collections"><h2>Receive a saved buyer collection</h2>'+
      '<p>Choose the complete collection archive exported by the existing buyer resource library. Every original member, its manifest and its buyer fields remain available after receiving.</p>'+
      '<form id="buyer-collection-upload"><label>Original collection archive<input name="file" type="file" accept=".tar,application/x-tar" required></label>'+
      field('operator','Receiving operator',context.state().project.operator,'maxlength="200" required')+
      '<div class="actions"><button type="submit">Receive complete collection archive</button></div>'+
      '<p class="hint">The file is hashed in small slices and streamed to this workspace. The original collection reader checks the complete archive and all member bytes.</p></form>'+
      '<details><summary>Read an archive already on the operating computer</summary><form id="buyer-collection-import">'+
      field('archive','Absolute original archive path','','maxlength="8000" required placeholder="/private/downloads/customer-collection.tar"')+
      '<p class="hint">This path is on the computer running Facility operations.</p><div class="grid">'+
      field('expectedSha256','Expected archive SHA-256, when supplied','','maxlength="64" pattern="[a-f0-9]{64}"')+
      field('operator','Receiving operator',context.state().project.operator,'maxlength="200" required')+'</div>'+
      area('note','Receiving note','',8000)+'<div class="actions"><button type="submit">Receive original archive from this computer</button></div></form></details>'+
      '<details><summary>Export through the existing buyer</summary><pre>starforge inbox library collections export --state /private/buyer-library --id COLLECTION_ID --revision ORIGINAL_REVISION --out /private/customer-collection.tar</pre></details>'+
      '<h2>Retained complete collections</h2>'+(entries.length?entries.slice().reverse().map(entry=>'<article>'+
        summary(entry)+links(entry)+'<div class="actions"><button data-action="buyer-collection-open" data-id="'+entry.id+
        '">Review and select original responses</button></div></article>').join(''):'<p>The received archive and its complete member list will appear here.</p>')+
      (id&&entries.some(entry=>entry.id===id)?memberSelection(id):'')+'</section>';
  }
  function delivery(){
    const entries=context.state().collections??[];
    return entries.length?'<section class="panel buyer-collections"><h2>Complete original buyer collections</h2>'+
      '<p>The full workspace transfer carries every archive listed here, including members that were not selected for an event report. Receiving validates those complete archives through the original buyer reader.</p>'+
      entries.map(entry=>'<article>'+summary(entry)+links(entry)+'</article>').join('')+'</section>':'';
  }
  async function afterImport(form,result){
    context.clearDraft(form);form.reset();await context.refresh();
    active.set(context.projectId(),result.id);await load(result.id);context.render();
    context.notice('Complete buyer collection received: '+result.members+' original members and '+count(result.archiveBytes)+' archive bytes. Select its event responses below.');
  }
  async function submit(form,input,operationId){
    if(form.id==='buyer-collection-import'){
      const result=await context.api(context.route('collections'),{method:'POST',
        data:{...input,revision:context.state().project.revision,operationId}});
      await afterImport(form,result);return true;
    }
    if(form.id==='buyer-collection-upload'){
      const file=form.elements.file.files[0];if(!file)throw new Error('Choose the complete original collection archive.');
      if(file.size<1024||file.size>16*1024*1024*1024)throw new Error('Choose a complete collection archive of at most 16 GiB.');
      const identity=await fileIdentity(file,value=>context.notice('Reading the original archive: '+count(value.bytes)+' of '+count(value.total)+' bytes.'));
      context.notice('Receiving and checking the complete original collection…');
      const query=new URLSearchParams({name:file.name,operator:input.operator,sha256:identity.sha256,bytes:String(identity.bytes)});
      const result=await context.api(context.route('collections/upload')+'?'+query,{method:'POST',body:file,
        headers:{'Content-Type':'application/x-tar','X-Project-Revision':String(context.state().project.revision),'X-Operation-Id':operationId}});
      context.clearFileDraft(form,'file');await afterImport(form,result);return true;
    }
    if(form.id.startsWith('buyer-collection-filter-')){
      const selected=view(form.dataset.collection);selected.query=input.query;selected.offset=0;context.clearOperation(form);
      await load(selected.id);context.render();context.notice(selected.result.total+' original collection members match this selection.');return true;
    }
    if(form.id.startsWith('buyer-collection-sources-')){
      const selected=view(form.dataset.collection);
      if(!selected.selected.size||selected.selected.size>16)throw new Error('Select 1–16 original response members.');
      const result=await context.api(context.route('collections/'+selected.id+'/sources'),{method:'POST',data:{
        memberIds:[...selected.selected],operator:input.operator,note:input.note,
        revision:context.state().project.revision,operationId}});
      context.clearDraft(form);selected.selected.clear();context.adoptSources(result.sourceIds);
      await context.refresh();context.render();
      context.notice(result.sourceIds.length+' complete original buyer responses retained and selected for the next report.');return true;
    }
    return false;
  }
  async function click(button){
    const action=button.dataset.action,id=button.dataset.id;
    if(!['buyer-collection-open','buyer-collection-previous','buyer-collection-next'].includes(action))return false;
    const selected=view(id);active.set(context.projectId(),id);
    if(action==='buyer-collection-previous')selected.offset=Math.max(0,selected.offset-50);
    if(action==='buyer-collection-next')selected.offset+=50;
    await load(id);context.render();context.notice('Original collection '+selected.result.received.collection.name+' is open.');return true;
  }
  function change(input){
    const id=input.dataset.buyerMember;if(!id)return false;
    const selected=view(input.dataset.collection);
    if(input.checked&&selected.selected.size>=16&&!selected.selected.has(id)){
      input.checked=false;context.notice('One report selection accepts at most 16 original responses.',true);return true;
    }
    if(input.checked)selected.selected.add(id);else selected.selected.delete(id);
    const form=input.closest('form'),hint=form.querySelector('.hint'),button=form.querySelector('[data-collection-submit]');
    hint.textContent=selected.selected.size+' original responses selected across all pages (maximum 16). The whole collection stays in this workspace.';
    button.dataset.unavailable=String(!selected.selected.size);context.clearOperation(form);context.controls();return true;
  }
  return {page,delivery,submit,click,change};
}

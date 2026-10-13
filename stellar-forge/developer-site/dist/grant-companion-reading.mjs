// MIT. Retained chapter reading, source comparison and complete workspace receiving.
export async function mountCompanionReadingWorkspace(root,{api,reader,initialSource,initialWorkspace=null,persist=null,onOffline=null,origin='',honorInitialHash=true}={}) {
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let workspace=initialWorkspace?await api.reopen(JSON.stringify(initialWorkspace)):await api.create(initialSource,{origin});
  let serial=0,busy=false,destroyed=false,readingMount=null,comparison=null,noteChapter=workspace.reading.chapter_id,noteId='',status='';
  let returnReview=null,returnIncoming=null,returnSerial=-1,returnChoices={},returnActor='',returnFilename='';
  const returnsEnabled=typeof api.reviewReturn==='function'&&typeof api.applyReturn==='function'&&typeof api.returnCopies==='function'&&typeof api.openReturnCopy==='function';
  if(initialSource){const received=await api.receive(workspace,initialSource,{origin});workspace=received.workspace;if(!received.already_received)status='The current published edition is retained. Compare it with your selected edition before switching.';}
  const edition=()=>api.getEdition(workspace),chapters=()=>reader.parseCompanionMarkdown(edition().markdown).chapters;
  if(honorInitialHash&&typeof location!=='undefined'&&location.hash){let anchor='';try{anchor=decodeURIComponent(location.hash.slice(1));}catch{}const target=chapters().find(c=>c.id===anchor||c.headings.some(h=>h.id===anchor));if(target){workspace=api.reading(workspace,{chapter_id:target.id,query:'',show_all:false});noteChapter=target.id;}}
  const selectedNote=()=>workspace.notes.find(n=>n.id===noteId);
  const one=s=>root.querySelector(s);
  const download=(body,name,type)=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([body],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);};
  function report(value){status=value;const node=one('[data-reading-status]');if(node)node.textContent=value;}
  function retain(next,{draw=false,message=''}={}) {
    if(destroyed)throw new Error('Reopen the current reading workspace.');
    if(next===workspace)return;
    workspace=next;serial++;
    try{persist?.(workspace);}catch(error){status='Reading work is retained in this open page. Download the complete workspace; browser storage could not save this edition.';}
    if(message)status=status.startsWith('Reading work is retained in this open page.')?message+' '+status:message;
    if(draw){try{history.replaceState(null,'','#'+workspace.reading.chapter_id);}catch{}render();}else{if(status)report(status);updateReturnApply();}
  }
  async function operation(fn){if(busy||destroyed)return;busy=true;toggleBusy();try{await fn();}catch(error){report(error.message||String(error));}finally{busy=false;toggleBusy();}}
  function toggleBusy(){root.setAttribute('aria-busy',String(busy));root.inert=busy;root.querySelectorAll('[data-reading-operation]').forEach(b=>b.disabled=busy);updateReturnApply();}
  function options(items,current){return items.map(([value,label])=>'<option value="'+esc(value)+'"'+(value===current?' selected':'')+'>'+esc(label)+'</option>').join('');}
  function editionLabel(e){return e.captured_at+' · '+e.sha256.slice(0,12)+' · '+Number(e.bytes).toLocaleString()+' bytes';}
  function formData(){return{edition_id:workspace.selected_edition,chapter_id:noteChapter,note_id:noteId,author:one('[name=note-author]').value,title:one('[name=note-title]').value,body:one('[name=note-body]').value,bookmark:one('[name=note-bookmark]').checked,status:one('[name=note-status]').value};}
  function loadNoteForm(){
    const old=selectedNote()?.versions.at(-1),draft=(workspace.drafts||[]).find(d=>d.edition_id===workspace.selected_edition&&d.chapter_id===noteChapter&&d.note_id===noteId);
    const value=draft||old||{author:'',title:'',body:'',bookmark:false,status:'open'};
    const notes=workspace.notes.filter(n=>n.edition_id===workspace.selected_edition&&n.chapter_id===noteChapter);
    one('[name=note-chapter]').innerHTML=options(chapters().map(c=>[c.id,c.title]),noteChapter);
    one('[name=note-existing]').innerHTML='<option value="">New reading note</option>'+options(notes.map(n=>[n.id,n.versions.at(-1).title||'Note by '+n.versions.at(-1).author]),noteId);
    for(const key of ['author','title','body','status'])one('[name=note-'+key+']').value=value[key];
    one('[name=note-bookmark]').checked=value.bookmark;
    one('[data-note-binding]').textContent='Bound to '+api.getChapter(edition(),noteChapter).title+' · '+edition().sha256.slice(0,12)+(draft?' · retained working draft':'');
  }
  function renderNotes(){
    const rows=workspace.notes.map(n=>{const latest=n.versions.at(-1),same=n.edition_id===workspace.selected_edition;return'<article class="reading-note"><h4>'+esc(latest.title||n.chapter_title)+'</h4><p>'+esc(n.chapter_title)+' · '+esc(latest.author)+' · '+esc(latest.status)+(latest.bookmark?' · bookmarked':'')+' · '+n.versions.length+' versions</p><p>'+esc(latest.body).replace(/\n/g,'<br>')+'</p><p class="reading-small">Original edition '+esc(n.edition_id.replace('edition-','').slice(0,12))+(n.parent_id?' · carried from '+esc(n.parent_id):'')+'</p><div class="reading-actions"><button data-note-open="'+esc(n.id)+'">Open original chapter</button>'+(same?'<button data-note-edit="'+esc(n.id)+'">Edit this note</button>':'<button data-note-carry="'+esc(n.id)+'">Carry into selected chapter</button>')+'</div><details><summary>Complete note history</summary>'+n.versions.map(v=>'<section><h5>Version '+v.version+' · '+esc(v.at)+'</h5><p>'+esc(v.author)+' · '+esc(v.status)+'</p><p>'+esc(v.title)+'</p><pre>'+esc(v.body)+'</pre></section>').join('')+'</details></article>';}).join('');
    one('[data-reading-notes]').innerHTML=rows||'<p>Saved notes and bookmarks appear here with their original source edition.</p>';
    one('[data-draft-count]').textContent=(workspace.drafts||[]).length+' retained working drafts';
  }
  function renderComparison(){
    const box=one('[data-reading-comparison]');if(!comparison){box.innerHTML='<p>Compare any two retained editions to inspect their complete changed chapters and source records.</p>';return;}
    const changes=comparison.chapters.filter(c=>c.kind!=='unchanged'||c.moved),sources=comparison.sources.filter(s=>s.kind!=='unchanged'),s=comparison.summary;
    box.innerHTML='<h3>Edition comparison</h3><p>'+s.added+' added chapters · '+s.changed+' changed · '+s.removed+' removed · '+s.moved+' moved · '+s.source_changes+' source changes</p>'+
      '<p class="reading-small">'+esc(comparison.from)+' → '+esc(comparison.to)+'</p>'+
      changes.map(c=>'<details class="reading-change"><summary>'+esc(c.title)+' · '+esc(c.kind)+(c.moved?' · moved':'')+'</summary><div class="reading-compare-grid"><section><h4>Earlier complete chapter</h4>'+(c.before?c.before.html:'<p>This chapter was absent.</p>')+'</section><section><h4>Later complete chapter</h4>'+(c.after?c.after.html:'<p>This chapter is absent.</p>')+'</section></div></details>').join('')+
      (!changes.length?'<p>The complete chapter text and order are unchanged.</p>':'')+
      '<h4>Original source records</h4>'+sources.map(s=>'<details><summary>'+esc(s.id)+' · '+esc(s.kind)+'</summary><div class="reading-compare-grid"><pre>'+esc(JSON.stringify(s.before,null,2))+'</pre><pre>'+esc(JSON.stringify(s.after,null,2))+'</pre></div></details>').join('')+
      (!sources.length?'<p>The complete source catalogue entries are unchanged.</p>':'');
  }

  function returnConflicts(){return returnReview?[...returnReview.notes,...returnReview.drafts].filter(row=>row.conflict_key):[];}
  function updateReturnApply(){
    const button=one('[data-return-apply]');if(!button)return;
    const stale=returnReview&&returnSerial!==serial;
    const missing=returnConflicts().filter(row=>!returnChoices[row.conflict_key]).length;
    button.disabled=busy||!returnReview||stale||!returnActor.trim()||missing>0;
    const message=one('[data-return-readiness]');
    if(message)message.textContent=!returnReview?'Choose a complete returned reading workspace.':stale?
      'Your reading workspace changed after this review. Review the retained incoming copy against your current work before applying.':
      missing?missing+' conflict decisions still need an explicit choice.':
      !returnActor.trim()?'Name the operator responsible for these reviewed decisions.':
      'All required choices are recorded. Apply keeps both complete original branches.';
  }
  function returnedNote(note){
    if(!note)return '<p>No note on this branch.</p>';
    return '<p><strong>'+esc(note.chapter_title||note.chapter_id)+'</strong></p><p class="reading-small">Source edition '+esc(note.edition_id)+' · original note '+esc(note.id)+(note.parent_id?' · carried from '+esc(note.parent_id):'')+'</p>'+
      note.versions.map(v=>'<section><h5>Version '+esc(v.version)+' · '+esc(v.at)+'</h5><p>'+esc(v.author)+' · '+esc(v.status)+(v.bookmark?' · bookmarked':'')+'</p><h5>'+esc(v.title||'Untitled reading note')+'</h5><pre>'+esc(v.body)+'</pre></section>').join('');
  }
  function returnedDraft(draft){
    if(!draft)return '<p>No unfinished draft on this branch.</p>';
    return '<p class="reading-small">Source edition '+esc(draft.edition_id)+' · chapter '+esc(draft.chapter_id)+' · '+(draft.note_id?'note '+esc(draft.note_id):'new note')+'</p>'+
      '<p>'+esc(draft.author||'Author not entered')+' · '+esc(draft.status)+(draft.bookmark?' · bookmarked':'')+'</p><h5>'+esc(draft.title||'Untitled working draft')+'</h5><pre>'+esc(draft.body)+'</pre>';
  }
  function conflictChoice(row,isNote){
    if(!row.conflict_key)return '';
    const optionsList=[['','Choose the working result'],['local','Continue with your current branch'],['incoming','Continue with the returned branch']];
    if(isNote)optionsList.push(['both','Keep both as separate editable notes']);
    return '<label>Reviewed working choice<select data-return-choice="'+esc(row.conflict_key)+'">'+options(optionsList,returnChoices[row.conflict_key]||'')+'</select></label><p class="reading-small">Both complete original branches remain in the return archive, whichever working choice you select.</p>'+(isNote?'<p class="reading-small">Keeping both creates a separate branch for this note. Unchanged carried child notes stay with the current parent; incoming added or changed children follow the returned parent. The complete incoming family remains in its downloadable original branch.</p>':'');
  }
  function renderReturn(){
    if(!returnsEnabled)return;
    const box=one('[data-reading-return-review]');if(!box)return;
    const labels={'added':'New on the returned branch','same':'Same complete history','local-ahead':'Your branch has later versions','incoming-ahead':'Returned branch has later versions','diverged':'Branches have different later versions','local-only':'Only in your current working copy','conflict':'Different unfinished drafts'};
    if(!returnReview)box.innerHTML='<p>Choose a complete collaborator workspace to inspect its retained source editions, all note versions and unfinished drafts. Your current reading work stays open until you apply reviewed decisions.</p>';
    else{
      const r=returnReview;
      const changedNotes=r.notes.filter(n=>n.kind!=='same').length;
      const conflicts=returnConflicts().length;
      box.innerHTML='<h3>Review returned reading work</h3><p>'+esc(returnFilename||'Selected complete workspace')+' · '+r.editions.filter(e=>e.kind==='added').length+' additional source editions · '+changedNotes+' notes with different history · '+conflicts+' conflict decisions</p>'+
        '<p class="reading-small">Current copy '+esc(r.local_sha256.slice(0,12))+' · returned copy '+esc(r.incoming_sha256.slice(0,12))+'</p>'+
        '<details><summary>Complete retained source editions</summary>'+r.editions.map(e=>{const value=e.incoming||e.local;return '<section><h4>'+esc(editionLabel(value))+'</h4><p>'+esc(e.kind==='added'?'Additional complete source pair':'Complete source pair already retained')+'</p><p class="reading-small">'+esc(e.id)+'</p></section>';}).join('')+'</details>'+
        '<h4>Saved notes and their complete histories</h4>'+
        (r.notes.length?r.notes.map(n=>'<details class="reading-change"'+(n.conflict_key?' open':'')+'><summary>'+esc((n.local||n.incoming).chapter_title||'Reading note')+' · '+esc(labels[n.kind]||n.kind)+'</summary><p>'+n.common_versions+' shared original versions</p><div class="reading-compare-grid"><section><h4>Your current note</h4>'+returnedNote(n.local)+'</section><section><h4>Returned note</h4>'+returnedNote(n.incoming)+'</section></div>'+conflictChoice(n,true)+'</details>').join(''):'<p>Neither branch contains saved notes.</p>')+
        '<h4>Unfinished working drafts</h4>'+
        (r.drafts.length?r.drafts.map(d=>'<details class="reading-change"'+(d.conflict_key?' open':'')+'><summary>'+esc((d.local||d.incoming).title||'Unfinished note')+' · '+esc(labels[d.kind]||d.kind)+'</summary><div class="reading-compare-grid"><section><h4>Your current draft</h4>'+returnedDraft(d.local)+'</section><section><h4>Returned draft</h4>'+returnedDraft(d.incoming)+'</section></div>'+conflictChoice(d,false)+'</details>').join(''):'<p>Neither branch contains unfinished drafts.</p>')+
        '<label>Reviewing operator<input data-return-actor maxlength="200" value="'+esc(returnActor)+'"></label><p data-return-readiness role="status"></p>'+
        '<div class="reading-actions"><button data-return-refresh data-reading-operation>Review against current reading work</button><button data-return-apply>Apply reviewed return</button><button data-return-download data-reading-operation>Download original returned copy</button><button data-return-dismiss data-reading-operation>Close this review</button></div>';
    }
    const copies=api.returnCopies(workspace),archive=one('[data-reading-return-copies]');
    archive.innerHTML='<h3>Retained return branches</h3>'+
      (copies.length?copies.map(copy=>'<section><h4>'+esc(copy.label)+'</h4><p>'+esc(copy.updated_at)+' · '+copy.editions+' source editions · '+copy.notes+' notes · '+copy.drafts+' working drafts</p><p class="reading-small">Complete branch '+esc(copy.sha256.slice(0,12))+'</p><button data-return-copy="'+esc(copy.sha256)+'" data-reading-operation>Download this complete branch</button></section>').join(''):'<p>After applying a return, its complete before, incoming and applied snapshots are available here. The complete workspace and offline HTML retain this archive.</p>');
    box.querySelectorAll('[data-return-choice]').forEach(select=>select.onchange=()=>{if(busy)return;returnChoices[select.dataset.returnChoice]=select.value;updateReturnApply();});
    const actor=one('[data-return-actor]');if(actor)actor.oninput=()=>{if(busy)return;returnActor=actor.value;updateReturnApply();};
    const refresh=one('[data-return-refresh]');if(refresh)refresh.onclick=()=>operation(async()=>{const before=serial,local=workspace,incoming=returnIncoming;const reviewed=await api.reviewReturn(local,incoming);if(before!==serial||destroyed)throw Error('Reading work changed during review. Review the same incoming copy again.');returnReview=reviewed;returnIncoming=reviewed.incoming;returnSerial=serial;returnChoices={};renderReturn();report('The original returned copy is reviewed against your current reading work. Confirm the displayed choices.');});
    const apply=one('[data-return-apply]');if(apply)apply.onclick=()=>operation(async()=>{
      if(!returnReview||returnSerial!==serial)throw Error('Review the original returned copy against the current reading work first.');
      const before=serial,review=returnReview,actor=returnActor.trim(),choices={...returnChoices};
      if(!actor||returnConflicts().some(row=>!choices[row.conflict_key]))throw Error('Name the reviewing operator and choose every conflict result.');
      const result=await api.applyReturn(workspace,review,{actor,choices});
      if(before!==serial||destroyed)throw Error('Reading work changed before the reviewed result was adopted. The original branches remain selected for review.');
      returnReview=null;returnIncoming=null;returnSerial=-1;returnChoices={};returnFilename='';
      retain(result.workspace,{draw:true,message:result.already_applied?'This exact return was already applied; later reading work is retained.':'Reviewed collaborator return applied. Both original branches and the complete review receipt remain in this workspace.'});
      if(result.already_applied){renderReturn();report('This exact return was already applied; later reading work is retained.');}
    });
    const incomingDownload=one('[data-return-download]');if(incomingDownload)incomingDownload.onclick=()=>operation(async()=>download(JSON.stringify(returnIncoming,null,2)+'\n','scf-companion-original-return.json','application/json'));
    const dismiss=one('[data-return-dismiss]');if(dismiss)dismiss.onclick=()=>operation(async()=>{returnReview=null;returnIncoming=null;returnSerial=-1;returnChoices={};returnFilename='';renderReturn();report('Return review closed. Current reading work is unchanged.');});
    archive.querySelectorAll('[data-return-copy]').forEach(button=>button.onclick=()=>operation(async()=>{const before=serial,branch=await api.openReturnCopy(workspace,button.dataset.returnCopy);if(before!==serial||destroyed)throw Error('Reading work changed during branch validation. Download the retained branch again.');download(JSON.stringify(branch,null,2)+'\n','scf-companion-return-'+button.dataset.returnCopy.slice(0,12)+'.json','application/json');report('Downloaded the complete retained branch. The current reading selection is unchanged.');}));
    updateReturnApply();
  }

  function render(){
    readingMount?.destroy();readingMount=null;
    const e=edition(),model=reader.parseCompanionMarkdown(e.markdown);if(!model.chapters.some(c=>c.id===noteChapter)){noteChapter=workspace.reading.chapter_id;noteId='';}
    root.innerHTML='<section class="reading-workspace"><h2>Retained reading workspace</h2><p>Keep source editions, reading notes and bookmarks together while reviewing the complete application companion.</p><p data-reading-status role="status" aria-live="polite">'+esc(status)+'</p>'+
      '<div class="reading-actions"><button data-reading-action="export" data-reading-operation>Download complete workspace</button><button data-reading-action="notes" data-reading-operation>Download working notes</button><button data-reading-action="offline" data-reading-operation>Save offline reading workspace</button><label>Reopen complete workspace<input data-reading-import type="file" accept=".json,application/json"></label></div>'+
      (returnsEnabled?'<details class="reading-returns"><summary>Review a collaborator\'s returned workspace</summary><p>Receive reading notes and unfinished drafts without replacing your current copy. Review every conflict before applying; both complete branches remain available afterward.</p><label>Returned complete reading workspace<input data-reading-return type="file" accept=".json,application/json"></label><div data-reading-return-review></div><div data-reading-return-copies></div></details>':'')+
      '<div class="reading-grid"><label>Selected source edition<select name="selected-edition">'+options(workspace.editions.map(e=>[e.id,editionLabel(e)]),workspace.selected_edition)+'</select></label><label>Compare from<select name="compare-from">'+options(workspace.editions.map(e=>[e.id,editionLabel(e)]),workspace.editions.length>1?workspace.editions.at(-2).id:workspace.selected_edition)+'</select></label><label>Compare to<select name="compare-to">'+options(workspace.editions.map(e=>[e.id,editionLabel(e)]),workspace.editions.at(-1).id)+'</select></label></div>'+
      '<div class="reading-actions"><button data-reading-action="select" data-reading-operation>Read selected edition</button><button data-reading-action="compare" data-reading-operation>Compare complete editions</button></div>'+
      '<details><summary>Receive another complete source edition</summary><p>Select the original companion Markdown and its matching source index. The complete pair is retained before you select it for reading.</p><div class="reading-grid"><label>Companion Markdown<input data-companion-file type="file" accept=".md,.txt,text/markdown,text/plain"></label><label>Original source index<input data-companion-index type="file" accept=".json,application/json"></label><label>Original source URL or context<input name="edition-origin" type="text"></label></div><button data-reading-action="receive" data-reading-operation>Receive source pair</button></details>'+
      '<details class="reading-notebook" open><summary>Chapter notes and bookmarks</summary><p data-note-binding></p><div class="reading-grid"><label>Original chapter<select name="note-chapter"></select></label><label>Note<select name="note-existing"></select></label><label>Named author<input name="note-author" maxlength="200"></label><label>Note title<input name="note-title" maxlength="500"></label></div><label>Reading note<textarea name="note-body" maxlength="50000" rows="5"></textarea></label><div class="reading-actions"><label class="reading-checkbox"><input name="note-bookmark" type="checkbox">Bookmark this chapter</label><label>Review state<select name="note-status"><option value="open">Open</option><option value="resolved">Resolved</option></select></label><button data-reading-action="save-note" data-reading-operation>Save note revision</button></div><p data-draft-count class="reading-small"></p><div data-reading-notes></div></details>'+
      '<details class="reading-comparisons"><summary>Full edition and source comparison</summary><div data-reading-comparison></div></details></section><div data-retained-reader></div>';
    const host=one('[data-retained-reader]');host.innerHTML=reader.companionReaderMarkup(model,e);
    readingMount=reader.activateCompanionReader(host,e,null,{reading:workspace.reading,honorHash:false,onReading:value=>{if(busy||destroyed)return;const next=api.reading(workspace,value);if(next!==workspace)retain(next);}});
    loadNoteForm();renderNotes();renderComparison();renderReturn();wire();toggleBusy();
  }
  function changeEdition(key,chapterId='') {
    comparison=null;noteId='';noteChapter=chapterId||workspace.reading.chapter_id;
    retain(api.select(workspace,key,{chapterId:noteChapter}),{draw:true,message:'Reading the retained selected edition. Earlier source and notes remain available.'});
  }
  function wire(){
    const returnFile=one('[data-reading-return]');
    if(returnFile)returnFile.onchange=event=>operation(async()=>{
      const file=event.target.files?.[0];if(!file)return;
      const before=serial,local=workspace;
      try{
        if(file.size>api.maxBytes)throw Error('Open a complete returned workspace under 64 MiB.');
        const reviewed=await api.reviewReturn(local,await file.text());
        if(before!==serial||destroyed)throw Error('Reading work changed while the returned file was being read. Select the same file again.');
        returnReview=reviewed;returnIncoming=reviewed.incoming;returnSerial=serial;returnChoices={};returnFilename=file.name;
        renderReturn();report('Returned reading work is ready for review. No note, draft or selected chapter has been replaced.');
      }finally{event.target.value='';}
    });
    one('[name=note-chapter]').onchange=event=>{if(busy||destroyed)return;noteChapter=event.target.value;noteId='';loadNoteForm();readingMount.select('#'+noteChapter,true);};
    one('[name=note-existing]').onchange=event=>{if(busy||destroyed)return;noteId=event.target.value;loadNoteForm();};
    for(const key of ['author','title','body','bookmark','status'])one('[name=note-'+key+']').addEventListener('input',()=>{if(busy||destroyed)return;retain(api.draft(workspace,formData()));one('[data-draft-count]').textContent=workspace.drafts.length+' retained working drafts';});
    one('[data-reading-notes]').onclick=event=>operation(async()=>{
      const button=event.target.closest('button');if(!button)return;
      const key=button.dataset.noteOpen||button.dataset.noteEdit||button.dataset.noteCarry,n=workspace.notes.find(n=>n.id===key);if(!n)return;
      if(button.dataset.noteOpen){changeEdition(n.edition_id,n.chapter_id);return;}
      if(button.dataset.noteEdit){noteChapter=n.chapter_id;noteId=n.id;loadNoteForm();readingMount.select('#'+noteChapter,true);return;}
      if(button.dataset.noteCarry){const author=one('[name=note-author]').value;const next=api.carry(workspace,n.id,{chapterId:noteChapter,author});retain(next,{draw:true,message:'Carried the note into the explicitly selected chapter; original note and all versions retained.'});}
    });
    one('[data-reading-import]').onchange=event=>operation(async()=>{
      const file=event.target.files?.[0];if(!file)return;const before=serial;
      try {
        if(file.size>api.maxBytes)throw new Error('Open a complete workspace under 64 MiB.');
        const incoming=await api.reopen(await file.text());
        if(before!==serial)throw new Error('Reading work changed during file import. Reopen the file again to replace this workspace deliberately.');
        noteId='';noteChapter=incoming.reading.chapter_id;comparison=null;retain(incoming,{draw:true,message:'Complete source editions, note versions and working drafts reopened.'});
      } finally {event.target.value='';}
    });
    root.querySelectorAll('[data-reading-action]').forEach(button=>button.onclick=()=>operation(async()=>{
      const action=button.dataset.readingAction;
      if(action==='export'){download(JSON.stringify(workspace,null,2)+'\n','scf-companion-reading-workspace.json','application/json');report('Downloaded every retained source edition, note version and working draft.');return;}
      if(action==='notes'){download(api.notesMarkdown(workspace),'scf-companion-reading-notes.md','text/markdown;charset=utf-8');return;}
      if(action==='offline'){if(onOffline)await onOffline(workspace);else throw new Error('The complete offline source is unavailable in this host. Download the complete workspace.');return;}
      if(action==='select'){changeEdition(one('[name=selected-edition]').value);return;}
      if(action==='compare'){const before=serial;const result=await api.compare(workspace,one('[name=compare-from]').value,one('[name=compare-to]').value);if(serial!==before)throw new Error('Reading work changed during comparison. Compare the current editions again.');comparison=result;renderComparison();one('.reading-comparisons').open=true;return;}
      if(action==='save-note'){const d=formData();retain(api.note(workspace,{noteId:d.note_id,chapterId:d.chapter_id,author:d.author,title:d.title,body:d.body,bookmark:d.bookmark,status:d.status}),{draw:true,message:'Complete note revision saved against the selected original chapter.'});return;}
      if(action==='receive'){
        const markdown=one('[data-companion-file]').files?.[0],index=one('[data-companion-index]').files?.[0],origin=one('[name=edition-origin]').value,before=serial;
        if(!markdown||!index)throw new Error('Choose both original files.');
        if(markdown.size>16*1024*1024||index.size>16*1024*1024)throw new Error('Each complete source file must be under 16 MiB.');
        const [body,indexText]=await Promise.all([markdown.text(),index.text()]);
        const result=await api.receive(workspace,{markdown:body,indexText},{origin});
        if(serial!==before)throw new Error('Reading work changed while receiving sources. Receive that same pair again.');
        retain(result.workspace,{draw:true,message:result.already_received?'This exact source pair is already retained.':'Complete source pair received. Compare the editions before choosing your reading edition.'});
        if(result.already_received)report('This exact source pair is already retained.');
      }
    }));
  }
  render();try{persist?.(workspace);}catch{report('Download the complete workspace to retain this source edition; browser storage is unavailable.');}
  return{getWorkspace:()=>JSON.parse(JSON.stringify(workspace)),destroy(){destroyed=true;readingMount?.destroy();root.replaceChildren();}};
}

// A revision counter cannot establish ancestry for mutable drafts and reading positions.
export async function resolveCompanionOfflineCopies(api,embedded,browserRaw='',retained=[]) {
  const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}':JSON.stringify(value);
  const original=await api.reopen(JSON.stringify(embedded)),copies=[],rejected=[],seen=new Set(),rejectedRaw=new Set();
  const receive=async(label,raw)=>{
    if(typeof raw!=='string')return;
    try{
      const workspace=await api.reopen(raw);
      if(workspace.id!==original.id)throw new Error('This saved copy belongs to a different reading workspace.');
      const identity=stable(workspace);if(seen.has(identity))return;
      seen.add(identity);copies.push({label,raw:JSON.stringify(workspace),workspace});
    }catch(error){if(!rejectedRaw.has(raw)){rejectedRaw.add(raw);rejected.push({label,raw,message:error.message||String(error)});}}
  };
  await receive('Downloaded workspace',JSON.stringify(original));
  if(browserRaw)await receive('Saved browser workspace',browserRaw);
  if(!Array.isArray(retained))throw new Error('Retained workspace copies must remain a complete list.');
  for(const item of retained)await receive(typeof item?.label==='string'?item.label:'Retained workspace',item?.raw);
  return{initial:copies.length===1?copies[0].workspace:null,copies,rejected};
}

export function offlineCompanionReadingWorkspace(workspace,{css,coreSource,editionSource,viewSource,returnsSource,applicationUrl='',submissionUrl='',recoveryCopies=[]}={}) {
  for(const value of [css,coreSource,editionSource,viewSource,returnsSource])if(typeof value!=='string'||!value.trim())throw new Error('Retain all complete reader sources for the offline workspace.');
  const payload={workspace,runtime:{css,coreSource,editionSource,viewSource,returnsSource,applicationUrl,submissionUrl,recoveryCopies}};
  const json=JSON.stringify(payload).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
  const clean=source=>source.replace(/^export /gm,'');
  const boot=String.raw`(async()=>{
    const payload=JSON.parse(document.getElementById('reading-source').textContent),root=document.getElementById('companion-reader');
    const api=createCompanionReturnModel({editions:createCompanionEditionModel({parseMarkdown:parseCompanionMarkdown})});
    const key='scf-companion-reading:'+payload.workspace.id,copiesKey=key+':retained-copies';
    let browserRaw='',warning='',storedCopies=[];
    try{browserRaw=localStorage.getItem(key)||'';const raw=localStorage.getItem(copiesKey);if(raw){if(raw.length>api.maxBytes)throw new Error('The retained browser copies exceed 64 MiB.');storedCopies=JSON.parse(raw);if(!Array.isArray(storedCopies))throw new Error('Retained browser copies must remain a complete list.');}}
    catch(error){warning='Browser work could not be fully reopened. '+error.message;storedCopies=[];}
    const resolved=await resolveCompanionOfflineCopies(api,payload.workspace,browserRaw,[...(payload.runtime.recoveryCopies||[]),...storedCopies]);
    let copies=resolved.copies,active=null,selected=-1,moving=false;
    const rejected=resolved.rejected;
    const panel=document.createElement('section');panel.className='reading-workspace';root.before(panel);
    const save=(body,name,type='text/html;charset=utf-8')=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([body],{type}));a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);};
    const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
    const retainCopy=(workspace,label)=>{
      const identity=stable(workspace),prior=copies.findIndex(copy=>stable(copy.workspace)===identity);
      if(prior>=0)return prior;
      copies.push({label,raw:JSON.stringify(workspace),workspace});return copies.length-1;
    };
    const retainedSources=()=>[...copies,...rejected].map(({label,raw})=>({label,raw}));
    const persist=workspace=>{
      // Save all alternate complete copies first. If quota fails, the older browser copy stays intact.
      localStorage.setItem(copiesKey,JSON.stringify(retainedSources()));
      localStorage.setItem(key,JSON.stringify(workspace));
    };
    const paintCopies=()=>{
      panel.replaceChildren();
      const heading=document.createElement('h2');heading.textContent='Retained downloaded and browser copies';panel.append(heading);
      const intro=document.createElement('p');intro.textContent=(active?'The selected copy is open below.':'Choose the complete workspace to continue.')+' Each alternative keeps its source editions, notes, unfinished drafts and reading position. Saving an offline HTML file retains these alternatives too.';panel.append(intro);
      if(warning){const p=document.createElement('p');p.setAttribute('role','status');p.textContent=warning;panel.append(p);}
      copies.forEach((copy,index)=>{
        const row=document.createElement('section'),title=document.createElement('h3'),details=document.createElement('p');
        title.textContent=copy.label+(index===selected?' · selected':'');
        details.textContent=copy.workspace.updated_at+' · '+copy.workspace.editions.length+' source editions · '+copy.workspace.notes.length+' notes · '+(copy.workspace.drafts||[]).length+' unfinished drafts';
        row.append(title,details);
        const choose=document.createElement('button');choose.textContent=index===selected?'Reopen this retained snapshot':'Continue with this copy';choose.disabled=moving;
        choose.onclick=()=>openCopy(index);row.append(choose);
        const download=document.createElement('button');download.textContent='Download complete copy';download.onclick=()=>save(copy.raw+'\n','scf-companion-copy-'+(index+1)+'.json','application/json');row.append(download);panel.append(row);
      });
      for(const copy of rejected){const p=document.createElement('p');p.textContent=copy.label+': '+copy.message;panel.append(p);const download=document.createElement('button');download.textContent='Download original unselected browser data';download.onclick=()=>save(copy.raw,'scf-companion-unselected-browser-data.json','application/json');panel.append(download);}
      const all=document.createElement('button');all.textContent='Download all retained complete copies';all.onclick=()=>{if(active)retainCopy(active.getWorkspace(),'Current reading work');save(JSON.stringify({schema:'stellar-forge.companion-reading-copies.v1',workspace_id:payload.workspace.id,copies:retainedSources(),unselected:rejected.map(({label,raw,message})=>({label,raw,message}))},null,2)+'\n','scf-companion-retained-copies.json','application/json');};panel.append(all);
    };
    const markup=(model,source)=>{
      let html=companionReaderMarkup(model,source),runtime=payload.runtime;
      if(runtime.applicationUrl)html=html.replace('href="./grant.html"','href="'+runtime.applicationUrl.replaceAll('&','&amp;').replaceAll('"','&quot;')+'"');
      if(runtime.submissionUrl)html=html.replace('href="./grant-submission.html"','href="'+runtime.submissionUrl.replaceAll('&','&amp;').replaceAll('"','&quot;')+'"');
      if(runtime.applicationUrl)html=html.replaceAll('href="./grant-data/','href="'+runtime.applicationUrl.replace(/[^/]*$/,'')+'grant-data/');
      return html;
    };
    async function openCopy(index) {
      if(moving)return;moving=true;paintCopies();
      try{
        const next=await api.reopen(copies[index].raw);
        if(active){retainCopy(active.getWorkspace(),'Reading work before changing copies');active.destroy();}
        selected=index;
        active=await mountCompanionReadingWorkspace(root,{api,reader:{parseCompanionMarkdown,companionReaderMarkup:markup,activateCompanionReader},initialWorkspace:next,honorInitialHash:false,persist,onOffline:w=>{
          const runtime={...payload.runtime,recoveryCopies:retainedSources()};
          save(offlineCompanionReadingWorkspace(w,runtime),'scf-companion-reading-workspace.html');
        }});
      }catch(error){warning=error.message||String(error);}
      finally{moving=false;paintCopies();}
    }
    paintCopies();
    if(resolved.initial)await openCopy(0);
    else root.replaceChildren();
  })().catch(error=>{const p=document.createElement('p');p.setAttribute('role','alert');p.textContent=error.message;document.getElementById('companion-reader').append(p);});`;
  const code=[clean(coreSource),clean(editionSource),clean(returnsSource),clean(viewSource),boot].join('\n').replace(/<\/script/gi,'<\\/script');
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SCF companion reading workspace</title><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style></head><body><a class="skip-link" href="#companion-content">Skip to companion</a><div id="companion-reader"><p class="loading" role="status">Opening complete retained reading workspace…</p></div><script id="reading-source" type="application/json">'+json+'</script><script>'+code+'</script></body></html>\n';
}

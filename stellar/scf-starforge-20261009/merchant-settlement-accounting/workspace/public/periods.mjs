// MIT. Recorded-activity periods and immutable close review over the native API.
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const exact=value=>value===null||value===undefined?'Not recorded':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const rows=values=>'<dl class="record-values">'+values.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(exact(value))+'</dd>').join('')+'</dl>';
const metrics=values=>values.map(([label,value])=>'<div class="metric"><span>'+esc(label)+'</span><strong>'+esc(exact(value))+'</strong></div>').join('');
const encode=encodeURIComponent;
const PAGE=50;
const date=value=>value?new Date(value).toLocaleString():'Not recorded';
const interval=value=>value?value.from+' → '+value.until:'All recorded activity';
const versionKey=value=>value?value.id+'/'+value.version:'';
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
function choose(element,options,preferred){
  const previous=preferred??element.value,html=options.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join('')||'<option value="">No completed period reconciliations</option>';
  if(element.innerHTML!==html)element.innerHTML=html;
  element.value=options.some(([value])=>value===previous)?previous:options[0]?.[0]??'';
}
function utc(id){const value=$(id).value;const parsed=new Date(value+'Z');if(!value||!Number.isFinite(parsed.getTime()))throw new Error('Enter both period boundaries as UTC dates and times.');return parsed.toISOString();}

export async function mountPeriods({api,perform,operator,attempt,notify,openArea,loadRun,compare}){
  const fragment=await fetch('/periods.html',{cache:'no-store'});
  if(!fragment.ok)throw new Error('The recorded-activity period workspace could not be loaded.');
  $('area-periods').innerHTML=await fragment.text();
  let state=null,busy=false,editing='',libraryLimit=24,versionOffset=0,closeOffset=0;
  let selectedClose='',closeDetail=null,closeRequest=0,detailRevision=-1,notes={items:[],total:0,offset:0,limit:PAGE},selectedNote='';
  let closeRunDetail=null,closeRunRequest=0,closeRunRevision=-1;
  const periods=()=>state?.periods??{definitions:[],selection:null,closes:[]};
  const definition=id=>periods().definitions.find(item=>item.id===id);
  const selectedPeriod=()=>{const selection=periods().selection;if(!selection)return null;return definition(selection.id)?.versions.find(item=>item.version===selection.version)??null;};
  const completed=()=>state?.runs.filter(run=>run.status==='complete'&&run.period)??[];

  function controls(){
    const usable=Boolean(state)&&!busy;
    $('period-save').disabled=!usable;
    $('period-all').disabled=!usable||!periods().selection;
    $('period-run').disabled=!usable||!periods().selection||state.runs.some(run=>['queued','running'].includes(run.status));
    $('period-close-save').disabled=!usable||!$('period-close-run').value;
    $('period-compare').disabled=!usable||!$('period-compare-baseline').value||!$('period-compare-current').value;
    for(const button of document.querySelectorAll('[data-period-select]'))button.disabled=!usable||button.dataset.selected==='true';
  }
  function renderSelection(){
    const selected=selectedPeriod(),selection=periods().selection;
    $('period-current-description').innerHTML=selected?'<strong>'+esc(selected.name)+' · definition '+selection.version+'</strong><p>'+esc(interval(selected))+' UTC · capture time / recovered import time</p>':'<strong>All recorded activity</strong><p>The next reconciliation includes every captured native and recovered record.</p>';
    $('period-run-context').textContent=selected?selected.name+' · definition '+selection.version+' · '+interval(selected)+' UTC.':'Select a saved period definition, or use the main reconciliation form for all activity.';
  }
  function renderDefinitions(){
    const search=$('period-search').value.trim().toLowerCase(),found=periods().definitions.filter(record=>!search||record.versions.some(version=>(version.name+' '+version.note).toLowerCase().includes(search)));
    $('period-list').innerHTML=found.slice(0,libraryLimit).map(record=>{const version=record.versions.at(-1);return '<button type="button" data-period-edit="'+esc(record.id)+'"'+(editing===record.id?' class="selected" aria-current="true"':'')+'><strong>'+esc(version.name)+'</strong><span>Latest definition '+version.version+'</span><span>'+esc(version.from)+'<br>to '+esc(version.until)+'</span></button>';}).join('')||'<p class="hint">No saved periods match this view.</p>';
    $('period-more').hidden=found.length<=libraryLimit;
    $('period-more').textContent='Show more ('+Math.max(0,found.length-libraryLimit)+' remaining)';
    const record=definition(editing);$('period-version-panel').hidden=!record;
    if(!record)return;
    const versions=[...record.versions].reverse();versionOffset=Math.min(versionOffset,Math.max(0,Math.floor((versions.length-1)/PAGE)*PAGE));
    $('period-versions').innerHTML=versions.slice(versionOffset,versionOffset+PAGE).map(version=>{
      const value={id:record.id,version:version.version},selected=versionKey(value)===versionKey(periods().selection);
      return '<tr><td><strong>'+esc(version.name)+' · '+version.version+'</strong><span class="subtle">'+esc(version.actor)+' · '+esc(date(version.createdAt))+'</span>'+(version.note?'<span class="subtle">'+esc(version.note)+'</span>':'')+'</td><td class="mono">'+esc(version.from)+'<br>to '+esc(version.until)+'</td><td><div class="actions"><button data-write data-period-select="'+esc(versionKey(value))+'" data-selected="'+selected+'" type="button">'+(selected?'Selected':'Select version')+'</button><button data-period-edit-version="'+version.version+'" type="button">Copy to editor</button></div></td></tr>';
    }).join('');
    $('period-version-count').textContent=(versionOffset+1)+'–'+Math.min(versionOffset+PAGE,versions.length)+' of '+versions.length+' definitions';
    $('period-version-previous').disabled=versionOffset===0;$('period-version-next').disabled=versionOffset+PAGE>=versions.length;
    $('period-editor-saved').textContent='Latest retained definition: '+record.versions.at(-1).version+'. Saving creates a new version; earlier runs keep their pinned definition.';
    controls();
  }
  function edit(id,version){
    const record=id?definition(id):null,source=record?.versions.find(item=>item.version===version)??record?.versions.at(-1);
    editing=record?.id??'';versionOffset=0;
    $('period-editor-title').textContent=record?'New definition for '+source.name:'New recorded-activity period';
    $('period-editor-saved').textContent=record?'Earlier saved definitions remain unchanged.':'Saved definitions remain available after later edits.';
    $('period-name').value=source?.name??'';$('period-from').value=source?.from.slice(0,-1)??'';$('period-until').value=source?.until.slice(0,-1)??'';$('period-note').value=source?.note??'';
    renderDefinitions();$('period-name').focus();
  }
  function currentDefinition(){
    const record=definition(editing);
    return {id:record?.id,expectedVersion:record?.versions.at(-1).version,name:$('period-name').value.trim(),from:utc('period-from'),until:utc('period-until'),note:$('period-note').value.trim(),select:true};
  }
  function runChoices(){
    const runs=completed().map(run=>[run.id,run.name+' · '+run.period.name+' v'+run.period.version]);
    choose($('period-close-run'),runs);choose($('period-compare-current'),runs);
    const closes=periods().closes.map(close=>[close.id,close.name+' · close '+close.revision+' · '+close.period.name]);
    choose($('period-compare-baseline'),closes);
  }
  async function renderCloseRun(){
    const id=$('period-close-run').value;
    if(!id){closeRunDetail=null;$('period-close-context').textContent='Capture a saved period to retain its first close.';return;}
    if(closeRunRevision===state.revision&&closeRunDetail?.run.id===id)return;
    const token=++closeRunRequest,revision=state.revision,result=await api('/api/runs/'+encode(id));
    if(token!==closeRunRequest||$('period-close-run').value!==id)return;
    closeRunDetail=result;closeRunRevision=revision;
    const review=result.reviewCounts,scope=result.period;
    $('period-close-context').textContent=interval(result.run.period)+' UTC\n'+scope.selectedCounts.events+' selected / '+scope.sourceCounts.events+' captured records · '+review.open+' open · '+review.investigating+' investigating · '+review.reviewed+' reviewed. The close retains these statuses.';
  }
  function renderCloses(){
    const search=$('period-close-search').value.trim().toLowerCase(),found=periods().closes.filter(close=>!search||[close.name,close.period.name,close.actor,close.runId,close.note].some(value=>String(value).toLowerCase().includes(search)));
    closeOffset=Math.min(closeOffset,Math.max(0,Math.floor((found.length-1)/PAGE)*PAGE));
    $('period-closes').innerHTML=found.slice(closeOffset,closeOffset+PAGE).map(close=>'<tr'+(close.id===selectedClose?' class="selected"':'')+'><td><button class="inspect" data-period-close="'+esc(close.id)+'" type="button">'+esc(close.name)+' · close '+close.revision+'</button><span class="subtle">'+esc(close.period.name)+' · definition '+close.period.version+'</span><span class="subtle">'+esc(close.actor)+' · '+esc(date(close.createdAt))+'</span></td><td class="mono">'+esc(close.period.from)+'<br>to '+esc(close.period.until)+'</td><td>'+close.reviewCounts.open+' open<br>'+close.reviewCounts.investigating+' investigating<br>'+close.reviewCounts.reviewed+' reviewed</td><td><a class="button" download href="/api/periods/closes/'+encode(close.id)+'/download">Download close</a><span class="subtle">'+(close.includeSources?'Includes private source bytes':'Original sources omitted')+'</span></td></tr>').join('')||'<tr><td colspan="4" class="empty">Retained close revisions will appear here.</td></tr>';
    $('period-close-count').textContent=found.length?(closeOffset+1)+'–'+Math.min(closeOffset+PAGE,found.length)+' of '+found.length+' closes':'0 closes';
    $('period-close-previous').disabled=closeOffset===0;$('period-close-next').disabled=closeOffset+PAGE>=found.length;
  }
  function renderNoteDetail(){
    const row=notes.items.find(item=>item.id===selectedNote);
    $('period-note-detail').innerHTML=row?'<h3>Original exception</h3>'+rows([['Event',row.eventId],['Reason',row.reason],['Route / method',row.method+' '+row.routeId],['Network',row.network]])+'<h3>Frozen at this close</h3>'+rows([['Status',row.review.status],['Named reviewer',row.review.actor||'No recorded reviewer'],['Assignee',row.review.assignee||'Unassigned'],['Full note',row.review.note||'No note'],['Version',row.review.version],['Updated',row.review.updatedAt]])+'<h3>Current workspace review</h3>'+rows([['Status',row.currentReview.status],['Named reviewer',row.currentReview.actor||'No recorded reviewer'],['Assignee',row.currentReview.assignee||'Unassigned'],['Full note',row.currentReview.note||'No note'],['Version',row.currentReview.version],['Updated',row.currentReview.updatedAt]]):'<p class="empty">Select an exception to read both full notes.</p>';
  }
  function renderNotes(){
    $('period-note-rows').innerHTML=notes.items.map(row=>'<tr'+(row.id===selectedNote?' class="selected"':'')+'><td><button type="button" class="inspect" data-period-note="'+esc(row.id)+'">'+esc(row.reason.replaceAll('_',' ').toLowerCase())+'</button><span class="subtle mono">'+esc(row.eventId)+'</span></td><td>'+esc(row.review.status)+'<span class="subtle">'+esc(row.review.actor||'No review recorded')+'</span></td><td>'+esc(row.currentReview.status)+(same(row.review,row.currentReview)?'<span class="subtle">Unchanged</span>':'<span class="subtle">Updated after this close</span>')+'</td></tr>').join('')||'<tr><td colspan="3" class="empty">No frozen exceptions match this view.</td></tr>';
    $('period-notes-count').textContent=notes.total?(notes.offset+1)+'–'+Math.min(notes.offset+notes.items.length,notes.total)+' of '+notes.total+' frozen notes':'0 frozen notes';
    $('period-notes-previous').disabled=notes.offset===0;$('period-notes-next').disabled=notes.offset+notes.items.length>=notes.total;renderNoteDetail();
  }
  function renderCloseDetail(){
    $('period-close-detail').hidden=!closeDetail;if(!closeDetail)return;
    const {close,currentReviewCounts,changedReviews}=closeDetail,scope=close.scope,base='/api/periods/closes/'+encode(close.id);
    $('period-close-title').textContent=close.name+' · close revision '+close.revision;
    $('period-close-by').textContent=close.period.name+' · definition '+close.period.version+' · '+close.actor+' · '+date(close.createdAt);
    $('period-close-metrics').innerHTML=metrics([['Selected records',scope.selectedCounts.events],['Captured before selection',scope.sourceCounts.events],['Open at close',close.reviewCounts.open],['Reviews updated since close',changedReviews]]);
    $('period-close-summary').textContent=interval(close.period)+' UTC\n'+scope.selectedCounts.nativeSuccessEvents+' native captures / '+scope.selectedCounts.recoveredSettlements+' recovered imports selected. '+scope.excludedCounts.events+' captured records outside this interval.\nFrozen: '+close.reviewCounts.open+' open, '+close.reviewCounts.investigating+' investigating, '+close.reviewCounts.reviewed+' reviewed. Current: '+currentReviewCounts.open+' open, '+currentReviewCounts.investigating+' investigating, '+currentReviewCounts.reviewed+' reviewed.'+(close.note?'\nClose note: '+close.note:'');
    $('period-close-downloads').innerHTML='<a class="button" download href="'+base+'/download">Download immutable close archive</a><a class="button" download href="'+base+'/download/period-close.json">Close metadata JSON</a><a class="button" download href="'+base+'/download/review-notes.json">Frozen review notes JSON</a>';
    $('period-close-identities').outerHTML=rows([['Close ID',close.id],['Previous close',closeDetail.previousClose?.name??'First retained close'],['Run ID',close.runId],['Definition name',close.period.name],['Definition version',close.period.version],['UTC start · inclusive',close.period.from],['UTC end · exclusive',close.period.until],['Native time basis',scope.timeBasis.SF98_NATIVE_CAPTURE],['Recovered time basis',scope.timeBasis.RECOVERED_ORIGINAL_SF31_OUTCOME],['Verification scope',scope.verificationScope],['Proof coverage',scope.proofCoverageScope],['Report SHA-256',close.reportSha256],['Source manifest SHA-256',close.inputManifestSha256],['Frozen review SHA-256',close.reviewNotesSha256],['Close metadata SHA-256',close.closeSha256],['Workspace revision at close',close.reviewSnapshotRevision],['Private source files',close.includeSources?'Included in archive':'Omitted from archive']]).replace('<dl ','<dl id="period-close-identities" ');
    renderNotes();
  }
  async function loadClose(id,offset=0){
    if(!id)return;const token=++closeRequest,revision=state.revision;
    if(selectedClose!==id){selectedClose=id;closeDetail=null;selectedNote='';}
    renderCloses();
    const query=new URLSearchParams({offset:String(offset),limit:String(PAGE),search:$('period-notes-search').value.trim(),status:$('period-notes-status').value});
    const [detail,result]=await Promise.all([api('/api/periods/closes/'+encode(id)),api('/api/periods/closes/'+encode(id)+'/notes?'+query)]);
    if(token!==closeRequest||selectedClose!==id)return;
    closeDetail=detail;notes=result;detailRevision=revision;renderCloseDetail();
  }

  $('period-search').addEventListener('input',()=>{libraryLimit=24;renderDefinitions();});
  $('period-more').addEventListener('click',()=>{libraryLimit+=24;renderDefinitions();});
  $('period-new').addEventListener('click',()=>edit(''));
  $('period-list').addEventListener('click',event=>{const button=event.target.closest('[data-period-edit]');if(button)edit(button.dataset.periodEdit);});
  $('period-versions').addEventListener('click',event=>{
    const selection=event.target.closest('[data-period-select]'),copy=event.target.closest('[data-period-edit-version]');
    if(copy)edit(editing,Number(copy.dataset.periodEditVersion));
    if(selection)attempt(async()=>{const [id,version]=selection.dataset.periodSelect.split('/');await perform({path:'/api/periods/selection',body:{revision:state.revision,selection:{id,version:Number(version)},actor:operator()},description:'recorded-activity period selection',message:'Saved period version selected. New runs pin this exact definition.'});});
  });
  $('period-version-previous').addEventListener('click',()=>{versionOffset=Math.max(0,versionOffset-PAGE);renderDefinitions();});
  $('period-version-next').addEventListener('click',()=>{versionOffset+=PAGE;renderDefinitions();});
  $('period-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    await perform({path:'/api/periods',body:{revision:state.revision,actor:operator(),...currentDefinition()},currentBody:currentDefinition,description:'recorded-activity period definition',message:'Definition retained and selected. Earlier runs and closes keep their original interval.',success:result=>{editing=result.definition.id;versionOffset=0;renderDefinitions();}});
  });});
  $('period-all').addEventListener('click',()=>attempt(()=>perform({path:'/api/periods/selection',body:{revision:state.revision,selection:null,actor:operator()},description:'all-activity accounting selection',message:'Future reconciliations include all captured activity. Saved periods and closes remain available.'})));
  $('period-run-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    const selection=structuredClone(periods().selection);if(!selection)throw new Error('Select a saved period definition.');
    const currentBody=()=>({name:$('period-run-name').value.trim(),expectedPeriodSelection:selection});
    await perform({path:'/api/runs',body:{revision:state.revision,actor:operator(),...currentBody()},currentBody,description:'period reconciliation',message:'Original source capture queued with the selected immutable period definition.',success:async result=>{await loadRun(result.run.id,{reset:true});openArea('reconcile');}});
  });});
  $('period-close-run').addEventListener('change',()=>attempt(()=>{closeRunRevision=-1;controls();return renderCloseRun();}));
  $('period-close-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    const currentBody=()=>({runId:$('period-close-run').value,name:$('period-close-name').value.trim(),note:$('period-close-note').value.trim(),includeSources:$('period-close-sources').checked});
    await perform({path:'/api/periods/closes',body:{revision:state.revision,actor:operator(),...currentBody()},currentBody,description:'immutable period close',message:'Close revision retained with original report, definition, and frozen review notes, including open exceptions.',success:async result=>{await loadClose(result.close.id);$('period-close-detail').scrollIntoView({block:'start',behavior:'smooth'});}});
  });});
  $('period-close-filter-form').addEventListener('submit',event=>{event.preventDefault();closeOffset=0;renderCloses();});
  $('period-close-previous').addEventListener('click',()=>{closeOffset=Math.max(0,closeOffset-PAGE);renderCloses();});
  $('period-close-next').addEventListener('click',()=>{closeOffset+=PAGE;renderCloses();});
  $('period-closes').addEventListener('click',event=>{const button=event.target.closest('[data-period-close]');if(button)attempt(()=>loadClose(button.dataset.periodClose));});
  $('period-close-open-run').addEventListener('click',()=>attempt(async()=>{if(!closeDetail)return;await loadRun(closeDetail.close.runId,{reset:true});openArea('reconcile');}));
  $('period-notes-filter').addEventListener('submit',event=>{event.preventDefault();attempt(()=>loadClose(selectedClose));});
  $('period-notes-previous').addEventListener('click',()=>attempt(()=>loadClose(selectedClose,Math.max(0,notes.offset-PAGE))));
  $('period-notes-next').addEventListener('click',()=>attempt(()=>loadClose(selectedClose,notes.offset+PAGE)));
  $('period-note-rows').addEventListener('click',event=>{const button=event.target.closest('[data-period-note]');if(button){selectedNote=button.dataset.periodNote;renderNotes();}});
  $('period-compare-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    const baseline=periods().closes.find(item=>item.id===$('period-compare-baseline').value),current=$('period-compare-current').value;
    if(!baseline||!current)throw new Error('Choose a retained close and a completed period run.');
    await compare(current,baseline.runId);
  });});

  return {
    render(next){
      state=next;renderSelection();renderDefinitions();runChoices();renderCloses();controls();attempt(renderCloseRun);
      if(!selectedClose)selectedClose=periods().closes[0]?.id??'';
      if(selectedClose&&detailRevision!==state.revision)attempt(()=>loadClose(selectedClose,notes.offset));
    },
    setBusy(value){busy=value;controls();},
    renderRun(result){
      const run=result?.run,scope=result?.period,container=$('run-period');container.hidden=!run?.period;
      if(!run?.period){container.innerHTML='';return;}
      container.innerHTML='<h3>'+esc(run.period.name)+' · definition '+run.period.version+'</h3><p>'+esc(interval(run.period))+' UTC. Start included; end excluded.</p><p>Native rows use capture time; recovered rows use import time. Original verification and transaction reuse see all captured records before period selection.</p>'+(scope?'<div class="metrics">'+metrics([['Selected records',scope.selectedCounts.events],['All captured records',scope.sourceCounts.events],['Outside period',scope.excludedCounts.events]])+'</div>':'');
      if(run.status==='complete'){$('period-close-run').value=run.id;closeRunRevision=-1;attempt(renderCloseRun);}
    }
  };
}

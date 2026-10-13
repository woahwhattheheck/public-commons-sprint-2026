// Pure delegated working-copy pane inside the original Contributor desk.
const PAGE=25,JSON_PAGE=12000;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const array=value=>Array.isArray(value)?value:[];
const shown=value=>value===null||value===undefined||value===''?'Not retained':String(value);
const bytes=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString('en-US')+' bytes':'Byte count not retained';
const code=value=>'<code>'+esc(shown(value))+'</code>';
const label=value=>String(value??'').replaceAll('_',' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
const badge=value=>'<span class="engagement-status">'+esc(label(value))+'</span>';
const empty=text=>'<p class="engagement-empty">'+esc(text)+'</p>';
function button(text,action,extra={},disabled=false){
  return '<button type="button" data-engagement-action="'+esc(action)+'"'+Object.entries(extra).map(([k,v])=>' '+k+'="'+esc(v)+'"').join('')+
    (disabled?' disabled data-engagement-fixed="true"':'')+'>'+esc(text)+'</button>';
}
function table(caption,headers,rows){
  return '<div class="engagement-table engagement-working-table" tabindex="0" role="region" aria-label="'+esc(caption)+'"><table><caption>'+esc(caption)+'</caption><thead><tr>'+
    headers.map(h=>'<th scope="col">'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+
    rows.map(cells=>'<tr>'+cells.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
}
function list(items,kind){
  return items.length?'<ul class="engagement-working-messages '+esc(kind)+'">'+items.map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul>':'';
}
function metadata(rows){
  return '<dl class="engagement-working-metadata">'+rows.map(([name,value,isCode])=>'<div><dt>'+esc(name)+'</dt><dd>'+(isCode?code(value):esc(shown(value)))+'</dd></div>').join('')+'</dl>';
}
function limitPage(page,total){return Math.max(0,Math.min(page,Math.max(0,Math.ceil(total/PAGE)-1)));}
function pager(kind,page,total,noun){
  if(total<=PAGE)return '';
  return '<div class="engagement-working-pagination" aria-label="'+esc(noun)+' pages">'+
    button('Previous '+noun,'working-'+kind+'-previous',{},page===0)+
    '<span>Showing '+(page*PAGE+1)+'–'+Math.min((page+1)*PAGE,total)+' of '+total+'</span>'+
    button('Next '+noun,'working-'+kind+'-next',{},(page+1)*PAGE>=total)+'</div>';
}
const PHASES={
  FORECAST_REVIEWED:'Cash forecast reviewed',
  FORECAST_SAVED:'Original Forecast saved',
  PORTFOLIO_REVIEWED:'Allocation reviewed',
  PORTFOLIO_SAVED:'Original Portfolio saved',
  COMPLETED:'Native receiving completed'
};
const JSON_PARTS={
  document:{label:'Complete working document',get:s=>s.document},
  agreements:{label:'Complete agreement document',get:s=>s.document.state.document},
  handoff:{label:'Complete handoff selections',get:s=>s.document.state.handoff},
  receiving:{label:'Original receiving flow and receipts',get:s=>s.document.state.receiving},
  commands:{label:'Complete original requests and retained receipts',get:s=>({pending:s.document.state.pending,accepted:s.document.state.accepted,rejected:s.document.state.rejected,requestReceipts:s.document.state.requestReceipts})},
  previews:{label:'Original preview and observed versions',get:s=>({preview:s.document.state.preview,previewVersion:s.document.state.previewVersion,draftVersion:s.document.state.draftVersion})},
  history:{label:'Saved original book and retained histories',get:s=>({saved:s.document.state.saved,selectedReview:s.document.state.selectedReview,history:s.document.state.history,receivingHistory:s.document.state.receivingHistory})},
  controls:{label:'Unfinished controls and visible selections',get:s=>({controls:s.document.state.controls,tab:s.document.state.tab,selectedAgreement:s.document.state.selectedAgreement,search:s.document.state.search,acceptanceFilter:s.document.state.acceptanceFilter,newContributor:s.document.state.newContributor})},
  sources:{label:'Original and current source metadata',get:s=>s.inspection.sources},
  bindings:{label:'Original and current case and staff binding',get:s=>({binding:s.inspection.binding,currentBinding:s.inspection.currentBinding})},
  portfolio:{label:'Complete applied and pending Portfolio files with exact encoded bytes',get:s=>({applied:s.document.state.portfolioFile,pending:s.document.state.pendingPortfolioFile})}
};
export function createEngagementWorkingDesk({root,view,capture,inspectSaved,inspectFile,openSelected,downloadCurrent,downloadSelected,removeSaved,dismiss,setName}){
  const callbacks={view,capture,inspectSaved,inspectFile,openSelected,downloadCurrent,downloadSelected,removeSaved,dismiss,setName};
  for(const [name,fn]of Object.entries(callbacks))if(typeof fn!=='function')throw new TypeError('The original Contributor desk must provide '+name+'.');
  if(!root||typeof root.contains!=='function')throw new TypeError('The original Contributor root is required.');
  let query='',copyPage=0,sourcePage=0,commandPage=0,removeChoice=null;
  let selectedKey='',jsonPart=null,jsonText=null,jsonPage=0;
  function current(){
    const value=view();
    if(!value||!Array.isArray(value.copies))throw new Error('The original Contributor working-copy view is incomplete.');
    return value;
  }
  function syncSelected(value){
    const next=value.selected||null,live=next?.inspection?.currentBinding;
    const key=next?[next.file?.sha256,next.file?.name,live?.programId,live?.caseVersion,live?.scopeKey,live?.planRevision].map(v=>String(v??'')).join('\n'):'';
    if(key!==selectedKey){
      selectedKey=key;sourcePage=0;commandPage=0;jsonPart=null;jsonText=null;jsonPage=0;
    }
    if(removeChoice&&!value.copies.some(row=>row.id===removeChoice.id&&row.sha256===removeChoice.sha256))removeChoice=null;
  }
  function filteredCopies(value){
    const find=query.trim().toLocaleLowerCase();
    return value.copies.filter(row=>!find||[row.name,row.id,row.createdAt,row.sha256,row.summary?.selectedReview,row.summary?.receivingPhase,row.summary?.pendingRequestId].some(part=>String(part??'').toLocaleLowerCase().includes(find)));
  }
  function copiesPanel(value){
    const rows=filteredCopies(value);copyPage=limitPage(copyPage,rows.length);
    const body=rows.length?table('Named local checkpoints',['Checkpoint','Retained preparation','Complete file','Local controls'],rows.slice(copyPage*PAGE,(copyPage+1)*PAGE).map(row=>[
      '<strong>'+esc(row.name)+'</strong><small>'+esc(row.createdAt)+'</small>'+code(row.id),
      '<span>'+esc(row.summary?.agreements??0)+' agreements</span><small>'+esc(row.summary?.receivingPhase?(PHASES[row.summary.receivingPhase]||row.summary.receivingPhase):'No native receiving selected')+'</small>'+
        (row.summary?.selectedReview?'<small>Saved edition '+code(row.summary.selectedReview)+'</small>':'')+
        (row.summary?.pendingRequestId?'<small>Original request '+code(row.summary.pendingRequestId)+'</small>':''),
      esc(bytes(row.bytes))+'<small>SHA-256 '+code(row.sha256)+'</small>',
      '<div class="engagement-actions">'+button('Inspect checkpoint','working-inspect-saved',{'data-copy-id':row.id})+
        button('Remove local checkpoint','working-remove',{'data-copy-id':row.id})+'</div>'
    ]))+pager('copy',copyPage,rows.length,'checkpoints'):
      empty(value.copies.length?'No local checkpoints match this search. Clear the search to see the retained list.':'No named checkpoint is retained here yet. Capture the current preparation or inspect a downloaded working file.');
    let removal='';
    if(removeChoice)removal='<section class="engagement-working-removal" aria-labelledby="engagement-working-removal-heading"><h5 id="engagement-working-removal-heading">Remove this local checkpoint?</h5><p><strong>'+esc(removeChoice.name)+'</strong> · '+code(removeChoice.id)+'</p><p>Only this named browser copy is removed. Active preparation, native agreement books, sources, Forecasts, Portfolios and request history remain in their original places. Download this checkpoint first if you need another copy.</p><div class="engagement-actions">'+button('Remove this local checkpoint','working-remove-confirm',{'data-copy-id':removeChoice.id})+button('Keep checkpoint','working-remove-cancel')+'</div></section>';
    return '<section class="engagement-working-panel" aria-labelledby="engagement-working-list-heading"><div class="engagement-working-heading"><div><h4 id="engagement-working-list-heading">Named checkpoints</h4><p>Each checkpoint retains one complete preparation. Opening a checkpoint is a separate, reviewed action.</p></div><span class="engagement-status">'+value.copies.length+' retained</span></div>'+
      '<div class="engagement-working-search"><label>Find a checkpoint<input type="search" value="'+esc(query)+'" data-engagement-working-search placeholder="Name, saved edition or original request"></label>'+button('Find checkpoints','working-search')+(query?button('Clear search','working-clear-search'):'')+'</div>'+body+removal+'</section>';
  }
  function bindingsPanel(inspection){
    const original=inspection.binding||{},live=inspection.currentBinding||{};
    const fields=[['Native case','programId'],['Observed case version','caseVersion'],['Selected plan','planId'],['Selected plan revision','planRevision'],['Recording staff scope','scopeKey'],['Recording operator','recordingActor']];
    return table('Original and current binding',['Identity','Working file','Current desk'],fields.map(([name,key])=>[esc(name),code(original[key]),code(live[key])]))+
      '<div class="engagement-actions">'+button('Inspect complete binding','working-inspect-json',{'data-working-section':'bindings'})+'</div>';
  }
  function sourcesPanel(inspection){
    const rows=array(inspection.sources);sourcePage=limitPage(sourcePage,rows.length);
    if(!rows.length)return empty('This file retains no original source inventory. Any legacy-file limitations remain listed above; the native source desk is authoritative.');
    return table('Original source identities',['Source','Original file','Current metadata','Observed comparison'],rows.slice(sourcePage*PAGE,(sourcePage+1)*PAGE).map(row=>[
      code(row.original?.id),
      '<strong>'+esc(row.original?.filename||row.original?.name||'Retained source')+'</strong><small>'+esc(bytes(row.original?.bytes))+'</small>'+code(row.original?.sha256),
      row.current?'<strong>'+esc(row.current.filename||row.current.name||'Current source')+'</strong><small>'+esc(bytes(row.current.bytes))+'</small>'+code(row.current.sha256):'Not present in current source inventory',
      badge(row.status)
    ]))+pager('source',sourcePage,rows.length,'sources')+
      '<p class="engagement-working-help">This compares retained source metadata. Original attachments stay in the native case and are downloaded through its existing Sources desk.</p>'+
      '<div class="engagement-actions">'+button('Inspect complete source metadata','working-inspect-json',{'data-working-section':'sources'})+'</div>';
  }
  function commandsPanel(inspection){
    const rows=array(inspection.commands);commandPage=limitPage(commandPage,rows.length);
    if(!rows.length)return empty('No original pending command, accepted receipt or receiving-step receipt is retained in this checkpoint.');
    return table('Original command identities',['Action and request','Actor and expected version','Receipt retained in file'],rows.slice(commandPage*PAGE,(commandPage+1)*PAGE).map(row=>[
      '<strong>'+esc(row.action)+'</strong><small>'+code(row.requestId)+'</small>',
      esc(shown(row.actor))+'<small>Expected case version '+esc(shown(row.expectedVersion))+'</small>',
      row.result?'<strong>Result retained</strong><small>'+code(row.result.recordId||row.result.id)+'</small><small>Returned case version '+esc(shown(row.result.version))+'</small>':'No result retained'
    ]))+pager('command',commandPage,rows.length,'requests')+
      '<p class="engagement-working-help">A result shown here is retained evidence from the file. Opening reconciles its exact command against the current native journal before it can become active.</p>';
  }
  function jsonPanel(){
    if(!jsonPart||jsonText===null)return '';
    const total=Math.max(1,Math.ceil(jsonText.length/JSON_PAGE));jsonPage=Math.max(0,Math.min(jsonPage,total-1));
    let start=jsonPage*JSON_PAGE,end=Math.min((jsonPage+1)*JSON_PAGE,jsonText.length);
    const high=c=>c>=0xd800&&c<=0xdbff,low=c=>c>=0xdc00&&c<=0xdfff;
    if(start>0&&high(jsonText.charCodeAt(start-1))&&low(jsonText.charCodeAt(start)))start--;
    if(end<jsonText.length&&high(jsonText.charCodeAt(end-1))&&low(jsonText.charCodeAt(end)))end--;
    return '<section class="engagement-working-json" aria-labelledby="engagement-working-json-heading"><div class="engagement-working-heading"><h5 id="engagement-working-json-heading">'+esc(JSON_PARTS[jsonPart].label)+'</h5>'+button('Close data inspection','working-json-close')+'</div>'+
      '<p>Complete retained JSON, displayed in '+total+' '+(total===1?'page':'pages')+'. Download the selected working file for the full document in one file.</p>'+
      '<div class="engagement-working-pagination">'+button('Previous data page','working-json-previous',{},jsonPage===0)+'<span>Data page '+(jsonPage+1)+' of '+total+'</span>'+button('Next data page','working-json-next',{},jsonPage+1>=total)+'</div>'+
      '<pre tabindex="0" aria-label="'+esc(JSON_PARTS[jsonPart].label)+'">'+esc(jsonText.slice(start,end))+'</pre></section>';
  }
  function selectedPanel(value){
    const selected=value.selected;
    if(!selected)return '<section class="engagement-working-panel" aria-labelledby="engagement-working-inspection-heading"><h4 id="engagement-working-inspection-heading">Inspect before opening</h4>'+empty('Choose Inspect checkpoint or select a working file. Its current case/staff binding, complete original commands and source identities appear here before active work is replaced.')+'</section>';
    const document=selected.document,inspection=selected.inspection||{},state=document?.state||{};
    const conflicts=array(inspection.conflicts),observations=array(inspection.observations),canOpen=inspection.canOpen===true&&conflicts.length===0;
    const sections=[['agreements','Agreements and raw fields'],['handoff','Handoff selections'],['receiving','Receiving flow and receipts'],['commands','Whole original commands'],['previews','Native preview and versions'],['history','Saved book and histories'],['controls','Unfinished controls'],['document','Complete working document']];
    if(state.portfolioFile||state.pendingPortfolioFile)sections.splice(7,0,['portfolio','Exact Portfolio files']);
    return '<section class="engagement-working-panel engagement-working-selection" aria-labelledby="engagement-working-inspection-heading"><div class="engagement-working-heading"><div><p class="engagement-working-eyebrow">Selected for inspection</p><h4 id="engagement-working-inspection-heading">'+esc(document?.name||selected.file?.name||'Complete working file')+'</h4></div>'+
      badge(canOpen?'READY_FOR_RECONCILIATION':'OPEN_UNAVAILABLE')+'</div>'+
      metadata([['Working filename',selected.file?.name],['Complete file size',bytes(selected.file?.bytes)],['File SHA-256',selected.file?.sha256,true],['Checkpoint created',document?.createdAt],['Agreements retained',inspection.agreements??0],['Selected saved book',inspection.selectedReview,true],['Receiving stage',PHASES[inspection.receivingPhase]||inspection.receivingPhase||'No receiving selected']])+
      (conflicts.length?'<section class="engagement-working-conflicts" role="status"><h5>Opening needs the original binding</h5>'+list(conflicts,'conflicts')+'</section>':'')+
      (observations.length?'<section class="engagement-working-observations"><h5>Review these retained observations</h5>'+list(observations,'observations')+'</section>':'')+
      '<p class="engagement-working-help">Opening preserves a recovery checkpoint of the current preparation, checks original native requests and saved editions, then adopts this complete state. It does not send a new save, accept an agreement or continue a financial handoff automatically.</p>'+
      '<div class="engagement-actions">'+button('Reconcile and open this copy','working-open-selected',{},!canOpen)+button('Download selected working file','working-download-selected')+button('Dismiss selection','working-dismiss')+'</div>'+
      '<details open><summary>Case, plan and staff binding</summary><div>'+bindingsPanel(inspection)+'</div></details>'+
      '<details open><summary>Original commands and receipts ('+array(inspection.commands).length+')</summary><div>'+commandsPanel(inspection)+button('Inspect complete commands','working-inspect-json',{'data-working-section':'commands'})+'</div></details>'+
      '<details open><summary>Original source inventory ('+array(inspection.sources).length+')</summary><div>'+sourcesPanel(inspection)+'</div></details>'+
      (inspection.portfolioFile?'<section class="engagement-working-file"><h5>Selected original Portfolio file</h5>'+
        metadata([['Original filename',inspection.portfolioFile.name],['Original complete size',bytes(inspection.portfolioFile.bytes)],['Original SHA-256',inspection.portfolioFile.sha256,true]])+
        '<p>The full original bytes and complete native inputs are retained in this working document.</p>'+button('Inspect exact Portfolio file','working-inspect-json',{'data-working-section':'portfolio'})+'</section>':'')+
      (state.pendingPortfolioFile?'<section class="engagement-working-file"><h5>Selected Portfolio file awaiting application</h5>'+
        metadata([['Selected filename',state.pendingPortfolioFile.name],['Original complete size',bytes(state.pendingPortfolioFile.bytes)],['Original SHA-256',state.pendingPortfolioFile.sha256,true]])+
        '<p>These exact bytes are retained as an unfinished file selection. They have not replaced the applied Portfolio input; invalid or unfinished JSON remains available for recovery.</p>'+button('Inspect both complete Portfolio files','working-inspect-json',{'data-working-section':'portfolio'})+'</section>':'')+
      '<section class="engagement-working-data"><h5>Inspect the complete preparation</h5><p>These views show original retained data, including unfinished values. Native review and acceptance judgments remain unchanged.</p><div class="engagement-actions">'+
        sections.map(([key,text])=>button(text,'working-inspect-json',{'data-working-section':key})).join('')+'</div>'+jsonPanel()+'</section></section>';
  }
  function render(){
    const value=current();syncSelected(value);
    return '<section class="engagement-working-desk" aria-labelledby="engagement-working-heading"><header class="engagement-working-heading"><div><h4 id="engagement-working-heading">Complete working copies</h4><p>Keep a named snapshot of the full agreement preparation and its original receiving stage. Inspect a saved or downloaded copy before opening it in this case.</p></div></header>'+
      (value.storageBlocked?'<div class="engagement-working-conflicts" role="status"><h5>Local retention needs attention</h5><p>The current preparation is still held by the original desk. Use Download current preparation below, or inspect and remove an unneeded local checkpoint before retrying retention. No native save is sent by these controls.</p></div>':'')+
      '<section class="engagement-working-panel" aria-labelledby="engagement-working-capture-heading"><h4 id="engagement-working-capture-heading">Keep the current preparation</h4>'+
      '<label class="engagement-working-name">Checkpoint name<input type="text" data-engagement-working-name maxlength="300" value="'+esc(value.name||'')+'" placeholder="For example: availability review before allocation" autocomplete="off"><small>Name this complete point in the existing work. Capturing does not replace another named checkpoint.</small></label>'+
      '<div class="engagement-actions">'+button('Capture named checkpoint','working-capture')+button('Download current preparation','working-download-current')+'</div>'+
      '<div class="engagement-working-file-input"><label>Inspect a downloaded working file<input type="file" data-engagement-working-file accept=".json,application/json"><small>The complete file is inspected first. Opening requires the explicit reconciliation control below.</small></label></div></section>'+
      copiesPanel(value)+selectedPanel(value)+'</section>';
  }
  function input(event){
    const target=event?.target;if(!target||!root.contains(target))return false;
    if(target.hasAttribute('data-engagement-working-name')){setName(target.value);return true;}
    if(target.hasAttribute('data-engagement-working-search')){query=target.value;copyPage=0;return true;}
    return false;
  }
  async function action(name,target){
    if(typeof name!=='string'||!name.startsWith('working-'))return false;
    const value=current();syncSelected(value);
    const selected=value.selected;
    switch(name){
      case 'working-capture':await capture(value.name);break;
      case 'working-download-current':await downloadCurrent();break;
      case 'working-inspect-file':{
        if(!target||!root.contains(target)||!target.hasAttribute('data-engagement-working-file'))throw new Error('Choose the original working-file control.');
        const file=target.files?.[0];if(!file)throw new Error('Choose a complete Contributor working file.');
        await inspectFile(file);break;
      }
      case 'working-inspect-saved':{
        const id=target?.dataset?.copyId;
        if(!value.copies.some(row=>row.id===id))throw new Error('Select a retained local checkpoint.');
        await inspectSaved(id);break;
      }
      case 'working-open-selected':
        if(!selected||selected.inspection?.canOpen!==true||array(selected.inspection.conflicts).length)throw new Error('Inspect a working copy with the original case and staff binding first.');
        await openSelected();break;
      case 'working-download-selected':
        if(!selected)throw new Error('Inspect a complete working copy first.');
        await downloadSelected();break;
      case 'working-dismiss':await dismiss();break;
      case 'working-remove':{
        const found=value.copies.find(row=>row.id===target?.dataset?.copyId);
        if(!found)throw new Error('Select the exact local checkpoint to remove.');
        removeChoice={id:found.id,name:found.name,sha256:found.sha256};break;
      }
      case 'working-remove-confirm':{
        const id=target?.dataset?.copyId;
        if(!removeChoice||removeChoice.id!==id||!value.copies.some(row=>row.id===id&&row.sha256===removeChoice.sha256))throw new Error('Review this local checkpoint removal again.');
        await removeSaved(id);removeChoice=null;break;
      }
      case 'working-remove-cancel':removeChoice=null;break;
      case 'working-search':copyPage=0;break;
      case 'working-clear-search':query='';copyPage=0;break;
      case 'working-copy-previous':copyPage=Math.max(0,copyPage-1);break;
      case 'working-copy-next':copyPage=limitPage(copyPage+1,filteredCopies(value).length);break;
      case 'working-source-previous':sourcePage=Math.max(0,sourcePage-1);break;
      case 'working-source-next':sourcePage=limitPage(sourcePage+1,array(selected?.inspection?.sources).length);break;
      case 'working-command-previous':commandPage=Math.max(0,commandPage-1);break;
      case 'working-command-next':commandPage=limitPage(commandPage+1,array(selected?.inspection?.commands).length);break;
      case 'working-inspect-json':{
        const part=target?.dataset?.workingSection;
        if(!selected||!Object.hasOwn(JSON_PARTS,part))throw new Error('Select a complete retained data section.');
        const text=JSON.stringify(JSON_PARTS[part].get(selected),null,2);
        jsonPart=part;jsonText=text===undefined?'null':text;jsonPage=0;break;
      }
      case 'working-json-previous':jsonPage=Math.max(0,jsonPage-1);break;
      case 'working-json-next':if(jsonText!==null)jsonPage=Math.min(jsonPage+1,Math.max(0,Math.ceil(jsonText.length/JSON_PAGE)-1));break;
      case 'working-json-close':jsonPart=null;jsonText=null;jsonPage=0;break;
      default:return false;
    }
    return true;
  }
  return {render,input,action};
}

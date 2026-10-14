/** Complete original-table browsing in the existing scientific source intake. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const arr=value=>Array.isArray(value)?value:[];
function cell(value,exists){
 if(!exists)return '<span class="ci-row-empty">No cell in this record</span>';
 if(value===null)return '<span class="ci-row-empty">Empty cell</span>';
 if(value==='')return '<span class="ci-row-empty">Empty string</span>';
 return esc(value);
}
export function originalRowsTable(value,mode='displayed'){
 const rows=arr(value.rows),fields=arr(value.fields),width=Math.max(fields.length,0,...rows.map(r=>Math.max(arr(r.cells).length,arr(r.stored_cells).length)));
 if(!rows.length)return '<p>No original rows match this selection. The complete retained file and table exports remain available.</p>';
 const columns=Array.from({length:width},(_,i)=>fields[i]||{display:'Unlabeled original column '+(i+1)});
 return '<div class="ci-scroll ci-original-grid" role="region" tabindex="0" aria-label="Complete original table records"><table><caption>Original rows '+rows[0].row+'–'+rows.at(-1).row+' · '+esc(mode==='stored'?'stored values':'selected-reader values')+'</caption><thead><tr><th scope="col">Original position</th>'+columns.map(f=>'<th scope="col">'+esc(f.display||f.label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>{
  const shown=mode==='stored'&&Array.isArray(row.stored_cells)?row.stored_cells:arr(row.cells);
  return '<tr><th scope="row">Row '+esc(row.row)+'<br><small>'+esc(row.kind)+' · '+(row.line_start===row.line_end?'line '+esc(row.line_start):'lines '+esc(row.line_start)+'–'+esc(row.line_end))+'</small></th>'+
   columns.map((f,i)=>'<td>'+cell(shown[i],i<shown.length)+(Array.isArray(row.stored_cells)?'<details><summary>Cell meaning</summary><dl><dt>Selected-reader value</dt><dd>'+cell(row.cells[i],i<row.cells.length)+'</dd><dt>Stored value</dt><dd>'+cell(row.stored_cells[i],i<row.stored_cells.length)+'</dd><dt>Number format</dt><dd>'+esc(row.number_formats?.[i]??'Not supplied')+'</dd><dt>Native type</dt><dd>'+esc(row.cell_metadata?.[i]?.data_type??'Not supplied')+'</dd></dl></details>':'')+'</td>').join('')+'</tr>';
 }).join('')+'</tbody></table></div>';
}
/** Operate the same complete export without keeping every parsed row in memory. */
function mountOfflineOriginalTable(){
 const q=selector=>document.querySelector(selector);
 const lines=q('#source-rows').textContent.trim().split('\n').filter(Boolean);
 const fields=JSON.parse(q('#source-fields').textContent);
 const pager=()=>document.querySelectorAll('[data-offline-page]');
 let start=0,matching=null,pageSize=100,generation=0,busy=false;
 const count=()=>matching===null?lines.length:matching.length;
 const sourceIndex=index=>matching===null?index:matching[index];
 const status=q('#status'),error=q('#offline-error');
 function controls(){
  for(const button of pager()){
   const previous=button.dataset.offlinePage==='previous';
   button.disabled=busy||(previous?start===0:start+pageSize>=count());
   button.textContent=(previous?'Previous ':'Next ')+pageSize;
  }
  q('#page-size').disabled=busy;
  for(const node of q('#jump').elements)node.disabled=busy||!count();
  q('#cancel-search').hidden=!busy;
  q('#table').setAttribute('aria-busy',String(busy));
 }
 function draw(note=''){
  const size=count();
  start=Math.min(start,Math.max(0,Math.floor((size-1)/pageSize)*pageSize));
  const page=[];
  for(let i=start;i<Math.min(size,start+pageSize);i++)page.push(JSON.parse(lines[sourceIndex(i)]));
  q('#table').innerHTML=originalRowsTable({rows:page,fields},q('#mode').value);
  status.textContent=size+' matching original records of '+lines.length+'; showing '+(page.length?start+1:0)+'–'+(start+page.length)+'.'+(note?' '+note:'');
  q('#bottom-status').textContent=page.length?'Showing '+(start+1)+'–'+(start+page.length)+' of '+size+'.':'No matching original records.';
  controls();
 }
 async function search(event){
  event.preventDefault();
  const request=++generation,text=q('#query').value,sensitive=q('#case').checked;
  const needle=sensitive?text:text.toLowerCase();
  error.textContent='';
  if(!needle){busy=false;matching=null;start=0;draw();return;}
  busy=true;controls();status.textContent='Searching every original record…';
  const found=[];
  let yieldAfter=performance.now()+12;
  try{
   for(let i=0;i<lines.length;i++){
    if(request!==generation)return;
    // Only the current original row is decoded; matches retain integer positions.
    const row=JSON.parse(lines[i]);
    if(row.search_values.some(value=>(sensitive?value:value.toLowerCase()).includes(needle)))found.push(i);
    if(performance.now()>=yieldAfter){
     status.textContent='Searched '+(i+1)+' of '+lines.length+' original records; '+found.length+' matches so far.';
     await new Promise(resolve=>setTimeout(resolve,0));
     yieldAfter=performance.now()+12;
    }
   }
   if(request!==generation)return;
   matching=found;start=0;busy=false;draw();
  }catch(failure){
   if(request!==generation)return;
   busy=false;draw('The previous complete result remains visible.');
   error.textContent='An original record could not be read. Keep the complete original file and JSONL export, then create a fresh HTML export.';
  }
 }
 q('#search').addEventListener('submit',event=>{void search(event);});
 q('#cancel-search').addEventListener('click',()=>{
  generation++;busy=false;draw('Search canceled. The previous complete result is retained.');
 });
 for(const button of pager())button.addEventListener('click',()=>{
  if(busy)return;
  start=button.dataset.offlinePage==='previous'?Math.max(0,start-pageSize):start+pageSize;
  draw();
 });
 q('#page-size').addEventListener('change',()=>{
  const selected=Number(q('#page-size').value);
  if(![50,100,250].includes(selected))return;
  pageSize=selected;start=Math.floor(start/pageSize)*pageSize;draw();
 });
 q('#mode').addEventListener('change',()=>{if(!busy)draw();});
 q('#jump').addEventListener('submit',event=>{
  event.preventDefault();if(busy||!count())return;
  const target=Number(q('#original-row').value);
  if(!Number.isSafeInteger(target)||target<1){error.textContent='Choose a positive original row number.';return;}
  error.textContent='';
  // Search the retained original row positions, never a reconstructed heading.
  let left=0,right=count();
  while(left<right){const middle=Math.floor((left+right)/2);const row=JSON.parse(lines[sourceIndex(middle)]).row;
   if(row<target)left=middle+1;else right=middle;}
  const position=Math.min(left,count()-1),actual=JSON.parse(lines[sourceIndex(position)]).row;
  start=Math.floor(position/pageSize)*pageSize;
  draw(actual===target?'Original row '+target+' is on this page.':(actual>target?'Next matching original row: ':'Last matching original row: ')+actual+'.');
  const region=q('#table .ci-original-grid');if(region)region.focus({preventScroll:true});
 });
 try{draw();}catch(failure){
  error.textContent='This HTML export is incomplete. Keep the complete original file and create a fresh export.';
  busy=false;controls();
 }
}

export function createOriginalTableReader(host){
 let active=null,serial=0;
 const valid=state=>active===state&&state.dialog.isConnected&&host.getWorkspace()===state.workspace;
 function close(){serial++;if(active){active.events.abort();active.dialog.close();active.dialog.remove();active=null;}}
 function save(name,value,type='application/json'){const url=URL.createObjectURL(new Blob([value],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function safeURL(url){if(typeof url!=='string'||!url.startsWith('/api/')||url.startsWith('//'))throw Error('The retained export did not provide an original local download route.');return url;}
 async function open(input){
  close();
  const dialog=document.createElement('dialog'),events=new AbortController();
  dialog.className='ci-original-dialog';
  const state={...input,dialog,events,request:0,page:null,history:[],pending:null,mode:'displayed',busy:false};
  active=state;
  dialog.innerHTML='<header><div><h2>Read every original row</h2><p>'+esc(input.title)+'</p></div><button type="button" data-cr-close aria-label="Close original table">Close</button></header>'+
   '<p class="ci-row-source">'+esc(input.original?.filename||'Retained original')+' · SHA-256 '+esc(input.original?.sha256||'')+'</p>'+
   '<form data-cr-search><label>Search original values<input name="query" type="search" maxlength="2000"></label><label class="ci-row-check"><input type="checkbox" name="case_sensitive">Case sensitive</label>'+
   '<label>First original row<input name="start_row" type="number" min="1" step="1" value="'+esc(input.startRow??input.headerRow+1)+'"></label>'+
   '<label>Rows per page<select name="page_size"><option>50</option><option selected>100</option><option>250</option></select></label>'+
   '<button type="submit">Read rows</button><button type="button" data-cr-first>Include original notes and heading</button></form>'+
   '<div class="ci-actions"><label>Cell values<select data-cr-mode><option value="displayed">Selected-reader values</option><option value="stored">Stored values</option></select></label>'+
   '<button type="button" data-cr-prev>Previous page</button><button type="button" data-cr-next>Next page</button>'+
   '<button type="button" data-cr-page>Download complete current page</button><button type="button" data-cr-export>Export every original row</button></div>'+
   '<p data-cr-status role="status" aria-live="polite"></p><p data-cr-error role="alert" class="ci-error"></p>'+
   '<button type="button" data-cr-retry hidden>Retry this original read</button><div data-cr-downloads class="ci-downloads"></div><div data-cr-body></div>';
  document.body.append(dialog);dialog.showModal();
  const q=selector=>dialog.querySelector(selector),form=q('[data-cr-search]');
  const changed=()=>{if(!valid(state))return;dialog.setAttribute('aria-busy',String(state.busy));for(const node of dialog.querySelectorAll('button,input,select'))if(!node.hasAttribute('data-cr-close'))node.disabled=state.busy;
   if(!state.busy){q('[data-cr-prev]').disabled=!state.history.length;q('[data-cr-next]').disabled=!state.page?.has_more;q('[data-cr-page]').disabled=!state.page;}}
  const requestFromForm=(start=null)=>({id:input.inspectionId,file_index:input.fileIndex,part_index:input.partIndex,start_row:start??Number(form.elements.start_row.value),page_size:Number(form.elements.page_size.value),query:form.elements.query.value,case_sensitive:form.elements.case_sensitive.checked});
  async function load(request,{history='reset'}={}){
   if(!valid(state)||state.busy)return;
   const version=++serial;state.request=version;state.pending={request:{...request},history};state.busy=true;q('[data-cr-error]').textContent='';q('[data-cr-retry]').hidden=true;q('[data-cr-status]').textContent='Reading the retained original rows…';changed();
   try{
    const page=await host.api('/api/client-source/rows',{method:'POST',body:{workspace:state.workspace,...request}});
    if(!valid(state)||state.request!==version)return;
    if(page.schema!=='upstate.client-source-rows/v1'||page.inspection_id!==input.inspectionId||page.file_index!==input.fileIndex||page.part_index!==input.partIndex||page.original?.sha256!==input.original?.sha256)throw Error('The returned page belongs to a different original source.');
    if(history==='reset')state.history=[];else if(history==='next'&&state.page)state.history.push(state.page.start_row);else if(history==='previous')state.history.pop();
    state.page=page;state.pageRequest={...request};form.elements.start_row.value=String(page.start_row);q('[data-cr-body]').innerHTML=originalRowsTable(page,state.mode);
    q('[data-cr-status]').textContent=page.rows.length+' original rows shown. '+(page.total_original_rows===null?'Further original rows remain.':'Original file contains '+page.total_original_rows+' reader records.')+' '+page.source_note;
   }catch(error){if(valid(state)&&state.request===version){q('[data-cr-error]').textContent=error.message||String(error);q('[data-cr-status]').textContent=state.page?'The previously read page remains visible.':'The original source and current intake choices remain saved.';q('[data-cr-retry]').hidden=false;}}
   finally{if(valid(state)&&state.request===version){state.busy=false;changed();}}
  }
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();},{signal:events.signal});
  q('[data-cr-close]').addEventListener('click',close,{signal:events.signal});
  form.addEventListener('submit',event=>{event.preventDefault();void load(requestFromForm());},{signal:events.signal});
  q('[data-cr-first]').addEventListener('click',()=>{form.elements.start_row.value='1';void load(requestFromForm(1));},{signal:events.signal});
  q('[data-cr-next]').addEventListener('click',()=>{if(state.page?.has_more)void load({...state.pageRequest,start_row:state.page.next_row},{history:'next'});},{signal:events.signal});
  q('[data-cr-prev]').addEventListener('click',()=>{if(state.history.length)void load({...state.pageRequest,start_row:state.history.at(-1)},{history:'previous'});},{signal:events.signal});
  q('[data-cr-mode]').addEventListener('change',()=>{state.mode=q('[data-cr-mode]').value;if(state.page)q('[data-cr-body]').innerHTML=originalRowsTable(state.page,state.mode);},{signal:events.signal});
  q('[data-cr-retry]').addEventListener('click',()=>{if(state.pending)void load(state.pending.request,{history:state.pending.history});},{signal:events.signal});
  q('[data-cr-page]').addEventListener('click',()=>{if(state.page)save('Original_Table_Page.json',JSON.stringify(state.page,null,2)+'\n');},{signal:events.signal});
  q('[data-cr-export]').addEventListener('click',async()=>{
   if(!valid(state)||state.busy)return;const version=++serial;state.request=version;state.busy=true;changed();q('[data-cr-error]').textContent='';q('[data-cr-status]').textContent='Exporting every row from the retained original table…';
   try{
    const result=await host.api('/api/client-source/table-export',{method:'POST',body:{workspace:state.workspace,id:input.inspectionId,file_index:input.fileIndex,part_index:input.partIndex}});
    if(!valid(state)||state.request!==version)return;
    if(result.original?.sha256!==input.original?.sha256||result.inspection_id!==input.inspectionId||result.file_index!==input.fileIndex||result.part_index!==input.partIndex)throw Error('The exported table belongs to a different original source.');
    q('[data-cr-downloads]').innerHTML=arr(result._downloads).map(item=>'<a href="'+esc(safeURL(item.url))+'" download>'+esc(item.label||item.filename)+'</a>').join(' ');
    q('[data-cr-status]').textContent='Exported all '+result.total_original_rows+' original reader records, including notes, heading and blank records. The offline HTML contains every row and works without the server; JSONL preserves cell metadata and CSV preserves selected-reader values.';
   }catch(error){if(valid(state)&&state.request===version){q('[data-cr-error]').textContent=error.message||String(error);q('[data-cr-status]').textContent='The original table and current page remain saved. Use Export every original row to retry.';}}
   finally{if(valid(state)&&state.request===version){state.busy=false;changed();}}
  },{signal:events.signal});
  await load(requestFromForm());
 }
 return {open,close};
}

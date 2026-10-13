/** Read exact retained synthesis evidence without changing the authored working copy. */
export const EVIDENCE_PAGE_ROWS=50;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone=v=>JSON.parse(JSON.stringify(v));
const scalar=v=>v===null?'null':typeof v==='string'?v:JSON.stringify(v);
const token=v=>JSON.stringify(v);
const object=v=>v!==null&&typeof v==='object';
const label=v=>String(v).replaceAll('_',' ');
const pointer=parts=>parts.map(x=>'/'+String(x).replaceAll('~','~0').replaceAll('/','~1')).join('');
function locate(value,path){for(const part of path){if(!object(value)||!Object.hasOwn(value,part))throw Error('Choose an original retained value.');value=value[part];}return value;}
export function resolveEvidence(catalog,id){
 if(!catalog||catalog.schema!=='upstate.scientific-synthesis-catalog/v1'||!Array.isArray(catalog.references)||!Array.isArray(catalog.sources))throw Error('Open the complete retained reference catalog.');
 const refs=catalog.references.filter(r=>r.id===id);if(refs.length!==1)throw Error('The exact reference is missing or ambiguous.');
 const reference=refs[0],sources=catalog.sources.filter(s=>s.source_collection_id===reference.source_collection_id&&s.source_id===reference.source_id);
 if(sources.length!==1||sources[0].body_sha256!==reference.body_sha256)throw Error('The reference belongs to another retained source edition.');
 return {reference,source:sources[0],catalog_sha256:catalog.catalog_sha256};
}
export function evidencePacket(catalog,id){
 const {reference,source,catalog_sha256}=resolveEvidence(catalog,id);
 return {schema:'upstate.scientific-synthesis-evidence/v1',catalog_sha256,source:clone(source),reference:clone(reference)};
}
export function referenceEvidenceHTML(reference){
 return '<details class="synthesis-evidence" data-synthesis-evidence="'+esc(reference.id)+'"><summary>Read '+esc(reference.kind==='figure'?'original figure and values':reference.kind==='member'?'original file details':'retained '+reference.kind)+'</summary><div data-evidence-body></div></details>';
}
export function tableWindow(block,{page=0,query=''}={}){
 if(!block||block.kind!=='table'||!Array.isArray(block.columns)||!Array.isArray(block.rows))throw Error('Choose an original retained table.');
 const words=String(query).toLocaleLowerCase().trim().split(/\s+/).filter(Boolean),indexed=block.rows.map((row,index)=>({row,index}));
 const matching=indexed.filter(({row})=>words.every(word=>scalar(row).toLocaleLowerCase().includes(word))),pages=Math.max(1,Math.ceil(matching.length/EVIDENCE_PAGE_ROWS));
 page=Math.min(Math.max(0,Number.isSafeInteger(page)?page:0),pages-1);
 return {columns:block.columns,rows:matching.slice(page*EVIDENCE_PAGE_ROWS,(page+1)*EVIDENCE_PAGE_ROWS),total:block.rows.length,matching:matching.length,page,pages};
}
const action=(name,text,extra='',disabled=false)=>'<button type="button" data-evidence-action="'+name+'" '+extra+(disabled?' disabled':'')+'>'+esc(text)+'</button>';
function pathButton(path,title){return action('path',title,'data-evidence-path="'+esc(token(path))+'"');}
function controls(page,pages,extra=''){
 return '<div class="inline-actions">'+action('page','Previous rows','data-evidence-page="'+(page-1)+'" '+extra,page===0)+'<span>Page '+(page+1)+' of '+pages+'</span>'+action('page','Next rows','data-evidence-page="'+(page+1)+'" '+extra,page===pages-1)+'</div>';
}
export function renderEvidenceValue(content,{path=[],page=0,query=''}={}){
 const value=locate(content,path),back=path.length?'<p>'+pathButton(path.slice(0,-1),'Back to enclosing value')+' <code>'+esc(pointer(path))+'</code></p>':'';
 if(!object(value))return back+'<p class="evidence-text">'+esc(scalar(value))+'</p>';
 if(Array.isArray(value)&&value.length===2&&typeof value[0]==='string'&&Array.isArray(value[1])){
  const blocks=value[1],pages=Math.max(1,Math.ceil(blocks.length/EVIDENCE_PAGE_ROWS));
  page=Math.min(Math.max(0,Number.isSafeInteger(page)?page:0),pages-1);
  return back+'<h4>'+esc(value[0])+'</h4>'+blocks.slice(page*EVIDENCE_PAGE_ROWS,(page+1)*EVIDENCE_PAGE_ROWS).map((block,index)=>{
   const at=page*EVIDENCE_PAGE_ROWS+index;
   if(typeof block==='string')return '<p class="evidence-text">'+esc(block)+'</p>';
   const title=block?.kind==='table'?'Read original table — '+(Array.isArray(block.rows)?block.rows.length:0)+' rows':block?.kind==='links'?'Read original file references':'Read complete original block '+(at+1);
   return '<section><p>'+esc(block?.caption||'')+'</p>'+pathButton([...path,1,at],title)+'</section>';
  }).join('')+controls(page,pages);
 }
 if(value.kind==='table'&&Array.isArray(value.columns)&&Array.isArray(value.rows)){
  const view=tableWindow(value,{page,query});
  return back+(value.caption?'<p class="evidence-text">'+esc(scalar(value.caption))+'</p>':'')+
   '<label>Find in these original rows<input type="search" data-evidence-query value="'+esc(query)+'"></label><p>'+view.matching+' of '+view.total+' original rows'+(view.rows.length?' · rows '+(view.page*EVIDENCE_PAGE_ROWS+1)+'–'+(view.page*EVIDENCE_PAGE_ROWS+view.rows.length)+' in this view':'')+'. Values and source row positions are unchanged.</p>'+
   '<div class="table-scroll" tabindex="0" role="region" aria-label="Retained evidence table"><table><thead><tr><th scope="col">Source row</th>'+view.columns.map(v=>'<th scope="col">'+esc(scalar(v))+'</th>').join('')+'</tr></thead><tbody>'+
   view.rows.map(({row,index})=>'<tr><th scope="row">'+(index+1)+'</th>'+(Array.isArray(row)?row:[row]).map((v,j)=>'<td class="evidence-text">'+(object(v)?pathButton([...path,'rows',index,j],'Read complete cell'):esc(scalar(v)))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+controls(view.page,view.pages)+
   '<details><summary>Complete table fields</summary>'+Object.keys(value).filter(k=>!['kind','columns','rows','caption'].includes(k)).map(k=>'<p>'+pathButton([...path,k],label(k))+'</p>').join('')+'</details>';
 }
 const entries=Array.isArray(value)?value.map((v,i)=>[i,v]):Object.entries(value),pages=Math.max(1,Math.ceil(entries.length/EVIDENCE_PAGE_ROWS));
 page=Math.min(Math.max(0,Number.isSafeInteger(page)?page:0),pages-1);
 const list=entries.slice(page*EVIDENCE_PAGE_ROWS,(page+1)*EVIDENCE_PAGE_ROWS);
 return back+'<p>'+entries.length+' retained '+(Array.isArray(value)?'items':'fields')+'. All values remain in their original order.</p>'+
  '<dl class="evidence-values">'+list.map(([name,v])=>'<dt>'+esc(Array.isArray(value)?'Item '+(Number(name)+1):label(name))+'</dt><dd>'+
   (object(v)?pathButton([...path,name],Array.isArray(v)?'Read all '+v.length+' items':'Read complete '+label(v.kind||v.title||v.heading||name)):'<span class="evidence-text">'+esc(scalar(v))+'</span>')+'</dd>').join('')+'</dl>'+controls(page,pages);
}
export function attachSynthesisEvidence({getCatalog,openSource,download,notify}){
 let root=null,serial=0;const states=new WeakMap();
 function state(details){let s=states.get(details);if(!s){s={path:[],page:0,query:'',error:''};states.set(details,s);}return s;}
 function context(details){const catalog=getCatalog(),bound=resolveEvidence(catalog,details.dataset.synthesisEvidence);return {catalog,...bound};}
 function render(details){
  if(!details.isConnected||!details.open)return;
  const target=details.querySelector('[data-evidence-body]'),s=state(details);
  try{
   const {reference:r,source}=context(details);
   target.innerHTML='<p><strong>'+esc(r.title)+'</strong> · '+esc(source.title||source.source_id)+'</p>'+
    '<p class="note">Read the retained evidence before selecting its reference above. Viewing and downloading do not change the authored chapter.</p>'+
    '<div class="inline-actions">'+action('source','Open original study, figures and files')+action('download','Download complete reference and source')+'</div>'+
    (r.kind==='figure'?'<p>The original rendered figure opens in the study reader. The fields below retain its exact supplied specification and data; no values are recalculated.</p>':'')+
    '<details><summary>Original edition and member identity</summary><dl class="evidence-values">'+
     [['Collection',r.source_collection_id],['Source',r.source_id],['Source SHA256',r.body_sha256],['Member',r.member_path],['Member SHA256',r.member_sha256],['Original pointer',r.pointer],...(r.asset_path?[['Figure file',r.asset_path],['Figure SHA256',r.asset_sha256]]:[])].map(([k,v])=>'<dt>'+esc(k)+'</dt><dd><code>'+esc(v)+'</code></dd>').join('')+'</dl></details>'+
    '<div data-evidence-value>'+renderEvidenceValue(r.content,s)+'</div><p data-evidence-status role="status">'+esc(s.error)+'</p>'+
    '<details><summary>Original machine-readable reference</summary><pre>'+esc(JSON.stringify(r,null,2))+'</pre></details>';
  }catch(reason){target.innerHTML='<p class="error" role="alert">'+esc(reason.message)+'</p>';}
 }
 function mount(element){
  if(root===element)return;if(root)throw Error('Keep one evidence reader in its original synthesis pane.');root=element;
  root.addEventListener('toggle',event=>{const details=event.target;if(details.matches?.('[data-synthesis-evidence]')&&details.open)render(details);},true);
  root.addEventListener('click',event=>{
   const button=event.target.closest('[data-evidence-action]'),details=button?.closest('[data-synthesis-evidence]');
   if(!button||!details||!root.contains(details))return;event.preventDefault();event.stopPropagation();
   const s=state(details),operation=button.dataset.evidenceAction;
   (async()=>{
    const {catalog,reference,source}=context(details);
    if(operation==='source'){
     const ticket=++serial,capturedRoot=root;
     const isCurrent=()=>ticket===serial&&root===capturedRoot&&details.isConnected&&details.open&&getCatalog()===catalog;
     if(typeof openSource!=='function')throw Error('Open the original study through the installed Sources reader.');
     s.error='Opening the original study…';details.querySelector('[data-evidence-status]').textContent=s.error;
     try{await openSource({...source},{isCurrent});if(isCurrent()){s.error='';details.querySelector('[data-evidence-status]').textContent='Original study opened below; your complete chapter remains here.';}}
     catch(reason){if(isCurrent())throw reason;}return;
    }
    if(operation==='download'){download('scientific-synthesis-evidence-'+reference.id+'.json',evidencePacket(catalog,reference.id));return;}
    if(operation==='path'){s.path=JSON.parse(button.dataset.evidencePath);s.page=0;s.query='';}
    else if(operation==='page')s.page=Number(button.dataset.evidencePage);
    else return;
    s.error='';render(details);
   })().catch(reason=>{if(details.isConnected&&getCatalog()){s.error=reason.message||String(reason);const status=details.querySelector('[data-evidence-status]');if(status)status.textContent=s.error;notify?.(s.error);}});
  });
  root.addEventListener('input',event=>{
   const input=event.target;if(!input.matches?.('[data-evidence-query]'))return;
   const details=input.closest('[data-synthesis-evidence]');if(!details)return;
   const s=state(details),start=input.selectionStart,end=input.selectionEnd;s.query=input.value;s.page=0;render(details);
   const replacement=details.querySelector('[data-evidence-query]');replacement?.focus();if(replacement&&start!==null)try{replacement.setSelectionRange(start,end);}catch{}
  });
 }
 function invalidate(){serial++;}
 function reset(){invalidate();root=null;}
 return {mount,invalidate,reset};
}

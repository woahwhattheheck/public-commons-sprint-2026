/** Release-specific saved review branches using the original Spatial records. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,attrs='')=>'<button type="button" data-atlas-review-action="'+action+'" '+attrs+'>'+esc(label)+'</button>';
const short=value=>String(value||'').slice(0,16);
const saveFile=(name,body,type)=>{
 const url=URL.createObjectURL(new Blob([body],{type})),link=document.createElement('a');
 link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
const csvCell=value=>{
 let text=String(value??'');if(/^[=+\-@\t\r]/.test(text))text="'"+text;
 return '"'+text.replaceAll('"','""')+'"';
};
export function createAtlasReviewCollection({getWorkspace,getDelivery,getData,request,openReview,prepareRelease,openItem}){
 const retained=new Map();let root=null,current=null,controller=null,epoch=0;
 const key=()=>{const d=getDelivery();return ['complete','received_snapshot'].includes(d?.state)?getWorkspace()+'/'+d.id:'';};
 const signature=()=>JSON.stringify([(getData()?.spatial_reviews||[]).map(row=>row.id),
  (getData()?.spatial_exports||[]).map(row=>[row.id,row.state])]);
 function model(){
  const id=key();if(!id)return null;
  if(!retained.has(id))retained.set(id,{key:id,workspace:getWorkspace(),delivery:getDelivery().id,collection:null,loading:false,error:'',selectedReviews:new Set(),selectedExports:new Set(),selected:false,signature:''});
  return retained.get(id);
 }
 function valid(m,requestEpoch){return root&&m===current&&m.key===key()&&epoch===requestEpoch;}
 function render(){
  if(!root||!current)return;
  const m=current,collection=m.collection,rows=collection?.reviews||[];
  const heads=rows.filter(row=>row.is_head),count=heads.filter(row=>row.context.status==='open').length;
  root.innerHTML='<h3>Saved atlas reviews</h3><p class="atlas-note">Each saved finding keeps its original sheet or pair, geographic view, annotations and revision history. Reopen a revision to address a finding; saving creates its successor.</p>'+
   '<div class="atlas-actions">'+button('refresh',m.loading?'Refreshing…':'Refresh reviews',m.loading?'disabled':'')+
   (rows.length?button('csv','Download review log CSV')+button('json','Download review collection JSON'):'')+'</div>'+
   (m.error?'<p class="atlas-error" role="alert">'+esc(m.error)+'</p>':'')+
   (collection?.export_issues||[]).map(item=>'<p class="atlas-error">Map export '+esc(short(item.id))+': '+esc(item.message)+'</p>').join('')+
   (!collection?'<p class="atlas-note">Loading this release’s saved reviews…</p>':!rows.length?'<p class="atlas-note">Use Inspect pixels and geography or Open paired inspection, enter a finding, and Save review. Its completed revision will appear here. Earlier unlinked reviews remain available in the global Spatial review list.</p>':
   '<p>'+heads.length+' current revision'+(heads.length===1?'':'s')+' · '+count+' open · '+rows.length+' total saved revision'+(rows.length===1?'':'s')+'</p>'+
   '<div class="atlas-table"><table><thead><tr><th>Include</th><th>Finding and history</th><th>Disposition</th><th>Original maps</th><th>Map packs</th><th></th></tr></thead><tbody>'+
   rows.map(row=>{
    const context=row.context,origin=context.origin;
    const panels=origin.panels.map(item=>item.map_key+' / panel '+(item.panel_index+1)).join(' · ');
    return '<tr><td><input type="checkbox" data-atlas-review-select="review" value="'+esc(row.id)+'" aria-label="Include '+esc(row.title)+'" '+(m.selectedReviews.has(row.id)?'checked ':'')+(row.issue?'disabled':'')+'></td>'+
     '<td><strong>'+esc(row.title)+'</strong><small>Revision '+row.revision_depth+(row.is_head?' · current branch':' · superseded')+' · '+short(row.id)+'</small>'+
     (row.previous_review_id?'<small>Previous '+short(row.previous_review_id)+'</small>':'')+
     '<details><summary>Revision history</summary><ol>'+row.history.map((id,i)=>'<li>'+button('open','Open revision '+(i+1)+' · '+short(id),'data-id="'+esc(id)+'"')+'</li>').join('')+'</ol></details></td>'+
     '<td>'+esc(context.status)+'<small>'+esc(context.reviewer||'Reviewer not entered')+'</small><p>'+esc(context.comment||'No finding entered.')+'</p>'+
     (row.issue?'<p class="atlas-error">'+esc(row.issue)+'</p>':'')+'</td>'+
     '<td>'+esc(panels)+'<small>'+row.marker_count+' annotations · '+esc(row.mode)+'</small></td>'+
     '<td>'+(row.exports.length?row.exports.map(item=>'<div><label><input type="checkbox" data-atlas-review-select="export" value="'+esc(item.id)+'" aria-label="Include map pack '+esc(short(item.id))+'" '+
      (m.selectedExports.has(item.id)?'checked ':'')+(item.state!=='complete'||row.issue?'disabled':'')+'> '+esc(item.paper.toUpperCase())+' / '+item.dpi+' DPI · '+esc(item.state)+'</label>'+
      (item.issue?'<p class="atlas-error">'+esc(item.issue)+'</p>':button('export','Open map pack','data-id="'+esc(item.id)+'"'))+'</div>').join(''):'<small>Open this review to export its annotated map pack.</small>')+'</td>'+
     '<td>'+button('open','Open saved review','data-id="'+esc(row.id)+'" '+(row.issue?'disabled':''))+'</td></tr>';
   }).join('')+'</tbody></table></div>'+
   '<div class="atlas-actions">'+button('prepare','Prepare release with selected reviews',(!m.selectedReviews.size&&!m.selectedExports.size)?'disabled':'')+'</div>'+
   '<p class="atlas-note">The preparation form retains the model cohort and map settings. Selected original review records and completed map packs travel in the existing GIS delivery and offline file catalogue.</p>');
 }
 async function refresh(){
  const m=current;if(!m)return;
  controller?.abort();controller=new AbortController();const signal=controller.signal,version=++epoch;
  m.loading=true;m.error='';render();
  try{
   const result=await request('/api/map-atlas/reviews',{method:'POST',body:{workspace:m.workspace,delivery_id:m.delivery},signal});
   if(!valid(m,version)||signal.aborted)return;
   const value=result.collection;
   if(result.workspace_key!==m.workspace||value?.delivery_id!==m.delivery||value?.schema!=='upstate.atlas-review-collection/v1')throw Error('The saved reviews belong to another atlas release.');
   m.collection=value;m.signature=signature();
   if(!m.selected){
    m.selected=true;
    for(const row of value.reviews.filter(row=>row.is_head&&!row.issue)){
     m.selectedReviews.add(row.id);
     const exports=row.exports.filter(item=>item.state==='complete').sort((a,b)=>String(b.completed_at||'').localeCompare(String(a.completed_at||'')));
     if(exports[0])m.selectedExports.add(exports[0].id);
    }
   }
   const ids=new Set(value.reviews.filter(row=>!row.issue).map(row=>row.id));
   const exportIds=new Set(value.reviews.filter(row=>!row.issue).flatMap(row=>row.exports.filter(item=>item.state==='complete').map(item=>item.id)));
   m.selectedReviews=new Set([...m.selectedReviews].filter(id=>ids.has(id)));
   m.selectedExports=new Set([...m.selectedExports].filter(id=>exportIds.has(id)));
  }catch(error){if(valid(m,version)&&!signal.aborted)m.error=error.message||String(error);}
  finally{if(valid(m,version)){m.loading=false;render();}}
 }
 async function click(event){
  const node=event.target.closest('[data-atlas-review-action]');if(!node||!root?.contains(node)||!current)return;
  event.preventDefault();event.stopPropagation();const m=current,action=node.dataset.atlasReviewAction;
  try{
   if(action==='refresh')return refresh();
   if(action==='open')return await openReview(node.dataset.id);
   if(action==='export')return await openItem('spatial_exports',node.dataset.id);
   if(action==='json')return saveFile('atlas-review-collection-'+short(m.delivery)+'.json',JSON.stringify(m.collection,null,2)+'\n','application/json');
   if(action==='csv'){
    const rows=[['review_id','previous_review_id','current_branch','title','reviewer','status','finding','atlas_delivery_id','atlas_index_sha256','panels','annotation_count','map_export_ids']];
    for(const row of m.collection.reviews)rows.push([row.id,row.previous_review_id,row.is_head,row.title,row.context.reviewer,row.context.status,row.context.comment,m.delivery,row.context.origin.atlas_index_sha256,JSON.stringify(row.context.origin.panels),row.marker_count,row.exports.map(item=>item.id).join(';')]);
    return saveFile('atlas-review-log-'+short(m.delivery)+'.csv',rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n','text/csv;charset=utf-8');
   }
   if(action==='prepare'){
    const rows=m.collection.reviews,selectedExports=rows.flatMap(row=>row.exports.map(item=>({...item,review_id:row.id}))).filter(item=>m.selectedExports.has(item.id)&&item.state==='complete');
    const reviewIds=[...new Set([...m.selectedReviews,...selectedExports.map(item=>item.review_id)])];
    if(!reviewIds.length)throw Error('Select a saved review or completed map pack to include.');
    return await prepareRelease({workspace:m.workspace,delivery_id:m.delivery,
     review_ids:reviewIds,export_ids:selectedExports.map(item=>item.id),
     all_review_ids:rows.map(row=>row.id),all_export_ids:rows.flatMap(row=>row.exports.map(item=>item.id))});
   }
  }catch(error){if(current===m){m.error=error.message||String(error);render();}}
 }
 function change(event){
  const node=event.target.closest('[data-atlas-review-select]');if(!node||!root?.contains(node)||!current)return;
  event.stopPropagation();const set=node.dataset.atlasReviewSelect==='review'?current.selectedReviews:current.selectedExports;
  if(node.checked)set.add(node.value);else set.delete(node.value);render();
 }
 function detach(){controller?.abort();controller=null;epoch++;if(current)current.loading=false;if(root){root.removeEventListener('click',click);root.removeEventListener('change',change);}root=null;current=null;}
 function mount(node){
  if(root===node&&current?.key===key())return update();
  detach();root=node;current=model();if(!root||!current)return;
  root.addEventListener('click',click);root.addEventListener('change',change);render();
  if(!current.collection||current.signature!==signature())refresh();
 }
 function update(){if(root&&current&&current.key===key()&&current.signature!==signature()&&!current.loading)refresh();}
 return {mount,detach,refresh,update};
}

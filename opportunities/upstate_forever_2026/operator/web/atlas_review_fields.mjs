/** Typed review disposition fields within the existing native Spatial editor. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
export function reconcileAtlasReview(model){
 const context=model.atlas_review;if(!context)return;
 const current=[model.primary];if(model.comparison)current.push(model.comparison);
 if(!same(current,context.origin?.sources)){
  model.atlas_review=null;model.previous_review_id=null;model.pendingSave=null;
  if(model.exportOptions)model.exportOptions.review_id='';
  model.dirty=true;
 }
}
export function renderAtlasReview(root,model){
 reconcileAtlasReview(model);
 const node=root.querySelector('[data-spatial-atlas-review]');if(!node)return;
 const context=model.atlas_review,identity=JSON.stringify(context?.origin||null);
 if(node.dataset.origin===identity&&node.contains(document.activeElement))return;
 node.dataset.origin=identity;
 if(!context){node.innerHTML='';return;}
 const field=(label,body)=>'<label class="spatial-field"><span>'+label+'</span>'+body+'</label>';
 node.innerHTML='<h3>Atlas review finding</h3><p class="note">Saved with release <code>'+esc(context.origin.delivery_id.slice(0,16))+'</code>. Changes create an immutable review revision.</p>'+
  field('Reviewer','<input data-spatial-input="atlas-reviewer" maxlength="240" value="'+esc(context.reviewer)+'">')+
  field('Disposition','<select data-spatial-input="atlas-status">'+['open','addressed','closed'].map(value=>'<option value="'+value+'"'+(value===context.status?' selected':'')+'>'+value[0].toUpperCase()+value.slice(1)+'</option>').join('')+'</select>')+
  field('Finding or resolution','<textarea data-spatial-input="atlas-comment" maxlength="4000" rows="4">'+esc(context.comment)+'</textarea>')+
  '<p class="note">Selecting different source rasters starts an independent review. Map extent, annotations, overlays and display settings remain editable.</p>';
}
export function editAtlasReview(model,node){
 const key={'atlas-reviewer':'reviewer','atlas-status':'status','atlas-comment':'comment'}[node.dataset.spatialInput];
 if(!key||!model.atlas_review)return false;
 model.atlas_review[key]=node.value;return true;
}

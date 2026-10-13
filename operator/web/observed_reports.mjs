/* Ordered original observed-study selection for the existing native delivery form. */
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const key=choice=>JSON.stringify([choice.source_collection_id,choice.source_id]);

export function selectedObservedReports(selection={}){
 const explicit=selection?.observed_context_sources,primary=selection?.source_roles?.OBSERVED_CONTEXT;
 const rows=Object.prototype.hasOwnProperty.call(selection||{},"observed_context_sources")?explicit:(primary?[primary]:[]);
 if(!Array.isArray(rows))throw Error("Observed report selections must be an ordered list.");
 const seen=new Set();
 return rows.map(row=>{
  if(!row||typeof row.source_collection_id!=="string"||typeof row.source_id!=="string"||!row.source_collection_id.trim()||!row.source_id.trim())throw Error("Select an original source collection and report document.");
  const result={source_collection_id:row.source_collection_id,source_id:row.source_id},id=key(result);
  if(seen.has(id))throw Error("Select each original observed report once.");
  seen.add(id);return result;
 });
}

export function observedReportCatalogue(collections=[]){
 const rows=[],seen=new Set();
 for(const collection of collections)for(const entry of collection.entries||[]){
  if(entry.kind!=="document"||entry.metadata?.report_schema!=="upstate.observed-report/v1")continue;
  const choice={source_collection_id:collection.id,source_id:entry.id},id=key(choice);
  if(seen.has(id))continue;seen.add(id);
  rows.push({key:id,choice,title:entry.title||entry.id,vintage:entry.vintage||"",collection:collection.title||collection.id});
 }
 return rows;
}

export function mountObservedReports(host,collections,initial={}){
 if(!host)throw Error("Observed study selection needs its delivery form.");
 const catalogue=observedReportCatalogue(collections),byKey=new Map(catalogue.map(x=>[x.key,x]));
 let selected=selectedObservedReports(initial);
 function render(){
  const ids=new Set(selected.map(key)),available=catalogue.filter(x=>!ids.has(x.key));
  const rows=selected.map((choice,index)=>{
   const item=byKey.get(key(choice)),title=item?.title||choice.source_id;
   return '<li style="padding:12px 0;border-bottom:1px solid #ddd"><div><strong>'+escape(title)+'</strong><small style="display:block">'+escape(item?[item.vintage,item.collection].filter(Boolean).join(" · "):"Retained selection is unavailable in the current Workspace")+'</small></div><div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px"><button type="button" data-observed-action="up" data-index="'+index+'"'+(index===0?' disabled':'')+' aria-label="'+escape("Move "+title+" earlier")+'">Move up</button><button type="button" data-observed-action="down" data-index="'+index+'"'+(index===selected.length-1?' disabled':'')+' aria-label="'+escape("Move "+title+" later")+'">Move down</button><button type="button" data-observed-action="remove" data-index="'+index+'" aria-label="'+escape("Remove "+title)+'">Remove</button></div></li>';
  }).join("");
  host.innerHTML='<fieldset><legend>Scientific study reports</legend><p class="note">Add retained study reports in the order they should appear. Their original sections, figures, measurements and source files travel with the complete scientific delivery.</p>'+(rows?'<ol style="padding-left:24px">'+rows+'</ol>':'<p class="note">Choose the original observed studies to include with this delivery.</p>')+'<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end"><label style="flex:1;min-width:220px">Available retained study<select data-observed-available'+(!available.length?' disabled':'')+'>'+(!available.length?'<option value="">'+(catalogue.length?'All available studies are selected':'Import an observed report source collection to select it')+'</option>':available.map(x=>'<option value="'+escape(x.key)+'">'+escape(x.title+(x.vintage?" · "+x.vintage:""))+'</option>').join(""))+'</select></label><button type="button" data-observed-action="add"'+(!available.length?' disabled':'')+'>Add study</button></div><p class="note">'+selected.length+' selected '+(selected.length===1?'study':'studies')+'. Existing modeled results and observed-load comparisons keep their selected settings.</p></fieldset>';
 }
 host.addEventListener("click",event=>{
  const button=event.target.closest("[data-observed-action]");
  if(!button||!host.contains(button)||button.disabled)return;
  const action=button.dataset.observedAction,index=Number(button.dataset.index);
  if(action==="add"){
   const item=byKey.get(host.querySelector("[data-observed-available]").value);
   if(item&&!selected.some(row=>key(row)===item.key))selected.push({...item.choice});
  }else if(Number.isInteger(index)&&index>=0&&index<selected.length){
   if(action==="remove")selected.splice(index,1);
   else if(action==="up"&&index>0)[selected[index-1],selected[index]]=[selected[index],selected[index-1]];
   else if(action==="down"&&index<selected.length-1)[selected[index+1],selected[index]]=[selected[index],selected[index+1]];
  }
  render();
  const nextIndex=action==="add"?selected.length-1:action==="up"?index-1:action==="down"?index+1:Math.min(index,selected.length-1);
  const focusAction=action==="up"||action==="down"?action:"remove";
  const focus=nextIndex>=0?host.querySelector('[data-observed-action="'+focusAction+'"][data-index="'+nextIndex+'"]'):host.querySelector("[data-observed-available]");
  if(focus&&!focus.disabled)focus.focus({preventScroll:true});
 });
 render();
 return {selection(){
  for(const choice of selected)if(!byKey.has(key(choice)))throw Error("The selected observed report "+choice.source_id+" is unavailable in this Workspace. Restore its original collection or remove that selection.");
  return selected.map(row=>({...row}));
 }};
}

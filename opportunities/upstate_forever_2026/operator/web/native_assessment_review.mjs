/** Import a source-bound native review selection through the existing geography queue. */
const escapeHTML=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const rows=value=>Array.isArray(value)?value:[];
const key=row=>String(row.collection_id)+"/"+String(row.source_id);
const SHA=/^[a-f0-9]{64}$/;
const MAX_BYTES=8*1024*1024;

export function inspectNativeReviewSelection(value) {
  if(!value||value.schema!=="upstate.native-assessment-selection/v1")
    throw Error("Choose the selected-stations JSON exported from the native assessment report.");
  if(!SHA.test(String(value.binding||""))||value.review?.binding!==value.binding)
    throw Error("The selected stations must retain their native report binding.");
  if(value.native_context?.schema!=="upstate.assessment-native-huc-context/v1")
    throw Error("The selection must retain its original native geography context.");
  const stations=rows(value.stations),ids=stations.map(row=>row?.original_native_station?.station_id);
  if(!ids.length||ids.length>159||ids.some(id=>typeof id!=="string"||!id.trim())||
     new Set(ids).size!==ids.length)throw Error("Choose between one and 159 distinct original stations.");
  const selected=rows(value.review?.selected_station_ids);
  if(selected.length!==ids.length||new Set(selected).size!==ids.length||
     selected.some(id=>!ids.includes(id)))throw Error("The review selection and retained station rows differ.");
  const filters=value.review?.filters;
  if(!filters||Array.isArray(filters)||typeof filters!=="object")
    throw Error("The original native review filters are missing.");
  return {station_ids:ids,binding:value.binding,filters,
    assessment_records:stations.reduce((sum,row)=>sum+rows(row.original_native_station?.assessment_records).length,0)};
}

export function attachNativeAssessmentReview({container,host,getWorkspace,submit,onError}) {
  let node=container,workspace=getWorkspace(),sources=[],selectedSource="",title="";
  let file=null,preview=null,uploaded=null,uploading=false,externalBusy=false,error="",version=0;
  const controller=new AbortController();
  const active=(current,generation)=>!!node&&current===workspace&&generation===version&&
    current===getWorkspace()&&current===(host.getWorkspace()||host.getState()?.workspace_key);
  const busy=()=>uploading||externalBusy;
  function render() {
    if(!node)return;
    const focus=node.contains(document.activeElement)?document.activeElement?.getAttribute("data-native-review-field"):null;
    const disabled=busy()?" disabled":"";
    const filters=preview?Object.entries(preview.filters).filter(([,value])=>value!==""&&value!==false&&value!=null):[];
    node.innerHTML='<section class="sg-presets"><h2>Use selected native report stations</h2>'+
      '<p>Build a retained study from the exact stations selected in the native assessment report. The original point sources, selected assessment records and review file travel with the saved study.</p>'+
      (sources.length?'<div class="sg-form-grid"><label>Imported native report<select data-native-review-field="source"'+disabled+'>'+
      '<option value="">Choose the retained report…</option>'+sources.map(row=>'<option value="'+escapeHTML(key(row))+'"'+
        (key(row)===selectedSource?' selected':'')+'>'+escapeHTML(row.title||row.source_id)+' · '+escapeHTML(String(row.source_sha256||"").slice(0,12))+'</option>').join("")+
      '</select></label><label>Study title<input data-native-review-field="title" value="'+escapeHTML(title)+'" maxlength="240"'+disabled+'></label></div>':
      '<p>Import the complete native assessment report edition in Original sources, then refresh this desk.</p>')+
      '<label class="sg-upload">Selected stations JSON<input type="file" data-native-review-field="file" accept=".json,application/json"'+disabled+'></label>'+
      (preview?'<p><strong>'+preview.station_ids.length+' selected stations</strong> · '+preview.assessment_records+' original assessment records · '+escapeHTML(file.name)+'</p>'+
        '<details><summary>Review selected stations and filters</summary><p>'+preview.station_ids.map(escapeHTML).join(", ")+'</p>'+
        (filters.length?'<dl>'+filters.map(([name,value])=>'<dt>'+escapeHTML(name.replaceAll("_"," "))+'</dt><dd>'+escapeHTML(typeof value==="string"?value:JSON.stringify(value))+'</dd>').join("")+'</dl>':'<p>All native stations were visible when this selection was exported.</p>')+'</details>':'')+
      '<p class="sg-error" role="alert"'+(error?'':' hidden')+'>'+escapeHTML(error)+'</p>'+
      '<p class="sg-help">The saved operation checks this file against the retained report before using the original Station geography model. Import the original watershed geometry in the same Workspace.</p>'+
      '<button type="button" data-native-review-action="build"'+(!preview||!selectedSource||busy()?' disabled':'')+'>'+
        (uploading?'Retaining selection…':'Build selected study')+'</button> '+
      '<button type="button" data-native-review-action="sources"'+disabled+'>Open original sources</button></section>';
    if(focus)node.querySelector('[data-native-review-field="'+focus+'"]')?.focus();
  }
  async function chooseFile(selected) {
    const current=workspace,generation=++version;
    file=null;preview=null;uploaded=null;error="";
    if(!selected){render();return;}
    if(selected.size>MAX_BYTES){error="Choose a native selection JSON smaller than 8 MiB.";render();return;}
    uploading=true;render();
    try{
      const value=JSON.parse(await selected.text());
      const next=inspectNativeReviewSelection(value);
      if(!active(current,generation))return;
      file=selected;preview=next;
      if(!title)title="Native review · "+next.station_ids.length+" selected stations";
    }catch(problem){if(active(current,generation))error=problem.message||String(problem);}
    finally{if(active(current,generation)){uploading=false;render();}}
  }
  async function build() {
    if(busy()||!file||!preview)return;
    const source=sources.find(row=>key(row)===selectedSource);
    if(!source){error="Choose the imported native report for this selection.";render();return;}
    const current=workspace,generation=version,chosenFile=file;
    const payload={source_collection_id:source.collection_id,source_id:source.source_id,
      title:title.trim()||"Native review · "+preview.station_ids.length+" selected stations"};
    uploading=true;error="";render();
    try{
      if(!uploaded)uploaded=await host.api("/api/upload",{method:"POST",raw:chosenFile,filename:chosenFile.name});
      if(!active(current,generation))return;
      await submit("station.geography.review-selection",{...payload,upload_id:uploaded.id});
    }catch(problem){
      if(active(current,generation)){error=problem.message||String(problem);onError?.(problem);}
    }finally{if(active(current,generation)){uploading=false;render();}}
  }
  node.addEventListener("change",event=>{
    if(event.target.matches('[data-native-review-field="file"]'))chooseFile(event.target.files?.[0]||null);
    else if(event.target.matches('[data-native-review-field="source"]')){selectedSource=event.target.value;render();}
  },{signal:controller.signal});
  node.addEventListener("input",event=>{
    if(event.target.matches('[data-native-review-field="title"]'))title=event.target.value;
  },{signal:controller.signal});
  node.addEventListener("click",event=>{
    const action=event.target.closest("[data-native-review-action]")?.dataset.nativeReviewAction;
    if(action==="build")build();
    else if(action==="sources"&&!busy())host.navigate("sources");
  },{signal:controller.signal});
  render();
  return {
    update(catalog){
      const next=rows(catalog?.native_review_sources),before=JSON.stringify(sources);
      sources=next;
      if(!sources.some(row=>key(row)===selectedSource))selectedSource=sources.length===1?key(sources[0]):"";
      if(JSON.stringify(sources)!==before)render();
    },
    setBusy(value){externalBusy=Boolean(value);render();},
    detach(){version++;controller.abort();node=null;file=null;preview=null;uploaded=null;}
  };
}

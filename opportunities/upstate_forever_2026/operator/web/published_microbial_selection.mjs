/* Selected original microbial activities enter the maintained Published studies desk. */
const MAX_SELECTION_BYTES=8*1024*1024;
const ACTION="published-study.microbial-selection.prepare";
const sha=/^[0-9a-f]{64}:[0-9a-f]{64}$/;
export function inspectMicrobialSelection(text){
  if(typeof text!=="string"||new TextEncoder().encode(text).length>MAX_SELECTION_BYTES)throw Error("Choose an exported microbial selection no larger than 8 MiB.");
  const value=JSON.parse(text);
  if(value?.schema!=="upstate.microbial-source-selection/v1"||!sha.test(value.binding||"")||
    value.review?.schema!=="upstate.microbial-source-review/v1"||value.review.binding!==value.binding||
    !Array.isArray(value.review.selected_activity_ids)||!Array.isArray(value.observations)||
    !value.observations.length||value.observations.length>10000)
    throw Error("Choose the selected-microbial-source-records.json exported by the retained measured-source report.");
  const ids=value.observations.map(row=>row?.activity_id),declared=value.review.selected_activity_ids,selectedIds=new Set(ids);
  if(ids.some(id=>typeof id!=="string"||!id)||selectedIds.size!==ids.length||new Set(declared).size!==declared.length||
    declared.length!==ids.length||declared.some(id=>!selectedIds.has(id)))
    throw Error("The selection must retain each distinct original activity exactly once.");
  return {binding:value.binding,activities:ids.length,stations:new Set(value.observations.map(row=>row.station_id)).size};
}
const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const sourceKey=row=>row.source_collection_id+"::"+row.source_id;
const copy=value=>value==null?value:JSON.parse(JSON.stringify(value));
export function createPublishedMicrobialSelection(host,course){
  let root=null,events=null,workspace=null,generation=0,busy=false,sources=[],sourceChoice="",selectionText="",fileName="",fileInfo=null;
  let preview=null,previewKey="",page=0,title="",pendingKey="",lastMessage="";
  const drafts=new Map(),q=selector=>root?.querySelector(selector);
  const state=()=>course.context();
  const live=(version,key)=>Boolean(root)&&generation===version&&workspace===key&&state().workspace===key&&host.getWorkspace()===key;
  function message(text,error=false){lastMessage=text;const el=q("[data-ms-status]");if(el){el.textContent=text;el.setAttribute("role",error?"alert":"status");}}
  function remember(){if(workspace)drafts.set(workspace,{sourceChoice,selectionText,fileName,fileInfo:copy(fileInfo),title,pendingKey});}
  function payload(){
    const source=sources.find(row=>sourceKey(row)===sourceChoice);
    if(!source)throw Error("Choose the retained original report edition.");
    if(!selectionText)throw Error("Open the JSON exported for the selected measured activities.");
    return {source_collection_id:source.source_collection_id,source_id:source.source_id,selection_json:selectionText,title:title.trim()||"Selected microbial activities"};
  }
  function key(value){return JSON.stringify(value);}
  function invalidate(){++generation;preview=null;previewKey="";page=0;pendingKey="";busy=false;remember();course.changed();renderPreview();update();}
  function options(){
    const select=q("[data-ms-source]");if(!select)return;select.replaceChildren(new Option("Choose a retained measured-source report",""));
    for(const source of sources)select.add(new Option(source.title+" · "+source.source_id,sourceKey(source)));
    if(sources.some(row=>sourceKey(row)===sourceChoice))select.value=sourceChoice;
    else{sourceChoice="";select.value="";}
    if(!sourceChoice&&sources.length===1){sourceChoice=sourceKey(sources[0]);select.value=sourceChoice;}
  }
  async function refreshSources(){
    const version=++generation,keyWorkspace=workspace;busy=true;preview=null;previewKey="";update();message("Reading retained report editions…");
    try{
      const result=await course.api("/api/published-studies/microbial-selection-catalog",{});
      if(!live(version,keyWorkspace))return;
      if(!Array.isArray(result.sources))throw Error("The source catalogue did not return retained report editions.");
      sources=result.sources;options();remember();
      message(sources.length?"Choose the original report edition and preview the exported activity selection.":"Import the complete native microbial report through Source reports, then refresh these editions.");
    }catch(error){if(live(version,keyWorkspace))message(error.message,true);}
    finally{if(live(version,keyWorkspace)){busy=false;renderPreview();update();}}
  }
  async function openFile(file){
    if(!file)return;
    const version=++generation,keyWorkspace=workspace;busy=true;preview=null;previewKey="";update();message("Reading selected activities…");
    try{
      if(file.size>MAX_SELECTION_BYTES)throw Error("Choose a selection no larger than 8 MiB.");
      const text=await file.text(),info=inspectMicrobialSelection(text);
      if(!live(version,keyWorkspace))return;
      selectionText=text;fileName=file.name;fileInfo=info;pendingKey="";page=0;remember();course.changed();
      message(info.activities+" exported activities at "+info.stations+" stations. Preview checks their exact retained report and original source rows.");
    }catch(error){if(live(version,keyWorkspace))message(error.message,true);}
    finally{if(live(version,keyWorkspace)){busy=false;renderPreview();update();const input=q("[data-ms-file]");if(input)input.value="";}}
  }
  async function check(){
    let selected;try{selected=payload();}catch(error){message(error.message,true);return;}
    const version=++generation,keyWorkspace=workspace;busy=true;preview=null;previewKey="";update();message("Matching the selected activities to the retained original sources…");
    try{
      const result=await course.api("/api/published-studies/microbial-selection-preview",selected);
      if(!live(version,keyWorkspace))return;
      if(!Array.isArray(result.observations)||!result.observations.length||result.binding!==fileInfo.binding)
        throw Error("The preview did not return the selected source-bound activities.");
      preview=result;previewKey=key(selected);page=0;remember();renderPreview();message("Original activity and source identities match. Save this selection as a study edition.");
    }catch(error){if(live(version,keyWorkspace))message(error.message,true);}
    finally{if(live(version,keyWorkspace)){busy=false;update();}}
  }
  async function prepare(){
    let selected;try{selected=payload();if(!preview||previewKey!==key(selected))throw Error("Preview the current report and selection before saving.");}
    catch(error){message(error.message,true);return;}
    if(state().busy||busy)return;
    const version=generation,keyWorkspace=workspace;busy=true;pendingKey=previewKey;remember();update();
    try{
      const task=await course.queue(ACTION,selected);
      if(!live(version,keyWorkspace))return;
      if(!task){message("The study task was not accepted. The current selection is retained for retry.",true);return;}
      if(["complete","completed"].includes(task.state))message("Selected study saved. Review its original observations below, then save a review or prepare its scientific report.");
      else message("The selected study is "+task.state+". Its completed edition will open below; the task retains this exact selection.");
    }catch(error){if(live(version,keyWorkspace))message(error.message,true);}
    finally{if(live(version,keyWorkspace)){busy=false;update();}}
  }
  function renderPreview(){
    const target=q("[data-ms-preview]");if(!target)return;
    q("[data-ms-file-info]").textContent=fileInfo?fileName+" · "+fileInfo.activities+" exported activities at "+fileInfo.stations+" stations":"No selected activity file is open.";
    if(!preview){target.replaceChildren();return;}
    const rows=preview.observations,stations=new Set(rows.map(row=>row.station_id)),routine=rows.filter(row=>row.activity_type==="Sample-Routine").length;
    const replicates=rows.filter(row=>row.activity_type==="Quality Control Sample-Field Replicate").length;
    const dates=rows.map(row=>row.date).filter(Boolean).sort(),statuses={};for(const row of rows)statuses[row.status]=(statuses[row.status]||0)+1;
    const pages=Math.max(1,Math.ceil(rows.length/25));page=Math.min(page,pages-1);
    target.innerHTML='<h3>Selected original activities</h3><p><strong>'+rows.length+' distinct activities at '+stations.size+' stations.</strong> '+
      routine+' routine samples · '+replicates+' field replicates.</p><p>'+escape(dates[0]||"No source date")+' through '+escape(dates.at(-1)||"No source date")+
      ' · '+Object.entries(statuses).map(([name,count])=>escape(name.replaceAll("_"," "))+": "+count).join(" · ")+'</p>'+
      '<p class="ps-help">The selected study keeps the complete original response files and their row references. Its editable study filters operate within these selected activities; the full source edition remains separately available.</p>'+
      '<div class="ps-table-scroll"><table><thead><tr><th>Original activity</th><th>Station / date</th><th>Activity type</th><th>Original result / unit</th><th>Status / reported limit</th><th>Source row</th></tr></thead><tbody>'+
      rows.slice(page*25,(page+1)*25).map(row=>'<tr><td>'+escape(row.activity_id)+'</td><td>'+escape(row.station_id)+'<br>'+escape(row.date)+'</td><td>'+
        escape(row.activity_type)+'</td><td>'+escape(row.result_value===""?"":row.result_value+(row.source_result_unit?" "+row.source_result_unit:""))+'</td><td>'+
        escape(row.status)+'<br>'+escape(row.limit_value+(row.source_limit_unit?" "+row.source_limit_unit:""))+'</td><td>'+escape(row.source_file)+' · '+escape(row.source_row)+'</td></tr>').join("")+
      '</tbody></table></div><div class="ps-actions"><button type="button" data-ms-previous'+(page===0?' disabled':"")+'>Previous activities</button><span>Page '+(page+1)+" / "+pages+
      '</span><button type="button" data-ms-next'+(page===pages-1?' disabled':"")+'>Next activities</button></div>'+
      '<details><summary>Exact source and selection binding</summary><dl class="ps-review-binding"><dt>Retained report</dt><dd>'+escape(preview.source?.title||"Selected original report")+
      '</dd><dt>Selection SHA-256</dt><dd><code>'+escape(preview.selection_sha256||"")+'</code></dd><dt>Context and observation identities</dt><dd><code>'+escape(preview.binding)+'</code></dd></dl></details>';
  }
  function update(){
    if(!root)return;
    const disabled=busy||state().busy;
    for(const selector of ["[data-ms-file]","[data-ms-source]","[data-ms-title]","[data-ms-refresh]"])q(selector).disabled=disabled;
    q("[data-ms-preview-button]").disabled=disabled||!sourceChoice||!selectionText;
    let valid=false;try{valid=Boolean(preview&&previewKey===key(payload()));}catch{}
    q("[data-ms-prepare]").disabled=disabled||!valid;
  }
  function mount(target){
    detach();root=target;workspace=state().workspace;events=new AbortController();if(!root||!workspace)return;
    const saved=drafts.get(workspace);sourceChoice=saved?.sourceChoice||"";selectionText=saved?.selectionText||"";fileName=saved?.fileName||"";
    fileInfo=copy(saved?.fileInfo||null);title=saved?.title||"";pendingKey=saved?.pendingKey||"";sources=[];preview=null;previewKey="";page=0;busy=false;
    root.innerHTML='<details class="ps-reviews"><summary>Continue selected microbial activities</summary><p>Open the activity JSON exported from the measured-source report. Keep the chosen original rows together in an editable study, saved review and scientific report.</p>'+
      '<div class="ps-form-grid"><label>Original retained report<select data-ms-source><option value="">Choose a retained measured-source report</option></select></label>'+
      '<label>Selected activity JSON<input type="file" data-ms-file accept=".json,application/json"></label><label>Selected study title<input data-ms-title maxlength="200" placeholder="Selected microbial activities"></label></div>'+
      '<p data-ms-file-info class="ps-help"></p><div class="ps-actions"><button type="button" data-ms-refresh>Refresh original reports</button>'+
      '<button type="button" data-ms-preview-button>Preview selected activities</button><button type="button" data-ms-prepare>Save selected study</button></div>'+
      '<p data-ms-status role="status" aria-live="polite"></p><div data-ms-preview></div></details>';
    q("[data-ms-title]").value=title;
    root.addEventListener("change",event=>{
      if(event.target.matches("[data-ms-file]"))openFile(event.target.files[0]);
      if(event.target.matches("[data-ms-source]")){sourceChoice=event.target.value;invalidate();}
    },{signal:events.signal});
    root.addEventListener("input",event=>{if(event.target.matches("[data-ms-title]")){title=event.target.value;invalidate();}},{signal:events.signal});
    root.addEventListener("click",event=>{
      const button=event.target.closest("button");if(!button||!root.contains(button))return;
      if(button.matches("[data-ms-refresh]"))refreshSources();
      if(button.matches("[data-ms-preview-button]"))check();
      if(button.matches("[data-ms-prepare]"))prepare();
      if(button.matches("[data-ms-previous]")){page--;renderPreview();q("[data-ms-previous]")?.focus({preventScroll:true});}
      if(button.matches("[data-ms-next]")){page++;renderPreview();q("[data-ms-next]")?.focus({preventScroll:true});}
    },{signal:events.signal});
    renderPreview();refreshSources();
  }
  function completed(task,entry){
    const current=state();
    if(task.action!==ACTION||!root||entry.workspace!==workspace||current.workspace!==workspace||entry.view!==current.view||entry.edit!==current.edit)return;
    const source=task.result?.selection_binding;
    if(source&&fileInfo&&source.binding!==fileInfo.binding)return;
    message("Selected study saved. Its original observations, complete study export and scientific review workflow are available below.");
  }
  function detach(){remember();events?.abort();++generation;root=null;events=null;workspace=null;preview=null;previewKey="";busy=false;}
  return {mount,update,completed,detach};
}

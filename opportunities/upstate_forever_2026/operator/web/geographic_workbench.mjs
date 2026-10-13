/** Geographic source/assumption workflow on the existing native source desk. */
import {createSourceWorkbench} from "./source_workbench.mjs";

const esc = value => String(value ?? "").replace(/[&<>"']/g, x => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[x]));
const canonical = value => Array.isArray(value) ? "["+value.map(canonical).join(",")+"]" :
  value && typeof value === "object" ? "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}" : JSON.stringify(value);
const list = value => Array.isArray(value) ? value : [];
const number = value => typeof value === "number" ? value.toLocaleString(undefined,{maximumFractionDigits:2}) : String(value ?? "—");
const KEY = "upstate-geographic-operator-v1";

export function readGeographicForm(form) {
  if (!form) throw new Error("Wait for the retained geographic source form to open.");
  const payload={method:"geographic-headwaters",title:form.querySelector("[data-sp-title]").value.trim(),inputs:{},options:{},import_sources:true};
  for (const input of form.querySelectorAll("[data-sp-input]")) if(input.value) payload.inputs[input.dataset.spInput]=JSON.parse(input.value);
  for (const input of form.querySelectorAll("[data-sp-option]")) if(input.value!=="") {
    let value=input.value;
    if(input.type==="number") {value=Number(value);if(!Number.isFinite(value))throw new Error("Use a finite value for "+input.dataset.spOption+".");}
    payload.options[input.dataset.spOption]=value;
  }
  return payload;
}

export function createGeographicWorkbench(host) {
  let container=null,workspace=null,version=0,catalog=null,preview=null,previewKey=null,previewBusy=false,abort=null,openedCase=null,choiceRevision=0,importGeneration=0,caseGeneration=0,topologyTimer=null;
  const active=(key,own)=>container&&workspace===key&&version===own&&host.getWorkspace()===key;
  const body=()=>readGeographicForm(container?.querySelector("[data-sp-form]"));
  const status=(message,error=false)=>{const node=container?.querySelector("[data-geo-notice]");if(node){node.textContent=message;node.classList.toggle("geo-error",error);}};
  const download=(value,name)=>{const url=URL.createObjectURL(new Blob([typeof value==="string"?value:JSON.stringify(value,null,2)+"\n"],{type:"application/json"}));const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);};
  const read=(operation,payload,key=workspace)=>host.api("/api/geographic-headwaters/"+operation,{method:"POST",body:{workspace:key,...payload}});
  const requestKey=(key,id)=>KEY+":request:"+key+":"+id;
  const proxy={...host,api:async(path,options={})=>{
    const key=workspace,own=version;
    if(path==="/api/actions"&&options.body?.action==="geography.prepare"){
      const original=options.body,id=original.operation_id,storage=requestKey(key,id);
      if(!active(key,own)||original.workspace!==key)throw new Error("Reopen the selected original study before preparing this case.");
      let saved=null;
      const text=localStorage.getItem(storage);if(text)saved=JSON.parse(text);
      if(saved&&canonical(saved.original)!==canonical(original))throw new Error("This retained operation already belongs to different source choices.");
      if(!saved){
        const observed=await read("preview",{payload:{...original.payload,import_sources:true}},key);
        if(!active(key,own))throw new Error("The selected study changed before native preparation.");
        const pinned={...original,payload:{...original.payload,import_sources:true,
          expected_preview_sha256:observed.preview_sha256,producer_sha256:observed.producer_sha256}};
        saved={schema:"upstate.geographic-operator-request/v1",original,pinned,preview:observed};
        const exact=JSON.stringify(saved);
        localStorage.setItem(storage,exact);
        if(localStorage.getItem(storage)!==exact)throw new Error("Retain the complete original request before dispatching the native operation.");
        preview=observed;previewKey=canonical({...original.payload,import_sources:true});renderPreview();
      }
      if(!active(key,own))throw new Error("The selected study changed before native preparation.");
      const task=await host.api(path,{...options,body:saved.pinned});
      // A late response stays attached to its immutable original operation even
      // when the operator has opened another study.
      const receiptKey=storage+":task:"+task.id;
      const receipt={schema:"upstate.geographic-operator-task/v1",workspace:key,operation_id:id,task_id:task.id};
      const prior=localStorage.getItem(receiptKey),exact=JSON.stringify(receipt);
      if(prior&&prior!==exact)throw new Error("The original task receipt changed.");
      if(!prior)localStorage.setItem(receiptKey,exact);
      return task;
    }
    const result=await host.api(path,options);
    if(path==="/api/geographic-headwaters/catalog"&&active(key,own)){
      catalog=result;renderCases();renderTopology();
      // The original desk builds its saved form after this API promise resolves.
      clearTimeout(topologyTimer);topologyTimer=setTimeout(()=>{if(active(key,own))renderTopology();},0);
    }
    return result;
  }};
  const original=createSourceWorkbench(proxy,{
    namespace:"geographic-headwaters",storageKey:KEY+":desk",
    prepareAction:"geography.prepare",composeAction:"geography.compose",
    title:"Geographic model case",
    description:"Prepare an editable Upper Savannah case from original upstream watersheds, the South Carolina reporting boundary and actual utility protection polygons. The native producer retains simulated physical assumptions and prepares baseline, restoration, matched control and parameter runs."
  });
  function table(headers,rows){return '<div class="geo-scroll"><table><thead><tr>'+headers.map(x=>"<th>"+esc(x)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map(x=>"<td>"+esc(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";}
  function renderPreview(){
    const target=container?.querySelector("[data-geo-preview]");if(!target)return;
    if(!preview){target.innerHTML="<p>Select original sources and assumptions, then preview the geographic coverage.</p>";return;}
    const p=preview.preview,g=p.geography,a=g.areas_ha,grid=g.grid;
    target.innerHTML='<h3>'+esc(p.selection.title)+'</h3><p>'+esc(p.selection.question)+'</p>'+
      table(["Geographic scope","Area (ha)","Original selection"],[
        ["Upstream model domain",number(a.model_domain),g.model_domain_huc12s.length+" original HUCs"],
        ["Selected reporting watersheds",number(a.reporting_whole_hucs),g.reporting_huc12s.length+" HUCs"],
        ["SC reporting intersection",number(a.reporting_area),p.selection.reporting_boundary_description],
        ["Original utility polygons",number(a.utility_full_union),p.selection.utility_label],
        ["Utility/reporting intersection",number(a.utility_reporting_intersection),"Original polygons intersected with the reporting area"]
      ])+
      table(["Grid / assumption","Selected value"],[
        ["Native grid",number(grid.width)+" × "+number(grid.height)+" cells; "+grid.crs],
        ["Resolution",number(grid.resolution_m)+" m"],["Rectangular grid",number(p.rectangular_grid_cells)+" cells"],
        ["Physical input generation",p.physical_generation.method],
        ["Generation working set",p.physical_generation.numeric_working_set_independent_of_total_cells ? "Raster-window numeric arrays are independent of total grid cells" : "See retained producer assumptions"],
        ["Declared matching method",p.selection.matching_method??"Original legacy selection"],
        ["Declared matching budget (bytes)",p.selection.max_working_bytes===undefined?"Original legacy selection":number(p.selection.max_working_bytes)],
        ["Field seed",p.selection.seed],["Corridor buffer on each side",number(p.selection.corridor_width_m)+" m; nominal "+number(2*p.selection.corridor_width_m)+" m total"],
        ["Original geography",p.geography_classification],["Physical inputs",p.physical_inputs_classification]
      ])+'<p>Prepared nitrogen and phosphorus results use kg/year; sediment uses metric tonnes/year delivered to streams. Native results appear after the existing model operation runs.</p>'+
      '<details><summary>Complete original source bindings and grid</summary><pre>'+esc(JSON.stringify(g,null,2))+'</pre></details>'+
      '<p class="geo-small">The preview uses this installed geographic producer and the selected original source bodies. Preparing the same request retains those exact choices.</p>';
  }
  function renderCases(){
    const target=container?.querySelector("[data-geo-cases]");if(!target)return;
    const cases=list(catalog?.native_cases),state=host.getState(),runs=new Map(list(state?.data?.runs).map(r=>[r.id,r]));
    target.innerHTML=cases.length?cases.map(c=>{
      const ids=[c.baseline_run_id,...list(c.alternative_run_ids)];
      return '<article><h3>'+esc(c.selection.title)+'</h3><p>'+esc(c.selection.question)+'</p>'+
        table(["Original run","Current retained state"],ids.map((id,i)=>[[ "Baseline","Restoration","Matched control"][i]||"Alternative "+i,runs.get(id)?.state||"Prepared"] ))+
        '<div class="geo-actions"><button type="button" data-geo-case="'+esc(c.id)+'">Open saved geographic case</button>'+
        '<button type="button" data-geo-edit="'+esc(c.id)+'">Use choices for another edition</button>'+
        '<button type="button" data-geo-item="profiles" data-geo-id="'+esc(c.profile_id)+'">Inspect model assumptions</button>'+
        '<button type="button" data-geo-item="grids" data-geo-id="'+esc(c.grid_id)+'">Open prepared grid</button></div>'+
        '<div class="geo-actions">'+ids.map((id,i)=>'<button type="button" data-geo-item="runs" data-geo-id="'+esc(id)+'">Open '+esc(["baseline","restoration","control"][i]||"alternative")+' run</button>').join("")+'</div></article>';
    }).join(""):"<p>Saved native geographic cases will appear here, including cases received in a complete working project.</p>";
  }
  function renderTopology(){
    const target=container?.querySelector("[data-geo-watersheds]");if(!target)return;
    const filter=container.querySelector("[data-geo-filter]").value.toLowerCase(),selected=new Set((container.querySelector('[data-sp-option="reporting_huc12s"]')?.value||"").split(/[\s,]+/).filter(Boolean));
    const rows=list(catalog?.watersheds).filter(x=>(x.huc12+" "+x.name+" "+x.downstream_huc12).toLowerCase().includes(filter));
    target.innerHTML=rows.map(x=>'<label><input type="checkbox" data-geo-huc="'+esc(x.huc12)+'"'+(selected.has(x.huc12)?" checked":"")+'> <span><strong>'+esc(x.huc12)+'</strong> '+esc(x.name)+'<small>Original downstream HUC: '+esc(x.downstream_huc12)+'</small></span></label>').join("")||"<p>No matching original watershed.</p>";
  }
  function setField(selector,value){
    const node=container.querySelector(selector);if(!node)throw new Error("Wait for the source form to finish opening.");
    const string=typeof value==="object"?JSON.stringify(value):String(value??"");
    if(node.tagName==="SELECT"&&!Array.from(node.options).some(x=>x.value===string))node.add(new Option("Retained original source",string));
    node.value=string;node.dispatchEvent(new Event("change",{bubbles:true}));node.dispatchEvent(new Event("input",{bubbles:true}));
  }
  function payloadFromSelection(s){
    const selector=x=>({collection_id:x.source_collection_id,source_id:x.source_id,...(x.part?{companion_path:x.part}:{})});
    return {method:"geographic-headwaters",title:s.title,inputs:{huc_polygons:selector(s.huc_polygons),reporting_boundary:selector(s.reporting_boundary),utility_focus:selector(s.utility_focus[0])},
      options:{question:s.question,reporting_huc12s:s.reporting_huc12s.join("\n"),huc_field:s.huc_field,
        huc_layer:s.huc_polygons.layer||"",huc_where:JSON.stringify(s.huc_polygons.where||{}),
        reporting_layer:s.reporting_boundary.layer||"",reporting_where:JSON.stringify(s.reporting_boundary.where||{}),
        reporting_boundary_description:s.reporting_boundary_description,utility_layer:s.utility_focus[0].layer||"",
        utility_where:JSON.stringify(s.utility_focus[0].where||{}),additional_utility_focus:JSON.stringify(s.utility_focus.slice(1)),
        intakes:JSON.stringify(s.intakes||[]),utility_label:s.utility_label,seed:s.seed,corridor_width_m:s.corridor_width_m,
        ...(Object.hasOwn(s,"matching_method")?{matching_method:s.matching_method}:{}),
        ...(Object.hasOwn(s,"max_working_bytes")?{max_working_bytes:s.max_working_bytes}:{})},import_sources:true};
  }
  function applyPayload(payload){
    if(payload?.method!=="geographic-headwaters"||!payload.inputs||!payload.options)throw new Error("Open a complete geographic operator selection.");
    setField("[data-sp-title]",payload.title||"");
    for(const node of container.querySelectorAll("[data-sp-input]"))setField('[data-sp-input="'+node.dataset.spInput+'"]',payload.inputs[node.dataset.spInput]??"");
    for(const node of container.querySelectorAll("[data-sp-option]"))setField('[data-sp-option="'+node.dataset.spOption+'"]',payload.options[node.dataset.spOption]??"");
    preview=null;previewKey=null;renderPreview();renderTopology();status("Original source and assumption choices reopened. Review the preview before preparing another edition.");
  }
  async function previewCurrent(){
    if(previewBusy)return;
    const key=workspace,own=version,payload=body(),choice=canonical(payload);previewBusy=true;status("Reading selected original geometry and 30 m coverage…");
    try{const result=await read("preview",{payload},key);if(!active(key,own))return;if(canonical(body())!==choice){status("Choices changed while the original preview was loading. Preview the current selection.");return;}preview=result;previewKey=choice;renderPreview();status("Original coverage and assumptions are open for this exact selection.");}
    catch(error){if(active(key,own))status(error.message,true);}
    finally{if(active(key,own))previewBusy=false;}
  }
  async function openCase(id){
    const key=workspace,own=version,generation=++caseGeneration;
    let result;
    try {result=await read("case",{case_id:id},key);}
    catch(error){if(active(key,own)&&generation===caseGeneration)status(error.message,true);return;}
    if(!active(key,own)||generation!==caseGeneration)return;openedCase=result;
    const target=container.querySelector("[data-geo-case-detail]");
    target.innerHTML='<h3>'+esc(result.case.selection.title)+'</h3><p>The full original selection, input receipts and declared assumptions are available below.</p>'+
      '<div class="geo-actions">'+list(result._downloads).filter(f=>String(f.url).startsWith("/api/file/")).map(f=>'<a href="'+esc(f.url+(f.url.includes("?")?"&":"?")+"download=1")+'" download>'+esc(f.label||f.filename)+'</a>').join("")+'</div>'+
      '<details><summary>Complete prepared case</summary><pre>'+esc(JSON.stringify(result.case,null,2))+'</pre></details>';
    target.hidden=false;target.scrollIntoView({block:"start"});
  }
  async function click(event){
    const button=event.target.closest("button");if(!button||!container?.contains(button))return;
    try{
      if(button.hasAttribute("data-geo-preview-button"))return await previewCurrent();
      if(button.hasAttribute("data-geo-save")){
        const payload=body();download({schema:"upstate.geographic-operator-selection/v1",workspace_key:workspace,project_id:catalog?.project_id,payload,preview:previewKey===canonical(payload)?preview:null},"geographic-selection.json");status("Complete source choices and current matching preview downloaded.");return;
      }
      if(button.dataset.geoCase)return await openCase(button.dataset.geoCase);
      if(button.dataset.geoEdit){const c=list(catalog?.native_cases).find(c=>c.id===button.dataset.geoEdit);if(!c)throw new Error("Refresh the saved geographic cases.");applyPayload(payloadFromSelection(c.selection));container.querySelector("[data-sp-form]").scrollIntoView({block:"start"});return;}
      if(button.dataset.geoItem)return host.openItem(button.dataset.geoItem,button.dataset.geoId);
      if(button.hasAttribute("data-geo-recovery")){
        const retained=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(KEY+":request:"+workspace+":"))retained.push({key,value:JSON.parse(localStorage.getItem(key))});}
        download({schema:"upstate.geographic-operator-recovery/v1",workspace_key:workspace,requests:retained},"geographic-operation-history.json");return;
      }
    }catch(error){status(error.message,true);}
  }
  function mount(target,current=host.getState()){
    const key=host.getWorkspace();if(container===target&&workspace===key){update(current);return;}
    suspend();container=target;workspace=key;version++;catalog=null;preview=null;previewKey=null;previewBusy=false;
    target.innerHTML='<div class="geo-desk"><section class="geo-tools"><h2>Geographic coverage and saved choices</h2><p>Choose the original sources in the preparation form. New source files enter through the existing Original sources workflow, with their complete companions.</p>'+
      '<div class="geo-actions"><button type="button" data-geo-preview-button>Preview selected coverage</button><button type="button" data-geo-save>Download complete choices</button>'+
      '<label class="geo-file">Reopen choices<input type="file" accept=".json,application/json" data-geo-reopen></label><button type="button" data-geo-recovery>Download original operation history</button></div>'+
      '<p data-geo-notice role="status" aria-live="polite"></p><div data-geo-preview></div>'+
      '<details><summary>Select original reporting watersheds</summary><label>Find a watershed<input type="search" data-geo-filter></label><p>Selections update the reporting HUC identifiers in the original preparation form. Upstream membership follows the retained native topology.</p><div data-geo-watersheds class="geo-watersheds"></div></details></section>'+
      '<div data-geo-original></div><section class="geo-saved"><h2>Saved geographic studies</h2><div data-geo-cases></div><div data-geo-case-detail hidden></div></section></div>';
    abort=new AbortController();const signal=abort.signal;
    target.addEventListener("click",click,{signal});
    target.querySelector("[data-geo-filter]").addEventListener("input",renderTopology,{signal});
    const choicesChanged=event=>{
      if(event.target.matches("[data-sp-input],[data-sp-option],[data-sp-title]")){
        choiceRevision++;
        if(event.target.matches('[data-sp-option="reporting_huc12s"]'))renderTopology();
        if(preview)status("Choices changed. Preview the current selection before using its geographic coverage.");
      }
    };
    target.addEventListener("input",choicesChanged,{signal});
    target.addEventListener("change",choicesChanged,{signal});
    target.addEventListener("change",event=>{
      if(event.target.hasAttribute("data-geo-huc")){
        const input=target.querySelector('[data-sp-option="reporting_huc12s"]');if(!input)return;
        const values=new Set(input.value.split(/[\s,]+/).filter(Boolean)),id=event.target.dataset.geoHuc;
        if(event.target.checked)values.add(id);else values.delete(id);setField('[data-sp-option="reporting_huc12s"]',[...values].sort().join("\n"));
      }
    },{signal});
    target.querySelector("[data-geo-reopen]").addEventListener("change",async event=>{
      const file=event.target.files[0],key=workspace,own=version,generation=++importGeneration,revision=choiceRevision;if(!file)return;
      try{const data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer()));if(!active(key,own)||generation!==importGeneration)return;
        if(revision!==choiceRevision){status("Source choices changed while this file was opening. Select the file again to apply it.");return;}
        if(data.schema!=="upstate.geographic-operator-selection/v1"||data.project_id!==catalog?.project_id)throw new Error("Receive these original source collections into this study before reopening another project's selection.");
        applyPayload(data.payload);
      }catch(error){if(active(key,own)&&generation===importGeneration&&revision===choiceRevision)status(error.message,true);}
    },{signal});
    original.mount(target.querySelector("[data-geo-original]"),current);renderPreview();renderCases();
  }
  function update(current=host.getState()){if(!container||workspace!==host.getWorkspace())return;original.update(current);renderCases();renderTopology();}
  function suspend(){clearTimeout(topologyTimer);topologyTimer=null;importGeneration++;caseGeneration++;original.suspend();abort?.abort();abort=null;container=null;workspace=null;catalog=null;openedCase=null;version++;previewBusy=false;}
  return {mount,update,suspend};
}

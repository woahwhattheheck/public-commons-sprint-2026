/** Complete grayscale reports and an offline editor for original Installation inputs. */
const esc = value => String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const CSS = "color-scheme:light;--ink:#181818;--muted:#666;--line:#c8c8c8;--paper:#fff;--wash:#f4f4f4;";
const styles = ":root{"+CSS+"}*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);font:15px/1.55 system-ui,sans-serif}header,main,footer{max-width:1360px;margin:auto;padding:24px}header{padding-top:42px;border-bottom:2px solid #222}h1{font-size:clamp(27px,4vw,42px);line-height:1.15;letter-spacing:-.035em;margin:8px 0 15px}h2{font-size:23px;margin:0 0 14px}h3{font-size:17px;margin:18px 0 10px}p{max-width:95ch}.eyebrow{font:12px/1.5 ui-monospace,monospace;letter-spacing:.09em;text-transform:uppercase;color:#555}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px}.card{background:#fff;border:1px solid var(--line);padding:22px;margin:18px 0}.grid .card{margin:0}.stat{font:600 27px/1.2 ui-monospace,monospace}.muted{color:#666}.table{overflow:auto;border:1px solid var(--line)}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;padding:11px;border-bottom:1px solid #ddd;white-space:pre-wrap}th{background:#efefef;font-size:12px;letter-spacing:.03em}tbody tr:last-child td{border-bottom:0}code,pre{font-family:ui-monospace,monospace;font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap;max-height:36rem;overflow:auto;background:#f4f4f4;padding:16px}button,.file{font:600 13px system-ui;padding:10px 14px;border:1px solid #444;background:#fff;color:#171717;cursor:pointer;border-radius:0}button:hover,.file:hover{background:#e8e8e8}button.primary{background:#222;color:#fff}button:disabled{opacity:.45;cursor:default}input,textarea,select{font:14px system-ui;background:#fff;border:1px solid #aaa;padding:8px;color:#111;max-width:100%}textarea{width:100%;min-height:19rem;font:12px/1.55 ui-monospace,monospace;tab-size:2}label{display:block;font-weight:600;font-size:13px;margin-bottom:5px}.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.file{display:inline-block;margin:0}.file input{display:none}.notice{background:#e9e9e9;border-left:4px solid #555;padding:13px 18px;white-space:pre-wrap}details{margin-top:16px}summary{font-weight:600;cursor:pointer}nav{display:flex;gap:12px;flex-wrap:wrap;margin:20px 0}a{color:#222}td input{min-width:110px;width:100%}td select{min-width:120px}footer{font-size:13px;color:#666;border-top:1px solid #bbb}@media(max-width:600px){header,main,footer{padding:18px}.card{padding:16px}.grid{grid-template-columns:1fr}button,.file{min-height:42px}}@media print{body{background:#fff}header,main,footer{max-width:none;padding:12px}.card{break-inside:avoid;border:1px solid #bbb}.actions,nav{display:none}pre{max-height:none}.table{overflow:visible}h1{font-size:30px}details{display:block}}";
function table(headers,rows) {
  return '<div class="table"><table><thead><tr>'+headers.map(v=>"<th>"+esc(v)+"</th>").join("")+"</tr></thead><tbody>"+
    rows.map(row=>"<tr>"+row.map(value=>"<td>"+esc(value)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
}
function shell(title,body,script="") {
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    "<title>"+esc(title)+"</title><style>"+styles+"</style></head><body>"+body+script+"</body></html>";
}
export function renderPropertyReport(value) {
  const prepared=!!value.property,selection=prepared?value.property.selection:null;
  const findings=prepared?value.property.findings:value.findings;
  const rows=prepared?selection.properties.map(row=>[row.key,[row.address,row.city,row.state,row.zip].filter(Boolean).join(", "),
    row.bbl||"Not supplied",row.bin||"Not supplied",row.buyerPropertyId||"Unselected",row.templateId||"Unselected",row.inspection,row.identityNote]):
    value.properties.map(row=>[row.key,row.disposition,row.sourceComplete?"Both reviewed":"Incomplete",
      row.inspectionComplete?"Selected inspection covered":"Incomplete",row.note,row.sourceIds.join("\n")]);
  const title=prepared?"Property commissioning workorder":"Property installation return";
  let body='<header><div class="eyebrow">Original Installation desk · source preparation</div><h1>'+title+'</h1><p>'+
    (prepared?esc(selection.id)+" · edition "+selection.edition:esc(value.baseline.id)+" · revision "+value.baseline.revision)+
    '</p><p class="muted">This file prepares the original native input. Native save, customer acceptance, source spending and grant qualification retain their own original records.</p></header><main>';
  if(prepared) {
    const c=value.property.commercial;
    body+='<section class="grid"><div class="card"><div class="eyebrow">Proposed implementation</div><div class="stat">USD '+esc(c.fixed_fee)+
      '</div><p>Original buyer offer</p></div><div class="card"><div class="eyebrow">Planned effort</div><div class="stat">84 + 16 h</div><p>Delivery plus included contingency</p></div>'+
      '<div class="card"><div class="eyebrow">Active delivery</div><div class="stat">20 days</div><p>Kickoff and staffing to be agreed</p></div>'+
      '<div class="card"><div class="eyebrow">Selected property roster</div><div class="stat">'+selection.properties.length+
      '</div><p>Maximum 50 · '+selection.templates.length+' templates</p></div></section>'+
      '<section class="card"><h2>Complete original workshare</h2>'+table(["Original phase","Planned hours","Complete result"],
        value.property.phases.map(row=>[row.id,row.hours,row.work]))+'<p>'+esc(c.terms)+'</p>'+table(["Commercial milestone","USD"],
        c.milestones.map(row=>[row.label,row.amount]))+'<p>'+esc(c.resource_payment)+"</p><p>"+esc(c.metric_boundary)+"</p></section>";
  }
  if(prepared) {
    body+='<section class="card"><h2>Current native Workshare</h2>'+table(["Native field","Complete retained value"],
      [["Case",value.source.caseId],["Case version",value.source.version],["Original Workshare",value.workshareCaseId],
       ["Reference",value.document.workorder.reference],["Payer",value.document.workorder.payer],
       ["Scope",value.document.workorder.scope],["Commercial terms",value.document.workorder.terms],
       ["Selection source",value.property.selectionAttachment?.id||"Not attached"]])+
      '<p>These are the current native seed fields. The original proposal above remains source history. A corrected selection does not create a new customer acceptance; its original observations remain visible until the owner records a new decision.</p></section>';
  }
  body+='<section class="card"><h2>'+ (prepared?"Actual selections to complete":"Receiving findings") +'</h2>'+
    (findings.length?table(["Field","Finding"],findings.map(row=>[row.field,row.message])):"<p>No local selection finding remains. The original native preview is still required.</p>")+"</section>"+
    '<section class="card"><h2>Every selected property</h2>'+table(prepared?["Key","Original address","BBL","BIN","Buyer property","Template","Inspection","Identity basis"]:
      ["Key","Disposition","Source outcomes","Inspection","Decision","Complete sources"],rows)+"</section>";
  if(prepared) {
    body+='<section class="card"><h2>Source editions and permitted fields</h2>'+table(["Edition","Original reference","Source files"],
      selection.editions.map(row=>[row.slot,row.reference,row.sourceIds.join("\n")]))+
      '<p>Selected fields: '+esc(selection.fields.join(", "))+"</p><p>Whole report selected: "+(selection.includeWholeReport?"Yes — explicit approval required":"No")+
      "</p><h3>Recorded source and hosting decisions</h3>"+table(["Decision","State","Named decision","Source basis"],Object.entries(selection.rights).map(([key,row])=>
        [key,row.state,[row.by,row.at].filter(Boolean).join(" · "),row.note+"\n"+row.sourceIds.join("\n")]))+"</section>"+
      '<section class="card"><h2>Five customer examples</h2>'+table(["Example","Properties","Task","Expected review"],
        selection.examples.map(row=>[row.id,row.propertyKeys.join(", "),row.task,row.expectedReview]))+"</section>";
  } else {
    body+='<section class="card"><h2>Original phase observations</h2>'+table(["Phase","Original check","Previous state","Selected state"],
      value.changes.map(row=>[row.phaseId,row.checkId,row.from,row.to]))+
      '<p>Checks selected KEEP remain as received. Original title, criterion, required flag and tranche are retained by the native Return seed.</p></section>';
  }
  const sources=prepared?value.property.sourceFiles:value.sourceFiles;
  body+='<section class="card"><h2>Complete source inventory</h2>'+table(["Source","Filename","Bytes","SHA-256","Original case source"],
    sources.map(row=>[row.id,row.filename,row.bytes,row.sha256,row.nativeSourceId||"To attach"]))+
    '<details><summary>Full editable preparation and original input</summary><pre>'+esc(JSON.stringify(value,null,2))+"</pre></details></section></main>"+
    "<footer>Original HPD project-participation development evidence remains distinct from Propply conditions and actual inspection results. Preserve the original Property owner, source request and Installation history.</footer>";
  return shell(title,body);
}
function editorMain() {
  const $=id=>document.getElementById(id),state={inputs:new Map(),sources:new Map(),generation:0,result:null,busy:false,previous:null,rosterText:null};
  const bytes=value=>new TextEncoder().encode(value),text=raw=>new TextDecoder("utf-8",{fatal:true}).decode(raw);
  const hash=async raw=>Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",raw)),v=>v.toString(16).padStart(2,"0")).join("");
  const json=raw=>JSON.parse(text(raw),(key,value)=>{if(typeof value==="number"&&(!Number.isFinite(value)||Number.isInteger(value)&&!Number.isSafeInteger(value)))throw Error("An unsafe numeric identifier cannot be interpreted without loss.");return value;});
  const fail=message=>{throw Error(message);},need=(ok,message)=>{if(!ok)fail(message);};
  const notice=message=>{$("notice").textContent=message;$("notice").hidden=!message;};
  const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  let core,view,profile,coordinator;
  const changing=()=>{state.generation++;state.result=null;$("result").hidden=true;$("download-native").disabled=true;$("download-report").disabled=true;};
  const description=row=>row?row.name+" · "+row.raw.length+" bytes · "+row.sha256:"No file selected";
  function refresh() {
    for(const kind of ["cohort","seed","selection","previous","return-seed","installation","review","case-state"])$(kind+"-selected").textContent=description(state.inputs.get(kind));
    $("source-roster").innerHTML=[...state.sources].map(([name,row])=>"<tr><td>"+escape(name)+"</td><td>"+row.raw.length+
      "</td><td><code>"+row.sha256+'</code></td><td><button data-remove="'+escape(name)+'">Remove</button></td></tr>').join("");
    document.querySelectorAll("button,input,select,textarea").forEach(node=>{node.disabled=state.busy;});
    $("download-native").disabled=state.busy||!state.result;
    $("download-report").disabled=state.busy||!state.result;
    coordinator?.availability();
  }
  async function work(action) {
    if(state.busy)return;state.busy=true;refresh();
    try{await action();}catch(error){notice(error.message);}finally{state.busy=false;refresh();}
  }
  function download(name,raw,type="application/json") {
    const url=URL.createObjectURL(new Blob([raw],{type})),link=document.createElement("a");
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function incoming(file) {
    need(file&&file.size>0&&file.size<=8*1024*1024,"Select a complete original file up to 8 MiB.");
    const raw=new Uint8Array(await file.arrayBuffer());return {name:file.name,raw,sha256:await hash(raw)};
  }
  async function storeInput(kind,row) {
    json(row.raw);
    // An explicit reload rebinds even an equal saved file after unsaved textarea edits.
    state.inputs.set(kind,row);changing();
    if(kind==="selection"){$("selection-json").value=text(row.raw);renderProperties(json(row.raw));coordinator?.refresh();}
    if(kind==="review")$("review-json").value=text(row.raw);
    if(kind==="coordinator")coordinator?.restore(json(row.raw));
    refresh();
  }
  async function fromText(kind,value) {
    const old=state.inputs.get(kind);
    if(old&&text(old.raw)===value)return old;
    const raw=bytes(value);json(raw);need(raw.length<=8*1024*1024,"The complete input exceeds 8 MiB.");
    const row={name:kind==="selection"?"PROPERTY_SELECTION.json":kind==="coordinator"?"PROPERTY_COORDINATOR_DRAFT.json":"PROPERTY_REVIEW.json",raw,sha256:await hash(raw)};
    await storeInput(kind,row);return row;
  }
  const requireInput=kind=>{const row=state.inputs.get(kind);need(row,"Load the complete "+kind+" file.");return {...row,bytes:row.raw.length,value:json(row.raw)};};
  async function selectedInput() {
    const row=await fromText("selection",$("selection-json").value);
    renderProperties(json(row.raw));return row;
  }
  function clearProperties(message="Apply the edited selection JSON to reopen its property table.") {
    state.rosterText=null;$("properties").replaceChildren();$("property-count").textContent=message;
  }
  function renderProperties(value) {
    need(Array.isArray(value.properties)&&value.properties.length<=50,"Keep the complete ordered property roster within 50 rows.");
    state.rosterText=$("selection-json").value;
    $("property-count").textContent=value.properties.length+" / 50 properties";
    const fields=["key","address","city","state","zip","bbl","bin","buyerPropertyId","templateId","inspection"];
    $("properties").innerHTML=value.properties.map((row,index)=>"<tr>"+fields.map(key=>"<td>"+
      (key==="inspection"?'<select data-row="'+index+'" data-key="'+key+'">'+["UNSELECTED","REQUIRED","NOT_REQUIRED"].map(v=>
        '<option'+(v===row[key]?" selected":"")+">"+v+"</option>").join("")+"</select>":
        '<input aria-label="'+escape(key)+'" data-row="'+index+'" data-key="'+key+'" value="'+escape(row[key])+'">')+
      '</td>').join("")+'<td><button data-delete="'+index+'">Remove</button></td></tr>').join("");
  }
  function currentSelection() {
    const raw=bytes($("selection-json").value),value=json(raw);need(value.schema===core.PROPERTY_SCHEMA,"Load an original property selection.");
    return value;
  }
  function editSelection(value) {$("selection-json").value=JSON.stringify(value,null,2)+"\n";changing();renderProperties(value);}
  function selectedFiles(rows) {
    const result=Object.create(null);let total=0;
    for(const row of rows) {
      const found=state.sources.get(row.filename);need(found,"Select the complete original "+row.filename);
      need(found.raw.length===row.bytes&&found.sha256===row.sha256,"The original file differs: "+row.filename);
      total+=found.raw.length;need(total<=24*1024*1024,"The complete source roster exceeds 24 MiB.");
      result[row.id]={filename:row.filename,bytes:found.raw.length,sha256:found.sha256,
        value:row.mediaType==="application/json"||row.mediaType.endsWith("+json")?json(found.raw):undefined};
    }
    return result;
  }
  function previous() {const row=state.inputs.get("previous");return row?{sha256:row.sha256,value:json(row.raw)}:null;}
  async function showResult(value,mode,generation) {
    need(generation===state.generation,"The selected source changed; prepare against the current selection.");
    state.result={value,mode,generation,html:view.renderPropertyReport(value)};
    $("result").hidden=false;
    const findings=value.property?.findings||value.findings||[];
    $("result-summary").textContent=(mode==="prepare"?"Native Installation input prepared. ":"Native Installation Return input prepared. ")+
      findings.length+" source or selection findings. Save through the original desk after its native preview.";
    $("result-details").textContent=JSON.stringify(value,null,2);
    notice("The complete prepared input and report are ready to download. Native actions performed: 0.");
    refresh();
  }
  const toBase64=raw=>{let value="";for(let i=0;i<raw.length;i+=32768)value+=String.fromCharCode(...raw.subarray(i,i+32768));return btoa(value);};
  const fromBase64=value=>{const text=atob(value);return Uint8Array.from(text,c=>c.charCodeAt(0));};
  async function packet() {
    await selectedInput();if($("review-json").value.trim())await fromText("review",$("review-json").value);
    coordinator?.requireSources();
    if(coordinator){const raw=bytes(JSON.stringify(coordinator.snapshot(),null,2)+"\n");need(raw.length<=8*1024*1024,"The complete coordinator draft exceeds 8 MiB.");state.inputs.set("coordinator",{name:"PROPERTY_COORDINATOR_DRAFT.json",raw,sha256:await hash(raw)});}
    const sourceTotal=[...state.sources.values()].reduce((total,row)=>total+row.raw.length,0);
    need(sourceTotal<=24*1024*1024,"The complete source roster is "+sourceTotal+" bytes; reopening permits at most 25165824 bytes. Preserve all originals through the CLI or deliberately select the complete sources for this stage.");
    const members=[...state.inputs].map(([kind,row])=>({kind,row}));
    for(const row of state.sources.values())members.push({kind:"source",row});
    const files=members.map(({kind,row})=>({kind,name:row.name,bytes:row.raw.length,sha256:row.sha256,base64:""}));
    const envelope={schema:"stellar-forge.property-commissioning-editor.v1",files};
    // Base64 contains only unescaped ASCII, so the empty-string envelope plus these
    // lengths is the exact serialized UTF-8 size, before allocating every encoding.
    const size=bytes(JSON.stringify(envelope,null,2)+"\n").length+
      members.reduce((total,{row})=>total+4*Math.ceil(row.raw.length/3),0);
    need(size<=64*1024*1024,"The complete input packet would be "+size+" bytes; this editor reopens at most 67108864 bytes. Keep all complete originals in the CLI's private preparation directory, or remove only inputs outside this selected stage before exporting.");
    members.forEach(({row},index)=>{files[index].base64=toBase64(row.raw);});
    const raw=bytes(JSON.stringify(envelope,null,2)+"\n");
    need(raw.length===size&&raw.length<=64*1024*1024,"The complete packet exceeds its exact reopen bound.");
    download("Property_Commissioning_Complete_Inputs.json",raw);
  }
  const data=JSON.parse($("program").textContent);profile=data.profile;
  (async()=>{
    const prepareUrl=URL.createObjectURL(new Blob([data.prepareSource],{type:"text/javascript"}));
    const clause='from "./prepare-core.mjs"';
    need(data.coreSource.split(clause).length===2,"The complete maintained compiler import changed.");
    const coreUrl=URL.createObjectURL(new Blob([data.coreSource.replace(clause,'from '+JSON.stringify(prepareUrl))],{type:"text/javascript"}));
    const viewUrl=URL.createObjectURL(new Blob([data.viewSource],{type:"text/javascript"}));
    need(typeof data.coordinatorSource==="string"&&typeof data.coordinatorUiSource==="string","Keep the complete guided coordinator source.");
    const rosterUrl=URL.createObjectURL(new Blob([data.coordinatorSource],{type:"text/javascript"}));
    const rosterClause='from "./property-coordinator.mjs"';
    need(data.coordinatorUiSource.split(rosterClause).length===2,"The complete coordinator import changed.");
    const coordinatorUrl=URL.createObjectURL(new Blob([data.coordinatorUiSource.replace(rosterClause,"from "+JSON.stringify(rosterUrl))],{type:"text/javascript"}));
    let guided;
    try{[core,view,guided]=await Promise.all([import(coreUrl),import(viewUrl),import(coordinatorUrl)]);}
    finally{[prepareUrl,coreUrl,viewUrl,rosterUrl,coordinatorUrl].forEach(url=>URL.revokeObjectURL(url));}
    coordinator=guided.mountPropertyCoordinator({
      target:$("property-coordinator"),work,download,getSelectionText:()=>$("selection-json").value,
      getSources:()=>[...state.sources.values()],touch:changing,
      setSelection:(value,expected)=>{need(expected===$("selection-json").value,"The selected draft changed.");editSelection(value);},
      addEvidence:async value=>{
        const raw=bytes(JSON.stringify(value,null,2)+"\n");need(raw.length<=8*1024*1024,"The full mapping record exceeds 8 MiB.");
        const digest=await hash(raw),name="Property_Roster_Mapping_"+digest.slice(0,24)+".json",old=state.sources.get(name);
        need(!old||old.sha256===digest&&old.raw.length===raw.length,"Another original source uses the mapping filename.");
        const total=[...state.sources.values()].reduce((n,r)=>n+r.raw.length,0)+(old?0:raw.length);
        need(total<=24*1024*1024,"The full original sources and mapping record exceed 24 MiB.");
        state.sources.set(name,old||{name,raw,sha256:digest});
        return {id:"mapping-"+digest.slice(0,24),filename:name,bytes:raw.length,sha256:digest,mediaType:"application/json",sourceUrl:"",
          observedAt:new Date().toISOString(),nativeSourceId:null};
      }
    });
    $("loading").hidden=true;$("editor").hidden=false;coordinator.refresh();refresh();
    document.querySelectorAll("[data-input]").forEach(node=>node.addEventListener("change",()=>work(async()=>{
      const row=await incoming(node.files[0]);await storeInput(node.dataset.input,row);notice("Loaded "+row.name+".");
    })));
    $("source-files").addEventListener("change",()=>work(async()=>{
      const next=new Map(state.sources);let total=[...next.values()].reduce((sum,row)=>sum+row.raw.length,0);
      for(const file of $("source-files").files) {
        const row=await incoming(file),old=next.get(row.name);
        need(!old||old.sha256===row.sha256,"Another complete original has this filename. Remove its selected copy before changing it.");
        if(!old){total+=row.raw.length;need(total<=24*1024*1024,"Selected source files exceed 24 MiB.");next.set(row.name,row);}
      }
      state.sources=next;changing();coordinator.refresh();refresh();notice("Complete original source files retained in this view. Download the complete input packet to reopen them.");
    }));
    $("source-roster").addEventListener("click",event=>{
      const button=event.target.closest("[data-remove]");if(!button||state.busy)return;
      if(!coordinator.canRemoveSource(button.dataset.remove)){notice("A retained mapping still needs this complete original. Preserve it in this input packet.");return;}
      state.sources.delete(button.dataset.remove);changing();coordinator.refresh();refresh();
    });
    $("properties").addEventListener("change",event=>{
      const node=event.target;if(node.dataset.row===undefined||state.busy)return;
      try{need(state.rosterText===$("selection-json").value,"Apply the current selection before editing a property row.");const value=currentSelection(),key=node.dataset.key;value.properties[Number(node.dataset.row)][key]=key==="templateId"&&node.value===""?null:node.value;editSelection(value);}
      catch(error){notice(error.message);}
    });
    $("properties").addEventListener("click",event=>{
      const button=event.target.closest("[data-delete]");if(!button||state.busy)return;
      try{need(state.rosterText===$("selection-json").value,"Apply the current selection before removing a property row.");const value=currentSelection();value.properties.splice(Number(button.dataset.delete),1);editSelection(value);notice("Removed the selected draft row. Its referenced examples must be deliberately updated.");}
      catch(error){notice(error.message);}
    });
    $("add-property").addEventListener("click",()=>work(async()=>{
      const value=currentSelection();need(value.properties.length<50,"The original scope contains at most 50 properties.");
      value.properties.push({key:"",address:"",city:"",state:"",zip:"",bbl:"",bin:"",buyerPropertyId:"",templateId:null,
        inspection:"UNSELECTED",identityNote:"",sourceIds:[]});editSelection(value);
    }));
    $("selection-json").addEventListener("input",()=>{changing();clearProperties();coordinator.invalidate();});$("review-json").addEventListener("input",changing);
    $("apply-selection").addEventListener("click",()=>work(async()=>{await selectedInput();notice("The complete draft selection is retained in this view.");}));
    $("template").addEventListener("click",()=>work(async()=>{
      const seed=requireInput("seed"),corpus=requireInput("cohort");
      const selected=core.propertyTemplate(seed.value,corpus);await fromText("selection",JSON.stringify(selected,null,2)+"\n");
      notice("Original Workshare and plan retained. Enter the actual property roster, operators, source and customer decisions.");
    }));
    $("prepare").addEventListener("click",()=>work(async()=>{
      await selectedInput();const selected=requireInput("selection"),seed=requireInput("seed"),corpus=requireInput("cohort"),generation=state.generation;
      const result=core.preparePropertyInstallation({seed:seed.value,profile,selection:selected.value,corpus,
        selectionSha256:selected.sha256,selectionBytes:selected.bytes,caseState:state.inputs.has("case-state")?requireInput("case-state").value:null,
        files:selectedFiles(selected.value.sourceFiles),previous:previous()});
      need(bytes(JSON.stringify(result.document)).length<=128*1024,"The full native Installation document exceeds 128 KiB.");
      await showResult(result,"prepare",generation);
    }));
    $("review-template").addEventListener("click",()=>work(async()=>{
      await selectedInput();const selected=requireInput("selection"),nativeSeed=requireInput("return-seed"),installation=requireInput("installation");
      const value=core.propertyReviewTemplate({nativeSeed:nativeSeed.value,installation:installation.value,selection:selected.value,
        selectionSha256:selected.sha256,selectionBytes:selected.bytes});
      const name="Property_Selection_"+selected.sha256.slice(0,16)+".json",next=new Map(state.sources),old=next.get(name);
      need(!old||old.sha256===selected.sha256&&old.raw.length===selected.raw.length,"Another retained original has the selection-copy filename.");
      next.set(name,{name,raw:selected.raw,sha256:selected.sha256});
      need([...next.values()].reduce((total,row)=>total+row.raw.length,0)<=24*1024*1024,
        "The complete selection copy would exceed the 24 MiB source roster. Preserve all originals through the CLI or select the complete receiving-stage sources first.");
      await fromText("review",JSON.stringify(value,null,2)+"\n");
      state.sources=next;changing();refresh();
      notice("The return template keeps every original check definition. Enter actual observations and source IDs, freeze and attach the complete review, then reload the current case catalogue and native Return seed before preparation.");
    }));
    $("prepare-return").addEventListener("click",()=>work(async()=>{
      await selectedInput();await fromText("review",$("review-json").value);
      const selected=requireInput("selection"),review=requireInput("review"),nativeSeed=requireInput("return-seed"),installation=requireInput("installation"),
        generation=state.generation;
      const result=core.preparePropertyReturn({nativeSeed:nativeSeed.value,installation:installation.value,selection:selected.value,
        selectionSha256:selected.sha256,review:review.value,reviewSha256:review.sha256,reviewBytes:review.bytes,
        caseState:requireInput("case-state").value,files:selectedFiles(review.value.sourceFiles),previous:previous()});
      await showResult(result,"review",generation);
    }));
    $("download-selection").addEventListener("click",()=>work(async()=>{const row=await selectedInput();download("PROPERTY_SELECTION.json",row.raw);}));
    $("download-review").addEventListener("click",()=>work(async()=>{const row=await fromText("review",$("review-json").value);download("PROPERTY_REVIEW.json",row.raw);}));
    $("download-native").addEventListener("click",()=>{
      const result=state.result;if(!result||result.generation!==state.generation)return;
      download(result.mode==="prepare"?"installation-input.json":"installation-return-input.json",
        JSON.stringify(result.mode==="prepare"?result.value.document:result.value.inputs,null,2)+"\n");
    });
    $("download-report").addEventListener("click",()=>{const result=state.result;if(result&&result.generation===state.generation)download("PROPERTY_REPORT.html",result.html,"text/html");});
    $("download-packet").addEventListener("click",()=>work(packet));
    $("load-packet").addEventListener("change",()=>work(async()=>{
      const file=$("load-packet").files[0];need(file&&file.size<=64*1024*1024,"Select a complete input packet up to 64 MiB.");
      const value=JSON.parse(await file.text());need(value.schema==="stellar-forge.property-commissioning-editor.v1"&&Array.isArray(value.files),"Select the complete original editor packet.");
      const inputs=new Map(),sources=new Map();let total=0;
      for(const member of value.files) {
        need(typeof member.name==="string"&&typeof member.base64==="string"&&member.base64.length<=12*1024*1024,"Keep the complete bounded file inventory.");
        const raw=fromBase64(member.base64);need(raw.length===member.bytes&&raw.length<=8*1024*1024&&await hash(raw)===member.sha256,"An original packet member differs.");
        need(["cohort","seed","selection","previous","return-seed","installation","review","case-state","coordinator","source"].includes(member.kind),"Unknown complete input kind.");
        const target=member.kind==="source"?sources:inputs,key=member.kind==="source"?member.name:member.kind;
        need(!target.has(key),"A packet repeats an original selection.");
        if(member.kind==="source"){total+=raw.length;need(total<=24*1024*1024,"The full original source exceeds 24 MiB.");}else json(raw);
        target.set(key,{name:member.name,raw,sha256:member.sha256});
      }
      const coordinatorDraft=coordinator.validateDraft(inputs.has("coordinator")?json(inputs.get("coordinator").raw):{schema:"stellar-forge.property-coordinator-draft.v1",mapping:null,history:[],selectedSource:"",page:0,sourcePage:0},[...sources.values()]);
      if(inputs.has("selection"))need(Array.isArray(json(inputs.get("selection").raw).properties)&&json(inputs.get("selection").raw).properties.length<=50,"Keep the complete ordered property roster within 50 rows.");
      state.inputs=inputs;state.sources=sources;changing();
      $("selection-json").value=inputs.has("selection")?text(inputs.get("selection").raw):"";
      $("review-json").value=inputs.has("review")?text(inputs.get("review").raw):"";
      if(inputs.has("selection"))renderProperties(json(inputs.get("selection").raw));
      else clearProperties("No selection loaded");
      coordinator.restore(coordinatorDraft);
      refresh();notice("Complete inputs reopened and every member hash verified. Prepare again against the retained native seed; this packet carries no native save acknowledgment.");
    }));
  })().catch(error=>{$("loading").textContent=error.message;});
}
export function renderPropertyEditor(program) {
  const file=(kind,label)=>'<label class="file">'+esc(label)+'<input type="file" data-input="'+kind+'" accept=".json,application/json"></label><p class="muted" id="'+kind+'-selected">No file selected</p>';
  const body='<header><div class="eyebrow">Original Installation desk · customer workorder</div><h1>Property commissioning</h1>'+
    '<p>Prepare the complete Propply / RentCheck customer selection, carry it into the original Installation, and return actual receiving observations against its saved edition.</p>'+
    '<p class="muted">Files stay in this browser view. Download the complete input packet before closing. This editor makes no vendor, inspection, payment or native case call.</p></header>'+
    '<main><p id="loading">Loading the complete maintained compiler…</p><div id="editor" hidden>'+
    '<p id="notice" role="status" aria-live="polite" class="notice" hidden></p><nav><a href="#originals">Original source</a><a href="#property-coordinator">Guided selection</a><a href="#roster">Property roster</a><a href="#selection">Source and rights</a><a href="#return">Customer return</a><a href="#result">Prepared output</a></nav>'+
    '<section id="originals" class="card"><h2>1. Original customer and Installation</h2><div class="grid"><div>'+
    file("cohort","Full original cohort.json")+file("seed","Original native Workshare seed")+file("case-state","Current complete native case")+'</div><div>'+
    file("selection","Existing property selection")+file("previous","Prior selection edition")+'</div></div>'+
    '<div class="actions"><button id="template" type="button">Start from original native seed</button><label class="file">Reopen complete input packet<input id="load-packet" type="file" accept=".json"></label></div>'+
    '<p>Keep the original buyer case, six phases and 20 active business days. The native seed owns commercial, cost assignment, history and current plan bindings. A new selection edition requires its exact prior file and reason; use the maintained revise command.</p></section>'+
    '<section id="property-coordinator" class="card"></section><section id="roster" class="card"><h2>2. Complete property roster</h2><div class="actions"><strong id="property-count">No selection loaded</strong><button id="add-property">Add actual property</button></div>'+
    '<p>Use original keys and opaque buyer/template IDs. Rows keep their original order. Address similarity, a BBL or a BIN does not by itself establish an inspection match.</p>'+
    '<div class="table"><table><thead><tr>'+["Key","Address","City","State","ZIP","BBL","BIN","Buyer property","Template","Inspection",""].map(v=>"<th>"+v+"</th>").join("")+
    '</tr></thead><tbody id="properties"></tbody></table></div></section>'+
    '<section id="selection" class="card"><h2>3. Source, rights, hosts and acceptance examples</h2>'+
    '<p>The complete editable selection contains both source editions, permitted field pointers, actual source/host decisions, one report/PMS route, payment selection and five customer examples. Empty fields remain unselected. Approved statements require their actual named decision and complete source.</p>'+
    '<label for="selection-json">Advanced complete property selection JSON</label><textarea id="selection-json" spellcheck="false"></textarea>'+
    '<div class="actions"><button id="apply-selection">Apply draft edits</button><button id="download-selection">Download selection</button>'+
    '<label class="file">Add complete original source files<input id="source-files" type="file" multiple></label></div>'+
    '<div class="table"><table><thead><tr><th>Original filename</th><th>Bytes</th><th>SHA-256</th><th>Selection</th></tr></thead><tbody id="source-roster"></tbody></table></div>'+
    '<p>Source descriptors must match the full files. Freeze and attach the exact selection JSON through the original case, then load the current case catalogue and a native seed read at that same version. The retained selection keeps its original case/plan observation while the current save version advances. Its matched source ID is included in the Installation.</p>'+
    '<button id="prepare" class="primary">Prepare original Installation input</button></section>'+
    '<section id="return" class="card"><h2>4. Customer acceptance and original return</h2><div class="grid"><div>'+file("return-seed","Original native Installation Return seed")+
    file("installation","Complete saved Installation edition")+'</div><div>'+file("review","Saved property review")+
    '<button id="review-template">Prepare complete return template</button></div></div>'+
    '<p>Review every property and both authentic source outcomes, retain real inspection/report identities and explicit exceptions, and record the five customer examples and independent reopen. Original checks start KEEP in the native Return seed. OBSERVE preserves the saved phase’s prior notes and evidence while recording the new named observation. Download and attach the complete review; load the current native case and Return seed after attachment.</p>'+
    '<label for="review-json">Complete customer review JSON</label><textarea id="review-json" spellcheck="false"></textarea>'+
    '<div class="actions"><button id="download-review">Download review</button><button id="prepare-return" class="primary">Prepare original Installation Return input</button></div></section>'+
    '<section id="result" class="card" hidden><h2>Prepared output</h2><p id="result-summary"></p><div class="actions">'+
    '<button id="download-native">Download native input</button><button id="download-report">Download complete report</button></div>'+
    '<details><summary>Complete prepared result</summary><pre id="result-details"></pre></details></section>'+
    '<section class="card"><h2>Keep and reopen the whole selection</h2><button id="download-packet">Download complete input packet</button>'+
    '<p>This includes every loaded native input, original source file and current editable selection/review with its exact hash. Reopening validates all members and prepares against the original native APIs again. Installation save/return acknowledgments remain in the original application.</p></section></div></main>'+
    '<footer>HPD project participation, Propply aggregate conditions and actual inspection outcomes retain their separate meanings. Original property and commercial owners retain runtime and relationship ownership.</footer>';
  const serialized=JSON.stringify(program).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
  return shell("Property commissioning",body,'<script id="program" type="application/json">'+serialized+
    '</script><script type="module">('+editorMain.toString()+')();</script>');
}

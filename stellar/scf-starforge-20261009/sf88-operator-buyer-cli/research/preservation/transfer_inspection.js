(() => {
"use strict";
window.createTransferInspectionPanel=function({root,api,mutation,refreshState}){
  const el=(tag,text,attrs={})=>{const n=document.createElement(tag);if(text!==null)n.textContent=String(text);
    for(const[k,v]of Object.entries(attrs))n.setAttribute(k,String(v));return n;};
  const field=(label,node)=>{const box=el("div",null,{class:"field"});box.append(el("label",label,{for:node.id}),node);return box;};
  const pretty=v=>JSON.stringify(v,null,2);
  let state=null,busy=false,hostBusy=false,connected=false,request=0,viewIntent=0,loading=false,selected="",offset=0,loaded=null,pending=null;
  const status=el("p","Select a complete package.",{id:"transfer-status",role:"status","aria-live":"polite"});
  const intro=el("div",null,{class:"panel"});
  intro.append(el("h2","Inspect and compare preservation transfers"),
    el("p","Open exact retained BagIt packages and read their complete original file and metadata selections. Compare two editions before deciding what to retain or submit. Inspection does not send a package to a repository."),
    el("p","Supported original profiles: research metadata and original-file collection BagIt. Use the existing destination controls for repository operations.",{class:"muted"}));
  const actions=el("div",null,{class:"panel"});
  const sourceControls=[];
  function source(label,index){
    const box=el("div",null,{class:"panel"}),kind=el("select",null,{id:"transfer-kind-"+index});
    kind.append(el("option","Saved delivery package",{value:"artifact"}),el("option","Original ZIP on this host",{value:"path"}));
    const saved=el("select",null,{id:"transfer-package-"+index}),path=el("input",null,{id:"transfer-path-"+index,type:"text"});
    box.append(el("h3",label),field("Package source",kind),field("Retained package",saved),field("Complete local ZIP path",path));
    function show(){saved.parentElement.hidden=kind.value!=="artifact";path.parentElement.hidden=kind.value!=="path";}
    kind.addEventListener("change",show);show();
    sourceControls.push({kind,saved,path,box});
    return box;
  }
  const grid=el("div",null,{class:"grid two"});grid.append(source("Selected package / previous edition",0),source("Current edition",1));
  const inspect=el("button","Inspect selected package",{id:"transfer-inspect",type:"button",class:"primary"});
  const compare=el("button","Compare complete editions",{id:"transfer-compare",type:"button"});
  const buttons=el("div",null,{class:"actions"});buttons.append(inspect,compare);
  actions.append(grid,buttons,status);
  const history=el("div",null,{class:"panel"}),reports=el("select",null,{id:"transfer-report-select"});
  const downloads=el("div",null,{class:"actions",id:"transfer-downloads"});
  const summary=el("p","No report selected.",{id:"transfer-summary"});
  const selection=el("pre","",{id:"transfer-selection",class:"code"});
  history.append(el("h3","Retained complete reports"),field("Original inspection or ordered comparison",reports),summary,downloads);
  const details=el("details",null);details.append(el("summary","Complete package identities"),selection);history.append(details);
  const filter=el("input",null,{id:"transfer-search",type:"search",placeholder:"Search complete original rows"});
  const changes=el("select",null,{id:"transfer-changes"});
  changes.append(el("option","All original rows",{value:"all"}),el("option","Changed rows only",{value:"changed"}));
  const go=el("button","Apply view",{id:"transfer-filter",type:"button"});
  const previous=el("button","Previous 50",{id:"transfer-previous",type:"button"});
  const next=el("button","Next 50",{id:"transfer-next",type:"button"});
  const pages=el("span","",{id:"transfer-page",class:"muted"});
  const filters=el("div",null,{class:"actions"});filters.append(filter,changes,go,previous,next,pages);history.append(filters);
  const table=el("table",null),head=el("thead",null),body=el("tbody",null,{id:"transfer-rows"});
  table.append(head,body);const wrap=el("div",null,{class:"table-wrap"});wrap.append(table);history.append(wrap);
  const original=el("div",null,{class:"panel",id:"transfer-original"});original.hidden=true;
  const rowTitle=el("h3",""),rowBody=el("pre","",{class:"code"});
  original.append(rowTitle,el("p","This is the full original row or complete before/after pair. No metadata values are truncated."),rowBody);
  root.append(intro,actions,history,original);
  function controls(){
    for(const n of root.querySelectorAll("button,input,select"))n.disabled=busy||hostBusy||!connected;
    for(const n of [go,filter,changes,previous,next])n.disabled=busy||hostBusy||!connected||loading||!loaded;
    previous.disabled=busy||hostBusy||!connected||loading||!loaded||offset===0;
    next.disabled=busy||hostBusy||!connected||loading||!loaded||offset+50>=loaded.total;
    reports.disabled=busy||!connected||reports.options.length<2;
    // Reading a completed retained report remains available during unrelated worker operations.
  }
  function sourceValue(index){
    const s=sourceControls[index];if(s.kind.value==="artifact"){
      if(!s.saved.value)throw Error("Choose the complete saved package.");return{kind:"artifact",id:s.saved.value};
    }
    if(!s.path.value.trim())throw Error("Enter the complete original ZIP path on this host.");
    return{kind:"path",path:s.path.value.trim()};
  }
  async function action(fn){
    if(busy)return;busy=true;controls();
    try{await fn();}catch(e){status.textContent=e.message||String(e);status.setAttribute("role","alert");}
    finally{busy=false;controls();}
  }
  function reportLinks(artifact){
    downloads.replaceChildren();
    const stem=artifact.path.replace(/\.json$/,"");
    for(const a of state?.artifacts||[]){
      if(a.path===stem+".json"||a.path===stem+".html"||a.path===stem+".csv")
        downloads.append(el("a","Download complete "+a.path.split(".").pop().toUpperCase(),{href:"/download?id="+encodeURIComponent(a.id),class:"button"}));
    }
    const packages=loaded?.selection;
    for(const [name,value]of Object.entries(packages||{})){
      if(!value?.artifactId)continue;
      downloads.append(el("a",name==="previousPackage"?"Download previous original ZIP":name==="currentPackage"?"Download current original ZIP":"Download original ZIP",
        {href:"/download?id="+encodeURIComponent(value.artifactId),class:"button"}));
    }
  }
  async function load(id,desiredOffset=0){
    const sequence=++request;selected=id;reports.value=id;original.hidden=true;
    loaded=null;offset=0;loading=Boolean(id);selection.textContent="";pages.textContent="";
    head.replaceChildren();body.replaceChildren();downloads.replaceChildren();rowTitle.textContent="";rowBody.textContent="";
    summary.textContent=id?"Loading the selected complete report…":"No report selected.";controls();
    if(!id)return;
    try{
    const query=filter.value,changed=changes.value==="changed";
    const value=await api("/api/transfer-report?id="+encodeURIComponent(id)+"&offset="+desiredOffset+"&q="+encodeURIComponent(query)+"&changed="+changed);
    if(sequence!==request||selected!==id)return;
    loaded=value;offset=value.offset;
    summary.textContent=(value.schema.endsWith(".comparison")?"Complete comparison":"Complete inspection")+" · "+value.kind+
      " · "+pretty(value.summary)+" · "+value.note;
    selection.textContent=pretty(value.selection);reportLinks(value.artifact);
    pages.textContent=value.total?(offset+1)+"–"+Math.min(offset+50,value.total)+" of "+value.total+" rows":"No matching rows";
    head.replaceChildren();const tr=el("tr",null),comparison=value.schema.endsWith(".comparison");
    for(const label of ["Original identifier or path",comparison?"Observed changes":"Selection","Original values"])tr.append(el("th",label,{scope:"col"}));
    head.append(tr);body.replaceChildren();
    for(const row of value.rows){
      const line=el("tr",null),open=el("button","Open full original values",{type:"button","data-transfer-row":row.id});
      open.addEventListener("click",()=>{viewIntent++;rowTitle.textContent=row.id;rowBody.textContent=pretty(row);original.hidden=false;original.scrollIntoView({block:"nearest"});});
      line.append(el("td",row.id,{class:"mono"}),el("td",comparison?(row.changes.join(", ")||"UNCHANGED"):(row.included?"Included":"Excluded")));
      const cell=el("td",null);cell.append(open);line.append(cell);body.append(line);
    }
    if(!value.rows.length){const row=el("tr",null);row.append(el("td","No original rows match this view.",{colspan:3}));body.append(row);}
    }catch(error){
      if(sequence!==request||selected!==id)return;
      summary.textContent="The selected report could not be opened. Choose it again to retry.";
      status.textContent="Report "+id+": "+(error.message||String(error));status.setAttribute("role","alert");
    }finally{if(sequence===request){loading=false;controls();}}
  }
  async function run(mode){
    const selections=mode==="inspect"?[sourceValue(0)]:[sourceValue(0),sourceValue(1)];
    const intent=viewIntent;
    const value=await mutation("/api/transfer-report",{mode,selections});
    pending={id:value.job.id,viewIntent:intent};status.textContent="The original "+mode+" operation is retained in Activity.";status.setAttribute("role","status");
    await refreshState();
  }
  inspect.addEventListener("click",()=>action(()=>run("inspect")));
  compare.addEventListener("click",()=>action(()=>run("compare")));
  reports.addEventListener("change",()=>{viewIntent++;action(()=>load(reports.value));});
  go.addEventListener("click",()=>{viewIntent++;action(()=>load(selected,0));});
  previous.addEventListener("click",()=>{viewIntent++;action(()=>load(selected,Math.max(0,offset-50)));});
  next.addEventListener("click",()=>{viewIntent++;action(()=>load(selected,offset+50));});
  filter.addEventListener("input",()=>{viewIntent++;});
  changes.addEventListener("change",()=>{viewIntent++;});
  function update(value){
    state=value;
    const archives=(value.artifacts||[]).filter(a=>a.available&&a.name.toLowerCase().endsWith(".zip")&&a.kind!=="complete-workspace");
    for(const s of sourceControls){const selected=s.saved.value;s.saved.replaceChildren(el("option","Choose a retained ZIP",{value:""}));
      for(const a of archives)s.saved.append(el("option",a.name+" · "+a.kind,{value:a.id}));s.saved.value=selected;}
    const results=(value.artifacts||[]).filter(a=>["transfer-inspect-json","transfer-compare-json"].includes(a.kind));
    reports.replaceChildren(el("option","Choose a complete retained report",{value:""}));
    for(const a of results)reports.append(el("option",a.name+" · "+a.createdAt,{value:a.id}));
    reports.value=selected;
    if(pending){const job=(value.jobs||[]).find(j=>j.id===pending.id);
      if(job?.state==="COMPLETED"){
        const id=job.result.artifacts.json.id,open=pending.viewIntent===viewIntent;pending=null;
        status.textContent=open?"Complete report and original package bytes are retained.":"The new complete report is available in Retained complete reports. Your selected view is unchanged.";
        if(open)load(id,0).catch(e=>{status.textContent=e.message;status.setAttribute("role","alert");});
      }else if(job&&["FAILED","INTERRUPTED"].includes(job.state)){
        pending=null;status.textContent=job.state+": "+(job.error?.message||job.message||"Inspect the original Activity operation.");
        status.setAttribute("role","alert");
      }
    }
    controls();
  }
  return{update,controls(value){hostBusy=Boolean(value.busy);connected=Boolean(value.connected);controls();}};
};
})();

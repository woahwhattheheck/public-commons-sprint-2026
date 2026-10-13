/**
 * Complete colleague correction review in the original Audit operator.
 * The native return core owns all source binding, comparison and validation.
 */
const clone = value => JSON.parse(JSON.stringify(value));
const keyOf = row => row.sourceId + ":" + row.returnedSourceId;
const text = value => value === undefined || value === null ? "" : String(value);
const json = value => JSON.stringify(value, null, 2);
const element = (tag, value, cls) => {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = text(value);
  if (cls) node.className = cls;
  return node;
};
const fieldSignature = row => JSON.stringify([row.path,row.kind,row.attributeName,row.baseline,row.current,row.returned,row.patchable]);
const fieldMap = row => new Map((row?.changedFields || []).map(field => [field.fieldId, field]));

/** Preserve decisions only while all three compared native values stay exact. */
export function rebaseCorrectionSelections(saved, before, after) {
  const oldRows = new Map((before?.sources || []).map(row => [keyOf(row), row]));
  return (saved || []).flatMap(selection => {
    const row = after.sources.find(item => keyOf(item) === keyOf(selection));
    const old = oldRows.get(keyOf(selection));
    if (!row || !old) return [];
    const oldFields = fieldMap(old), newFields = fieldMap(row);
    const sameCurrent = row.current.id === old.current.id && row.current.sha256 === old.current.sha256;
    const sameBaseline = row.baseline.id === old.baseline.id && row.baseline.sha256 === old.baseline.sha256;
    const decisions = sameBaseline ? (selection.decisions || []).filter(decision =>
      oldFields.has(decision.fieldId) && newFields.has(decision.fieldId) &&
      fieldSignature(oldFields.get(decision.fieldId)) === fieldSignature(newFields.get(decision.fieldId))
    ) : [];
    return [{...selection,
      baselineRevisionId:row.baseline.id,expectedCurrentRevisionId:row.current.id,
      expectedCurrentSha256:row.current.sha256,
      mode:selection.mode === "returned-document" && !sameCurrent ? "" : selection.mode,
      decisions,reviewIds:(selection.reviewIds || []).filter(id =>
        (row.reviews || []).some(review => review.id === id) &&
        json((old.reviews || []).find(review => review.id === id)) === json(row.reviews.find(review => review.id === id)))
    }];
  });
}

export function mountCorrectionDesk(host) {
  const root = document.getElementById("correction-desk");
  const ui = id => document.getElementById(id);
  let documentState = null, loadedWorkspace = null, loadingWorkspace = null, generation = 0, active = null;
  let page = 0, plan = null, result = null, revision = 0, databasePromise = null;
  const connected = () => host.state()?.workspaceId;
  const busy = () => host.busy() || Boolean(host.pending()) || !connected();
  const currentSource = () => documentState?.preview?.sources.find(row => keyOf(row) === active);
  const selectionFor = row => documentState?.selections.find(item => keyOf(item) === keyOf(row));
  function button(label, fn, mutation=false) {
    const node = element("button",label); node.type="button";
    node.dataset.correctionControl="";
    if (mutation) node.dataset.mutation="";
    node.addEventListener("click",() => host.run(label,fn));
    return node;
  }
  function detail(label,value) {
    const node=element("details");node.append(element("summary",label),element("pre",json(value)));return node;
  }
  function database() {
    if (!databasePromise) databasePromise = new Promise((resolve,reject) => {
      const request=indexedDB.open("audit-exchange-colleague-corrections",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("drafts",{keyPath:"draftId"});
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error || new Error("The correction review could not be retained."));
    });
    return databasePromise;
  }
  async function storage(write,value) {
    const db=await database();
    return await new Promise((resolve,reject) => {
      const transaction=db.transaction("drafts",write?"readwrite":"readonly");
      const request=write?transaction.objectStore("drafts").put(value):transaction.objectStore("drafts").get(value);
      let stored;
      request.onsuccess=()=>{stored=request.result;};
      transaction.oncomplete=()=>resolve(stored);
      transaction.onerror=()=>reject(transaction.error || new Error("The correction review could not be retained."));
      transaction.onabort=()=>reject(transaction.error || new Error("The correction review was not saved."));
    });
  }
  async function commit(next,{keepPlan=false}={}) {
    const workspaceId=connected();
    if (!workspaceId || next.workspaceId!==workspaceId) throw new Error("Reopen this correction review in its original workspace.");
    next={...next,draftId:workspaceId+":"+host.tabId()};
    await storage(true,next);
    if (connected()!==workspaceId) throw new Error("The workspace changed while its correction review was saved.");
    documentState=next;revision++;
    if (!keepPlan) plan=null;
    result=null;render();
  }
  function selectedInput() {
    if (!documentState?.preview) throw new Error("Compare the complete returned project first.");
    if (!documentState.selections.length) throw new Error("Select the original sources to review.");
    return {
      contentBase64:documentState.contentBase64,name:documentState.name,
      expectedPreviewSha256:documentState.preview.previewSha256,
      baselines:documentState.preview.sources.map(row=>({sourceId:row.sourceId,returnedSourceId:row.returnedSourceId,baselineRevisionId:row.baseline.id})),
      selections:clone(documentState.selections)
    };
  }
  async function compare(next=documentState) {
    if (!next?.contentBase64) throw new Error("Choose the colleague's complete workspace or application ZIP.");
    const previous=next.preview;
    const value=await host.read("return.preview",{contentBase64:next.contentBase64,name:next.name,
      baselines:(next.selections || []).map(row=>({sourceId:row.sourceId,returnedSourceId:row.returnedSourceId,baselineRevisionId:row.baselineRevisionId}))});
    const selections=rebaseCorrectionSelections(next.selections,previous,value);
    await commit({...next,preview:value,selections});
    if (!value.sources.some(row=>keyOf(row)===active)) active=value.sources.length?keyOf(value.sources[0]):null;
    page=0;render();
    host.notice("Compared the complete return against the current original workspace. Review the three versions and choose changes to apply.");
  }
  async function changeSelection(row,change) {
    const next=clone(documentState);
    const position=next.selections.findIndex(item=>keyOf(item)===keyOf(row));
    let selection=position>=0?next.selections[position]:{
      sourceId:row.sourceId,returnedSourceId:row.returnedSourceId,
      baselineRevisionId:row.baseline.id,expectedCurrentRevisionId:row.current.id,
      expectedCurrentSha256:row.current.sha256,mode:row.structuralSummary.compatible?"fields":"",
      decisions:[],reviewIds:[],note:""
    };
    selection=change(selection);
    if (selection===null) { if(position>=0) next.selections.splice(position,1); }
    else if(position>=0) next.selections[position]=selection;
    else next.selections.push(selection);
    await commit(next);
  }
  function optionSelect(values,value,onChange) {
    const select=element("select");
    for(const [id,label] of values) {const option=element("option",label);option.value=id;select.append(option);}
    select.value=value||"";
    select.dataset.correctionControl="";
    select.addEventListener("change",()=>host.run("Retain correction decision",async()=>{
      try { await onChange(select.value); } catch(error) { render();throw error; }
    }));
    return select;
  }
  function scalar(value) {
    if(value===null || value===undefined) return element("span","Absent","muted");
    const node=element("span",value.value === "" ? "(empty string)" : value.value,"literal");
    return node;
  }
  function table(target,columns,rows) {
    target.replaceChildren();
    if(!rows.length) {target.append(element("p","No records in this selection.","empty"));return;}
    const wrap=element("div",undefined,"table-wrap"),table=element("table"),head=element("thead"),header=element("tr");
    for(const [label] of columns){const th=element("th",label);th.scope="col";header.append(th);}
    head.append(header);table.append(head);const body=element("tbody");
    for(const row of rows){const tr=element("tr");for(const [,renderCell] of columns){const cell=element("td"),value=renderCell(row);cell.append(value instanceof Node?value:document.createTextNode(text(value)));tr.append(cell);}body.append(tr);}
    table.append(body);wrap.append(table);target.append(wrap);
  }
  function renderSources() {
    const preview=documentState?.preview;
    if (!preview) {ui("correction-sources").replaceChildren(element("p","Choose the complete returned project to compare its sources.","empty"));return;}
    ui("correction-archive").textContent=documentState.name+" · "+preview.archive.bytes.toLocaleString()+" bytes · "+preview.archive.sha256;
    table(ui("correction-sources"),[
      ["Apply",row=>{const label=element("label"),input=element("input");input.type="checkbox";input.checked=Boolean(selectionFor(row));input.dataset.correctionControl="";input.setAttribute("aria-label","Include "+(row.name||row.sourceName||row.sourceId));input.addEventListener("change",()=>host.run("Retain source selection",()=>changeSelection(row,selection=>input.checked?selection:null)));label.append(input);return label;}],
      ["Original source",row=>button(row.name||row.sourceName||row.sourceId,async()=>{active=keyOf(row);page=0;render();})],
      ["Original sent",row=>"Revision "+row.baseline.number],
      ["Current original",row=>"Revision "+row.current.number],
      ["Returned",row=>"Revision "+row.returned.number],
      ["Changes",row=>(row.changedFields||[]).length+" fields · "+(row.reviews||[]).length+" reviews"]
    ],preview.sources);
    const unmatched=ui("correction-unmatched");unmatched.replaceChildren();
    if(preview.unmatchedSources?.length) unmatched.append(element("h3","Sources outside this original project"),element("p","These sources remain in the complete return. Their original source relationship must be established before applying corrections."),detail("Complete unmatched source information",preview.unmatchedSources));
  }
  function renderSource() {
    const row=currentSource(),panel=ui("correction-source-review");panel.hidden=!row;
    if(!row)return;
    const selected=selectionFor(row);
    ui("correction-source-title").textContent=row.name||row.sourceName||row.sourceId;
    ui("correction-source-binding").textContent="Original "+row.sourceId+" · returned "+row.returnedSourceId;
    ui("correction-source-details").replaceChildren(detail("Complete original, current and returned source identities",{baseline:row.baseline,current:row.current,returned:row.returned,structuralSummary:row.structuralSummary}));
    const baseline=ui("correction-baseline");baseline.replaceChildren();
    const label=element("label","Original sent revision");
    label.append(optionSelect((row.baselineCandidates||[row.baseline]).map(item=>[item.id,"Revision "+item.number+" · "+item.sha256.slice(0,12)]),row.baseline.id,async value=>{
      await changeSelection(row,selection=>({...selection,baselineRevisionId:value,decisions:[],mode:"",reviewIds:[]}));
      await compare();
    }));baseline.append(label);
    const modes=[["","Choose how to apply"],["current","Keep current XML; receive selected reviews"]];
    if(row.structuralSummary.compatible)modes.push(["fields","Review individual native fields"]);
    modes.push(["returned-document","Use the complete returned XML document"]);
    const mode=ui("correction-mode");mode.replaceChildren();const modeLabel=element("label","Application choice");modeLabel.append(optionSelect(modes,selected?.mode||"",value=>changeSelection(row,selection=>({...selection,mode:value,decisions:value==="fields"?selection.decisions:[]}))));mode.append(modeLabel);
    ui("correction-structural").textContent=row.structuralSummary.compatible
      ?"The three documents support comparison of the same native fields."
      :"The document structure changed. Review the full differences and choose the current or complete returned XML explicitly.";
    const useReturned=ui("correction-use-compatible");useReturned.disabled=busy()||!row.structuralSummary.compatible;
    const fields=row.changedFields||[];page=Math.min(page,Math.max(0,Math.ceil(fields.length/40)-1));
    ui("correction-field-range").textContent=fields.length?(page*40+1)+"–"+Math.min((page+1)*40,fields.length)+" of "+fields.length+" fields":"No native scalar changes.";
    ui("correction-previous").disabled=busy()||page===0;
    ui("correction-next").disabled=busy()||(page+1)*40>=fields.length;
    table(ui("correction-fields"),[
      ["Native field",field=>{const node=element("div");node.append(element("strong",field.name||field.kind),element("code",field.path),element("span",field.attributeName||"","muted"));return node;}],
      ["Original sent",field=>scalar(field.baseline)],["Current original",field=>scalar(field.current)],["Returned",field=>scalar(field.returned)],
      ["Review",field=>{
        const node=element("div");node.append(element("p",field.status,"muted"));
        if(selected?.mode!=="fields"){node.append(element("span","The selected document choice applies."));return node;}
        const decision=selected.decisions.find(item=>item.fieldId===field.fieldId);
        const values=[["","Choose"],["current","Keep current"]];
        if(field.patchable)values.push(["returned","Use returned"],["custom","Use reviewed value"]);
        const select=optionSelect(values,decision?.choice||"",choice=>changeSelection(row,selection=>({...selection,decisions:[...selection.decisions.filter(item=>item.fieldId!==field.fieldId),...(choice?[{fieldId:field.fieldId,choice,...(choice==="custom"?{value:field.current?.value||""}:{})}]:[])]})));
        select.setAttribute("aria-label","Decision for "+field.path);node.append(select);
        if(decision?.choice==="custom"){const value=element("textarea");value.rows=3;value.value=decision.value;value.dataset.correctionControl="";value.setAttribute("aria-label","Reviewed value for "+field.path);value.addEventListener("change",()=>host.run("Retain reviewed native value",()=>changeSelection(row,selection=>({...selection,decisions:selection.decisions.map(item=>item.fieldId===field.fieldId?{...item,value:value.value}:item)}))));node.append(value);}
        return node;
      }]
    ],fields.slice(page*40,(page+1)*40));
    table(ui("correction-reviews"),[
      ["Receive",review=>{const input=element("input");input.type="checkbox";input.dataset.correctionControl="";input.checked=Boolean(selected?.reviewIds.includes(review.id));input.setAttribute("aria-label","Receive "+review.title);input.addEventListener("change",()=>host.run("Retain review selection",()=>changeSelection(row,selection=>({...selection,reviewIds:input.checked?[...selection.reviewIds.filter(id=>id!==review.id),review.id]:selection.reviewIds.filter(id=>id!==review.id)}))));return input;}],
      ["Review",review=>{const node=element("div");node.append(element("strong",review.title),element("p",review.note),detail("Complete returned review and evidence",review));return node;}],
      ["State",review=>review.status],["Assignee",review=>review.assignee||""]
    ],row.reviews||[]);
    ui("correction-source-note").value=selected?.note||"";
  }
  function renderPlan() {
    const target=ui("correction-plan");target.replaceChildren();
    if(!plan)return;
    target.append(element("h3","Validated application plan"),element("p","Review the native validation and complete decisions before saving all selected sources together."),detail("Complete native plan",plan));
    for(const row of plan.sources||[]){
      const article=element("article");article.append(element("h4",row.name||row.sourceName||row.sourceId),detail("Native validation",row.validation),detail("Reviewed changes and returned reviews",row));target.append(article);
    }
  }
  function render() {
    ui("correction-file-status").textContent=documentState?.contentBase64
      ?documentState.name+" · complete file and review choices retained in this browser."
      :"Choose the colleague's complete workspace or application ZIP.";
    renderSources();renderSource();renderPlan();
    ui("correction-accept-diagnostics").checked=false;
    const out=ui("correction-result");out.replaceChildren();
    if(result){out.append(element("h3","Saved correction return"),element("p","The selected sources and reviews are retained together in a saved edition."),detail("Complete retained result",result));
      for(const item of result.sources||[])if(item.revisionId)out.append(button("Open "+(item.sourceName||item.sourceId),()=>host.openSource(item.sourceId,item.revisionId)));
      if(result.archive)out.append(button("Download original returned project",()=>host.download(result.archive)));
      out.append(button("Download complete updated workspace",()=>host.exportFile({kind:"workspace",note:"Complete original project after reviewed colleague corrections."}),true));
    }
    sync();
  }
  function sync() {
    const locked=busy();root.querySelectorAll("[data-correction-control]").forEach(node=>node.disabled=locked);
    ui("correction-compare").disabled=locked||!documentState?.contentBase64;
    ui("correction-prepare").disabled=locked||!documentState?.selections.length;
    ui("correction-save-draft").disabled=locked||!documentState;
    ui("correction-apply").disabled=locked||host.pending()||!plan||!ui("correction-accept-diagnostics").checked;
    const row=currentSource();ui("correction-use-compatible").disabled=locked||!row?.structuralSummary.compatible;
    ui("correction-previous").disabled=locked||page===0;
    ui("correction-next").disabled=locked||!row||(page+1)*40>=(row.changedFields||[]).length;
    if (connected()!==loadedWorkspace && connected()!==loadingWorkspace) {
      documentState=null;plan=null;result=null;active=null;loadedWorkspace=null;generation++;
      ui("correction-file-status").textContent="Open Colleague corrections to load this workspace's retained review.";
      ui("correction-sources").replaceChildren();ui("correction-source-review").hidden=true;ui("correction-plan").replaceChildren();ui("correction-result").replaceChildren();
    }
  }
  async function open() {
    const workspaceId=connected();if(!workspaceId)throw new Error("Open the original workspace first.");
    if(loadedWorkspace===workspaceId){render();return;}
    const ticket=++generation;loadingWorkspace=workspaceId;
    try {
      const stored=await storage(false,workspaceId+":"+host.tabId());
      if(ticket!==generation||connected()!==workspaceId)return;
      documentState=stored||null;loadedWorkspace=workspaceId;
      active=documentState?.preview?.sources[0]?keyOf(documentState.preview.sources[0]):null;plan=null;result=documentState?.lastApplied||null;page=0;render();
    } finally { if(loadingWorkspace===workspaceId)loadingWorkspace=null; }
  }
  ui("correction-file").addEventListener("change",()=>host.run("Retain complete colleague return",async()=>{
    const file=ui("correction-file").files?.[0];if(!file)return;await open();
    await commit({format:"commons.audit-exchange.corrections-draft.v1",workspaceId:connected(),name:file.name,contentBase64:await host.fileBase64(file),preview:null,selections:[]});
    active=null;page=0;await compare();
  }));
  ui("correction-draft-file").addEventListener("change",()=>host.run("Open complete correction review",async()=>{
    const file=ui("correction-draft-file").files?.[0];if(!file)return;const value=JSON.parse(await file.text());
    if(value.format!=="commons.audit-exchange.corrections-draft.v1"||value.workspaceId!==connected()||
      typeof value.contentBase64!=="string"||typeof value.name!=="string"||!Array.isArray(value.selections))
      throw new Error("Choose a complete correction review from this original workspace.");
    await open();await commit(value);await compare();
  }));
  ui("correction-compare").addEventListener("click",()=>host.run("Compare current original workspace",()=>compare()));
  ui("correction-save-draft").addEventListener("click",()=>host.run("Download complete correction review",async()=>host.downloadBytes(json(documentState)+"\n","Audit_Colleague_Correction_Review.json","application/json")));
  ui("correction-use-compatible").addEventListener("click",()=>host.run("Review compatible returned changes",async()=>{
    const row=currentSource();if(!row?.structuralSummary.compatible)throw new Error("Review the complete document structure first.");
    await changeSelection(row,selection=>({...selection,mode:"fields",decisions:(row.changedFields||[]).flatMap(field=>{
      if(field.status==="conflict"||!field.patchable&&field.status==="returned-change")return [];
      const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
      const choice=field.patchable&&same(field.baseline,field.current)&&!same(field.baseline,field.returned)?"returned":"current";
      return [{fieldId:field.fieldId,choice}];
    })}));
  }));
  ui("correction-source-note").addEventListener("change",()=>host.run("Retain source review note",()=>changeSelection(currentSource(),selection=>({...selection,note:ui("correction-source-note").value}))));
  ui("correction-previous").addEventListener("click",()=>{page--;render();});
  ui("correction-next").addEventListener("click",()=>{page++;render();});
  ui("correction-prepare").addEventListener("click",()=>host.run("Validate complete correction plan",async()=>{
    const input=selectedInput(),at=revision;const prepared=await host.read("return.plan",input);
    if(at!==revision)throw new Error("Review choices changed during preparation.");
    plan=prepared;result=null;render();
  }));
  ui("correction-accept-diagnostics").addEventListener("change",sync);
  ui("correction-apply").addEventListener("click",()=>host.run("Apply reviewed colleague corrections",async()=>{
    if(!plan||!ui("correction-accept-diagnostics").checked)throw new Error("Review the complete native validation before applying this plan.");
    const input={...selectedInput(),expectedPlanSha256:plan.planSha256,acceptDiagnostics:true,actor:host.operator()};
    const applied=await host.mutate("return.apply",input);
    const next={...documentState,lastApplied:applied,selections:[],preview:null};
    try { await commit(next); }
    catch(error) { result=applied;plan=null;active=null;render();throw new Error("The corrections were saved. The browser review draft could not be updated: "+error.message); }
    result=applied;plan=null;active=null;render();
    host.notice("Saved the selected corrections and returned reviews with their complete original project.");
  }));
  ui("correction-help").addEventListener("click",()=>host.run("Prepare complete colleague review",()=>host.exportFile({kind:"application",note:"Complete editable source and history for colleague review and return."})));
  for(const id of ["correction-intake","correction-source-review","correction-application"])ui(id).addEventListener("submit",event=>event.preventDefault());
  async function recovered(applied,inputs) {
    await open();
    const sameReview=!documentState || (
      documentState.contentBase64===inputs.contentBase64 && documentState.name===inputs.name &&
      documentState.preview?.previewSha256===inputs.expectedPreviewSha256 &&
      JSON.stringify(documentState.selections)===JSON.stringify(inputs.selections));
    const next=sameReview
      ?{format:"commons.audit-exchange.corrections-draft.v1",workspaceId:connected(),name:inputs.name,contentBase64:inputs.contentBase64,preview:null,selections:[],lastApplied:applied}
      :{...documentState,lastApplied:applied};
    try { await commit(next); }
    finally { result=applied;plan=null;if(sameReview)active=null;render(); }
  }
  return {open,sync,recovered};
}

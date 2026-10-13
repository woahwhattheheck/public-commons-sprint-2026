(() => {
"use strict";
window.createCollectionAccessionPanel = function ({root, api, mutation, refreshState, notifyChange}) {
  const copy = value => JSON.parse(JSON.stringify(value));
  const stable = value => JSON.stringify(value, function (_, item) {
    return item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
  });
  const el = (tag, text, attrs = {}) => {
    const n = document.createElement(tag);
    if (text !== null && text !== undefined) n.textContent = String(text);
    for (const [key, value] of Object.entries(attrs)) n.setAttribute(key, String(value));
    return n;
  };
  const field = (label, input, hint) => {
    const box = el("div", null, {class:"field"}), title = el("label", label, {for:input.id});
    box.append(title, input); if (hint) box.append(el("small", hint)); return box;
  };
  const input = (id, type="text") => el("input", null, {id,type});
  const button = (id, text, fn) => {
    const n = el("button", text, {id,type:"button"});
    n.addEventListener("click", () => action(fn)); return n;
  };
  const bytes = n => n >= 1048576 ? (n/1048576).toFixed(2)+" MiB" : n.toLocaleString()+" B";
  let state = null, saved = null, draft = null, selected = "", inspection = null;
  let localBusy = false, hostBusy = false, connected = false, loadSequence = 0, loading = false;
  let rowPath = null, rowDirty = false, offset = 0, external = false, rowEditor = {};
  let sessionNotice = "", restoring = false;
  const dirty = () => rowDirty || Boolean(merging) || Boolean(saved && draft && stable(saved.review)!==stable(draft));
  const sessionKey = () => state ? "preservation-collection-draft:"+state.workspace+":"+selected : null;
  function remember() {
    const key=sessionKey(); if(restoring || !key || !saved || !draft) return;
    try {
      if(dirty()) sessionStorage.setItem(key,JSON.stringify({id:selected,inventorySha256:saved.inventory.sha256,
        baseReviewSha256:saved.reviewSha256,baseRevision:saved.revision,review:draft,
        row:rowPath,editor:rowDirty?{include:include.checked,fieldsText:metadata.value,reason:reason.value}:null}));
      else sessionStorage.removeItem(key);
      sessionNotice="";
    } catch (_) { sessionNotice="This browser could not retain a tab draft. Download the complete review JSON before closing."; }
  }
  function announce(value, error=false) {
    message.textContent=value; message.setAttribute("role",error?"alert":"status");
  }
  async function action(fn) {
    if(localBusy) return;
    localBusy=true; controls();
    try { await fn(); }
    catch(error) { announce(error.message||String(error),true); }
    finally { localBusy=false; controls(); notifyChange?.(); }
  }
  const introduction=el("div",null,{class:"panel"});
  introduction.append(el("h2","Original file collections"),el("p",
    "Retain a fixed copy of an institutional collection, review its description and selection, then build a verified BagIt transfer. Research metadata and repository destinations keep their existing workflow."),
    el("p","Local profile: 10,000 regular files, 64 MiB per file and 2 GiB of original content. Symlinks are refused. Rights, file format and preservation suitability are recorded by the operator; none are inferred.",{class:"muted"}));
  const intake=el("div",null,{class:"panel"});
  intake.append(el("h3","Inspect and retain a collection"));
  const source=input("collection-source");
  intake.append(field("Original directory on this host",source,"The application reads this local directory. The retained accession must be outside it."));
  const inspectButton=button("collection-inspect","Inspect original files",async()=>{
    if(!source.value.trim()) throw new Error("Enter the original directory.");
    inspection=null; inventoryNote.textContent="Inventory is running. Its original operation appears in Activity.";
    await mutation("/api/accession-inspect",{source:source.value.trim()}); await refreshState();
  });
  const inventoryNote=el("p","Inspect a directory before retaining its files.",{id:"collection-inspection",class:"muted","aria-live":"polite"});
  intake.append(inspectButton,inventoryNote);
  const settingsGrid=el("div",null,{class:"grid two"});
  const settings={};
  for(const [name,label,hint] of [
    ["id","Accession ID","1–96 letters, digits, hyphens or underscores. This identifies the retained collection."],
    ["title","Collection title","Describe the original collection."],
    ["organization","Holding organization","Use the institution’s actual name."],
    ["contact","Contact","Optional responsible contact."],
    ["sourceReference","Original source reference","Original accession reference, deposit record or accountable source description."]
  ]) {settings[name]=input("collection-"+name);settingsGrid.append(field(label,settings[name],hint));}
  intake.append(settingsGrid);
  const initializeButton=button("collection-retain","Retain inspected original files",async()=>{
    if(!inspection || inspection.requestedSource!==source.value.trim()) throw new Error("Inspect this exact source directory first.");
    const selection=Object.fromEntries(Object.entries(settings).map(([key,n])=>[key,n.value.trim()]));
    await mutation("/api/accession-init",{source:inspection.source,inventorySha256:inspection.inventorySha256,settings:selection});
    selected=selection.id; await refreshState();
    announce("The original collection intake is queued. The completed accession will be available below.");
  });
  intake.append(initializeButton);
  const review=el("div",null,{class:"panel"});
  review.append(el("h3","Review retained files"));
  const chooser=el("select",null,{id:"collection-select"});
  chooser.addEventListener("change",()=>action(async()=>{
    if(dirty() && !confirm("Leave this accession? Its draft stays in this browser tab. Download review JSON to keep an independent copy.")) {chooser.value=selected;return;}
    remember(); await load(chooser.value);
  }));
  const reload=button("collection-reload","Reload saved review",async()=>{
    if(dirty()&&!confirm("Replace this accession’s current tab draft with its saved review?"))return;
    const key=sessionKey();if(key)sessionStorage.removeItem(key);
    await load(selected,false);
  });
  const selectionBar=el("div",null,{class:"toolbar"});selectionBar.append(field("Retained accession",chooser),reload);review.append(selectionBar);
  const summary=el("p","No collection selected.",{id:"collection-summary",class:"muted"});
  const statusLine=el("p","",{id:"collection-review-status","aria-live":"polite"});
  review.append(summary,statusLine);
  const note=el("textarea",null,{id:"collection-review-note",rows:"2"});
  note.addEventListener("input",()=>{if(draft){draft.note=note.value;remember();controls();notifyChange?.();}});
  review.append(field("Review note",note,"Saved with the complete edition. File changes and exclusions also require their own reason."));
  const search=input("collection-query","search"),filter=el("select",null,{id:"collection-filter"});
  for(const [value,label] of [["all","All files"],["included","Included"],["excluded","Excluded"],["rights","Included without recorded rights"]])filter.append(el("option",label,{value}));
  for(const n of [search,filter])n.addEventListener("input",()=>{offset=0;renderRows();});
  const filters=el("div",null,{class:"toolbar"});filters.append(field("Find an original path",search),field("Selection",filter));review.append(filters);
  const table=el("table"),head=el("thead"),hr=el("tr");
  for(const t of ["Original file","Selection","Size","Rights","Review"])hr.append(el("th",t,{scope:"col"}));
  head.append(hr); const tbody=el("tbody");
  table.append(head,tbody); const wrap=el("div",null,{class:"table-wrap"});wrap.append(table);review.append(wrap);
  const pagination=el("div",null,{class:"toolbar"}),pageInfo=el("span","",{class:"muted"});
  const previous=button("collection-previous","Previous",()=>{offset=Math.max(0,offset-50);renderRows();});
  const next=button("collection-next","Next",()=>{offset+=50;renderRows();});
  pagination.append(previous,pageInfo,next);review.append(pagination);
  const editor=el("div",null,{class:"panel compact",hidden:"hidden"}),editorTitle=el("h3","");
  const include=input("collection-file-include","checkbox"),reason=el("textarea",null,{id:"collection-file-reason",rows:"2"});
  const metadata=el("textarea",null,{id:"collection-file-fields",rows:"10",class:"code",spellcheck:"false"});
  editor.append(editorTitle,field("Include original file in the transfer",include),
    field("Dublin Core field overrides",metadata,'Use a JSON object of field names and arrays of strings, such as {"title":["Archive photograph"],"rights":["Institutional rights statement"]}. An empty object retains the original path and filename title.'),
    field("Reason for this file decision",reason,"Required for any metadata override or exclusion."));
  for(const n of [include,reason,metadata])n.addEventListener("input",()=>{rowDirty=true;remember();controls();notifyChange?.();});
  const apply=button("collection-file-apply","Apply file decision to draft",()=>{
    const v=readEditor();if(!v.fields || typeof v.fields!=="object" || Array.isArray(v.fields))throw new Error("Field overrides must be a JSON object.");
    for(const [key,values]of Object.entries(v.fields)){
      if(!["title","creator","subject","description","publisher","contributor","date","type","format","identifier","source","language","relation","coverage","rights"].includes(key)
        || !Array.isArray(values)||values.some(x=>typeof x!=="string"||!x.trim()))throw new Error("Use Dublin Core names with arrays of nonempty strings.");
    }
    if((!v.include||Object.keys(v.fields).length)&&!v.reason.trim())throw new Error("Record a reason for the change or exclusion.");
    draft.decisions=draft.decisions.filter(x=>x.path!==rowPath);
    if(!v.include||Object.keys(v.fields).length||v.reason)draft.decisions.push({path:rowPath,...v});
    draft.decisions.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
    rowDirty=false;remember();renderRows();controls();notifyChange?.();
  });
  const discard=button("collection-file-discard","Reload this file from draft",()=>{if(rowPath)openRow(rowPath,true);});
  editor.append(apply,discard);review.append(editor);
  const save=button("collection-save","Save complete review",async()=>{
    if(rowDirty)throw new Error("Apply or reload the open file decision first.");
    const currentId=selected,expected=saved.revision,submitted=copy(draft);
    await mutation("/api/accession-review",{id:currentId,expectedRevision:expected,review:submitted});
    // Even a lost acknowledgement keeps the original tab draft. Reopen checks its exact saved head.
    const key=sessionKey();if(key)sessionStorage.removeItem(key);
    await load(currentId,false);await refreshState();announce("The complete collection review is saved.");
  });
  const download=button("collection-review-download","Download complete review JSON",()=>{
    if(rowDirty)throw new Error("Apply the open file decision first.");
    const blob=new Blob([JSON.stringify(draft,null,2)+"\n"],{type:"application/json"});
    const url=URL.createObjectURL(blob),link=el("a","",{href:url,download:"Collection_"+selected+"_review.json"});
    link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  });
  const build=button("collection-build","Build verified BagIt transfer",async()=>{
    if(dirty())throw new Error("Save the complete review first.");
    await mutation("/api/accession-build",{id:selected,expectedRevision:saved.revision});
    await refreshState();announce("The transfer is queued. Download its verified archive from Delivery when complete.");
  });
  const importFile=input("collection-review-import","file");
  importFile.accept=".json,.html,application/json,text/html";
  const reopen=button("collection-review-reopen","Review imported working file",async()=>{
    const file=importFile.files?.[0];if(!file)throw new Error("Select the complete review JSON or working HTML/JSON.");
    if(file.size>128*1024*1024)throw new Error("The complete working file exceeds 128 MiB.");
    if(rowDirty)throw new Error("Apply the current file edit before comparing another complete review.");
    const portable=window.PreservationCollectionReview,id=selected,raw=await file.text();
    let incoming=portable.parse(raw),reviewedSource=null;
    if(incoming.schema===portable.WORKING){
      const current=await api("/api/accession-review-source?id="+encodeURIComponent(id));
      if(id!==selected)throw new Error("The selected accession changed while opening the return.");
      incoming=await portable.returnReview(incoming,current);reviewedSource=current;
    }else if(portable.bytes(raw)>4*1024*1024)throw new Error("The decisions-only JSON exceeds the original 4 MiB metadata profile.");
    await prepareMerge(incoming,reviewedSource);
  });
  const reconcile=button("collection-review-reconcile","Reconcile this draft with saved review",async()=>{
    if(rowDirty)throw new Error("Apply the current file edit first.");
    await prepareMerge(copy(draft));
  });
  const imports=el("div",null,{class:"toolbar"});
  imports.append(field("Complete working HTML/JSON or original review JSON",importFile),reopen,reconcile);review.append(imports);
  const mergePanel=el("div",null,{class:"panel compact",hidden:"hidden"}),mergeHeading=el("h3","Review every difference");
  const mergeStatus=el("p","",{class:"muted"}),mergeRows=el("div"),mergeControls=el("div",null,{class:"toolbar"});
  let merging=null,mergeOffset=0;
  const keepCurrent=button("collection-merge-current","Keep local draft for all differences",()=>{
    for(const row of merging.rows)merging.choices[row.key]="current";renderMerge();
  });
  const keepSaved=button("collection-merge-saved","Use saved review for all differences",()=>{
    for(const row of merging.rows)merging.choices[row.key]="saved";renderMerge();
  });
  const useImported=button("collection-merge-imported","Use imported for all differences",()=>{
    for(const row of merging.rows)merging.choices[row.key]="imported";renderMerge();
  });
  const mergePrevious=button("collection-merge-previous","Previous differences",()=>{mergeOffset=Math.max(0,mergeOffset-20);renderMerge();});
  const mergeNext=button("collection-merge-next","Next differences",()=>{mergeOffset+=20;renderMerge();});
  const applyMerge=button("collection-merge-apply","Apply reviewed choices to draft",()=>{
    if(!merging||merging.rows.some(row=>!merging.choices[row.key]))throw new Error("Choose current or imported for every difference.");
    if(selected!==merging.id||stable(draft)!==merging.draftSha)throw new Error("The local draft changed. Keep it and compare the complete reviews again.");
    const decisions=new Map(merging.local.decisions.map(row=>[row.path,copy(row)]));
    let nextNote=merging.local.note||"";
    for(const row of merging.rows){
      const chosen=row[merging.choices[row.key]];
      if(row.key==="note")nextNote=chosen;
      else if(chosen===null)decisions.delete(row.path);
      else decisions.set(row.path,copy(chosen));
    }
    saved=merging.head;draft={...copy(saved.review),note:nextNote,
      decisions:[...decisions.values()].sort((x,y)=>x.path<y.path?-1:x.path>y.path?1:0)};
    external=false;rowPath=null;rowDirty=false;editor.hidden=true;note.value=draft.note;
    merging=null;mergePanel.hidden=true;remember();renderRows();controls();notifyChange?.();
    announce("Your explicit choices are in the draft. Save complete review to retain a new edition.");
  });
  const cancelMerge=button("collection-merge-cancel","Keep existing draft",()=>{merging=null;mergePanel.hidden=true;});
  mergeControls.append(keepCurrent,keepSaved,useImported,mergePrevious,mergeNext,applyMerge,cancelMerge);
  mergePanel.append(mergeHeading,el("p","Compare the complete saved review, your complete local draft and imported review. Select each file decision as a whole record. A missing decision means original defaults and inclusion. Saved history stays unchanged until Save complete review."),
    mergeStatus,mergeRows,mergeControls);review.append(mergePanel);
  function validateImported(value,inv){
    const keys=["schema","inventorySha256","decisions","note"];
    if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).some(x=>!keys.includes(x))||
      value.schema!=="stellar-forge.collection-accession.v1.review"||value.inventorySha256!==inv.sha256||
      !Array.isArray(value.decisions)||value.decisions.length>10000||typeof(value.note??"")!=="string")
      throw new Error("Import a complete review bound to this original collection inventory.");
    const seen=new Set();
    for(const row of value.decisions){
      if(!row||typeof row!=="object"||Object.keys(row).sort().join(",")!=="fields,include,path,reason"||
        !Object.hasOwn(inv.files,row.path)||seen.has(row.path)||typeof row.include!=="boolean"||typeof row.reason!=="string"||
        !row.fields||typeof row.fields!=="object"||Array.isArray(row.fields))throw new Error("Invalid or duplicate original file decision.");
      seen.add(row.path);
      for(const [key,values]of Object.entries(row.fields)){
        if(!["title","creator","subject","description","publisher","contributor","date","type","format","identifier","source","language","relation","coverage","rights"].includes(key)||
          !Array.isArray(values)||values.length>100||values.some(x=>typeof x!=="string"||!x.trim()))
          throw new Error("Imported metadata must use complete Dublin Core arrays.");
      }
      if((!row.include||Object.keys(row.fields).length)&&!row.reason.trim())throw new Error("Imported edits and exclusions require their original reasons.");
    }
    return {...copy(value),note:value.note||""};
  }
  async function prepareMerge(value,reviewedSource=null){
    if(!saved)throw new Error("Choose the retained original collection first.");
    const id=selected,head=await api("/api/accession?id="+encodeURIComponent(id));
    if(id!==selected||head.inventory.sha256!==saved.inventory.sha256)throw new Error("The original accession changed during comparison.");
    if(reviewedSource&&(reviewedSource.history.at(-1).revision!==head.revision||
      reviewedSource.history.at(-1).reviewSha256!==head.reviewSha256))throw new Error("The saved review advanced while the full working return was checked. Retain the selected file and compare again.");
    const imported=validateImported(value,head.inventory),local=validateImported(copy(draft),head.inventory);
    const current=new Map(local.decisions.map(row=>[row.path,row]));
    const stored=new Map(head.review.decisions.map(row=>[row.path,row]));
    const incoming=new Map(imported.decisions.map(row=>[row.path,row])),rows=[];
    for(const path of [...new Set([...stored.keys(),...current.keys(),...incoming.keys()])].sort()){
      const a=current.get(path)||null,b=incoming.get(path)||null,c=stored.get(path)||null;
      if(stable(a)!==stable(b)||stable(a)!==stable(c))rows.push({key:"file:"+path,path,saved:c,current:a,imported:b});
    }
    if((head.review.note||"")!==local.note||local.note!==imported.note)rows.push({key:"note",path:"Review note",saved:head.review.note||"",current:local.note,imported:imported.note});
    merging={id,head,local,imported,rows,choices:{},draftSha:stable(draft)};mergeOffset=0;mergePanel.hidden=false;renderMerge();
    announce("Compare the imported review with saved r"+head.revision+". Your existing draft remains intact until you apply explicit choices.");
  }
  function renderMerge(){
    if(!merging)return;
    mergeRows.replaceChildren();
    for(const row of merging.rows.slice(mergeOffset,mergeOffset+20)){
      const box=el("div",null,{class:"panel compact"}),details=el("details"),summary=el("summary","Complete saved, local draft and imported values");
      details.append(summary,el("pre",JSON.stringify({saved:row.saved,localDraft:row.current,imported:row.imported},null,2)));
      const choice=el("select",null,{"aria-label":"Choice for "+row.path});
      for(const[value,label]of [["","Choose explicitly"],["saved","Use complete saved value"],["current","Keep complete local draft value"],["imported","Use complete imported value"]])choice.append(el("option",label,{value}));
      choice.value=merging.choices[row.key]||"";
      choice.addEventListener("change",()=>{merging.choices[row.key]=choice.value;controls();});
      box.append(el("h3",row.path),details,choice);mergeRows.append(box);
    }
    mergeStatus.textContent=merging.rows.length+" differences · "+Object.values(merging.choices).filter(Boolean).length+" choices recorded. Saved r"+merging.head.revision+" remains the save precondition.";
    controls();
  }

  async function portableWorking(){
    if(!saved||!draft)throw new Error("Select the original retained accession.");
    const id=selected,revision=saved.revision,reviewSha256=saved.reviewSha256;
    const original=await api("/api/accession-review-source?id="+encodeURIComponent(id)+
      "&revision="+revision+"&reviewSha256="+encodeURIComponent(reviewSha256));
    if(id!==selected||revision!==saved.revision||reviewSha256!==saved.reviewSha256)throw new Error("The original review selection changed.");
    const unfinished=rowDirty?{path:rowPath,include:include.checked,fieldsText:metadata.value,reason:reason.value}:null;
    return window.PreservationCollectionReview.create(original,copy(draft),unfinished);
  }
  function downloadPortable(raw,extension,type){
    const url=URL.createObjectURL(new Blob([raw],{type})),link=el("a","",{href:url,download:"Collection_"+selected+"_working."+extension});
    link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  const workingHTML=button("collection-working-html","Download editable working HTML",async()=>{
    const value=await portableWorking();
    downloadPortable(window.PreservationCollectionReview.renderHTML(value),"html","text/html");
    announce("Complete editable working HTML download requested. Open the saved file independently; the original accession remains unchanged.");
  });
  const workingJSON=button("collection-working-json","Download complete working JSON",async()=>{
    const value=await portableWorking();
    downloadPortable(window.PreservationCollectionReview.stringify(value),"json","application/json");
    announce("Complete working JSON download requested, including any unfinished file edit. Open it in the editable HTML to continue.");
  });

  const buttons=el("div",null,{class:"toolbar"});buttons.append(save,download,workingHTML,workingJSON,build);review.append(buttons);
  review.append(el("p","Portable working files contain the full original inventory, institutional settings and complete saved review history through the selected base, plus this draft and any unfinished file edit. Original binary files remain in the retained workspace and BagIt. Returned working files use the same explicit saved/local/imported comparison.",{class:"muted"}));
  review.append(el("p","Each saved review remains in the complete Workbench export. The transfer includes selected original file bytes, exact checksums and the full selection/inventory report. Excluded originals remain in the private complete workspace.",{class:"muted"}));
  const history=el("details"),historyTitle=el("summary","Saved review editions"),historyText=el("pre","");history.append(historyTitle,historyText);review.append(history);
  const message=el("p","",{id:"collection-message",role:"status","aria-live":"polite"});
  root.replaceChildren(introduction,intake,review,message);
  source.addEventListener("input",()=>{inspection=null;inventoryNote.textContent="Inspect this directory before retaining its files.";controls();});
  function readEditor(){return {include:include.checked,fields:JSON.parse(metadata.value),reason:reason.value};}
  function mappedRows(){
    if(!saved||!draft)return[];
    const decisions=new Map(draft.decisions.map(x=>[x.path,x]));
    return Object.entries(saved.inventory.files).map(([path,original])=>{
      const decision=decisions.get(path);return{path,original,include:decision?decision.include:true,
        fields:decision?.fields||{},reason:decision?.reason||""};
    });
  }
  function openRow(path,force=false){
    if(rowDirty&&!force&&!confirm("Replace this open file edit with another file? Apply it first to retain the decision."))return;
    const row=mappedRows().find(x=>x.path===path);if(!row)return;
    rowPath=path;rowDirty=false;editorTitle.textContent=path;include.checked=row.include;
    metadata.value=JSON.stringify(row.fields,null,2);reason.value=row.reason;editor.hidden=false;
    remember();controls();
  }
  function renderRows(){
    const query=search.value.trim().toLowerCase(),mode=filter.value;
    const rows=mappedRows().filter(row=>(!query||row.path.toLowerCase().includes(query))&&
      (mode==="all"||mode==="included"&&row.include||mode==="excluded"&&!row.include||mode==="rights"&&row.include&&!row.fields.rights?.length));
    if(offset>=rows.length)offset=Math.max(0,Math.floor((rows.length-1)/50)*50);
    tbody.replaceChildren();
    for(const row of rows.slice(offset,offset+50)){
      const tr=el("tr");tr.append(el("td",row.path,{class:"mono"}),el("td",row.include?"Included":"Excluded"),
        el("td",bytes(row.original.bytes)),el("td",row.fields.rights?.join("; ")||"Unspecified"));
      const td=el("td"),b=el("button","Review",{type:"button","data-collection-row":row.path});
      b.addEventListener("click",()=>{if(!localBusy&&!hostBusy)openRow(row.path);});td.append(b);tr.append(td);tbody.append(tr);
    }
    if(!rows.length){const tr=el("tr");tr.append(el("td","No files match this view.",{colspan:"5",class:"empty"}));tbody.append(tr);}
    pageInfo.textContent=rows.length?String(offset+1)+"–"+Math.min(offset+50,rows.length)+" of "+rows.length+" files":"0 files";
    previous.dataset.empty=String(offset===0);next.dataset.empty=String(offset+50>=rows.length);controls();
  }
  async function load(id,restore=true){
    const sequence=++loadSequence;selected=id;chooser.value=id;merging=null;mergePanel.hidden=true;
    loading=true;controls();
    try {
    if(!id){saved=draft=null;rowPath=null;rowDirty=false;editor.hidden=true;renderRows();controls();return;}
    const result=await api("/api/accession?id="+encodeURIComponent(id));
    if(sequence!==loadSequence||selected!==id)return;
    saved=result;draft=copy(result.review);rowPath=null;rowDirty=false;external=false;editor.hidden=true;offset=0;
    if(restore){
      restoring=true;
      try{
        const raw=sessionStorage.getItem(sessionKey()),retained=raw?JSON.parse(raw):null;
        if(retained&&retained.id===id&&retained.inventorySha256===result.inventory.sha256){
          if(stable(retained.review)!==stable(result.review)||retained.editor){
            draft=retained.review;external=retained.baseReviewSha256!==result.reviewSha256;
            // Keep the exact original CAS base for a stale tab draft.
            saved={...result,revision:retained.baseRevision,reviewSha256:retained.baseReviewSha256};
            if(retained.editor&&Object.hasOwn(result.inventory.files,retained.row)){
              openRow(retained.row,true);include.checked=retained.editor.include;
              metadata.value=retained.editor.fieldsText;reason.value=retained.editor.reason;rowDirty=true;
            }
          }else sessionStorage.removeItem(sessionKey());
        }
      }catch(_){sessionNotice="A retained tab draft could not be restored. The server’s saved review remains intact.";}
      finally{restoring=false;}
    }
    note.value=draft.note||"";
    summary.textContent=result.settings.title+" · "+result.summary.files+" files · "+bytes(result.summary.bytes)+
      " · Original inventory "+result.inventory.sha256;
    historyText.textContent=JSON.stringify(result.reviewHistory,null,2);
    renderRows();controls();
    } finally {if(sequence===loadSequence){loading=false;controls();}}
  }
  function controls(){
    const busy=localBusy||hostBusy,has=Boolean(saved);
    for(const n of root.querySelectorAll("input,textarea,select,button"))n.disabled=busy||!connected;
    chooser.disabled=busy||!connected||!(state?.accessions?.length);
    initializeButton.disabled=busy||!connected||!inspection||inspection.requestedSource!==source.value.trim();
    for(const n of [note,search,filter,reload,download,workingHTML,workingJSON])n.disabled=busy||!connected||!has;
    save.disabled=busy||!connected||!has||rowDirty||!dirty()||external;
    build.disabled=busy||!connected||!has||dirty()||external;
    for(const n of [importFile,reopen,reconcile])n.disabled=busy||!connected||!has;
    for(const n of [keepCurrent,keepSaved,useImported,cancelMerge])n.disabled=busy||!connected||!merging;
    mergePrevious.disabled=busy||!merging||mergeOffset===0;
    mergeNext.disabled=busy||!merging||mergeOffset+20>=merging.rows.length;
    applyMerge.disabled=busy||!connected||!merging||merging.rows.some(row=>!merging.choices[row.key]);
    apply.disabled=busy||!connected||!rowDirty;
    discard.disabled=busy||!connected||!rowPath;
    previous.disabled=busy||!has||previous.dataset.empty==="true";
    next.disabled=busy||!has||next.dataset.empty==="true";
    statusLine.textContent=!has?"Choose or retain a collection.":external?
      "The saved review advanced elsewhere. Your original tab draft is retained; download it before reloading the saved review.":
      "Draft based on saved r"+saved.revision+" · "+(rowDirty?"Unapplied file edit":dirty()?"Unsaved review":"All changes saved");
    if(sessionNotice)statusLine.textContent+=" · "+sessionNotice;
    if(merging){for(const n of review.querySelectorAll("input,textarea,select,button"))if(!mergePanel.contains(n)&&n!==download)n.disabled=true;}
    if(loading){for(const n of review.querySelectorAll("input,textarea,select,button"))n.disabled=true;statusLine.textContent+=" · Loading original saved review…";}
  }
  function update(value){
    state=value;
    const old=chooser.value;
    chooser.replaceChildren(el("option","Choose a retained collection",{value:""}));
    for(const item of value.accessions||[])chooser.append(el("option",item.title+" · r"+item.revision,{value:item.id}));
    chooser.value=selected||old;
    const inspectionJobs=(value.jobs||[]).filter(job=>job.kind==="collection-inspect"&&
      job.arguments?.source===source.value.trim());
    const latest=inspectionJobs[inspectionJobs.length-1];
    if(latest?.state==="COMPLETED"){
      inspection={...latest.result,requestedSource:latest.arguments.source};
      inventoryNote.textContent=inspection.files+" files · "+inspection.directories+" directories · "+bytes(inspection.bytes)+
        " · SHA-256 "+inspection.inventorySha256+". "+inspection.notice;
    }else if(latest&&["FAILED","INTERRUPTED"].includes(latest.state)){
      inventoryNote.textContent=latest.state+": "+(latest.error?.message||latest.message||"Inspect the retained Activity result.");
    }
    const binding=(value.accessions||[]).find(x=>x.id===selected);
    if(binding&&!loading&&(!saved||saved.id!==selected))load(selected).catch(e=>announce(e.message,true));
    else if(binding&&saved&&binding.reviewSha256!==saved.reviewSha256&&!localBusy&&!loading){
      if(dirty()){external=true;controls();}
      else load(selected,false).catch(e=>announce(e.message,true));
    }
    controls();
  }
  return {update,dirty,controls(value){if(value){hostBusy=value.busy;connected=value.connected;}controls();},
    refresh(){if(selected&&!dirty())return load(selected);return Promise.resolve();}};
};
})();

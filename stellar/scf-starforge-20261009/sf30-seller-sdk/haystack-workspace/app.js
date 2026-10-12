import {HaystackClient} from "./client.mjs";
import {stringifyJson,canonicalJson} from "./json-codec.mjs";

const $ = id => document.getElementById(id);
const PAGE = 100;
const S = {
  client:null, identity:null, status:null, connectionUrl:null, busy:false, section:"overview",
  sources:[], editions:[], proposals:[], sourceDraft:new Set(), sourceDirty:false,
  edits:[], preview:null, activeProposal:null, activeRecord:null, delivery:null,
  pages:{}, disabled:new Map(), localOperations:[], draftTimer:null,
  works:[], activeWork:null, selectedWorkId:null, workDrafts:{}, workCapture:null, workUploads:new Map(),
  returnDraft:{file:null,preview:null,decisions:{},author:"",note:""},
  pendingDraft:null, draftWrites:Promise.resolve(), draftReady:false, draftSerial:0, draftSavedSerial:0
};
const tabKey = "commons.haystack.operator.tab";
let tabId;
try {tabId=sessionStorage.getItem(tabKey);if(!tabId){tabId=crypto.randomUUID();sessionStorage.setItem(tabKey,tabId);}}
catch {tabId=crypto.randomUUID();}
const text = value => value === null || value === undefined ? "—" : String(value);
const json = value => stringifyJson(value, 2);
const short = (value,length=12) => String(value??"").slice(0,length);
const number = value => typeof value === "number" ? value.toLocaleString() : text(value);
const when = value => {if(!value)return "—";const date=new Date(value);return Number.isNaN(date.getTime())?String(value):date.toLocaleString();};
const size = value => {const bytes=Number(value);if(!Number.isFinite(bytes))return "—";if(bytes<1024)return bytes+" B";if(bytes<1048576)return (bytes/1024).toFixed(1)+" KiB";return (bytes/1048576).toFixed(1)+" MiB";};
const own = (value,key) => Object.prototype.hasOwnProperty.call(value,key);
function node(tag, props={}, ...children) {
  const element=document.createElement(tag);
  for(const [key,value] of Object.entries(props)){
    if(value===null||value===undefined)continue;
    if(key==="class")element.className=value;
    else if(key==="text")element.textContent=text(value);
    else if(key==="dataset")for(const [name,item] of Object.entries(value))element.dataset[name]=item;
    else if(key.startsWith("on")&&typeof value==="function")element.addEventListener(key.slice(2),value);
    else if(key in element&&key!=="role")element[key]=value;
    else element.setAttribute(key,text(value));
  }
  for(const child of children.flat(Infinity)){if(child!==null&&child!==undefined&&child!==false)element.append(child instanceof Node?child:document.createTextNode(text(child)));}
  return element;
}
function replace(id,...children){$(id).replaceChildren(...children.flat(Infinity).filter(item=>item!==null&&item!==undefined));}
function detail(title,value){return node("details",{},node("summary",{},title),node("pre",{},json(value)));}
function badge(value,strong=false){return node("span",{class:"badge"+(strong?" strong":"")},value);}
function action(label,callback,props={}){return node("button",{type:"button",disabled:S.busy,dataset:{action:"true"},onclick:()=>run(callback),...props},label);}
function linkButton(label,callback){return action(label,callback,{class:"link-button"});}
function dl(entries){const list=node("dl");for(const [key,value] of entries){list.append(node("dt",{},key),node("dd",{},value instanceof Node?value:text(value)));}return list;}
function emptyRow(columns,message){return node("tr",{},node("td",{colSpan:columns,class:"empty"},message));}
function notice(message,kind="info"){replace("notice",message);$("notice").dataset.kind=kind;$("notice").hidden=!message;}
function failure(error){
  const code=error?.code?String(error.code):"";
  let message=error?.message||String(error);
  if(code==="HAYSTACK_INSTANCE"||code==="HAYSTACK_IDENTITY")message+=" Open the correct workspace again to establish its current server connection; original requests keep their identities.";
  else if(error?.status===409||/REVISION|STALE|revision|stale/.test(code))message+=" Refresh the workspace before preparing a new action; the original request and your draft remain retained.";
  if(error?.outcomeUnknown)message+=" Open Operations and read the original receipt before resending.";
  notice(message,"error");
}
function controls(){
  const unavailable=S.busy||!S.client;
  for(const element of document.querySelectorAll("[data-connected],[data-action]"))element.disabled=unavailable;
  $("refresh-workspace").disabled=unavailable;
  for(const input of document.querySelectorAll("[data-source-id]"))input.disabled=unavailable;
  for(const kind of ["asset","diagnostic","comparison","work"]){
    const page=S.pages[kind];
    $(kind+"-previous").disabled=unavailable||!page||page.history.length<2;
    $(kind+"-next").disabled=unavailable||!page||!page.response?.hasMore;
  }
  const review=S.activeProposal?.proposal;
  $("accept-proposal").disabled=unavailable||!review||review.state!=="proposed"||review.stale;
  $("reject-proposal").disabled=unavailable||!review||review.state!=="proposed";
  $("edit-value").disabled=S.busy||$("edit-action").value==="remove";
  $("save-source-selection").disabled=unavailable||!S.sourceDirty;
  const native=$("report-kind").value==="native-grid";
  $("report-format").disabled=S.busy||native;
  $("report-source").disabled=S.busy||!native;
  $("report-role").disabled=S.busy||native||["diagnostics","work-register"].includes($("report-kind").value);
  $("report-edition").disabled=S.busy||$("report-kind").value==="work-register";
  workControls();
}
function setBusy(value){
  S.busy=value;document.body.dataset.busy=String(value);$("main").setAttribute("aria-busy",String(value));
  if(value){S.disabled=new Map();for(const el of document.querySelectorAll("button,input,select,textarea")){S.disabled.set(el,el.disabled);el.disabled=true;}}
  else {for(const [el,previous] of S.disabled)if(el.isConnected)el.disabled=previous;S.disabled.clear();for(const el of document.querySelectorAll("[data-action]"))el.disabled=false;}
  controls();
}
async function run(task){
  if(S.busy)return;
  setBusy(true);
  try{return await task();}
  catch(error){failure(error);}
  finally{setBusy(false);}
}
function requireWorkspace(){if(!S.client||!S.status)throw new Error("Open a workspace first.");}
function revision(){requireWorkspace();return S.status.revision;}
async function request(actionName,args={}){
  if(!S.client||!S.identity)throw new Error("Open a workspace first.");
  return S.client.request(actionName,args);
}
function validatePage(page,args,offset,identity=S.identity){
  if(!page||!Array.isArray(page.items))throw new Error("The server did not return a complete page.");
  if(page.workspaceId!==identity.workspaceId||page.revision!==args.expectedRevision)throw new Error("The page belongs to a different workspace revision. Refresh before continuing.");
  if(page.hasMore&&(!Number.isInteger(page.nextOffset)||page.nextOffset<=offset))throw new Error("The server returned a page without a forward continuation.");
  return page;
}
async function collect(actionName,args,{client=S.client,identity=S.identity}={}){
  if(!client||!identity)throw new Error("Open a workspace first.");
  const items=[];let offset=0;
  for(;;){
    const page=validatePage(await client.request(actionName,{...args,offset,limit:250}),args,offset,identity);
    items.push(...page.items);
    if(!page.hasMore)return items;
    offset=page.nextOffset;
  }
}
function sourceName(sourceId){const source=S.sources.find(item=>item.id===sourceId);return source?source.name:short(sourceId);}
function sourceLabel(sourceId){return sourceName(sourceId)+" · "+short(sourceId);}
function sourceKey(sourceId){return node("span",{class:"source-key"},sourceId);}
function countValue(counts,name){return typeof counts?.[name]==="number"?counts[name]:0;}
function sourceCount(value){return Array.isArray(value)?value.length:typeof value==="number"?value:0;}
function saveFile(bytes,name,type="application/octet-stream"){
  const url=URL.createObjectURL(new Blob([bytes],{type}));
  const link=node("a",{href:url,download:String(name||"handover-export").replace(/[\\/\u0000-\u001f]/g,"_")});
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function fileBase64(file){
  const bytes=new Uint8Array(await file.arrayBuffer());let binary="";
  for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return btoa(binary);
}
function cleanArgs(value){return Object.fromEntries(Object.entries(value).filter(([,item])=>item!==undefined&&item!==null&&item!==""));}

let databasePromise;
function database(){
  if(databasePromise)return databasePromise;
  databasePromise=new Promise((resolve,reject)=>{
    const opening=indexedDB.open("commons.haystack.operator.v1",1);
    opening.onupgradeneeded=()=>{
      const db=opening.result;
      if(!db.objectStoreNames.contains("operations"))db.createObjectStore("operations",{keyPath:"operationId"});
      if(!db.objectStoreNames.contains("drafts"))db.createObjectStore("drafts",{keyPath:"key"});
    };
    opening.onsuccess=()=>resolve(opening.result);
    opening.onerror=()=>reject(opening.error||new Error("Browser request storage could not be opened."));
    opening.onblocked=()=>reject(new Error("Close another outdated workspace tab so request storage can open."));
  });
  return databasePromise;
}
async function dbRead(storeName,key){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readonly"),call=key===undefined?tx.objectStore(storeName).getAll():tx.objectStore(storeName).get(key);
    let result;
    call.onsuccess=()=>{result=call.result;};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error||call.error||new Error("Browser storage read failed."));
    tx.onabort=()=>reject(tx.error||new Error("Browser storage read was interrupted."));
  });
}
async function dbWrite(storeName,value,{original=false}={}){
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readwrite"),store=tx.objectStore(storeName);
    if(original){
      const lookup=store.get(value.operationId);
      lookup.onsuccess=()=>{
        const existing=lookup.result;
        if(existing&&(
          existing.workspaceId!==value.workspaceId||existing.action!==value.action||
          stringifyJson(existing.args)!==stringifyJson(value.args)
        )){tx.abort();return;}
        if(!existing)store.add(value);
      };
    }else store.put(value);
    tx.oncomplete=()=>resolve(value);
    tx.onerror=()=>reject(tx.error||new Error("The complete original request could not be retained in this browser."));
    tx.onabort=()=>reject(tx.error||new Error("A different original request already occupies this operation ID."));
  });
}
async function retainOperation(actionName,args){
  const item={
    operationId:args.operationId,workspaceId:S.identity.workspaceId,
    instanceId:S.identity.instanceId,serverUrl:S.connectionUrl,
    action:actionName,args:structuredClone(args),createdAt:new Date().toISOString(),
    state:"prepared",receipt:null,error:null
  };
  await dbWrite("operations",item,{original:true});
  return item;
}
async function updateOperation(item,state,receipt=null,error=null){
  const original=await dbRead("operations",item.operationId);
  if(!original||original.workspaceId!==item.workspaceId||original.action!==item.action||stringifyJson(original.args)!==stringifyJson(item.args))throw new Error("The retained operation no longer matches its original request.");
  if(original.state==="completed"&&state!=="completed")return original;
  const updated={...original,state,receipt,error,updatedAt:new Date().toISOString()};
  await dbWrite("operations",updated);broadcast(updated);return updated;
}
let channel;
try{channel=new BroadcastChannel("commons.haystack.operator.v1");channel.onmessage=event=>{
  if(event.data?.workspaceId===S.identity?.workspaceId&&!S.busy&&S.section==="operations")loadLocalOperations().catch(failure);
};}catch{}
function broadcast(item){channel?.postMessage({workspaceId:item.workspaceId,operationId:item.operationId});}
function shortError(error){return {message:error?.message||String(error),code:error?.code||null,status:error?.status||null,outcomeUnknown:!!error?.outcomeUnknown};}
async function mutate(actionName,fields){
  const args={...structuredClone(fields),expectedRevision:revision(),operationId:crypto.randomUUID()};
  const retained=await retainOperation(actionName,args);
  try{
    const receipt=await request(actionName,args);
    try{await updateOperation(retained,"completed",receipt);}
    catch(error){notice("The server completed "+actionName+". Its original request is retained; refresh Operations to recover the receipt. "+error.message,"error");}
    return receipt;
  }catch(error){
    try{await updateOperation(retained,error?.outcomeUnknown?"outcome unknown":"not completed",null,shortError(error));}catch(storageError){notice(storageError.message,"error");}
    throw error;
  }
}
function draftKey(){return S.identity?S.identity.workspaceId+":"+tabId:null;}
function draftSnapshot(){
  const key=draftKey();if(!key||!S.draftReady)return null;
  return {key,workspaceId:S.identity.workspaceId,tabId,serial:S.draftSerial,updatedAt:new Date().toISOString(),
    title:$("proposal-title").value,note:$("proposal-note").value,
    edits:structuredClone(S.edits),jsonText:$("proposal-json").value,
    editRecord:$("edit-record").value,editTag:$("edit-tag").value,editAction:$("edit-action").value,editValue:$("edit-value").value,
    sourceDirty:S.sourceDirty,sourceIds:[...S.sourceDraft],sourceUrl:$("source-url").value,sourceImportSelect:$("source-import-select").checked,
    workState:workDraftSnapshot()};
}
function queueDraft(snapshot){
  if(!snapshot)return S.draftWrites;
  S.draftWrites=S.draftWrites.catch(()=>{}).then(()=>dbWrite("drafts",snapshot));
  S.draftWrites.then(()=>{if(snapshot.key===draftKey()){
    S.draftSavedSerial=Math.max(S.draftSavedSerial,snapshot.serial||0);
    $("proposal-draft-status").textContent=S.draftSavedSerial===S.draftSerial?"Draft retained for this workspace and browser tab.":"Retaining the latest draft changes.";
    $("work-draft-status").textContent=S.draftSavedSerial===S.draftSerial?"Work forms, review choices and file references are retained for this workspace and browser tab.":"Retaining the latest work draft changes.";
  }}
    ,error=>{if(snapshot.key===draftKey()){$("proposal-draft-status").textContent="Draft could not be retained: "+error.message;$("work-draft-status").textContent="Work draft could not be retained: "+error.message;notice("Keep this tab open until its draft can be retained. "+error.message,"error");}});
  return S.draftWrites;
}
function rememberDraft(){
  S.draftSerial++;
  S.pendingDraft=draftSnapshot();
  if(S.draftTimer)clearTimeout(S.draftTimer);
  S.draftTimer=setTimeout(()=>{S.draftTimer=null;const snapshot=S.pendingDraft;S.pendingDraft=null;queueDraft(snapshot);},250);
}
async function flushDraft(){
  if(S.draftTimer)clearTimeout(S.draftTimer);S.draftTimer=null;
  const snapshot=S.pendingDraft;S.pendingDraft=null;
  if(snapshot)await queueDraft(snapshot);else await S.draftWrites;
}
async function restoreDraft(retained){
  S.draftReady=false;
  const draft=retained===undefined?await dbRead("drafts",draftKey()):retained;
  S.edits=Array.isArray(draft?.edits)?structuredClone(draft.edits):[];
  $("proposal-title").value=draft?.title||"";$("proposal-note").value=draft?.note||"";
  $("proposal-json").value=typeof draft?.jsonText==="string"?draft.jsonText:json(S.edits);
  $("edit-record").value=draft?.editRecord||"";$("edit-tag").value=draft?.editTag||"";
  $("edit-action").value=draft?.editAction==="remove"?"remove":"set";$("edit-value").value=draft?.editValue||"";
  S.sourceDirty=!!draft?.sourceDirty;
  S.sourceDraft=new Set(S.sourceDirty&&Array.isArray(draft.sourceIds)?draft.sourceIds:S.status.selectedSourceIds);
  $("source-url").value=draft?.sourceUrl||"";$("source-import-select").checked=draft?.sourceImportSelect!==false;
  restoreWorkDraft(draft?.workState);
  S.preview=null;S.draftSerial=0;S.draftSavedSerial=0;S.draftReady=true;
  $("proposal-draft-status").textContent=draft?"Restored this tab's retained draft. Preview it against the current working selection.":"Drafts are retained separately for this workspace and browser tab.";
  renderEdits();renderSources();
}
async function synchronize({restore=false}={}){
  if(!S.client||!S.identity)throw new Error("Open a workspace first.");
  const previous=S.status?.revision;
  const status=await request("workspace.status");
  if(status.workspaceId!==S.identity.workspaceId)throw new Error("The status belongs to another workspace.");
  const [sources,editions]=await Promise.all([
    collect("sources.list",{expectedRevision:status.revision}),
    collect("editions.list",{expectedRevision:status.revision})
  ]);
  S.status=status;S.sources=sources;S.editions=editions;
  if(!S.sourceDirty)S.sourceDraft=new Set(status.selectedSourceIds);
  if(previous!==status.revision){
    S.pages={};S.activeProposal=null;S.activeRecord=null;S.preview=null;
    $("proposal-review-card").hidden=true;replace("record-details",node("p",{class:"empty"},"Choose a record to read its current complete tags and relationships."));
    replace("proposal-preview",node("p",{class:"empty"},"Preview the complete draft against this workspace revision."));
  }
  renderIdentity();populateSelects();renderOverview();renderSources();renderEditions();
  if(restore)await restoreDraft();
}
function populateSelects(){
  for(const select of document.querySelectorAll("[data-source-select]")){
    const previous=select.value,first=select.options[0]?.textContent||"All selected sources";
    select.replaceChildren(node("option",{value:""},first),...S.sources.map(source=>node("option",{value:source.id},source.name+" · "+short(source.id))));
    if([...select.options].some(option=>option.value===previous))select.value=previous;
  }
  for(const select of document.querySelectorAll("[data-edition-select],[data-saved-edition-select]")){
    const previous=select.value,working=select.hasAttribute("data-edition-select");
    select.replaceChildren(...(working?[node("option",{value:""},"Working selection")]:[]),...S.editions.map(edition=>node("option",{value:edition.id},edition.title+" · "+short(edition.id))));
    if([...select.options].some(option=>option.value===previous))select.value=previous;
  }
  if(S.editions.length>1&&!$("compare-before").dataset.chosen){$("compare-before").value=S.editions[0].id;$("compare-after").value=S.editions[S.editions.length-1].id;}
}
function renderIdentity(){
  const status=S.status;
  $("connection-state").textContent=status?"Connected":"Workspace closed";
  $("workspace-title").textContent=status?.title||"Open a local workspace to begin";
  $("workspace-revision").textContent=status?"Revision "+status.revision:"—";
  $("workspace-selection").textContent=status?status.selectedSourceIds.length+" selected source"+(status.selectedSourceIds.length===1?"":"s"):"No sources selected";
  replace("connection-details",...(status?dl([
    ["Workspace",status.workspaceId],["Instance",S.identity.instanceId],["Server",S.connectionUrl],
    ["State SHA-256",status.sha256],["Material SHA-256",status.materialSha256]
  ]).childNodes:[]));
  $("source-count").textContent=status?number(status.sourceCount):"";
  $("diagnostic-count").textContent=status?number(status.diagnosticCount):"";
  $("proposal-count").textContent=status?number(status.pendingProposals):"";
  $("rename-title").value=status?.title||"";
}
function renderOverview(){
  if(!S.status)return;
  const status=S.status;
  replace("overview-summary",...[["Original sources",status.sourceCount],["Selected records",status.recordCount],["Pending reviews",status.pendingProposals],["Saved editions",status.editionCount]].map(([label,value])=>node("div",{class:"metric"},node("strong",{},number(value)),node("span",{},label))));
  const chosen=status.selectedSourceIds.map(id=>S.sources.find(source=>source.id===id)).filter(Boolean);
  replace("overview-sources",...(chosen.length?chosen.map(source=>node("div",{class:"list-item"},node("strong",{},source.name),node("p",{},number(source.rows)+" records · "+size(source.bytes)),sourceKey(source.id))):[node("p",{class:"empty"},"No source files selected.")]));
}
async function openSection(name,{focus=true,load=true}={}){
  if(!$( "panel-"+name))return;
  S.section=name;
  for(const section of document.querySelectorAll(".panel"))section.hidden=section.id!=="panel-"+name;
  for(const button of document.querySelectorAll("[data-panel]")){if(button.dataset.panel===name)button.setAttribute("aria-current","page");else button.removeAttribute("aria-current");}
  if(focus)$("main").focus({preventScroll:true});
  if(load&&S.client)await loadSection(name);
}
async function loadSection(name){
  if(name==="sources")renderSources();
  else if(name==="assets")await loadAssets(0,true);
  else if(name==="diagnostics")await loadDiagnostics(0,true);
  else if(name==="work"){await loadWorks(0,true);await loadWorkReturns();renderReturnPreview();}
  else if(name==="proposals")await loadProposals();
  else if(name==="editions")renderEditions();
  else if(name==="operations")await loadOperations();
  else if(name==="overview")renderOverview();
}

function renderSources(){
  if(!S.status)return;
  const body=$("sources-body");body.replaceChildren();
  for(const source of S.sources){
    const checkbox=node("input",{type:"checkbox",disabled:S.busy,checked:S.sourceDraft.has(source.id),"aria-label":"Use "+source.name,dataset:{sourceId:source.id},onchange:event=>{
      if(event.target.checked)S.sourceDraft.add(source.id);else S.sourceDraft.delete(source.id);
      S.sourceDirty=!sameSet(S.sourceDraft,S.status.selectedSourceIds);renderSelectionNote();rememberDraft();controls();
    }});
    body.append(node("tr",{},
      node("td",{},checkbox),
      node("td",{},node("strong",{},source.name),sourceKey(source.id),node("p",{class:"help"},size(source.bytes)+" · "+text(source.format))),
      node("td",{},source.sourceUrl?node("span",{},source.sourceUrl):node("span",{class:"help"},"Source reference not supplied")),
      node("td",{},number(source.rows),node("p",{class:"help"},sourceCount(source.columns)+" columns")),
      node("td",{},when(source.importedAt)),
      node("td",{},node("div",{class:"button-row"},
        action("Inspect",()=>{ $("asset-source").value=source.id;$("asset-edition").value="";return openSection("assets");}),
        action("Original file",()=>downloadSource(source)),
        action("Details",()=>{replace("operation-details",detail("Original source metadata",source));return openSection("operations",{load:false});})
      ))
    ));
  }
  if(!S.sources.length)body.append(emptyRow(6,"No source files imported. Choose original JSON-v4 grids above."));
  renderSelectionNote();
}
function sameSet(left,right){const set=new Set(right);return left.size===set.size&&[...left].every(value=>set.has(value));}
function renderSelectionNote(){
  $("source-selection-note").textContent=S.sourceDirty
    ?S.sourceDraft.size+" sources in this selection draft. Choose Use selected sources to update the workspace."
    :S.status.selectedSourceIds.length+" sources in the current working selection.";
  $("source-selection-note").classList.toggle("selection-dirty",S.sourceDirty);
}
async function downloadSource(source){
  const bytes=await S.client.sourceBytes(source.id);
  saveFile(bytes,source.name,"application/json");
  notice("Downloaded the complete verified original source: "+source.name+".");
}
async function importSources(){
  requireWorkspace();
  const files=[...$("source-files").files],sourceUrl=$("source-url").value.trim(),select=$("source-import-select").checked;
  if(!files.length)throw new Error("Choose at least one native JSON-v4 grid.");
  let imported=0,retained=0;
  for(let index=0;index<files.length;index++){
    const file=files[index];
    if(file.size<1||file.size>32*1024*1024)throw new Error("Import a complete original grid of 1 byte to 32 MiB: "+file.name);
    $("import-progress").textContent="Importing "+(index+1)+" of "+files.length+": "+file.name;
    const base64=await fileBase64(file);
    const result=await mutate("source.import",cleanArgs({name:file.name,base64,sourceUrl,format:"json-v4",select}));
    if(result.alreadyRetained)retained++;else imported++;
    await synchronize();
  }
  $("source-files").value="";
  $("import-progress").textContent=imported+" new sources imported; "+retained+" identical files already retained. An identical import preserves the existing selection; use the selection table to change it.";
  notice("Source import complete. Every listed original file is retained.");
}

async function importCharlie(){
  requireWorkspace();
  $("import-progress").textContent="Reading the complete bundled Charlie source.";
  const response=await fetch(new URL("./fixture-charlie.json",location.href),{redirect:"error",cache:"no-store"});
  if(!response.ok)throw new Error("The complete bundled Charlie source could not be read.");
  const bytes=new Uint8Array(await response.arrayBuffer());
  if(bytes.length<1||bytes.length>32*1024*1024)throw new Error("The bundled Charlie source is outside the supported complete-file size.");
  const file=new File([bytes],"charlie.json",{type:"application/json"});
  const result=await mutate("source.import",{name:file.name,base64:await fileBase64(file),
    sourceUrl:"https://project-haystack.org/example/download/charlie.json",format:"json-v4",select:$("source-import-select").checked});
  await synchronize();
  $("import-progress").textContent=result.alreadyRetained
    ?"The complete Charlie source is already retained. Use the source selection table to include it."
    :"Imported the complete Charlie source: "+number(result.source?.rows)+" records, "+size(bytes.length)+".";
  notice("The original Charlie grid and its source metadata are retained in this workspace.");
}

function pageArgs(kind){
  if(kind==="asset")return cleanArgs({expectedRevision:revision(),editionId:$("asset-edition").value,sourceId:$("asset-source").value,role:$("asset-role").value,query:$("asset-query").value.trim()});
  if(kind==="diagnostic")return cleanArgs({expectedRevision:revision(),editionId:$("diagnostic-edition").value,sourceId:$("diagnostic-source").value,severity:$("diagnostic-severity").value,recordKey:$("diagnostic-record").value.trim()});
  if(kind==="work")return cleanArgs({expectedRevision:revision(),status:$("work-status-filter").value,assignee:$("work-assignee-filter").value.trim(),priority:$("work-priority-filter").value,sourceId:$("work-source-filter").value,query:$("work-query-filter").value.trim()});
  const beforeEditionId=$("compare-before").value,afterEditionId=$("compare-after").value;
  if(!beforeEditionId||!afterEditionId)throw new Error("Choose two saved editions.");
  const raw=$("compare-source-pairs").value.trim();
  const sourcePairs=raw?JSON.parse(raw):undefined;
  if(sourcePairs!==undefined&&!Array.isArray(sourcePairs))throw new Error("Source pairs must be a JSON array.");
  return cleanArgs({expectedRevision:revision(),beforeEditionId,afterEditionId,sourcePairs,state:$("compare-state").value});
}
async function readPage(kind,actionName,offset=0,reset=false){
  const previous=S.pages[kind],args=reset||!previous?pageArgs(kind):previous.args;
  const response=validatePage(await request(actionName,{...args,offset,limit:PAGE}),args,offset);
  let history=reset||!previous?[offset]:previous.history.slice();
  if(!reset&&previous){const earlier=history.indexOf(offset);if(earlier>=0)history=history.slice(0,earlier+1);else history.push(offset);}
  S.pages[kind]={args,response,history,offset};
  const start=response.items.length?offset+1:0,end=offset+response.items.length;
  $(kind+"-page-status").textContent=start+"–"+end+" of "+number(response.total)+(kind==="work"?" work items · workspace revision ":" records · workspace revision ")+args.expectedRevision+(args.editionId?" · edition "+short(args.editionId):"");
  return response;
}
async function pageMove(kind,direction){
  const page=S.pages[kind];if(!page)return;
  const offset=direction==="next"?page.response.nextOffset:page.history[page.history.length-2];
  if(offset===undefined||offset===null)return;
  if(kind==="asset")await loadAssets(offset);
  else if(kind==="diagnostic")await loadDiagnostics(offset);
  else if(kind==="work")await loadWorks(offset);
  else await loadComparison(offset);
}
async function loadAssets(offset=0,reset=false){
  const page=await readPage("asset","records.list",offset,reset);
  replace("assets-body",...(page.items.length?page.items.map(record=>node("tr",{dataset:{active:String(S.activeRecord?.record?.key===record.key)}},
    node("td",{class:"record-label"},linkButton(record.display||record.id||"Row "+record.rowIndex,()=>openRecord(record.key,S.pages.asset.args.editionId)),sourceKey(record.key),node("p",{class:"help"},record.id||"Record has no reference ID")),
    node("td",{},(record.roles||[]).length?(record.roles||[]).map(role=>badge(role)):node("span",{class:"help"},"Other"),record.kind?node("p",{class:"help"},record.kind+(record.unit?" · "+record.unit:"")):null),
    node("td",{},sourceName(record.sourceId),sourceKey(record.sourceId)),
    node("td",{},record.siteRef?node("div",{},"siteRef: "+record.siteRef):null,record.equipRef?node("div",{},"equipRef: "+record.equipRef):null,!record.siteRef&&!record.equipRef?"—":null)
  )):[emptyRow(4,"No records match this source, edition and filter.")]));
}
function diagnosticMessage(item){return item.message||item.description||item.code||"Finding";}
function diagnosticList(items,editionId=""){
  if(!items?.length)return node("p",{class:"help"},"No diagnostics for this scope.");
  return node("ul",{class:"diagnostic-list"},items.map(item=>node("li",{},badge(item.severity||"info")," ",node("strong",{},diagnosticMessage(item)),item.tag?node("span",{}," · "+item.tag):null,detail("Complete finding",item),action("Capture work from finding",()=>startWorkCapture({diagnostic:item,editionId})))));
}
async function openRecord(recordKey,editionId){
  const args=cleanArgs({expectedRevision:revision(),editionId,recordKey});
  const result=await request("record.read",args);
  S.activeRecord={...result,editionId,expectedRevision:args.expectedRevision};
  const record=result.record;
  const tagTable=node("table",{},node("caption",{class:"sr-only"},"Complete typed tags for "+(record.display||record.key)),node("thead",{},node("tr",{},node("th",{},"Tag"),node("th",{},"Native value"),node("th",{},"Review"))));
  const tags=node("tbody");
  for(const [tag,value] of Object.entries(record.tags||{}).sort(([a],[b])=>a<b?-1:a>b?1:0)){
    tags.append(node("tr",{},node("td",{},node("code",{},tag)),node("td",{},node("pre",{},json(value))),node("td",{},action("Propose edit",()=>editFromRecord(record,tag,value,editionId)))));
  }
  tagTable.append(tags);
  const relations=Array.isArray(result.relations)?result.relations:Object.values(result.relations||{}).flat().filter(item=>item&&typeof item==="object");
  const relationNodes=relations.map(relation=>{
    const targets=Array.isArray(relation.targetKeys)?relation.targetKeys:[];
    return node("div",{class:"list-item"},
      node("strong",{},relation.tag+" → "+text(relation.targetId))," ",badge(relation.state,relation.state!=="resolved"),
      relation.fromKey&&relation.fromKey!==record.key?node("p",{},"Referenced by ",linkButton(relation.fromKey,()=>openRecord(relation.fromKey,editionId))):null,
      node("div",{class:"detail-actions"},targets.map(key=>linkButton(key,()=>openRecord(key,editionId)))),
      relation.crossSourceCandidateKeys?.length?node("p",{class:"help"},"Matching ID strings also occur in "+relation.crossSourceCandidateKeys.length+" records in other sources. This reference keeps its original source scope."):null,
      detail("Complete source-local relationship",relation)
    );
  });
  replace("record-details",
    node("h4",{},record.display||record.id||"Unnamed record"),
    dl([["Record",record.key],["Source",sourceLabel(record.sourceId)],["Reference ID",record.id],["Roles",(record.roles||[]).join(", ")||"Other"],["Edition",editionId||"Working selection"],["Workspace revision",args.expectedRevision]]),
    node("div",{class:"detail-actions"},
      action("Find diagnostics",()=>{ $("diagnostic-record").value=record.key;$("diagnostic-edition").value=editionId||"";$("diagnostic-source").value=record.sourceId;return openSection("diagnostics");}),
      action("Use record in proposal",()=>editFromRecord(record,"",undefined,editionId)),
      action("Capture work from record",()=>startWorkCapture({recordKey:record.key,sourceId:record.sourceId,editionId,title:"Work for "+(record.display||record.id||record.key)}))
    ),
    node("h4",{},"Complete native tags"),node("div",{class:"table-wrap"},tagTable),
    node("h4",{},"Source-local hierarchy and references"),
    ...(relationNodes.length?relationNodes:[node("p",{class:"help"},"This record has no indexed references or incoming relationships.")]),
    node("h4",{},"Diagnostics"),diagnosticList(result.diagnostics||[],editionId)
  );
  controls();
}
async function editFromRecord(record,tag,value,editionId){
  $("edit-record").value=record.key;$("edit-tag").value=tag;$("edit-action").value="set";$("edit-value").value=value===undefined?"":json(value);
  rememberDraft();await openSection("proposals");
  $("edit-tag").focus();
  if(editionId)notice("The draft starts from a saved edition's value. Preview validates the record and before-value against the current working selection.");
}
async function loadDiagnostics(offset=0,reset=false){
  const page=await readPage("diagnostic","diagnostics.list",offset,reset);
  replace("diagnostics-body",...(page.items.length?page.items.map(item=>node("tr",{},
    node("td",{},badge(item.severity||"info",item.severity==="error")),
    node("td",{},node("strong",{},diagnosticMessage(item)),item.code?node("p",{class:"help"},item.code):null),
    node("td",{},item.recordKey?linkButton(item.recordKey,async()=>{await openSection("assets",{load:false});await openRecord(item.recordKey,S.pages.diagnostic.args.editionId);}):item.sourceId?sourceLabel(item.sourceId):"Workspace"),
    node("td",{},action("Capture work",()=>startWorkCapture({diagnostic:item,editionId:S.pages.diagnostic.args.editionId||""})),detail("Complete finding",item))
  )):[emptyRow(4,"No diagnostics match this scope.")]));
}
function checkEdits(edits){
  if(!Array.isArray(edits))throw new Error("The draft must be an array of tag edits.");
  const seen=new Set();
  for(const [index,edit] of edits.entries()){
    if(!edit||typeof edit!=="object"||Array.isArray(edit)||typeof edit.recordKey!=="string"||typeof edit.tag!=="string"||!edit.recordKey.trim()||!edit.tag.trim())throw new Error("Edit "+(index+1)+" needs an exact record key and tag.");
    if(!["set","remove"].includes(edit.action))throw new Error("Edit "+(index+1)+" must set a native value or remove the tag.");
    if(edit.action==="set"&&!own(edit,"value"))throw new Error("Edit "+(index+1)+" has no native value.");
    const key=stringifyJson([edit.recordKey,edit.tag]);
    if(seen.has(key))throw new Error("Only one draft edit may target each record and tag. Duplicate: "+edit.tag+".");
    seen.add(key);
  }
  return structuredClone(edits);
}
function renderEdits(){
  replace("proposal-edits",...(S.edits.length?S.edits.map((edit,index)=>node("div",{class:"list-item"},
    node("strong",{},(index+1)+". "+edit.tag+" · "+edit.action),
    sourceKey(edit.recordKey),
    edit.action==="set"?node("pre",{},json(edit.value)):node("p",{class:"help"},"The tag will be absent."),
    action("Remove draft edit",()=>{const current=visibleEdits();S.edits=current.filter(item=>item.recordKey!==edit.recordKey||item.tag!==edit.tag);S.preview=null;$("proposal-json").value=json(S.edits);renderEdits();rememberDraft();})
  )):[node("p",{class:"empty"},"No tag edits in this draft.")]));
}
function changeValue(value){
  return value?.present?node("pre",{},json(value.value)):node("p",{class:"help"},"Tag absent");
}
function renderChanges(changes){
  if(!changes?.length)return node("p",{class:"empty"},"No material tag changes.");
  return node("div",{},changes.map(change=>node("section",{class:"comparison-change"},
    node("strong",{},change.tag),change.recordKey?sourceKey(change.recordKey):null,
    node("div",{class:"before-after"},node("div",{},node("h4",{},"Before"),changeValue(change.before)),node("div",{},node("h4",{},"After"),changeValue(change.after)))
  )));
}
function renderPreview(result,target="proposal-preview"){
  replace(target,
    dl([["Material SHA-256",result.materialSha256||S.status.materialSha256],["Tag changes",result.changes?.length??0],["Record counts",json(result.counts||{})],["Diagnostics",Array.isArray(result.diagnostics)?result.diagnostics.length:"See preview"]]),
    renderChanges(result.changes||[]),
    detail("Complete resulting diagnostics",result.diagnostics||[])
  );
}
function visibleEdits(){
  let edits;try{edits=JSON.parse($("proposal-json").value);}catch{throw new Error("The complete edits array is not valid JSON. Correct it before continuing.");}
  S.edits=checkEdits(edits);renderEdits();rememberDraft();return structuredClone(S.edits);
}
async function previewDraft(){
  const edits=visibleEdits();if(!edits.length)throw new Error("Add at least one tag edit.");
  const expectedRevision=revision();
  const result=await request("proposal.preview",{expectedRevision,edits});
  S.preview={...result,expectedRevision,edits:structuredClone(edits)};
  renderPreview(result);notice("Preview complete. Review each native before-and-after value and the resulting findings.");
}
async function addEdit(){
  visibleEdits();
  const recordKey=$("edit-record").value.trim(),tag=$("edit-tag").value.trim(),kind=$("edit-action").value;
  if(!recordKey||!tag)throw new Error("Enter the exact record key and tag.");
  const edit={recordKey,tag,action:kind};
  if(kind==="set"){try{edit.value=JSON.parse($("edit-value").value);}catch{throw new Error("Enter a valid native JSON value for this tag.");}}
  const index=S.edits.findIndex(item=>item.recordKey===recordKey&&item.tag===tag);
  if(index>=0)throw new Error("This tag already has a draft edit. Remove that edit or update the complete edits array before replacing it.");
  S.edits=checkEdits([...S.edits,edit]);S.preview=null;$("proposal-json").value=json(S.edits);renderEdits();rememberDraft();
}
async function prepareProposal(){
  const title=$("proposal-title").value.trim(),note=$("proposal-note").value;
  if(!title)throw new Error("Give the proposal a title.");
  const edits=visibleEdits();if(!edits.length)throw new Error("Add at least one tag edit.");
  await flushDraft();
  const result=await mutate("proposal.prepare",{title,note,edits});
  const proposalId=result.proposal?.id||result.proposalId||result.id;
  await synchronize();await loadProposals();
  if(proposalId)await openProposal(proposalId);
  notice("Proposal prepared. Review its complete before-and-after values, then accept or reject it.");
}
async function loadProposals(){
  const state=$("proposal-state").value;
  S.proposals=await collect("proposals.list",cleanArgs({expectedRevision:revision(),state}));
  replace("proposals-body",...(S.proposals.length?S.proposals.map(proposal=>node("tr",{},
    node("td",{},node("strong",{},proposal.title),sourceKey(proposal.id),proposal.stale?node("p",{class:"help"},"Working material has changed since this proposal was prepared."):null),
    node("td",{},badge(proposal.state,proposal.stale),proposal.stale?node("p",{class:"help"},"Stale"):null),
    node("td",{},number(proposal.changeCount??proposal.changes?.length??0)),
    node("td",{},when(proposal.createdAt)),
    node("td",{},action("Review",()=>openProposal(proposal.id)))
  )):[emptyRow(5,"No proposals match this state.")]));
}
async function openProposal(proposalId){
  const result=await request("proposal.read",{expectedRevision:revision(),proposalId});
  S.activeProposal=result;
  const proposal=result.proposal;
  $("proposal-review-card").hidden=false;
  $("proposal-review-heading").textContent=proposal.title;
  $("proposal-review-note").value="";
  replace("proposal-review-details",
    dl([["State",proposal.state+(proposal.stale?" · material changed":"")],["Proposal",proposal.id],["Prepared",when(proposal.createdAt)],["Original material SHA-256",proposal.baseMaterialSha256],["Original note",proposal.note||"—"]]),
    proposal.stale?node("p",{class:"error-message"},"The working selection has changed. This original proposal remains available; prepare a new proposal from the current material to accept revised changes."):null,
    renderChanges(proposal.changes),
    result.preview?detail("Complete current preview and diagnostics",result.preview):null,
    proposal.review?detail("Recorded review",proposal.review):null,
    detail("Complete proposal",proposal)
  );
  $("proposal-review-form").hidden=proposal.state!=="proposed";
  controls();
  $("proposal-review-card").scrollIntoView({block:"start",behavior:"instant"});
}
async function reviewProposal(decision){
  if(!["accept","reject"].includes(decision)||!S.activeProposal)throw new Error("Open a proposal and choose its review decision.");
  const proposalId=S.activeProposal.proposal.id,note=$("proposal-review-note").value;
  await mutate("proposal.review",{proposalId,decision,note});
  await synchronize();await loadProposals();await openProposal(proposalId);
  notice(decision==="accept"?"Proposal accepted into the working material. Save an edition to retain this handover state.":"The proposal's rejection is recorded.");
}
function renderEditions(){
  replace("editions-body",...(S.editions.length?S.editions.map(edition=>node("tr",{},
    node("td",{},node("strong",{},edition.title),sourceKey(edition.id),edition.note?node("p",{class:"help"},edition.note):null),
    node("td",{},when(edition.savedAt),node("p",{class:"help"},"Workspace revision "+edition.savedRevision)),
    node("td",{},number(edition.sourceIds?.length??0)),
    node("td",{},json(edition.counts||{})),
    node("td",{},node("div",{class:"button-row"},action("Details",()=>openEdition(edition.id)),action("Register",()=>{ $("asset-edition").value=edition.id;$("asset-source").value="";return openSection("assets");}),action("Deliver",()=>{ $("report-edition").value=edition.id;return openSection("exports");})))
  )):[emptyRow(5,"No editions have been saved yet.")]));
}
async function openEdition(editionId){
  const result=await request("edition.read",{expectedRevision:revision(),editionId});
  replace("edition-details",node("h4",{},result.edition.title),dl([["Edition",result.edition.id],["Saved",when(result.edition.savedAt)],["Material SHA-256",result.edition.materialSha256],["Records",json(result.counts||result.edition.counts)],["Diagnostics",result.diagnosticCount??result.edition.diagnosticCount]]),detail("Complete immutable edition and source metadata",result));
}
async function saveEdition(){
  const title=$("edition-title").value.trim(),note=$("edition-note").value;
  if(!title)throw new Error("Give this edition a title.");
  const result=await mutate("edition.save",{title,note});
  await synchronize();
  const editionId=result.edition?.id||result.editionId||result.id;
  if(editionId)await openEdition(editionId);
  $("edition-title").value="";$("edition-note").value="";
  notice("The complete working selection and accepted tag changes are retained in a new immutable edition.");
}
async function loadComparison(offset=0,reset=false){
  const page=await readPage("comparison","edition.compare",offset,reset);
  replace("comparison-summary",detail("Complete comparison counts",page.counts||page.comparisonCounts||{}));
  replace("comparison-body",...(page.items.length?page.items.map(item=>node("tr",{},
    node("td",{},badge(item.state||item.change||"record",(item.state||item.change)!=="same")),
    node("td",{},item.display||item.after?.display||item.before?.display||item.recordKey||item.key||item.id||"Record",sourceKey(item.recordKey||item.after?.key||item.before?.key||item.key||"")),
    node("td",{},detail("Source identities",{
      beforeSourceId:item.beforeSourceId||item.before?.sourceId||null,
      afterSourceId:item.afterSourceId||item.after?.sourceId||null
    })),
    node("td",{},Array.isArray(item.changes)?renderChanges(item.changes):detail("Complete before and after",item),Array.isArray(item.changes)?detail("Complete comparison record",item):null)
  )):[emptyRow(4,"No records match this edition comparison.")]));
}
function reportRules(){
  const kind=$("report-kind").value;
  if(kind!=="native-grid")$("report-source").value="";
  if(kind==="native-grid"){$("report-format").value="json";$("report-help").textContent="Choose one exact source. The export is a complete native JSON-v4 grid for that source, including accepted changes in the selected edition.";}
  else if(kind==="diagnostics")$("report-help").textContent="The report includes every finding and its source or record reference for the chosen scope.";
  else if(kind==="work-register")$("report-help").textContent="The complete corrective work register includes current assignment, progress, source context and retained evidence across this workspace.";
  else $("report-help").textContent="The report includes every source-linked asset or point in the chosen scope, with native tag values.";
  controls();
}
async function prepareReport(){
  const kind=$("report-kind").value;
  const fields=cleanArgs({kind,format:$("report-format").value,editionId:kind==="work-register"?undefined:$("report-edition").value,sourceId:kind==="native-grid"?$("report-source").value:undefined,role:kind==="register"?$("report-role").value:undefined});
  if(kind==="native-grid"&&!fields.sourceId)throw new Error("Choose one exact source for the native grid export.");
  const result=await mutate("delivery.prepare",fields);
  S.delivery=result;renderDelivery(result);await loadLocalOperations();
  notice("The complete delivery is prepared and retained under its original operation.");
}
function renderDelivery(result){
  if(!result)return;
  replace("delivery-result",
    node("h4",{},result.name||"Prepared delivery"),
    dl([["Kind",result.kind],["Workspace revision",result.revision],["Bytes",size(result.bytes)],["SHA-256",result.sha256],["Operation",result.operationId],["Prepared",when(result.createdAt)]]),
    action("Download complete file",()=>downloadDelivery(result),{class:"primary"}),
    detail("Complete delivery receipt",result)
  );
}
async function downloadDelivery(result){
  const bytes=await S.client.deliveryBytes(result.operationId);
  saveFile(bytes,result.name,result.mediaType);
  notice("Downloaded "+result.name+" with complete-byte verification.");
}
async function prepareWorkspace(){
  const result=await mutate("delivery.prepare",{kind:"workspace"});
  S.delivery=result;renderDelivery(result);await loadLocalOperations();
  notice("The complete editable application, original source bytes and workspace history are ready to download.");
}
async function loadLocalOperations(){
  if(!S.identity)return;
  const workspaceId=S.identity.workspaceId;
  const rows=(await dbRead("operations")).filter(item=>item.workspaceId===workspaceId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  if(S.identity?.workspaceId!==workspaceId)return;
  S.localOperations=rows;
  const pending=rows.filter(item=>item.state!=="completed").length;
  $("operation-count").textContent=pending?number(pending):"";
  $("local-operation-status").textContent=rows.length+" individually retained original requests; "+pending+" awaiting a completed receipt.";
  replace("local-operations-body",...(rows.length?rows.map(item=>node("tr",{},
    node("td",{},item.action,item.error?node("p",{class:"help"},item.error.message):null),
    node("td",{},badge(item.state,item.state!=="completed")),
    node("td",{},when(item.createdAt)),
    node("td",{},node("code",{},item.operationId),node("p",{class:"help"},"Expected revision "+item.args.expectedRevision)),
    node("td",{},node("div",{class:"button-row"},
      action("Read receipt",()=>recoverOperation(item,false)),
      item.state!=="completed"?action("Resend original",()=>recoverOperation(item,true)):null,
      item.action==="delivery.prepare"&&item.receipt?action("Delivery",()=>{S.delivery=item.receipt;renderDelivery(item.receipt);return openSection("exports");}):null,
      action("Request details",()=>showLocalOperation(item))
    ))
  )):[emptyRow(5,"No original requests retained for this workspace in this browser.")]));
}
function showLocalOperation(item){
  const safe={...item,args:{...item.args}};
  if(own(safe.args,"base64"))safe.args.base64="[Complete original source bytes retained; "+safe.args.base64.length+" base64 characters]";
  replace("operation-details",detail("Retained request envelope",safe),action("Download complete original request",()=>saveFile(new TextEncoder().encode(json({format:"commons.haystack.operator.request.v1",workspaceId:item.workspaceId,action:item.action,args:item.args})),item.operationId+".request.json","application/json")));
}
function missingReceipt(error){return error?.status===404||["operation_not_found","unknown_operation","not_found"].includes(error?.code);}
async function recoverOperation(item,resend){
  if(item.workspaceId!==S.identity.workspaceId)throw new Error("This original request belongs to another workspace.");
  let receipt;
  try{receipt=await request("operation.read",{operationId:item.operationId});}
  catch(error){
    if(!missingReceipt(error))throw error;
    if(!resend){notice("No completed receipt exists for this operation. Its exact original request remains available for an explicit resend.");return;}
  }
  if(receipt){
    await updateOperation(item,"completed",receipt);
    await synchronize();await loadOperations();showReceipt(receipt,item.action);
    notice("Recovered the completed original operation receipt.");
    return;
  }
  if(!await confirmAction("Resend the original request?","This sends the same "+item.action+" action, operation ID, expected revision and complete arguments. A changed workspace may reject this original request; its identity will stay intact.","Resend original"))return;
  try{
    receipt=await request(item.action,structuredClone(item.args));
    await updateOperation(item,"completed",receipt);
    await synchronize();await loadOperations();showReceipt(receipt,item.action);
    notice("The original request completed with its original operation ID.");
  }catch(error){await updateOperation(item,error?.outcomeUnknown?"outcome unknown":"not completed",null,shortError(error));throw error;}
}
function showReceipt(receipt,actionName){
  replace("operation-details",detail("Complete original operation receipt",receipt));
  const workResult=receipt.result?.itemId?receipt.result:receipt;
  if(actionName?.startsWith("work.")&&workResult.itemId)$("operation-details").append(action("Open original work item",async()=>{await openSection("work");await openWork(workResult.itemId);}));
  if(actionName==="return.apply")$("operation-details").append(action("Read retained return decisions",()=>openSection("work")));
  const delivery=receipt.result?.kind?receipt.result:receipt;
  if((actionName==="delivery.prepare"||delivery.kind)&&delivery.operationId&&delivery.sha256&&delivery.name){
    S.delivery=delivery;
    $("operation-details").append(action("Open prepared delivery",()=>{renderDelivery(delivery);return openSection("exports");}));
  }
}
async function loadOperations(){
  const rows=await collect("operations.list",{expectedRevision:revision()});
  replace("operations-body",...(rows.length?rows.map(item=>node("tr",{},
    node("td",{},item.action||"Recorded action"),
    node("td",{},number(item.revision??item.result?.revision??item.expectedRevision)),
    node("td",{},when(item.at||item.createdAt||item.completedAt)),
    node("td",{},node("code",{},item.operationId||item.id)),
    node("td",{},action("Read receipt",async()=>{const result=await request("operation.read",{operationId:item.operationId||item.id});showReceipt(result,item.action);}))
  )):[emptyRow(5,"No operations have been recorded in this workspace.")]));
  await loadLocalOperations();
}

function confirmAction(title,message,label="Continue"){
  $("confirm-heading").textContent=title;$("confirm-message").textContent=message;$("confirm-yes").textContent=label;
  $("confirm-yes").disabled=false;$("confirm-no").disabled=false;
  return new Promise(resolve=>{
    let settled=false;
    const finish=value=>{
      if(settled)return;settled=true;
      $("confirm-form").removeEventListener("submit",yes);$("confirm-no").removeEventListener("click",no);$("confirm-dialog").removeEventListener("cancel",cancel);
      $("confirm-dialog").close();resolve(value);
    };
    const yes=event=>{event.preventDefault();finish(true);},no=()=>finish(false),cancel=event=>{event.preventDefault();finish(false);};
    $("confirm-form").addEventListener("submit",yes);$("confirm-no").addEventListener("click",no);$("confirm-dialog").addEventListener("cancel",cancel);
    $("confirm-dialog").showModal();$("confirm-no").focus();
  });
}
function showConnect(){
  $("connect-error").hidden=true;
  if(!$("connect-url").value)$("connect-url").value=/^https?:$/.test(location.protocol)?location.origin:"http://127.0.0.1:8768";
  if(S.identity)$("connect-workspace").value=S.identity.workspaceId;
  if(!$("connect-dialog").open)$("connect-dialog").showModal();
}
function resetContent(){
  resetWorkContent();
  S.pages={};S.activeProposal=null;S.activeRecord=null;S.delivery=null;S.preview=null;S.proposals=[];
  $("proposal-review-card").hidden=true;
  replace("record-details",node("p",{class:"empty"},"Choose a record to read its complete native tags and source-local relationships."));
  replace("assets-body",emptyRow(4,"Read the register to inspect this workspace."));
  replace("diagnostics-body",emptyRow(4,"Read the findings for this workspace."));
  replace("comparison-body",emptyRow(4,"Choose two saved editions."));
  replace("proposals-body",emptyRow(5,"Read the proposals for this workspace."));
  replace("operations-body",emptyRow(5,"Read the recorded workspace actions."));
  replace("local-operations-body",emptyRow(5,"Read this workspace's retained browser requests."));
  for(const id of ["asset-page-status","diagnostic-page-status","comparison-page-status","comparison-summary","edition-details","operation-details","local-operation-status"])replace(id);
  replace("delivery-result",node("p",{class:"empty"},"Prepare a complete delivery for this workspace."));
  replace("proposal-preview",node("p",{class:"empty"},"Preview the complete draft against the current working selection."));
  $("operation-count").textContent="";
}
async function connectWorkspace(){
  const url=$("connect-url").value.trim(),token=$("connect-token").value,workspaceId=$("connect-workspace").value.trim();
  $("connect-error").hidden=true;
  await flushDraft();
  if(new URL(url).origin!==location.origin)throw new Error("Open the workspace browser at its own server address before connecting.");
  const client=new HaystackClient(cleanArgs({url,token,workspaceId}));
  const identity=await client.connect();
  const status=await client.request("workspace.status",{});
  if(status.workspaceId!==identity.workspaceId)throw new Error("The server's identity and workspace status differ.");
  const [sources,editions,draft]=await Promise.all([
    collect("sources.list",{expectedRevision:status.revision},{client,identity}),
    collect("editions.list",{expectedRevision:status.revision},{client,identity}),
    dbRead("drafts",identity.workspaceId+":"+tabId)
  ]);
  S.client=client;S.identity=identity;S.status=status;S.connectionUrl=url;S.sources=sources;S.editions=editions;S.sourceDirty=false;S.sourceDraft=new Set(status.selectedSourceIds);S.draftReady=false;
  $("source-files").value="";
  resetContent();renderIdentity();populateSelects();renderOverview();renderSources();renderEditions();
  await restoreDraft(draft||null);await loadLocalOperations();await openSection("overview",{load:false});
  $("connect-token").value="";$("connect-workspace").value=identity.workspaceId;$("connect-dialog").close();
  notice("Opened "+status.title+" at workspace revision "+status.revision+".");
}
async function disconnectWorkspace(){
  await flushDraft();
  S.client=null;S.identity=null;S.status=null;S.connectionUrl=null;S.sources=[];S.editions=[];S.edits=[];S.sourceDraft=new Set();S.sourceDirty=false;S.draftReady=false;
  resetContent();renderIdentity();populateSelects();$("source-files").value="";$("source-url").value="";replace("overview-summary");replace("overview-sources",node("p",{class:"empty"},"No workspace open."));
  replace("sources-body",emptyRow(6,"Open a workspace to read its original sources."));
  replace("editions-body",emptyRow(5,"Open a workspace to read its saved editions."));
  for(const id of ["proposal-title","proposal-note","edit-record","edit-tag","edit-value","connect-token"])$(id).value="";
  $("proposal-json").value="[]";renderEdits();$("connect-dialog").close();
  await openSection("overview",{load:false});
  notice("Workspace closed. Its original requests and drafts remain retained in this browser.");
}
function bindForm(id,callback){
  $(id).addEventListener("submit",event=>{
    event.preventDefault();const submitter=event.submitter;
    run(()=>callback(event,submitter));
  });
}
function bindButton(id,callback){$(id).addEventListener("click",()=>run(callback));}
for(const button of document.querySelectorAll("[data-panel]"))button.addEventListener("click",()=>run(()=>openSection(button.dataset.panel)));
for(const button of document.querySelectorAll("[data-go]"))button.addEventListener("click",()=>run(()=>openSection(button.dataset.go)));
for(const button of document.querySelectorAll("[data-connect]"))button.addEventListener("click",showConnect);
$("show-connect").addEventListener("click",showConnect);
$("close-connect").addEventListener("click",()=>$("connect-dialog").close());
$("connect-form").addEventListener("submit",event=>{
  event.preventDefault();
  run(async()=>{try{await connectWorkspace();}catch(error){$("connect-error").textContent=error.message;$("connect-error").hidden=false;throw error;}});
});
bindButton("disconnect",disconnectWorkspace);
bindButton("refresh-workspace",async()=>{await flushDraft();await synchronize();await loadSection(S.section);notice("Workspace refreshed to revision "+S.status.revision+".");});
bindForm("rename-form",async()=>{const title=$("rename-title").value.trim();if(!title)throw new Error("Enter a workspace name.");await mutate("workspace.rename",{title});await synchronize();notice("Workspace name saved.");});
bindForm("source-import-form",importSources);
bindButton("import-charlie",importCharlie);
bindButton("reload-sources",async()=>{await synchronize();renderSources();});
bindButton("source-select-all",()=>{S.sourceDraft=new Set(S.sources.map(source=>source.id));S.sourceDirty=!sameSet(S.sourceDraft,S.status.selectedSourceIds);renderSources();rememberDraft();});
bindButton("source-select-none",()=>{S.sourceDraft.clear();S.sourceDirty=!sameSet(S.sourceDraft,S.status.selectedSourceIds);renderSources();rememberDraft();});
bindButton("save-source-selection",async()=>{
  const sourceIds=[...S.sourceDraft];await mutate("source.select",{sourceIds});S.sourceDirty=false;await synchronize();rememberDraft();
  notice("The working selection now uses "+sourceIds.length+" original sources. Existing saved editions remain available.");
});
bindForm("asset-filter-form",()=>loadAssets(0,true));
bindButton("reload-assets",()=>loadAssets(0,true));
bindForm("diagnostic-filter-form",()=>loadDiagnostics(0,true));
for(const kind of ["asset","diagnostic","comparison","work"]){bindButton(kind+"-previous",()=>pageMove(kind,"previous"));bindButton(kind+"-next",()=>pageMove(kind,"next"));}
bindButton("add-edit",addEdit);
$("edit-action").addEventListener("change",()=>{controls();rememberDraft();});
for(const id of ["proposal-title","proposal-note","edit-record","edit-tag","edit-value","proposal-json","source-url"])$(id).addEventListener("input",rememberDraft);
$("source-import-select").addEventListener("change",rememberDraft);
bindButton("load-proposal-json",()=>{
  let edits;try{edits=JSON.parse($("proposal-json").value);}catch{throw new Error("The complete draft is not valid JSON.");}
  S.edits=checkEdits(edits);S.preview=null;$("proposal-json").value=json(S.edits);renderEdits();rememberDraft();
  notice("The complete edits array is now the active draft. Preview its resulting changes.");
});
bindButton("preview-proposal",previewDraft);
bindForm("proposal-form",prepareProposal);
bindButton("clear-proposal-draft",async()=>{
  if(!await confirmAction("Clear this proposal draft?","This clears this tab's title, note and draft edits for the current workspace. Prepared proposals remain in its saved review history.","Clear draft"))return;
  S.edits=[];S.preview=null;$("proposal-title").value="";$("proposal-note").value="";$("proposal-json").value="[]";
  for(const id of ["edit-record","edit-tag","edit-value"])$(id).value="";
  replace("proposal-preview",node("p",{class:"empty"},"Add typed tag edits to preview a new proposal."));
  renderEdits();rememberDraft();await flushDraft();
});
bindButton("reload-proposals",loadProposals);
$("proposal-state").addEventListener("change",()=>run(loadProposals));
bindButton("close-proposal-review",()=>{S.activeProposal=null;$("proposal-review-card").hidden=true;});
bindForm("proposal-review-form",(_event,submitter)=>reviewProposal(submitter?.value));
bindForm("edition-save-form",saveEdition);
bindButton("reload-editions",async()=>{await synchronize();renderEditions();});
bindForm("edition-compare-form",()=>loadComparison(0,true));
$("compare-before").addEventListener("change",()=>{$("compare-before").dataset.chosen="true";});
$("compare-after").addEventListener("change",()=>{$("compare-before").dataset.chosen="true";});
bindForm("report-form",prepareReport);
$("report-kind").addEventListener("change",reportRules);
bindButton("prepare-workspace-delivery",prepareWorkspace);
bindButton("reload-operations",loadOperations);
window.addEventListener("pagehide",()=>{const snapshot=S.pendingDraft||draftSnapshot();if(S.draftTimer)clearTimeout(S.draftTimer);S.draftTimer=null;S.pendingDraft=null;queueDraft(snapshot);});
window.addEventListener("beforeunload",event=>{
  if(S.busy||S.pendingDraft||(S.draftReady&&S.draftSavedSerial<S.draftSerial)){event.preventDefault();event.returnValue="";}
});

const WORK_FIELDS=["title","description","assignee","dueDate","priority"];
const RETURN_FIELDS=[...WORK_FIELDS,"progress"];
const WORK_LABELS={title:"Title",description:"Required work",assignee:"Assigned to",dueDate:"Due date",priority:"Priority",progress:"Status, submission and review"};
const WORK_FILE_LIMIT=8*1024*1024,WORK_RETURN_LIMIT=192*1024*1024;
function valueText(value){return value===null||value===undefined?"Not recorded":typeof value==="object"?json(value):String(value);}
function workFields(prefix){return {title:$(prefix+"title").value,description:$(prefix+"description").value,assignee:$(prefix+"assignee").value,dueDate:$(prefix+"due").value,priority:$(prefix+"priority").value};}
function setWorkFields(prefix,fields={}){
  for(const [key,suffix] of [["title","title"],["description","description"],["assignee","assignee"],["dueDate","due"],["priority","priority"]])$(prefix+suffix).value=fields[key]??(key==="priority"?"routine":"");
}
function activeWorkDraft(){
  const item=S.activeWork;if(!item)return null;
  return S.workDrafts[item.id]||(S.workDrafts[item.id]={
    itemId:item.id,expectedHeadSha256:item.headSha256,base:structuredClone(item.current),
    fields:structuredClone(item.current.fields),author:"",note:"",
    evidenceKind:"note",evidenceAuthor:"",evidenceNote:"",evidenceProposalId:"",evidenceFile:null,
    reviewAuthor:"",reviewNote:"",reviewEditionId:"",rebases:[]
  });
}
function captureVisibleWorkDrafts(){
  if(S.workCapture){
    S.workCapture.fields=workFields("work-capture-");
    S.workCapture.author=$("work-capture-author").value;
    S.workCapture.recordKey=$("work-capture-record").value;
  }
  if(S.activeWork){
    const d=activeWorkDraft();d.fields=workFields("work-edit-");
    d.author=$("work-edit-author").value;d.note=$("work-edit-note").value;
    d.evidenceKind=$("work-evidence-kind").value;d.evidenceAuthor=$("work-evidence-author").value;
    d.evidenceNote=$("work-evidence-note").value;d.evidenceProposalId=$("work-evidence-proposal").value;
    d.reviewAuthor=$("work-review-author").value;d.reviewNote=$("work-review-note").value;d.reviewEditionId=$("work-review-edition").value;
  }
  S.returnDraft.author=$("work-return-author").value;S.returnDraft.note=$("work-return-note").value;
}
function workDraftSnapshot(){
  captureVisibleWorkDrafts();
  return structuredClone({capture:S.workCapture,selectedId:S.selectedWorkId,items:S.workDrafts,returned:S.returnDraft});
}
function restoreWorkDraft(saved){
  S.workCapture=saved?.capture&&typeof saved.capture==="object"?structuredClone(saved.capture):null;
  S.workDrafts=saved?.items&&typeof saved.items==="object"?structuredClone(saved.items):{};
  S.selectedWorkId=typeof saved?.selectedId==="string"?saved.selectedId:null;
  S.returnDraft=saved?.returned&&typeof saved.returned==="object"?structuredClone(saved.returned):{file:null,preview:null,decisions:{},author:"",note:""};
  S.returnDraft.decisions||={};S.workUploads=new Map();S.activeWork=null;
  renderWorkCapture();renderReturnPreview();
}
function resetWorkContent(){
  S.works=[];S.activeWork=null;S.selectedWorkId=null;S.workDrafts={};S.workCapture=null;S.workUploads=new Map();
  S.returnDraft={file:null,preview:null,decisions:{},author:"",note:""};
  $("work-capture-card").hidden=true;$("work-detail-card").hidden=true;$("work-recovery").hidden=true;
  $("work-return-apply-form").hidden=true;$("work-return-stale").hidden=true;
  $("work-evidence-file").value="";$("work-return-file").value="";
  replace("work-body",emptyRow(5,"Read work for this workspace."));
  for(const id of ["work-page-status","work-returns-list","work-return-read","work-return-summary","work-return-items"])replace(id);
  $("work-count").textContent="";$("work-return-file-status").textContent="No return file retained.";
}
function workControls(){
  const unavailable=S.busy||!S.client,d=S.activeWork?activeWorkDraft():null,stale=!!d&&d.expectedHeadSha256!==S.activeWork.headSha256;
  for(const id of ["work-update-save","work-evidence-save","work-submit","work-verify","work-reopen","work-exception"])$(id).disabled=unavailable||!d||stale;
  $("work-submit").disabled=unavailable||!d||stale||!S.activeWork.evidence?.length;
  $("work-verify").disabled=unavailable||!d||stale||S.activeWork.current.status!=="submitted"||!S.activeWork.current.submission?.sha256;
  $("work-capture-save").disabled=unavailable||!S.workCapture;
  $("work-capture-record").readOnly=!!S.workCapture?.context?.diagnostic;
  $("work-capture-edition").disabled=unavailable||!!S.workCapture?.context?.diagnostic;
  $("work-adopt-current").disabled=unavailable||!stale;
  const preview=S.returnDraft.preview;
  $("work-return-apply").disabled=unavailable||!preview||preview.expectedRevision!==S.status?.revision||preview.packageSha256!==S.returnDraft.file?.sha256;
  $("work-return-stale").hidden=!preview||preview.expectedRevision===S.status?.revision;
  const kind=$("work-evidence-kind").value;
  $("work-evidence-file-fields").hidden=kind!=="file";$("work-evidence-proposal-fields").hidden=kind!=="proposal";
}
async function digestWorkBytes(bytes){
  if(!crypto.subtle)throw new Error("Complete file and finding verification needs Web Crypto.");
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(x=>x.toString(16).padStart(2,"0")).join("");
}
async function canonicalWorkHash(value){return digestWorkBytes(new TextEncoder().encode(canonicalJson(value)));}
function encodeWorkBytes(bytes){let binary="";for(let p=0;p<bytes.length;p+=32768)binary+=String.fromCharCode(...bytes.subarray(p,p+32768));return btoa(binary);}
async function retainWorkUpload(file,kind){
  requireWorkspace();const limit=kind==="return"?WORK_RETURN_LIMIT:WORK_FILE_LIMIT;
  if(!file||file.size<1||file.size>limit)throw new Error("Choose a complete "+(kind==="return"?"workspace return of up to 192 MiB.":"evidence file of up to 8 MiB."));
  const bytes=new Uint8Array(await file.arrayBuffer());if(bytes.length!==file.size)throw new Error("The complete selected file could not be read.");
  const sha256=await digestWorkBytes(bytes),key=draftKey()+":work-"+kind+":"+sha256;
  const entry={key,workspaceId:S.identity.workspaceId,tabId,kind:"work-"+kind,name:file.name,mediaType:file.type||"application/octet-stream",bytes:bytes.length,sha256,base64:encodeWorkBytes(bytes),retainedAt:new Date().toISOString()};
  S.workUploads.set(key,entry);
  await dbWrite("drafts",entry);
  return {key,name:entry.name,mediaType:entry.mediaType,bytes:entry.bytes,sha256:entry.sha256};
}
async function retainedWorkUpload(reference,kind){
  if(!reference||typeof reference.key!=="string"||reference.key!==draftKey()+":work-"+kind+":"+reference.sha256||typeof reference.name!=="string"||!reference.name||typeof reference.mediaType!=="string"||!reference.mediaType)throw new Error("Select and retain the complete original file and its reviewed name and type for this workspace and tab.");
  let entry=S.workUploads.get(reference.key);
  if(!entry){entry=await dbRead("drafts",reference.key);if(entry)S.workUploads.set(reference.key,entry);}
  if(!entry||entry.workspaceId!==S.identity.workspaceId||entry.tabId!==tabId||entry.kind!=="work-"+kind||entry.bytes!==reference.bytes||entry.sha256!==reference.sha256)throw new Error("The retained file reference no longer matches its original bytes. Select the original file again.");
  if(!entry.verified){
    const binary=atob(entry.base64),bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
    if(bytes.length!==reference.bytes||await digestWorkBytes(bytes)!==reference.sha256)throw new Error("The retained file bytes differ from the reviewed original.");
    entry.verified=true;
  }
  // The shared content entry deduplicates bytes. Each draft retains its own reviewed file metadata.
  return {...entry,name:reference.name,mediaType:reference.mediaType};
}
function workScope(actionName,fields,item){
  if(item.action==="return.apply"||actionName==="return.apply")return item.action===actionName&&item.args.base64===fields.base64;
  if(fields.itemId)return item.action.startsWith("work.")&&item.args.itemId===fields.itemId;
  if(actionName==="work.capture")return item.action===actionName&&item.args.materialSha256===fields.materialSha256&&
    (fields.diagnosticId?item.args.diagnosticId===fields.diagnosticId:item.args.recordKey===fields.recordKey);
  return false;
}
async function mutateWork(actionName,fields){
  await flushDraft();
  const rows=(await dbRead("operations")).filter(x=>x.workspaceId===S.identity.workspaceId&&workScope(actionName,fields,x));
  const pending=rows.find(x=>x.state==="prepared"||x.state==="outcome unknown");
  if(pending){await renderWorkRecovery();throw new Error("The original "+pending.action+" request "+pending.operationId+" needs its receipt read before a new action. Use Continue an original request below or Operations.");}
  if(actionName==="work.capture"){
    const known=rows.find(x=>x.state==="completed"&&canonicalJson(Object.fromEntries(Object.entries(x.args).filter(([key])=>!["operationId","expectedRevision"].includes(key))))===canonicalJson(fields));
    if(known?.receipt){notice("This exact capture already completed. Opening its original work item.");return known.receipt.result?.itemId?known.receipt.result:known.receipt;}
  }
  try{return await mutate(actionName,fields);}
  catch(error){try{await renderWorkRecovery();}catch{}throw error;}
}
async function renderWorkRecovery(){
  if(!S.identity)return;
  const rows=(await dbRead("operations")).filter(x=>x.workspaceId===S.identity.workspaceId&&(x.action.startsWith("work.")||x.action==="return.apply")&&(x.state==="prepared"||x.state==="outcome unknown"));
  $("work-recovery").hidden=!rows.length;
  replace("work-recovery-items",...rows.map(row=>node("div",{class:"list-item"},node("strong",{},row.action+" · "+row.state),sourceKey(row.operationId),
    node("p",{},"The complete original arguments and expected revision remain retained."),
    node("div",{class:"button-row"},action("Read original receipt",async()=>{await recoverOperation(row,false);await loadWorks(0,true);}),
      action("Continue original request",async()=>{await recoverOperation(row,true);await loadWorks(0,true);}),
      action("Open request details",()=>{showLocalOperation(row);return openSection("operations",{load:false});}))
  )));
}
function selectedWorkMaterial(editionId){
  if(!editionId)return S.status.materialSha256;
  const edition=S.editions.find(x=>x.id===editionId);if(!edition)throw new Error("The retained material edition is unavailable. Read the original source selection again.");
  return edition.materialSha256;
}
async function startWorkCapture({diagnostic=null,recordKey=null,sourceId=null,editionId="",title=""}={}){
  captureVisibleWorkDrafts();await flushDraft();
  if(S.workCapture?.fields?.title&&!await confirmAction("Choose a new work source?","The existing capture draft has not been submitted. Replace its source and form with this selected record or finding?","Use this source"))return;
  const context={editionId:editionId||"",materialSha256:selectedWorkMaterial(editionId),sourceId:sourceId||diagnostic?.sourceId||null};
  if(diagnostic){context.diagnostic=structuredClone(diagnostic);context.diagnosticSha256=await canonicalWorkHash(diagnostic);}
  S.workCapture={context,recordKey:recordKey||diagnostic?.recordKey||"",author:"",fields:{title:title||diagnosticMessage(diagnostic||{})||"",description:"",assignee:"",dueDate:"",priority:diagnostic?.severity==="error"?"high":"routine"},open:true};
  if(!diagnostic&&!title)S.workCapture.fields.title="";
  renderWorkCapture();rememberDraft();await flushDraft();await openSection("work");$("work-capture-title").focus();
}
function renderWorkCapture(){
  const draft=S.workCapture;$("work-capture-card").hidden=!draft?.open;
  if(!draft)return;
  setWorkFields("work-capture-",draft.fields);$("work-capture-author").value=draft.author||"";
  $("work-capture-record").value=draft.recordKey||"";$("work-capture-edition").value=draft.context?.editionId||"";
  $("work-capture-help").textContent=draft.context?.diagnostic?"Capturing the exact selected finding and its material. The source snapshot stays fixed while you describe the work.":"Choose an exact source record and describe the work. The displayed material identifies the source snapshot.";
  replace("work-capture-context",detail("Retained capture context",draft.context||{}));
}
async function captureWork(){
  captureVisibleWorkDrafts();const d=S.workCapture;if(!d)throw new Error("Choose a source record or diagnostic first.");
  const context=d.context;if(!context?.materialSha256)throw new Error("Choose a complete material snapshot.");
  const fields={...d.fields,title:d.fields.title.trim(),author:d.author.trim(),materialSha256:context.materialSha256};
  if(!fields.title||!fields.author)throw new Error("Enter a work title and the person recording it.");
  if(context.editionId)fields.editionId=context.editionId;
  if(context.diagnostic){fields.diagnosticId=context.diagnostic.id;fields.diagnosticSha256=context.diagnosticSha256;}
  else{fields.recordKey=d.recordKey.trim();if(!fields.recordKey)throw new Error("Enter the exact source record key.");}
  const result=await mutateWork("work.capture",fields);
  S.workCapture=null;$("work-capture-card").hidden=true;rememberDraft();await flushDraft();
  await synchronize();await loadWorks(0,true);await openWork(result.itemId);
  notice("Work captured with the complete original source context.");
}
async function loadWorks(offset=0,reset=false){
  const page=await readPage("work","works.list",offset,reset);S.works=page.items;
  $("work-count").textContent=number(page.total);
  replace("work-body",...(page.items.length?page.items.map(item=>node("tr",{dataset:{active:String(item.id===S.selectedWorkId)}},
    node("td",{},linkButton(item.current.fields.title,()=>openWork(item.id)),sourceKey(item.id),node("p",{class:"help"},item.current.fields.description)),
    node("td",{},badge(item.current.status,["submitted","exception"].includes(item.current.status)),node("p",{class:"help"},"Finding: "+text(item.finding?.state))),
    node("td",{},item.current.fields.assignee||"Unassigned",node("p",{class:"help"},item.current.fields.dueDate?"Due "+item.current.fields.dueDate:"No due date"),badge(item.current.fields.priority)),
    node("td",{},sourceName(item.origin.sourceId)||"Workspace",sourceKey(item.origin.recordKey||item.origin.sourceId),item.origin.diagnostic?node("p",{class:"help"},diagnosticMessage(item.origin.diagnostic)):null),
    node("td",{},number(item.evidenceCount??item.current.evidenceIds?.length??0))
  )):[emptyRow(5,"No work items match this filter.")]));
  await renderWorkRecovery();
  if(S.selectedWorkId)await openWork(S.selectedWorkId,{scroll:false});
}
async function openWork(itemId,{scroll=true}={}){
  if(!itemId)throw new Error("The completed operation did not identify a work item.");
  captureVisibleWorkDrafts();await flushDraft();
  const item=await request("work.read",{expectedRevision:revision(),itemId});
  if(item.id!==itemId||item.workspaceId!==S.identity.workspaceId||item.revision!==revision())throw new Error("The work item belongs to another workspace or revision.");
  S.activeWork=item;S.selectedWorkId=itemId;activeWorkDraft();renderWorkDetail();
  rememberDraft();if(scroll)$("work-detail-card").scrollIntoView({block:"start",behavior:"instant"});
}
function fieldComparison(label,base,local,incoming,headings=["Original editing base","Your draft","Current saved value"]){
  return node("section",{class:"work-return-field"},node("h5",{},label),node("div",{class:"work-diff"},
    [base,local,incoming].map((v,i)=>node("div",{},node("h5",{},headings[i]),node("div",{class:"work-value"},valueText(v))))));
}
function renderWorkDetail(){
  const item=S.activeWork;$("work-detail-card").hidden=!item;if(!item)return;
  const d=activeWorkDraft();$("work-detail-heading").textContent=item.current.fields.title;$("work-detail-label").textContent="Work item · "+short(item.id);
  replace("work-detail-summary",node("div",{class:"work-status-line"},badge(item.current.status,true),badge(item.current.fields.priority),node("span",{},"Finding: "+text(item.finding?.state))),
    dl([["Assigned to",item.current.fields.assignee||"Unassigned"],["Due",item.current.fields.dueDate||"No due date"],["Retained evidence",item.evidence.length]]));
  replace("work-origin",detail("Original captured source and finding",item.origin),detail("Current material finding",item.finding),detail("Retained material context",item.context));
  setWorkFields("work-edit-",d.fields);$("work-edit-author").value=d.author||"";$("work-edit-note").value=d.note||"";
  $("work-evidence-kind").value=d.evidenceKind||"note";$("work-evidence-author").value=d.evidenceAuthor||"";
  $("work-evidence-note").value=d.evidenceNote||"";$("work-evidence-proposal").value=d.evidenceProposalId||"";
  $("work-review-author").value=d.reviewAuthor||"";$("work-review-note").value=d.reviewNote||"";$("work-review-edition").value=d.reviewEditionId||"";
  $("work-evidence-file-status").textContent=d.evidenceFile?d.evidenceFile.name+" · "+size(d.evidenceFile.bytes)+" · original bytes retained":"No evidence file retained for this draft.";
  const stale=d.expectedHeadSha256!==item.headSha256;$("work-stale").hidden=!stale;
  replace("work-base-comparison",...(stale?WORK_FIELDS.map(key=>fieldComparison(WORK_LABELS[key],d.base?.fields?.[key],d.fields[key],item.current.fields[key])):[]),
    ...(stale?[fieldComparison("Status, submission and review",{status:d.base.status,submission:d.base.submission,review:d.base.review},"Your retained decision notes remain in the forms below.",{status:item.current.status,submission:item.current.submission,review:item.current.review})]:[]));
  renderWorkEvidence();replace("work-submission",...(item.current.submission?[detail("Exact retained submission",item.current.submission)]:[node("p",{class:"help"},"This work item has no retained submission yet.")]),...(item.current.review?[detail("Current review decision",item.current.review)]:[]));
  replace("work-history",...(item.history||[]).map((event,index)=>detail("Recorded work edition "+(index+1),event)),...(d.rebases?.length?[detail("This tab's reviewed editing bases",d.rebases)]:[]));
  workControls();
}
async function adoptCurrentWork(){
  captureVisibleWorkDrafts();const item=S.activeWork,d=activeWorkDraft();if(!item||!d)throw new Error("Read the work item first.");
  if(d.expectedHeadSha256===item.headSha256)return;
  d.rebases||=[];d.rebases.push({at:new Date().toISOString(),fromHeadSha256:d.expectedHeadSha256,toHeadSha256:item.headSha256,original:structuredClone(d.base),draft:structuredClone(d.fields),current:structuredClone(item.current)});
  d.expectedHeadSha256=item.headSha256;d.base=structuredClone(item.current);
  renderWorkDetail();rememberDraft();await flushDraft();notice("Your authored values and notes remain; the reviewed current version is now this draft's editing base.");
}
function workMutationBase(){
  captureVisibleWorkDrafts();const d=activeWorkDraft();if(!d||!S.activeWork)throw new Error("Open a work item first.");
  if(d.expectedHeadSha256!==S.activeWork.headSha256)throw new Error("Review the original, draft and current values before adopting the current editing base.");
  return {itemId:S.activeWork.id,expectedHeadSha256:d.expectedHeadSha256};
}
async function updateWork(){
  const base=workMutationBase(),d=activeWorkDraft();
  const fields={...d.fields,title:d.fields.title.trim()};
  if(!fields.title||!d.author.trim()||!d.note.trim())throw new Error("Enter the work title, person making the change and a change note.");
  const receipt=await mutateWork("work.update",{...base,fields,author:d.author.trim(),note:d.note});
  await finishWorkMutation(base.itemId,"fields",receipt);notice("Assignment and scope saved with their original history.");
}


function renderWorkEvidence(){
  const items=S.activeWork?.evidence||[];
  replace("work-evidence-list",...(items.length?items.map(evidence=>node("section",{class:"work-evidence-item"},
    node("h5",{},evidence.name),node("div",{class:"work-status-line"},badge(evidence.kind),node("span",{},size(evidence.bytes))),
    node("div",{class:"button-row"},action("Download original evidence",async()=>{
      const bytes=await S.client.completeBytes("evidence.read",{evidenceId:evidence.id});
      if(bytes.length!==evidence.bytes||await digestWorkBytes(bytes)!==evidence.sha256)throw new Error("The complete evidence does not match its retained summary.");
      saveFile(bytes,evidence.name,evidence.mediaType);notice("Downloaded the complete retained evidence.");
    }),evidence.proposal?action("Copy native changes to tag draft",()=>copyWorkProposal(evidence)):null),
    evidence.proposal?detail("Frozen native proposal and review",evidence.proposal):null,detail("Retained evidence details",evidence)
  )):[node("p",{class:"empty"},"Retain at least one evidence item before submitting this work.")]));
}
async function copyWorkProposal(evidence){
  const proposal=evidence.proposal;if(!proposal||!Array.isArray(proposal.changes))throw new Error("This evidence has no complete native proposal changes.");
  const edits=checkEdits(proposal.changes.map(change=>{
    if(!change.after||typeof change.after.present!=="boolean")throw new Error("A retained native change has no complete after-value.");
    return change.after.present?{recordKey:change.recordKey,tag:change.tag,action:"set",value:change.after.value}:{recordKey:change.recordKey,tag:change.tag,action:"remove"};
  }));
  if(!edits.length)throw new Error("The retained proposal contains no tag edits to copy.");
  let current;try{current=JSON.parse($("proposal-json").value);}catch{current=null;}
  if((!Array.isArray(current)||current.length||$("proposal-title").value||$("proposal-note").value)&&
    !await confirmAction("Replace the current tag draft?","Copy the frozen evidence changes into the original tag proposal editor. The current unsaved tag draft will be replaced; existing saved proposals remain retained.","Copy these changes"))return;
  S.edits=edits;S.preview=null;$("proposal-title").value=proposal.title||"Changes from retained work evidence";
  $("proposal-note").value="Copied from retained evidence "+evidence.id+". "+(proposal.note||"");$("proposal-json").value=json(edits);
  renderEdits();rememberDraft();await flushDraft();await openSection("proposals");
  notice("The frozen native changes are in the ordinary tag draft. Preview the current material before preparing and accepting a proposal.");
}
async function previewWorkEvidenceProposal(){
  const proposalId=$("work-evidence-proposal").value.trim();if(!proposalId)throw new Error("Enter an existing native proposal ID.");
  const result=await request("proposal.read",{expectedRevision:revision(),proposalId});
  replace("work-evidence-proposal-preview",node("h5",{},result.proposal.title),badge(result.proposal.state),
    renderChanges(result.proposal.changes),detail("Complete current native proposal",result.proposal));
}
async function selectWorkEvidenceFile(){
  const d=activeWorkDraft();if(!d)throw new Error("Open a work item first.");
  const file=$("work-evidence-file").files?.[0];if(!file)return;
  const reference=await retainWorkUpload(file,"evidence");
  d.evidenceFile=reference;$("work-evidence-file").value="";
  $("work-evidence-file-status").textContent=reference.name+" · "+size(reference.bytes)+" · original bytes retained";
  rememberDraft();await flushDraft();
}
async function finishWorkMutation(itemId,kind,receipt){
  if(receipt?.itemId!==itemId||receipt.workspaceId!==S.identity.workspaceId||!/^[0-9a-f]{64}$/.test(receipt.headSha256||""))throw new Error("The completed mutation did not return its exact work item and head.");
  const d=S.workDrafts[itemId];S.activeWork=null;
  await synchronize();const item=await request("work.read",{expectedRevision:revision(),itemId});
  if(item.id!==itemId||item.workspaceId!==S.identity.workspaceId||item.revision!==revision())throw new Error("The completed work item returned a different identity.");
  if(d){
    // A later peer edition must remain stale against this tab\'s retained base and authored fields.
    // Only the exact head returned by our completed mutation can advance that editing base.
    if(item.headSha256===receipt.headSha256){
      d.expectedHeadSha256=item.headSha256;d.base=structuredClone(item.current);
      if(kind==="fields")d.fields=structuredClone(item.current.fields);
    }
    if(kind==="fields")d.note="";
    if(kind==="evidence"){d.evidenceNote="";d.evidenceProposalId="";d.evidenceFile=null;$("work-evidence-file").value="";}
    if(kind==="review")d.reviewNote="";
  }
  S.activeWork=item;S.selectedWorkId=item.id;renderWorkDetail();rememberDraft();await flushDraft();await loadWorks(0,true);
}
async function addWorkEvidence(){
  const base=workMutationBase(),d=activeWorkDraft();
  if(!d.evidenceAuthor.trim()||!d.evidenceNote.trim())throw new Error("Enter the evidence author and note.");
  const fields={...base,author:d.evidenceAuthor.trim(),note:d.evidenceNote,kind:d.evidenceKind};
  if(fields.kind==="file"){
    if($("work-evidence-file").files?.length)await selectWorkEvidenceFile();
    const file=await retainedWorkUpload(d.evidenceFile,"evidence");
    Object.assign(fields,{name:file.name,mediaType:file.mediaType,base64:file.base64});
  }else if(fields.kind==="proposal"){
    fields.proposalId=d.evidenceProposalId.trim();if(!fields.proposalId)throw new Error("Enter the exact existing proposal ID.");
  }else if(fields.kind!=="note")throw new Error("Choose file, proposal or note evidence.");
  const receipt=await mutateWork("work.evidence",fields);await finishWorkMutation(base.itemId,"evidence",receipt);notice("The complete evidence is retained with this work item.");
}
async function decideWork(decision){
  if(!["submit","verify","reopen","accept-exception"].includes(decision))throw new Error("Choose a submission or review decision.");
  const base=workMutationBase(),d=activeWorkDraft(),item=S.activeWork;
  if(!d.reviewAuthor.trim()||!d.reviewNote.trim())throw new Error("Enter the person making this submission or decision and its note.");
  const fields={...base,author:d.reviewAuthor.trim(),note:d.reviewNote};
  if(d.reviewEditionId)fields.editionId=d.reviewEditionId;
  let receipt;
  if(decision==="submit"){
    if(!item.evidence.length)throw new Error("Retain original evidence before submitting this work.");
    receipt=await mutateWork("work.submit",fields);
  }else{
    fields.decision=decision;
    if(decision==="verify"){
      if(item.current.status!=="submitted"||!item.current.submission?.sha256)throw new Error("Read the exact submitted work before verifying it.");
      fields.submissionSha256=item.current.submission.sha256;
    }
    receipt=await mutateWork("work.review",fields);
  }
  await finishWorkMutation(base.itemId,"review",receipt);
  notice(decision==="submit"?"The exact work and material snapshot is submitted for review.":decision==="verify"?"Verification of the submitted work is recorded.":decision==="reopen"?"The work item is reopened with its review history.":"The documented exception is recorded as its own decision.");
}
async function selectReturnFile(){
  const file=$("work-return-file").files?.[0];if(!file)return S.returnDraft.file;
  const reference=await retainWorkUpload(file,"return");
  if(S.returnDraft.file?.sha256!==reference.sha256){
    S.returnDraft.preview=null;S.returnDraft.decisions={};S.returnDraft.applied=null;
  }
  S.returnDraft.file=reference;$("work-return-file").value="";
  renderReturnPreview();rememberDraft();await flushDraft();return reference;
}
async function previewReturnedWork(){
  if($("work-return-file").files?.length)await selectReturnFile();
  captureVisibleWorkDrafts();const file=await retainedWorkUpload(S.returnDraft.file,"return");await flushDraft();
  const expectedRevision=revision(),result=await request("return.preview",{expectedRevision,base64:file.base64});
  if(result.packageSha256!==file.sha256||!Array.isArray(result.items))throw new Error("The return preview does not match the complete selected file.");
  if(result.workspaceId&&result.workspaceId!==S.identity.workspaceId)throw new Error("The return preview belongs to another workspace.");
  const decisions={};
  for(const item of result.items){
    if(!item||typeof item.itemId!=="string"||!Array.isArray(item.conflicts)||!item.fields)throw new Error("The returned work comparison is incomplete.");
    const prior=S.returnDraft.decisions[item.itemId];
    const retained=prior&&prior.expectedHeadSha256===(item.localHeadSha256??null)&&prior.incomingHeadSha256===item.incomingHeadSha256;
    decisions[item.itemId]={itemId:item.itemId,decision:retained&&prior.decision==="accept"?"accept":"keep",expectedHeadSha256:item.localHeadSha256??null,
      incomingHeadSha256:item.incomingHeadSha256,choices:retained?Object.fromEntries(Object.entries(prior.choices||{}).filter(([key,value])=>item.conflicts.includes(key)&&["local","incoming"].includes(value))):{}};
  }
  S.returnDraft.preview={...result,expectedRevision};S.returnDraft.decisions=decisions;
  renderReturnPreview();rememberDraft();await flushDraft();
  notice("The complete return is compared with the retained common revision and current work. Review each item and actual conflict.");
}
function renderReturnPreview(){
  const draft=S.returnDraft||{},file=draft.file,preview=draft.preview;
  $("work-return-file-status").textContent=file?file.name+" · "+size(file.bytes)+" · original file retained in this tab":"No return file retained.";
  $("work-return-author").value=draft.author||"";$("work-return-note").value=draft.note||"";
  $("work-return-apply-form").hidden=!preview;
  if(!preview){
    replace("work-return-summary",...(draft.applied?[node("p",{class:"work-accepted-note"},"The reviewed return was applied. Its complete original receipt is retained below."),detail("Completed original return operation",draft.applied)]:[]));
    replace("work-return-items");$("work-return-stale").hidden=true;return;
  }
  const accepted=preview.items.filter(x=>draft.decisions?.[x.itemId]?.decision==="accept").length;
  replace("work-return-summary",dl([["Work items",preview.items.length],["Selected to accept",accepted],["Selected to keep",preview.items.length-accepted],["Common retained revision",preview.commonRevision],["Returned revision",preview.incomingRevision],["Current review revision",preview.expectedRevision]]),
    detail("Returned package identity",{name:file?.name,bytes:file?.bytes,packageSha256:preview.packageSha256,payloadSha256:preview.payloadSha256,incomingRevision:preview.incomingRevision,commonRevision:preview.commonRevision}));
  replace("work-return-items",...preview.items.map(item=>{
    const choice=draft.decisions[item.itemId];
    const section=node("section",{class:"work-return-item",dataset:{itemId:item.itemId,decision:choice.decision}});
    const select=node("select",{id:"return-item-"+item.itemId,dataset:{connected:"true",returnDecision:item.itemId},disabled:S.busy,onchange:event=>{
      choice.decision=event.target.value;captureVisibleWorkDrafts();renderReturnPreview();rememberDraft();workControls();
    }},node("option",{value:"keep"},"Keep current work"),node("option",{value:"accept"},"Accept reviewed changes"));select.value=choice.decision;
    section.append(node("div",{class:"section-heading"},node("div",{},node("h4",{},item.title),sourceKey(item.itemId),badge(item.kind,item.kind==="diverged")),
      node("label",{class:"inline-label return-decision",htmlFor:select.id},"Decision",select)));
    const differences=node("details",{open:item.kind==="diverged"||choice.decision==="accept"},node("summary",{},item.conflicts.length?item.conflicts.length+" field conflicts · complete original, current and returned values":"Compare complete original, current and returned values"));
    for(const key of RETURN_FIELDS){
      const field=item.fields[key];if(!field)continue;
      const conflict=item.conflicts.includes(key);
      const block=node("fieldset",{class:"work-return-field"+(conflict?" work-conflict":"")},node("legend",{},WORK_LABELS[key],conflict?" · explicit choice required":""),
        node("div",{class:"work-diff"},[[field.baseAmbiguous?"Values in the shared history":"Original common value",field.baseAmbiguous?field.baseAlternatives:field.base],["Current local value",field.local],["Returned value",field.incoming]].map(([heading,value])=>node("div",{},node("h5",{},heading),node("div",{class:"work-value"},valueText(value))))));
      if(field.baseAmbiguous)block.append(node("p",{class:"help"},conflict?"The shared history contains different earlier values. Choose the complete current or returned value explicitly.":"The shared history contains different earlier values; both copies now agree on the displayed value."));
      if(conflict){
        const control=node("select",{id:"return-choice-"+item.itemId+"-"+key,dataset:{connected:"true",returnChoice:item.itemId,field:key},disabled:S.busy,onchange:event=>{
          if(event.target.value)choice.choices[key]=event.target.value;else delete choice.choices[key];
          rememberDraft();
        }},node("option",{value:""},"Choose a value for accepted work"),node("option",{value:"local"},"Use current local value"),node("option",{value:"incoming"},"Use returned value"));control.value=choice.choices[key]||"";
        block.append(node("label",{class:"work-choice",htmlFor:control.id},"Accepted "+WORK_LABELS[key].toLowerCase()+" value",control));
      }else block.append(node("p",{class:"help"},"If accepted, the retained comparison selects: "+valueText(field.suggested)));
      differences.append(block);
    }
    differences.append(detail("Exact local, returned and common work heads",{localHeadSha256:item.localHeadSha256,incomingHeadSha256:item.incomingHeadSha256,commonHeadSha256:item.commonHeadSha256,commonHeadSha256s:item.commonHeadSha256s}));
    section.append(differences);return section;
  }));
  workControls();
}
async function applyReturnedWork(){
  captureVisibleWorkDrafts();const draft=S.returnDraft,preview=draft.preview;
  if(!preview||preview.expectedRevision!==revision())throw new Error("Read the retained return against the current workspace before applying decisions.");
  const file=await retainedWorkUpload(draft.file,"return");
  if(file.sha256!==preview.packageSha256)throw new Error("The selected original return differs from this preview.");
  if(!draft.author.trim()||!draft.note.trim())throw new Error("Enter the reviewer and the return decision note.");
  const decisions=preview.items.map(item=>{
    const selected=draft.decisions[item.itemId];
    if(!selected||!["keep","accept"].includes(selected.decision)||selected.expectedHeadSha256!==(item.localHeadSha256??null)||selected.incomingHeadSha256!==item.incomingHeadSha256)throw new Error("Review every item against its current and returned work heads.");
    if(selected.decision==="accept")for(const field of item.conflicts)if(!["local","incoming"].includes(selected.choices[field]))throw new Error("Choose the "+WORK_LABELS[field]+" value for "+item.title+".");
    return {itemId:item.itemId,decision:selected.decision,expectedHeadSha256:selected.expectedHeadSha256,choices:structuredClone(selected.choices)};
  });
  const result=await mutateWork("return.apply",{author:draft.author.trim(),note:draft.note,base64:file.base64,decisions});
  draft.applied={...result,packageSha256:preview.packageSha256};draft.preview=null;draft.decisions={};
  renderReturnPreview();rememberDraft();await flushDraft();await synchronize();await loadWorks(0,true);await loadWorkReturns();
  notice("The reviewed return is retained with every decision and its original event history. Current source selection and native tag proposal acceptance remain explicit.");
}
async function loadWorkReturns(){
  const items=await collect("returns.list",{expectedRevision:revision()});
  replace("work-returns-list",...(items.length?items.map(item=>node("div",{class:"list-item"},node("strong",{},"Returned revision "+item.incomingRevision),
    node("p",{},when(item.at)+(item.author?" · "+item.author:"")),item.note?node("p",{},item.note):null,
    action("Read retained decisions",async()=>{
      const value=await request("return.read",{expectedRevision:revision(),returnId:item.id});
      if(value.id!==item.id||value.workspaceId!==S.identity.workspaceId||value.revision!==revision())throw new Error("The retained return decision has a different identity.");
      replace("work-return-read",node("h4",{},"Retained return decisions"),dl([["Reviewed by",value.author],["Recorded",when(value.at)],["Note",value.note],["Returned revision",value.incomingRevision],["Common revision",value.commonRevision]]),
        detail("Complete retained decisions",value.decisions),detail("Applied result and original return provenance",value));
    })
  )):[node("p",{class:"empty"},"No returned-work reviews are recorded in this workspace.")]));
}
async function clearWorkReturn(){
  if(!S.returnDraft.file&&!S.returnDraft.preview)return;
  if(!await confirmAction("Clear this return draft?","This clears the file selection and unapplied choices in this tab. Original uploaded bytes, completed operations and saved return history remain retained.","Clear return draft"))return;
  if(S.returnDraft.file)S.workUploads.delete(S.returnDraft.file.key);
  S.returnDraft={file:null,preview:null,decisions:{},author:"",note:""};$("work-return-file").value="";
  renderReturnPreview();rememberDraft();await flushDraft();
}
function bindWorkUi(){
  bindButton("work-new",()=>startWorkCapture());
  bindButton("work-reload",async()=>{await flushDraft();await synchronize();await loadWorks(0,true);await loadWorkReturns();renderReturnPreview();});
  bindForm("work-filter-form",()=>loadWorks(0,true));bindForm("work-capture-form",captureWork);
  bindButton("work-capture-close",()=>{captureVisibleWorkDrafts();if(S.workCapture)S.workCapture.open=false;renderWorkCapture();rememberDraft();});
  bindButton("work-detail-close",()=>{captureVisibleWorkDrafts();S.activeWork=null;S.selectedWorkId=null;$("work-detail-card").hidden=true;rememberDraft();});
  bindButton("work-adopt-current",adoptCurrentWork);bindForm("work-update-form",updateWork);
  bindForm("work-evidence-form",addWorkEvidence);bindButton("work-evidence-proposal-read",previewWorkEvidenceProposal);
  bindForm("work-review-form",(_event,submitter)=>decideWork(submitter?.value));
  bindForm("work-return-preview-form",previewReturnedWork);bindForm("work-return-apply-form",applyReturnedWork);
  bindButton("work-return-clear",clearWorkReturn);bindButton("work-returns-reload",loadWorkReturns);
  bindButton("work-evidence-file-clear",()=>{const d=activeWorkDraft();if(d)d.evidenceFile=null;$("work-evidence-file").value="";$("work-evidence-file-status").textContent="No evidence file retained.";rememberDraft();});
  $("work-evidence-file").addEventListener("change",()=>run(selectWorkEvidenceFile));
  $("work-return-file").addEventListener("change",()=>run(selectReturnFile));
  $("work-evidence-kind").addEventListener("change",()=>{rememberDraft();workControls();});
  $("work-capture-edition").addEventListener("change",()=>run(async()=>{
    if(!S.workCapture||S.workCapture.context.diagnostic)return;
    const editionId=$("work-capture-edition").value;
    S.workCapture.context={...S.workCapture.context,editionId,materialSha256:selectedWorkMaterial(editionId)};
    captureVisibleWorkDrafts();renderWorkCapture();rememberDraft();await flushDraft();
  }));
  for(const id of ["work-capture-title","work-capture-description","work-capture-assignee","work-capture-due","work-capture-priority","work-capture-author","work-capture-record",
    "work-edit-title","work-edit-description","work-edit-assignee","work-edit-due","work-edit-priority","work-edit-author","work-edit-note",
    "work-evidence-author","work-evidence-note","work-evidence-proposal","work-review-author","work-review-note","work-review-edition","work-return-author","work-return-note"]){
    $(id).addEventListener("input",rememberDraft);$(id).addEventListener("change",rememberDraft);
  }
}

bindWorkUi();
renderIdentity();reportRules();controls();showConnect();

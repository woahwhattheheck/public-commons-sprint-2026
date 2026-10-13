// MIT. Operator desk mounted by the original application with its authenticated client.
import { readReturnDesk, saveReturnDesk } from "./review-return-drafts.mjs";
export async function mountReviewReturnDesk(root, { request, identity, reconnect, onSaved = () => {} }) {
  let origin = structuredClone(identity()), overview, local, version = 0, dirty = false, busy = false, storageFault = false, initialized = false;
  let requestPreview = null, responsePreview = null, closing = false, closed = false, closePromise = null;
  const idleWaiters=[];
  const node = (tag, value, parent) => { const el = document.createElement(tag); if (value !== undefined) el.textContent = value; if (parent) parent.append(el); return el; };
  root.classList.add("review-return-desk"); root.replaceChildren();
  const header=node("header",undefined,root);node("h2","Customer review returns",header);
  node("p","Prepare an editable response document from a saved review, receive its complete returned JSON and explicitly retain the response in this workspace.",header);
  const status=node("p","Opening original workspace…",root);status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const say=(message,error=false)=>{status.textContent=message;status.classList.toggle("error",error);};
  const tools=node("div",undefined,root);tools.className="return-toolbar";
  const content=node("div",undefined,root);
  const initial={request:{reviewId:"",recipient:{name:"",organisation:"",reference:""},requestedBy:"",instructions:""},
    receive:{requestId:"",originalText:"",receivedBy:"",operatorNote:""},pending:null,history:[],selectedRequest:""};
  function valid(saved) {
    const value=saved?.value;
    if(saved.schema!=="commons.openlineage.return-desk.v1"||saved.workspaceId!==origin.workspaceId||!value||
       !value.request||!value.receive||!Array.isArray(value.history))throw Error("Choose a complete working copy from this original workspace.");
    if(value.pending&&(value.pending.workspaceId!==origin.workspaceId||
      !["review-return.request.save","review-return.response.save"].includes(value.pending.action)||
      !value.pending.args||typeof value.pending.args.operationId!=="string"||
      !Number.isSafeInteger(value.pending.args.expectedRevision)))throw Error("The original pending request is incomplete.");
    return structuredClone(value);
  }
  async function persist() {
    try {
      const saved=await saveReturnDesk(origin.workspaceId,version,local);version=saved.version;dirty=false;storageFault=false;return saved;
    } catch(error) { storageFault=true;throw error; }
  }
  function download(name,text,type="application/json") {
    const url=URL.createObjectURL(new Blob([text],{type})),a=node("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
  }
  const run=fn=>async()=>{if(!initialized||busy||closing||closed)return;busy=true;renderButtons();try{await fn();}catch(error){say(error.message,true);}finally{busy=false;renderButtons();for(const resolve of idleWaiters.splice(0))resolve();}};
  const buttons=[];
  function button(parent,label,fn,{write=false,pending=false}={}) {
    const el=node("button",label,parent);el.type="button";el.disabled=!initialized;el.addEventListener("click",run(fn));buttons.push({el,write,pending});return el;
  }
  function renderButtons(){
    for(const{el,write,pending}of buttons)el.disabled=!initialized||busy||closing||closed||(write&&(!!local?.pending||storageFault))||(pending&&(!local?.pending||storageFault));
    for(const el of root.querySelectorAll("input,textarea,select"))el.disabled=!initialized||busy||closing||closed;
  }
  function field(parent,label,value,change,multiline=false) {
    const wrap=node("label",undefined,parent);node("span",label,wrap);const el=node(multiline?"textarea":"input",undefined,wrap);el.value=value??"";
    if(multiline)el.rows=4;el.addEventListener("input",()=>{change(el.value);dirty=true;requestPreview=responsePreview=null;});return el;
  }
  function select(parent,label,value,rows,change) {
    const wrap=node("label",undefined,parent);node("span",label,wrap);const el=node("select",undefined,wrap);
    const first=node("option","Choose…",el);first.value="";
    rows.forEach(([id,title])=>{const option=node("option",title,el);option.value=id;});el.value=value;
    el.addEventListener("change",()=>{change(el.value);dirty=true;requestPreview=responsePreview=null;});return el;
  }
  async function call(action,args={}) {
    const current=identity();
    if(current.workspaceId!==origin.workspaceId||current.instanceId!==origin.instanceId)throw Error("The workspace connection changed. Reconnect explicitly before using retained work.");
    const result=await request(action,structuredClone(args));
    if(result.workspaceId!==origin.workspaceId)throw Error("The response belongs to another workspace.");
    return result;
  }
  async function refresh(){overview=await call("review-return.overview");}
  async function pendingSave(action,args) {
    if(storageFault)throw Error("Reopen the retained working copy after resolving its save conflict before writing.");
    if(local.pending)throw Error("Resolve the original pending request first.");
    local.pending={workspaceId:origin.workspaceId,instanceId:origin.instanceId,action,
      args:{...structuredClone(args),operationId:crypto.randomUUID()},preparedAt:new Date().toISOString()};
    await persist();await replay();
  }
  async function replay() {
    if(storageFault)throw Error("Reopen the retained working copy before replaying.");
    if(!local.pending)throw Error("No original request is pending.");
    if(local.pending.instanceId!==origin.instanceId)throw Error("Reconnect this saved request explicitly to the same workspace before replay.");
    const pending=structuredClone(local.pending);
    let result;
    try{result=await call(pending.action,pending.args);}
    catch(error){
      if([400,413,422].includes(error.status)){
        local.pending.definitiveRejection={status:error.status,message:error.message,receivedAt:new Date().toISOString()};
        await persist();
      }
      throw error;
    }
    local.history.push({pending,result,completedAt:new Date().toISOString()});local.pending=null;
    if(result.request)local.selectedRequest=result.request.id;
    await persist();await refresh();paint();await onSaved(result);say("Saved in the original workspace. Complete request and response are retained in this desk.");
  }
  async function inspectPending() {
    const p=local.pending;if(!p)throw Error("No original request is pending.");
    const read=await call("review-return.operation.get",{operationId:p.args.operationId,expectedRevision:p.args.expectedRevision});
    if(read.operation){say("The original operation is recorded. Replay its exact saved request to recover the native result.");return;}
    if(!read.absentAtLaterRevision&&!p.definitiveRejection){say("The original operation is not recorded at this revision. Keep its exact request and replay it.");return;}
    if(p.definitiveRejection&&!read.absentAtLaterRevision&&!confirm("The server definitively rejected this exact request and its operation is absent. Retain its full request/error in history and reopen the form?"))return;
    local.history.push({pending:structuredClone(p),absentAtRevision:read.revision,retiredAt:new Date().toISOString()});
    local.pending=null;requestPreview=responsePreview=null;await persist();await refresh();paint();
    say("The original uncommitted request and any definitive rejection are retained in history; review a new preview before another save.");
  }
  button(tools,"Save working copy",async()=>{await persist();say("Complete working copy saved in this browser.");});
  button(tools,"Download working copy",async()=>{download("review-return-desk-"+origin.workspaceId+".json",JSON.stringify({
    schema:"commons.openlineage.return-desk.v1",workspaceId:origin.workspaceId,version,updatedAt:new Date().toISOString(),value:local},null,2)+"\n");});
  button(tools,"Reopen saved working copy",async()=>{
    if(dirty&&!confirm("Replace the current entries with the retained complete working copy?"))return;
    const saved=await readReturnDesk(origin.workspaceId);if(!saved)throw Error("No retained working copy exists.");
    local=valid(saved);version=saved.version;dirty=false;storageFault=false;requestPreview=responsePreview=null;paint();say("Original saved working copy opened.");
  });
  button(tools,"Replay original save",replay,{pending:true});
  button(tools,"Inspect original save",inspectPending,{pending:true});
  button(tools,"Reconnect same workspace",async()=>{
    if(typeof reconnect!=="function")throw Error("Reconnect through the original application's connection controls, then reopen this desk.");
    await reconnect();const next=identity();
    if(next.workspaceId!==origin.workspaceId)throw Error("Keep the original workspace selected.");
    origin=structuredClone(next);if(local.pending)local.pending.instanceId=origin.instanceId;
    await persist();await refresh();paint();say("Explicitly reconnected to the same workspace. Any retained request keeps its original operation ID and exact body.");
  });
  const importWrap=node("label",undefined,tools);importWrap.className="return-file";node("span","Open downloaded working copy",importWrap);
  const importFile=node("input",undefined,importWrap);importFile.type="file";importFile.disabled=true;importFile.accept=".json,application/json";
  importFile.addEventListener("change",run(async()=>{
    const file=importFile.files[0];if(!file)return;if(file.size>16000000)throw Error("Choose a working copy under 16 MB.");
    const candidate=valid(JSON.parse(await file.text()));
    if(local.pending)throw Error("Keep and resolve the existing original pending save before opening another working copy.");
    if(dirty&&!confirm("Replace the current unsaved entries with this complete working copy?"))return;
    local=candidate;requestPreview=responsePreview=null;dirty=true;await persist();paint();say("Complete selected working copy retained.");importFile.value="";
  }));
  function paint() {
    requestPreview=responsePreview=null;
    // Remove previous content controls from the enablement list.
    for(let i=buttons.length-1;i>=0;i--)if(content.contains(buttons[i].el))buttons.splice(i,1);
    content.replaceChildren();
    const notice=node("p",local.pending?"An original save is retained. Replay or inspect that exact request before creating another.":"Workspace "+origin.workspaceId+" · Revision "+overview.revision,content);
    notice.className="return-notice";
    const prepare=node("section",undefined,content);node("h3","1. Prepare recipient review",prepare);
    select(prepare,"Saved customer review",local.request.reviewId,overview.reviews.map(row=>[row.id,row.title+" · "+row.customer+" · edition "+row.edition]),v=>local.request.reviewId=v);
    const grid=node("div",undefined,prepare);grid.className="return-grid";
    field(grid,"Recipient name",local.request.recipient.name,v=>local.request.recipient.name=v);
    field(grid,"Organisation",local.request.recipient.organisation,v=>local.request.recipient.organisation=v);
    field(grid,"Recipient reference",local.request.recipient.reference,v=>local.request.recipient.reference=v);
    field(prepare,"Requesting operator",local.request.requestedBy,v=>local.request.requestedBy=v);
    field(prepare,"Review instructions",local.request.instructions,v=>local.request.instructions=v,true);
    const requestResult=node("pre","Open a complete preview before saving.",prepare);
    button(prepare,"Preview complete request",async()=>{
      requestPreview=await call("review-return.request.preview",local.request);requestResult.textContent=JSON.stringify(requestPreview,null,2);say("Complete saved edition and recipient request preview opened.");
    },{write:true});
    button(prepare,"Save recipient request",async()=>{
      if(!requestPreview)throw Error("Preview the current request first.");
      await pendingSave("review-return.request.save",{...local.request,expectedRevision:requestPreview.revision,expectedPreviewSha256:requestPreview.previewSha256});
    },{write:true});
    const receive=node("section",undefined,content);node("h3","2. Receive complete response",receive);
    select(receive,"Original recipient request",local.receive.requestId,overview.requests.map(row=>[row.id,row.title+" · "+row.recipient.name]),v=>local.receive.requestId=v);
    const fileLabel=node("label",undefined,receive);node("span","Returned response JSON",fileLabel);const fileInput=node("input",undefined,fileLabel);
    fileInput.type="file";fileInput.accept=".json,application/json";
    fileInput.addEventListener("change",run(async()=>{
      const file=fileInput.files[0];if(!file)return;if(file.size>8000000)throw Error("Choose a complete response under 8 MB.");
      local.receive.originalText=await file.text();const parsed=JSON.parse(local.receive.originalText);
      if(!overview.requests.some(row=>row.id===parsed.requestId))throw Error("This return belongs to a recipient request outside this workspace.");
      local.receive.requestId=parsed.requestId;responsePreview=null;dirty=true;await persist();paint();say("Exact returned file text retained; open its preview before adoption.");
    }));
    field(receive,"Complete returned JSON text",local.receive.originalText,v=>local.receive.originalText=v,true);
    field(receive,"Receiving operator",local.receive.receivedBy,v=>local.receive.receivedBy=v);
    field(receive,"Operator note",local.receive.operatorNote,v=>local.receive.operatorNote=v,true);
    const preview=node("pre","Open the returned response and exact source preview.",receive);
    button(receive,"Preview returned response",async()=>{
      responsePreview=await call("review-return.response.preview",{requestId:local.receive.requestId,originalText:local.receive.originalText});
      preview.textContent=JSON.stringify(responsePreview,null,2);say("Returned statements and original-source binding opened. Saving retains the response without changing assessments or decisions.");
    },{write:true});
    button(receive,"Retain reviewed response",async()=>{
      if(!responsePreview)throw Error("Preview the complete current returned response first.");
      if(responsePreview.existingResponseId)throw Error("This response is already retained. Open its original saved history.");
      if(typeof local.receive.receivedBy!=="string"||!local.receive.receivedBy.trim()||local.receive.receivedBy.length>1000)
        throw Error("Enter the receiving operator within 1,000 characters before preparing the save.");
      if(typeof local.receive.operatorNote!=="string"||local.receive.operatorNote.length>100000)
        throw Error("Keep the operator note within 100,000 characters.");
      await pendingSave("review-return.response.save",{...local.receive,expectedRevision:responsePreview.revision,expectedPreviewSha256:responsePreview.previewSha256});
    },{write:true});
    const history=node("section",undefined,content);node("h3","3. Saved requests and response history",history);
    select(history,"Saved request",local.selectedRequest,overview.requests.map(row=>[row.id,row.title+" · "+row.recipient.name+" · "+row.responseCount+" responses"]),v=>local.selectedRequest=v);
    const detail=node("pre","Select a saved request to open its complete source and return history.",history);
    button(history,"Open complete history",async()=>{
      if(!local.selectedRequest)throw Error("Choose a saved request.");
      detail.textContent=JSON.stringify(await call("review-return.get",{requestId:local.selectedRequest}),null,2);
    });
    for(const[format,label]of [["editable","Download editable recipient review"],["json","Download full history JSON"],["html","Download printable history"]])
      button(history,label,async()=>{
        if(!local.selectedRequest)throw Error("Choose a saved request.");
        const report=await call("review-return.report",{requestId:local.selectedRequest,format});download(report.name,report.text,report.mediaType);
      });
    renderButtons();
  }
  const beforeUnload=event=>{if(dirty||storageFault||busy||local?.pending){event.preventDefault();event.returnValue="";}};
  window.addEventListener("beforeunload",beforeUnload);
  try {
    if(!origin.workspaceId||!origin.instanceId)throw Error("Open the original authenticated workspace connection first.");
    await refresh();const saved=await readReturnDesk(origin.workspaceId);local=saved?valid(saved):structuredClone(initial);version=saved?.version??0;
    initialized=true;paint();say(local.pending?"Original pending request recovered. Inspect or replay its exact body.":"Original review return desk ready.");
  } catch(error){initialized=false;window.removeEventListener("beforeunload",beforeUnload);renderButtons();say(error.message,true);throw error;}
  function close() {
    if(closed)return Promise.resolve({state:"CLOSED",workspaceId:origin.workspaceId,pendingOperationId:local?.pending?.args?.operationId??null});
    if(closePromise)return closePromise;
    closing=true;renderButtons();
    const operation=(async()=>{
      while(busy)await new Promise(resolve=>idleWaiters.push(resolve));
      if(dirty||storageFault)await persist();
      closed=true;root.inert=true;window.removeEventListener("beforeunload",beforeUnload);
      return {state:"CLOSED",workspaceId:origin.workspaceId,pendingOperationId:local?.pending?.args?.operationId??null};
    })();
    closePromise=operation;
    operation.catch(()=>{if(closePromise===operation){closePromise=null;closing=false;renderButtons();}});
    return operation;
  }
  return { refresh:async()=>{
    if(!initialized)throw Error("The original review desk has not finished opening.");
    if(closing||closed)throw Error("The original review desk is closing or closed.");
    while(busy)await new Promise(resolve=>idleWaiters.push(resolve));
    if(closing||closed)throw Error("The original review desk is closing or closed.");
    return run(async()=>{await refresh();paint();})();
  }, close, destroy:close };
}

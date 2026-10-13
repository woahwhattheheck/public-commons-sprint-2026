const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const SANDBOX="allow-scripts allow-downloads allow-modals allow-popups allow-popups-to-escape-sandbox";
function downloadURL(ticket,workspace) {
  if(!ticket||ticket.workspace!==workspace||!/^[a-f0-9]{64}$/.test(ticket.id||"")||
     ticket.url!=="/api/file/"+ticket.id)throw Error("The original download belongs to another file or Workspace.");
  return ticket.url+"?download=1";
}
function previewURL(ticket,workspace,prefix="/api/file/published-study-preview/") {
  if(!ticket||ticket.workspace!==workspace||!/^[a-f0-9]{64}$/.test(ticket.id||"")||
     ticket.url!==prefix+encodeURIComponent(workspace)+"/"+ticket.id)
    throw Error("The report preview belongs to another file or Workspace.");
  return ticket.url;
}

export function createPublishedOriginalReports(host,options) {
  let node=null,events=null,request=null,serial=0,current=null,history=[],frame=null,binding=null;
  let loading=false,error="",status="",retry=null,frameTimer=null,framePending=false,suspended=false;
  const context=()=>options.context();
  const key=value=>value&&JSON.stringify([value.workspace,value.study_id,value.version_id,value.view]);
  const valid=mark=>Boolean(node)&&!suspended&&(!options.isCurrent||options.isCurrent())&&mark.serial===serial&&key(context())===mark.key&&
    host.getWorkspace()===mark.workspace;
  function mark() {
    const value=context();
    if(!value?.workspace||!value.study_id||!value.version_id||host.getWorkspace()!==value.workspace)
      throw Error("Open the retained original study edition first.");
    return {serial,key:key(value),workspace:value.workspace,study_id:value.study_id,version_id:value.version_id};
  }
  function clearFrame() {
    if(frameTimer!==null){clearTimeout(frameTimer);frameTimer=null;}
    framePending=false;
    if(frame) {frame.src="about:blank";frame.remove();frame=null;}
  }
  function close() {
    ++serial;request?.abort();request=null;clearFrame();current=null;binding=null;history=[];
    loading=false;error="";status="";retry=null;
    if(node){node.hidden=true;node.innerHTML="";}
  }
  function sync() {
    if(binding&&(key(context())!==binding.key||host.getWorkspace()!==binding.workspace))close();
  }
  function shell() {
    if(!node)return;
    node.hidden=false;
    node.innerHTML='<header class="ps-original-header"><div><h2>Original study report</h2>'+
      '<p data-original-title></p></div><button type="button" data-original-action="close">Close report</button></header>'+
      '<p class="ps-help">'+esc(options.scopeNote||'This report keeps its complete original observation scope. Its own filters are independent of the selected tables in the study desk.')+'</p>'+
      '<div class="ps-actions"><button type="button" data-original-action="back">Previous report</button>'+
      '<button type="button" data-original-action="print">Print this report</button>'+
      '<button type="button" data-original-action="retry" hidden>Retry opening</button>'+
      '<a data-original-download download>Download original HTML</a>'+
      '<button type="button" data-original-action="export">Export complete study</button></div>'+
      '<p data-original-status role="status" aria-live="polite"></p>'+
      '<div class="ps-original-frame" data-original-frame></div>'+
      '<details data-original-sources><summary>Original companion files</summary><ul class="ps-source-list" data-original-links></ul></details>';
  }
  function render() {
    if(!node)return;
    if(!node.querySelector("[data-original-frame]"))shell();
    node.querySelector("[data-original-title]").textContent=current?.result.member||"Opening the exact retained source…";
    const message=node.querySelector("[data-original-status]");
    message.textContent=error||status||(loading?"Reading verified original report and companions…":"");
    message.classList.toggle("ps-original-error",Boolean(error));
    node.querySelector('[data-original-action="back"]').disabled=loading||!history.length;
    node.querySelector('[data-original-action="print"]').disabled=loading||!current||!frame;
    node.querySelector('[data-original-action="retry"]').hidden=!retry;
    node.querySelector('[data-original-action="retry"]').disabled=loading;
    node.querySelector('[data-original-action="export"]').disabled=loading||!current;
    node.querySelector('[data-original-action="export"]').hidden=typeof options.exportComplete!=="function";
    const original=node.querySelector("[data-original-download]");
    original.hidden=!current;
    if(current)original.href=downloadURL(current.result.download,binding.workspace);
    else original.removeAttribute("href");
    const unique=new Map();
    for(const row of current?.result.links||[])if(!unique.has(row.path))unique.set(row.path,row);
    node.querySelector("[data-original-links]").innerHTML=[...unique.values()].map(row=>
      '<li>'+(row.html?'<button type="button" class="ps-link-button" data-original-member="'+esc(row.id)+'">Open '+esc(row.path)+'</button> · ':"")+
      '<a href="'+esc(downloadURL(row.download_ticket,binding.workspace))+'" download>Download '+esc(row.path)+'</a>'+
      '<span class="ps-help">'+Number(row.source.bytes).toLocaleString()+' bytes</span></li>').join("");
    node.querySelector("[data-original-sources]").hidden=!unique.size;
  }
  async function navigate(selection,{back=false,replace=false}={}) {
    sync();++serial;request?.abort();
    const opening=mark(),prior=current;
    binding=opening;loading=true;error="";status="";retry=null;clearFrame();render();
    const controller=new AbortController();request=controller;
    try {
      const result=await (options.loadPreview?options.loadPreview(opening,selection.path,controller.signal):host.api("/api/published-studies/report-preview",{
        method:"POST",body:{workspace:opening.workspace,study_id:opening.study_id,
          version_id:opening.version_id,path:selection.path},signal:controller.signal}));
      if(!valid(opening))return;
      if(result.workspace!==opening.workspace||result.study_id!==opening.study_id||
         result.version_id!==opening.version_id||result.member!==selection.path||
         !/^[a-f0-9]{64}$/.test(result.id||"")||!Array.isArray(result.links))
        throw Error("The returned report is not the requested retained study source.");
      const seen=new Set();
      for(const row of result.links) {
        if(typeof row.id!=="string"||seen.has(row.id)||typeof row.path!=="string"||
           typeof row.html!=="boolean"||typeof row.download!=="boolean")
          throw Error("The report companion binding is invalid.");
        seen.add(row.id);downloadURL(row.download_ticket,opening.workspace);
      }
      const url=new URL(previewURL(result.preview,opening.workspace,options.previewPrefix),window.location.origin);
      if(selection.query) {
        const query=new URLSearchParams(selection.query);query.delete("download");url.search=query.toString();
      }
      if(selection.fragment)url.hash=selection.fragment;
      downloadURL(result.download,opening.workspace);
      if(back)history.pop();else if(prior&&!replace)history.push(copy(prior.selection));
      current={selection:copy(selection),result};frame=document.createElement("iframe");
      frame.title="Original study report: "+result.member;
      frame.setAttribute("sandbox",SANDBOX);frame.referrerPolicy="no-referrer";
      const openedFrame=frame;
      function failedFrame() {
        if(!valid(opening)||frame!==openedFrame||!framePending)return;
        clearFrame();loading=false;
        error="The original report did not confirm that it opened. Retry opening, or download the original HTML and complete study.";
        retry={selection:copy(selection),back:false,replace:true};render();
      }
      frame.addEventListener("error",failedFrame,{once:true});
      framePending=true;
      frameTimer=setTimeout(failedFrame,15000);
      frame.src=url.pathname+url.search+url.hash;
      node.querySelector("[data-original-frame]").append(frame);
      status="Opening the retained report…";
    } catch(exception) {
      if(valid(opening)&&exception?.name!=="AbortError") {
        error=exception.message||String(exception);
        // Keep the prior immutable report selection for retry/back navigation.
        current=prior;retry={selection:copy(selection),back,replace};render();
      }
    } finally {
      if(valid(opening)) {if(!framePending)loading=false;if(request===controller)request=null;render();}
    }
  }
  async function open(path) {
    if(typeof path!=="string"||!path)throw Error("Choose an original report.");
    close();suspended=false;shell();await navigate({path,query:"",fragment:""});
    if(node&&!error)node.scrollIntoView?.({block:"start",behavior:"smooth"});
  }
  function activate(row) {
    if(!current||!binding||!valid(binding)||loading)return;
    if(row.html&&!row.download) {
      const expected=binding;
      navigate({path:row.path,query:row.query||"",fragment:row.fragment||""}).catch(error=>{if(valid(expected))showError(error);});
    } else {
      const anchor=document.createElement("a");
      anchor.href=downloadURL(row.download_ticket,binding.workspace);
      anchor.download=row.path.split("/").pop();anchor.hidden=true;
      node.append(anchor);anchor.click();anchor.remove();
      status="Original download requested: "+row.path;render();
    }
  }
  function showError(exception) {
    if(!node)return;
    error=exception?.message||String(exception);render();host.toast(error);
  }
  function message(event) {
    sync();
    const value=event.data;
    if(!current||!frame||event.source!==frame.contentWindow||event.origin!=="null"||
       !binding||!valid(binding)||!value||value.token!==current.result.id)return;
    if(value.type==="upstate.published-report.ready/v1") {
      if(!framePending)return;
      if(frameTimer!==null){clearTimeout(frameTimer);frameTimer=null;}
      framePending=false;loading=false;error="";retry=null;
      status="Original report opened. Its companion links use the verified retained source files.";render();return;
    }
    if(loading||value.type!=="upstate.published-report.member/v1"||typeof value.id!=="string")return;
    const row=current.result.links.find(item=>item.id===value.id);
    if(row)activate(row);
  }
  function click(event) {
    const button=event.target.closest("button");
    if(!button||!node?.contains(button))return;
    sync();if(!node||node.hidden)return;
    const action=button.dataset.originalAction;
    if(action==="close"){close();return;}
    if(!binding||!valid(binding)||loading)return;
    if(button.dataset.originalMember!==undefined) {
      const row=current?.result.links.find(item=>item.id===button.dataset.originalMember);
      if(row)activate({...row,download:false});
    } else if(action==="back"&&history.length) {
      const expected=binding;
      navigate(history.at(-1),{back:true}).catch(error=>{if(valid(expected))showError(error);});
    } else if(action==="retry"&&retry) {
      const chosen=copy(retry),expected=binding;
      navigate(chosen.selection,{back:chosen.back,replace:chosen.replace}).catch(error=>{if(valid(expected))showError(error);});
    } else if(action==="print"&&frame&&current) {
      frame.contentWindow.postMessage({type:"upstate.published-report.print/v1",token:current.result.id},"*");
    } else if(action==="export"&&current) {
      const selected=copy({study_id:binding.study_id,version_id:binding.version_id});
      const expected=binding;
      Promise.resolve(options.exportComplete(selected)).catch(error=>{if(valid(expected))showError(error);});
    }
  }
  function mount(target) {
    detach();node=target;node.hidden=true;events=new AbortController();
    node.addEventListener("click",click,{signal:events.signal});
    window.addEventListener("message",message,{signal:events.signal});
  }
  function suspend() {
    if(loading)close();
    if(frameTimer!==null){clearTimeout(frameTimer);frameTimer=null;}
    suspended=true;
  }
  function resume() {suspended=false;return Boolean(current&&frame&&!framePending);}
  function detach() {close();events?.abort();events=null;node=null;suspended=false;}
  return {mount,detach,sync,open,suspend,resume};
}

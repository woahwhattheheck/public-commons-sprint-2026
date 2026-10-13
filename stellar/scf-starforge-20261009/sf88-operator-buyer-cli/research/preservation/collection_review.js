/* Complete offline review for the original collection accession. No network or original-file writes. */
(function (global) {
"use strict";
function createAPI(hashText) {
  const SOURCE="stellar-forge.collection-review-source.v1", WORKING="stellar-forge.collection-review-working.v1";
  const COLLECTION="stellar-forge.collection-accession.v1", MAX=64*1024*1024, REVIEW_MAX=4*1024*1024;
  const FIELDS=["title","creator","subject","description","publisher","contributor","date","type","format","identifier","source","language","relation","coverage","rights"];
  const need=(value,message)=>{if(!value)throw new Error(message);};
  const plain=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
  const exact=(value,keys)=>plain(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
  const copy=value=>JSON.parse(JSON.stringify(value));
  const blank=value=>/^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/u.test(value);
  const sha=value=>typeof value==="string"&&/^[a-f0-9]{64}$/.test(value);
  function compare(a,b){const x=Array.from(a),y=Array.from(b);for(let i=0;i<Math.min(x.length,y.length);i++){const d=x[i].codePointAt(0)-y[i].codePointAt(0);if(d)return d;}return x.length-y.length;}
  function bytes(value){let n=0;for(const c of value){const p=c.codePointAt(0);need(p<0xd800||p>0xdfff,"Unsupported unpaired Unicode surrogate.");n+=p<128?1:p<2048?2:p<65536?3:4;}return n;}
  function canonical(value){
    if(value===null)return"null";
    if(typeof value==="string"){bytes(value);return JSON.stringify(value);}
    if(typeof value==="boolean")return String(value);
    if(typeof value==="number"){need(Number.isSafeInteger(value),"Use exact integer JSON values.");return String(value);}
    if(Array.isArray(value))return"["+value.map(canonical).join(",")+"]";
    need(plain(value),"Use complete ordinary JSON.");
    return"{"+Object.keys(value).sort(compare).map(key=>canonical(key)+":"+canonical(value[key])).join(",")+"}";
  }
  const equal=(a,b)=>canonical(a)===canonical(b);
  const hash=async value=>{
    const raw=typeof value==="string"?value:canonical(value);
    if(hashText)return await hashText(raw);
    need(globalThis.crypto?.subtle&&typeof TextEncoder==="function","This browser cannot verify SHA-256. Open the file in a current browser with local-file cryptography.");
    const result=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(result),x=>x.toString(16).padStart(2,"0")).join("");
  };
  function text(value,label,nonempty=false){
    need(typeof value==="string"&&Array.from(value).length<=20000,label+" must contain at most 20,000 characters.");
    for(const c of value){const n=c.codePointAt(0);need(n===9||n===10||n===13||(n>=32&&n<=0xd7ff)||(n>=0xe000&&n<=0xfffd)||(n>=0x10000&&n<=0x10ffff),label+" contains unsupported text.");}
    need(!nonempty||!blank(value),label+" must not be empty.");return value;
  }
  function path(value){
    need(typeof value==="string"&&value&&Array.from(value).length<=2048&&!/[\\:\x00-\x1f\x7f]/.test(value)&&
      !value.startsWith("/")&&!value.split("/").some(p=>!p||p==="."||p===".."),"Invalid original relative path.");return value;
  }
  function review(value,inventory){
    need(plain(value)&&Object.keys(value).every(k=>["schema","inventorySha256","decisions","note"].includes(k))&&
      value.schema===COLLECTION+".review"&&value.inventorySha256===inventory.sha256&&
      Array.isArray(value.decisions)&&value.decisions.length<=10000,"Review must bind the complete original inventory.");
    need(bytes(canonical(value))<=REVIEW_MAX,"The complete review exceeds the original 4 MiB metadata profile.");
    const seen=new Set(),decisions=[];
    for(const item of value.decisions){
      need(exact(item,["path","include","fields","reason"])&&Object.hasOwn(inventory.files,item.path)&&!seen.has(item.path)&&
        typeof item.include==="boolean"&&plain(item.fields),"Unknown, duplicate or incomplete file decision.");
      seen.add(item.path);const fields={};
      for(const key of Object.keys(item.fields).sort(compare)){
        const values=item.fields[key];
        need(FIELDS.includes(key)&&Array.isArray(values)&&values.length<=100,"Use original Dublin Core names with up to 100 strings.");
        fields[key]=values.map(v=>text(v,key,true));
      }
      const reason=text(item.reason,"File reason");
      need(item.include&&!Object.keys(fields).length||!blank(reason),"Metadata changes and exclusions require their reason.");
      need(!Object.hasOwn(fields,"title")||fields.title.length,"Keep a title for the original file.");
      decisions.push({path:item.path,include:item.include,fields,reason});
    }
    return{schema:COLLECTION+".review",inventorySha256:inventory.sha256,decisions:decisions.sort((a,b)=>compare(a.path,b.path)),note:text(value.note??"","Review note")};
  }
  function editor(value,inventory){
    if(value===null)return null;
    need(exact(value,["path","include","fieldsText","reason"])&&Object.hasOwn(inventory.files,value.path)&&typeof value.include==="boolean"&&
      typeof value.fieldsText==="string"&&bytes(value.fieldsText)<=REVIEW_MAX&&typeof value.reason==="string"&&bytes(value.reason)<=REVIEW_MAX,
      "Invalid unfinished file edit.");
    // Unfinished JSON/reason is retained literally. Applying it invokes the original review rules.
    return copy(value);
  }
  async function source(value){
    need(exact(value,["schema","accession","inventory","history","sha256"])&&value.schema===SOURCE&&sha(value.sha256),"Unsupported complete collection review source.");
    need(bytes(canonical(value))<=MAX,"Complete source exceeds 64 MiB; use the full workspace export.");
    const payload=copy(value);delete payload.sha256;
    need(await hash(payload)===value.sha256,"The complete review source digest changed.");
    const a=value.accession;
    need(exact(a,["id","settings","createdAt"])&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(a.id)&&
      exact(a.settings,["id","title","organization","contact","sourceReference"])&&a.settings.id===a.id,"Invalid original accession identity.");
    text(a.createdAt,"Original creation time",true);
    for(const key of Object.keys(a.settings))text(a.settings[key],key,["id","title","sourceReference"].includes(key));
    need(!/[\r\n]/.test(a.settings.organization+a.settings.contact),"Sender fields must be single-line.");
    const inv=value.inventory;
    need(exact(inv,["schema","files","directories","bytes","sha256"])&&inv.schema===COLLECTION+".inventory"&&sha(inv.sha256)&&plain(inv.files)&&
      Object.keys(inv.files).length>0&&Object.keys(inv.files).length<=10000&&Array.isArray(inv.directories)&&inv.directories.length<=10000,
      "Invalid original inventory.");
    const rawInv=copy(inv);delete rawInv.sha256;
    need(bytes(canonical(inv))<=REVIEW_MAX+100&&await hash(rawInv)===inv.sha256,"Original inventory digest or metadata size changed.");
    let total=0;const dirs=new Set();
    for(const name of inv.directories){path(name);need(!dirs.has(name)&&!Object.hasOwn(inv.files,name),"Repeated original directory.");dirs.add(name);}
    need(equal(inv.directories,[...dirs].sort(compare)),"Original directories must retain canonical order.");
    for(const[name,id]of Object.entries(inv.files)){
      path(name);need(exact(id,["bytes","sha256"])&&Number.isSafeInteger(id.bytes)&&id.bytes>=0&&id.bytes<=64*1024*1024&&sha(id.sha256),"Invalid original file identity.");
      total+=id.bytes;
    }
    for(const name of [...Object.keys(inv.files),...dirs]){
      const parts=name.split("/");parts.pop();
      while(parts.length){need(dirs.has(parts.join("/")),"Missing original parent directory.");parts.pop();}
    }
    need(inv.bytes===total&&Number.isSafeInteger(total)&&total<=2*1024*1024*1024,"Original file total changed.");
    need(Array.isArray(value.history)&&value.history.length>0&&value.history.length<=2001,"Keep every complete original saved revision.");
    let prior=null;
    for(let i=0;i<value.history.length;i++){
      const row=value.history[i];
      need(exact(row,["schema","revision","createdAt","previousReviewSha256","reviewSha256","review"])&&
        row.schema===COLLECTION+".revision"&&row.revision===i&&row.previousReviewSha256===prior&&sha(row.reviewSha256),"Original saved review history is incomplete.");
      text(row.createdAt,"Saved revision time",true);
      need(equal(review(row.review,inv),row.review)&&await hash(row.review)===row.reviewSha256,"Original saved review bytes or digest changed.");
      prior=row.reviewSha256;
    }
    return copy(value);
  }
  async function seal(value){const result=copy(value);delete result.sha256;need(bytes(canonical(result))<=MAX-80,"Complete working review exceeds 64 MiB. Preserve the current file; no history was omitted.");return{...result,sha256:await hash(result)};}
  async function create(sourceValue,draft,unfinished=null){
    const original=await source(sourceValue);
    return seal({schema:WORKING,source:original,draft:review(draft||original.history.at(-1).review,original.inventory),
      editor:editor(unfinished,original.inventory)});
  }
  async function validate(value){
    need(exact(value,["schema","source","draft","editor","sha256"])&&value.schema===WORKING&&sha(value.sha256),"Open a complete collection-review working file.");
    need(bytes(canonical(value))<=MAX,"The working file exceeds 64 MiB.");
    const raw=copy(value);delete raw.sha256;need(await hash(raw)===value.sha256,"The working review digest changed.");
    await source(value.source);need(equal(review(value.draft,value.source.inventory),value.draft),"The working review is not normalized.");
    editor(value.editor,value.source.inventory);return copy(value);
  }
  async function returnReview(value,currentSource){
    const working=await validate(value),head=await source(currentSource);
    need(equal(working.source.accession,head.accession)&&equal(working.source.inventory,head.inventory),"This working review belongs to another original accession.");
    need(working.source.history.length<=head.history.length&&working.source.history.every((r,i)=>equal(r,head.history[i])),
      "The original saved history is not a complete prefix of this accession. Retain both working files.");
    need(working.editor===null,"This working file retains an unfinished file edit. Open it offline and apply or reload that edit before returning decisions.");
    return review(working.draft,head.inventory);
  }
  function stringify(value){const raw=JSON.stringify(value,null,2)+"\n";need(bytes(raw)<=MAX,"Pretty working JSON exceeds 64 MiB. Preserve the current working file.");return raw;}
  function parse(raw){
    need(typeof raw==="string"&&bytes(raw)<=128*1024*1024,"Select a complete working JSON or HTML within 128 MiB.");
    let body=raw;
    if(raw.trimStart().startsWith("<")){
      need(typeof DOMParser==="function","HTML extraction requires the original browser.");
      const doc=new DOMParser().parseFromString(raw,"text/html"),nodes=doc.querySelectorAll('script#collection-working-data[type="application/json"]');
      need(nodes.length===1,"The HTML does not contain one complete collection working file.");body=nodes[0].textContent;
    }
    need(bytes(body)<=MAX,"The working JSON exceeds 64 MiB.");return JSON.parse(body);
  }
  return{SOURCE,WORKING,MAX,REVIEW_MAX,copy,canonical,equal,bytes,hash,text,path,review,editor,source,create,validate,returnReview,stringify,parse,seal};
}

function mount(api,initial) {
  const by=id=>document.getElementById(id),copy=api.copy;
  let value=null,draft=null,editor=null,busy=false,generation=0,downloaded=-1,offset=0,openSequence=0,tabDraft=null;
  const status=by("review-status"),rows=by("review-rows"),details=by("file-editor"),note=by("review-note");
  const announce=(message,error=false)=>{status.textContent=message;status.setAttribute("role",error?"alert":"status");};
  const dom=(tag,text,attrs={})=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;for(const[k,v]of Object.entries(attrs))node.setAttribute(k,v);return node;};
  const key=()=>value?"collection-review-working:"+value.sha256:null;
  const dirty=()=>generation!==downloaded||Boolean(tabDraft);
  const fields=by("file-fields"),reason=by("file-reason"),included=by("file-include");
  function controls(){
    for(const n of document.querySelectorAll("button,input,select,textarea"))n.disabled=busy||!value;
    by("working-open").disabled=busy||Boolean(tabDraft);by("working-file").disabled=busy||Boolean(tabDraft);
    by("download-review").disabled=busy||!value||!!editor;
    by("apply-file").disabled=busy||!editor;by("reload-file").disabled=busy||!editor;by("original-file").disabled=busy||!editor;
    by("restore-tab").disabled=busy||!tabDraft;by("discard-tab").disabled=busy||!tabDraft;
    by("previous").disabled=busy||offset===0;by("next").disabled=busy||offset+50>=filtered().length;
    if(tabDraft){
      for(const node of document.querySelectorAll("#review-note,#query,#selection,#previous,#next,#file-fields,#file-reason,#file-include,#apply-file,#reload-file,#original-file,[data-file]"))node.disabled=true;
    }
    by("state-note").textContent=value?"Saved source r"+value.source.history.at(-1).revision+" · "+(editor?"Unfinished file edit retained":dirty()?"Working changes":generation===0?"Opened saved working file":"Download prepared; reopen the saved file to verify"):"Opening complete source…";
  }
  function retainTab(){
    if(!value||tabDraft)return;try{sessionStorage.setItem(key(),JSON.stringify({sourceSha256:value.source.sha256,draft,editor}));}
    catch(_){announce("This tab could not retain a recovery copy. Download the complete working file before closing.",true);}
  }
  function changed(){generation++;retainTab();controls();}
  async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){announce(e.message||String(e),true);}finally{busy=false;controls();}}
  async function snapshot(){return api.create(value.source,draft,editor);}
  function emit(raw,name,type){
    const url=URL.createObjectURL(new Blob([raw],{type})),a=dom("a","",{href:url,download:name});
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  const fileName=ext=>"Collection_"+value.source.accession.id+"_working."+ext;
  function filtered(){
    if(!value)return[];
    const decisions=new Map(draft.decisions.map(x=>[x.path,x])),query=by("query").value.toLowerCase(),mode=by("selection").value;
    return Object.entries(value.source.inventory.files).map(([path,original])=>{
      const item=decisions.get(path);return{path,original,include:item?.include??true,fields:item?.fields||{},reason:item?.reason||""};
    }).filter(r=>(!query||r.path.toLowerCase().includes(query))&&(mode==="all"||mode==="included"&&r.include||mode==="excluded"&&!r.include||mode==="rights"&&r.include&&!r.fields.rights?.length));
  }
  function renderRows(){
    const all=filtered();if(offset>=all.length)offset=Math.max(0,Math.floor((all.length-1)/50)*50);rows.replaceChildren();
    for(const row of all.slice(offset,offset+50)){
      const tr=dom("tr");tr.append(dom("td",row.path),dom("td",row.include?"Included":"Excluded"),dom("td",row.original.bytes.toLocaleString()+" B"),dom("td",row.fields.rights?.join("; ")||"Unspecified"));
      const cell=dom("td"),b=dom("button","Review",{type:"button","data-file":row.path});b.addEventListener("click",()=>action(()=>openRow(row.path)));cell.append(b);tr.append(cell);rows.append(tr);
    }
    if(!all.length){const tr=dom("tr");tr.append(dom("td","No original files match this view.",{colspan:"5"}));rows.append(tr);}
    by("page-count").textContent=all.length?(offset+1)+"–"+Math.min(offset+50,all.length)+" of "+all.length+" files":"0 files";controls();
  }
  function showEditor(){
    details.hidden=!editor;if(!editor)return;
    by("file-title").textContent=editor.path;
    by("file-identity").textContent=JSON.stringify(value.source.inventory.files[editor.path],null,2);
    included.checked=editor.include;fields.value=editor.fieldsText;reason.value=editor.reason;
  }
  function openRow(path){
    if(editor&&editor.path===path){showEditor();return;}
    if(editor&&!confirm("Replace this unfinished file edit? Download the working file or apply it to retain it."))return;
    const row=draft.decisions.find(x=>x.path===path);
    editor={path,include:row?.include??true,fieldsText:JSON.stringify(row?.fields||{},null,2),reason:row?.reason||""};
    changed();showEditor();
  }
  function applyFile(){
    if(!editor)return;
    const proposed={path:editor.path,include:editor.include,fields:JSON.parse(editor.fieldsText),reason:editor.reason};
    const decisions=draft.decisions.filter(x=>x.path!==editor.path);
    decisions.push(proposed);
    const next=api.review({...draft,decisions},value.source.inventory);
    draft=next;editor=null;changed();showEditor();renderRows();announce("The complete file decision is in this working draft.");
  }
  async function install(next){
    const checked=await api.validate(next);
    value=checked;draft=copy(checked.draft);editor=copy(checked.editor);offset=0;generation=0;downloaded=0;tabDraft=null;
    by("title").textContent=checked.source.accession.settings.title;
    by("institution").textContent=checked.source.accession.settings.organization||"Holding organization not supplied";
    by("source-details").textContent=JSON.stringify({accession:checked.source.accession,inventorySha256:checked.source.inventory.sha256,
      files:Object.keys(checked.source.inventory.files).length,directories:checked.source.inventory.directories.length,
      originalBytes:checked.source.inventory.bytes,sourceSha256:checked.source.sha256},null,2);
    by("history").textContent=JSON.stringify(checked.source.history,null,2);
    note.value=draft.note;showEditor();renderRows();
    try{
      const raw=sessionStorage.getItem(key()),saved=raw?JSON.parse(raw):null;
      if(saved&&saved.sourceSha256===value.source.sha256){
        api.review(saved.draft,value.source.inventory);api.editor(saved.editor,value.source.inventory);
        if(!api.equal(saved.draft,draft)||!api.equal(saved.editor,editor))tabDraft=saved;
      }
    }catch(_){announce("A tab recovery copy could not be read. This selected working file is intact.",true);}
    by("tab-recovery").hidden=!tabDraft;controls();
  }
  by("apply-file").addEventListener("click",()=>action(applyFile));
  by("original-file").addEventListener("click",()=>action(()=>{
    if(!editor)return;
    draft=api.review({...draft,decisions:draft.decisions.filter(row=>row.path!==editor.path)},value.source.inventory);
    editor=null;changed();showEditor();renderRows();announce("This draft now uses the original file defaults. Saved source history remains intact.");
  }));
  by("reload-file").addEventListener("click",()=>action(()=>{
    if(!editor)return;if(!confirm("Discard this unfinished edit and keep the complete draft decision?"))return;
    editor=null;changed();showEditor();renderRows();
  }));
  for(const node of [fields,reason,included])node.addEventListener("input",()=>{
    if(busy||!editor)return;editor={path:editor.path,include:included.checked,fieldsText:fields.value,reason:reason.value};changed();
  });
  note.addEventListener("input",()=>{if(busy||!value)return;draft.note=note.value;changed();});
  for(const id of ["query","selection"])by(id).addEventListener("input",()=>{offset=0;renderRows();});
  by("previous").addEventListener("click",()=>{offset=Math.max(0,offset-50);renderRows();});
  by("next").addEventListener("click",()=>{offset+=50;renderRows();});
  by("download-json").addEventListener("click",()=>action(async()=>{
    const next=await snapshot();emit(api.stringify(next),fileName("json"),"application/json");downloaded=generation;
    announce("Complete working JSON download requested. Reopen the saved file to verify its retained source, draft and unfinished edit.");
  }));
  by("download-html").addEventListener("click",()=>action(async()=>{
    const next=await snapshot();emit(globalThis.PreservationCollectionReview.renderHTML(next),fileName("html"),"text/html");downloaded=generation;
    announce("Complete editable HTML download requested. Open the saved HTML independently to continue this working review.");
  }));
  by("download-review").addEventListener("click",()=>action(async()=>{
    if(editor)throw new Error("Apply or reload the unfinished file edit first.");
    const next=api.review(draft,value.source.inventory);emit(JSON.stringify(next,null,2)+"\n","Collection_"+value.source.accession.id+"_review.json","application/json");
    announce("Review decisions downloaded. The complete working file also retains original inventory and saved history.");
  }));
  by("working-open").addEventListener("click",()=>action(async()=>{
    const selected=by("working-file").files?.[0];if(!selected)throw new Error("Choose the complete saved working HTML or JSON.");
    if(selected.size>128*1024*1024)throw new Error("The selected file exceeds 128 MiB.");
    if(dirty()&&!confirm("Replace the current working draft? Download it first to preserve all edits."))return;
    const sequence=++openSequence,raw=await selected.text(),next=await api.validate(api.parse(raw));if(sequence!==openSequence)return;
    await install(next);announce("The complete selected working file reopened; original inventory and every saved revision verified.");
  }));
  by("restore-tab").addEventListener("click",()=>action(()=>{
    if(!tabDraft)return;draft=api.review(tabDraft.draft,value.source.inventory);editor=api.editor(tabDraft.editor,value.source.inventory);
    tabDraft=null;by("tab-recovery").hidden=true;note.value=draft.note;changed();showEditor();renderRows();announce("The complete retained tab draft is restored. Download a working file to keep an independent copy.");
  }));
  by("discard-tab").addEventListener("click",()=>action(()=>{if(confirm("Discard only this tab recovery copy? The opened working file remains intact.")){tabDraft=null;sessionStorage.removeItem(key());by("tab-recovery").hidden=true;}}));
  window.addEventListener("beforeunload",event=>{if(busy||dirty()){event.preventDefault();event.returnValue="";}});
  action(async()=>{await install(initial);announce("Complete working file opened. Edits remain here until returned and explicitly saved in the original Workbench.");});
}

const CSS=":root{font:15px/1.5 Arial,Helvetica,sans-serif;color:#252525;background:#f4f4f4}*{box-sizing:border-box}body{margin:0}main{max-width:1280px;margin:auto;padding:24px}header{border-bottom:3px solid #353535;margin-bottom:20px}h1{font-size:28px;margin:8px 0}h2{font-size:20px}h3{font-size:16px;overflow-wrap:anywhere}.muted,small{color:#606060}section,.panel,details{background:white;border:1px solid #c6c6c6;padding:18px;margin:16px 0}label{display:block;font-weight:600;margin:10px 0 4px}button,input,select,textarea{font:inherit;color:inherit}button{background:#fff;border:1px solid #686868;border-radius:3px;padding:8px 12px;cursor:pointer}button.primary{background:#303030;color:white}button:disabled{opacity:.45;cursor:default}input:not([type=checkbox]),select,textarea{width:100%;border:1px solid #8c8c8c;padding:8px;background:white}input[type=checkbox]{width:20px;height:20px}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid #555555;outline-offset:2px}.toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:end}.toolbar>div{flex:1;min-width:220px}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:670px}th,td{padding:10px;border-bottom:1px solid #d2d2d2;text-align:left;vertical-align:top}td:first-child{max-width:460px;overflow-wrap:anywhere}th{background:#eeeeee}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 monospace}textarea.code{font-family:monospace}#review-status{padding:12px;background:#e8e8e8}#review-status[role=alert]{background:#dedede}[hidden]{display:none!important}@media(max-width:600px){main{padding:12px}section,.panel,details{padding:12px}.toolbar>div{min-width:100%}h1{font-size:23px}button{min-height:44px}}@media print{button,input[type=file],#working-open,#tab-recovery{display:none}main{max-width:none}section,details{break-inside:avoid}body{background:white}}";
const BODY="<main><header><p class=\"muted\">COLLECTION REVIEW · PORTABLE WORKING FILE</p><h1 id=\"title\">Opening collection review…</h1><p id=\"institution\"></p><p id=\"state-note\" role=\"status\"></p></header>\n<p>This file contains the complete original inventory, institutional settings, saved review history and this working draft. Original file contents remain in the retained Workbench workspace and BagIt transfer. Offline decisions become a saved accession edition only after explicit comparison and Save complete review in the original Workbench.</p>\n<section><h2>Save and reopen</h2><div class=\"toolbar\"><button id=\"download-html\" class=\"primary\">Download editable working HTML</button><button id=\"download-json\">Download complete working JSON</button><button id=\"download-review\">Download review decisions JSON</button></div>\n<p class=\"muted\">Working downloads retain unfinished file edits exactly. The decisions-only download requires applying or reloading the open edit. To return a complete working file, select it under Collections → Review imported JSON in the original Workbench.</p>\n<div class=\"toolbar\"><div><label for=\"working-file\">Saved working HTML or JSON</label><input id=\"working-file\" type=\"file\" accept=\".html,.json,text/html,application/json\"></div><button id=\"working-open\">Open selected working file</button></div>\n<div id=\"tab-recovery\" class=\"panel\" hidden><h3>A complete draft remains in this tab</h3><p>The selected saved file is open. Choose whether to restore or discard this separate tab draft before editing. Downloads of the opened file remain available.</p><button id=\"restore-tab\">Restore retained tab draft</button> <button id=\"discard-tab\">Keep opened file and discard tab copy</button></div></section>\n<section><h2>Review original files</h2><label for=\"review-note\">Review note</label><textarea id=\"review-note\" rows=\"3\" maxlength=\"20000\"></textarea>\n<div class=\"toolbar\"><div><label for=\"query\">Find original path</label><input id=\"query\" type=\"search\"></div><div><label for=\"selection\">Selection</label><select id=\"selection\"><option value=\"all\">All files</option><option value=\"included\">Included</option><option value=\"excluded\">Excluded</option><option value=\"rights\">Included without recorded rights</option></select></div></div>\n<div class=\"scroll\"><table><thead><tr><th>Original file</th><th>Selection</th><th>Size</th><th>Rights</th><th>Review</th></tr></thead><tbody id=\"review-rows\"></tbody></table></div>\n<div class=\"toolbar\"><button id=\"previous\">Previous</button><span id=\"page-count\"></span><button id=\"next\">Next</button></div>\n<div id=\"file-editor\" class=\"panel\" hidden><h3 id=\"file-title\"></h3><details><summary>Full original file identity</summary><pre id=\"file-identity\"></pre></details>\n<label><input id=\"file-include\" type=\"checkbox\"> Include original file in the transfer</label>\n<label for=\"file-fields\">Dublin Core field overrides</label><textarea class=\"code\" id=\"file-fields\" rows=\"10\" spellcheck=\"false\"></textarea>\n<p class=\"muted\">Use an object of original field names and complete arrays of strings. An empty object retains the original filename title and path identifier. Rights are recorded by the reviewer and are never inferred.</p>\n<label for=\"file-reason\">Reason for this file decision</label><textarea id=\"file-reason\" rows=\"3\"></textarea>\n<div class=\"toolbar\"><button id=\"apply-file\" class=\"primary\">Apply file decision to working draft</button><button id=\"reload-file\">Discard unfinished edit</button><button id=\"original-file\">Use original file defaults</button></div></div></section>\n<details><summary>Complete original accession and inventory binding</summary><pre id=\"source-details\"></pre></details>\n<details><summary>Every complete saved review edition</summary><pre id=\"history\"></pre></details><p id=\"review-status\" role=\"status\" aria-live=\"polite\">Verifying the complete working file…</p>\n<footer class=\"muted\">Portable review of the original collection. No repository connection or automatic submission.</footer></main>";

const api=createAPI();
function renderHTML(value){
  const data=JSON.stringify(value).replace(/</g,"\\u003c").replace(/\u2028/g,"\\u2028").replace(/\u2029/g,"\\u2029");
  const executable="const createAPI="+createAPI.toString()+";const mount="+mount.toString()+";const CSS="+JSON.stringify(CSS)+";const BODY="+JSON.stringify(BODY)+";const renderHTML="+renderHTML.toString()+";const api=createAPI();globalThis.PreservationCollectionReview={...api,renderHTML};mount(api,JSON.parse(document.getElementById('collection-working-data').textContent));";
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src data:; connect-src \'none\'; object-src \'none\'; base-uri \'none\'"><title>Collection review working file</title><style>'+CSS+'</style></head><body>'+BODY+'<script id="collection-working-data" type="application/json">'+data+'</script><script>'+executable.replace(/<\/script/gi,"<\\/script")+'</script></body></html>\n';
  if(api.bytes(html)>128*1024*1024)throw new Error("The complete working HTML exceeds 128 MiB. Download complete working JSON instead.");return html;
}
global.PreservationCollectionReview={...api,createAPI,renderHTML};
})(globalThis);

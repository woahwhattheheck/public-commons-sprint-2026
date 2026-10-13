// MIT. The generated document is complete, editable, offline and bound to one saved request.
function recipientRuntime() {
  "use strict";
  const seed = JSON.parse(document.getElementById("review-data").textContent);
  const request = seed.request, root = document.getElementById("review-editor");
  let draft = seed.draft || { respondent: { name: request.recipient.name, organisation: request.recipient.organisation, role: "" },
    overall: "comments", comment: "", items: request.source.items.map(item => ({
      itemId: item.id, sourceSha256: seed.itemHashes[item.id], response: "not_reviewed", comment: ""
    })) }, exported = seed.exported || null, dirty = false;
  const key = "commons.openlineage.review-return:" + request.contentSha256;
  const say = (message, error = false) => { const el = document.getElementById("status"); el.textContent = message; el.className = error ? "error" : ""; };
  const node = (tag, text, parent) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (parent) parent.append(el); return el; };
  const safe = value => value && typeof value === "object" && !Array.isArray(value);
  const only = (value, keys) => safe(value) && Object.keys(value).every(key => keys.includes(key));
  function valid(value) {
    return only(value,["respondent","overall","comment","items"]) && only(value.respondent,["name","organisation","role"]) && ["name","organisation","role"].every(k => typeof value.respondent[k] === "string") &&
      ["comments","acknowledged","changes_requested"].includes(value.overall) && typeof value.comment === "string" &&
      Array.isArray(value.items) && value.items.length === request.source.items.length &&
      value.items.every((r,i) => only(r,["itemId","sourceSha256","response","comment"]) && r.itemId === request.source.items[i].id && r.sourceSha256 === seed.itemHashes[r.itemId] &&
        ["not_reviewed","acknowledged","question","change_requested"].includes(r.response) && typeof r.comment === "string");
  }
  const serial = value => JSON.stringify(value);
  function remember(preserveExported = false) {
    dirty = true; if (!preserveExported) exported = null;
    try { localStorage.setItem(key, serial({ requestSha256: request.contentSha256, draft, exported })); say("Working copy retained in this browser. Download the editable document or JSON before leaving this device."); }
    catch { say("Changes are in this page. Download the editable document or working JSON to retain them."); }
  }
  function field(parent, label, value, change, multiline = false) {
    const row=node("label",undefined,parent);node("span",label,row);
    const input=node(multiline?"textarea":"input",undefined,row); input.value=value;
    if(multiline)input.rows=4; else input.type="text";
    input.addEventListener("input",()=>{change(input.value);remember();});return input;
  }
  function choice(parent,label,value,options,change) {
    const row=node("label",undefined,parent);node("span",label,row);const select=node("select",undefined,row);
    for(const [id,title]of options){const option=node("option",title,select);option.value=id;}
    select.value=value;select.addEventListener("change",()=>{change(select.value);remember();});return select;
  }
  function paint() {
    root.replaceChildren();const facts=node("section",undefined,root);facts.className="facts";
    node("h2","Review details",facts);
    for(const [name,value]of [["Customer",request.source.customer],["Period",request.source.period],["Intended recipient",request.recipient.name],
      ["Organisation",request.recipient.organisation],["Requested by",request.requestedBy],["Instructions",request.instructions],["Scope",request.source.review.preview.document.scope],["Narrative",request.source.review.preview.document.narrative]])
      if(value){const p=node("p",undefined,facts);node("strong",name+": ",p);p.append(document.createTextNode(value));}
    const identity=node("section",undefined,root);node("h2","Your response",identity);
    node("p","Enter your name and role. These fields record your statement; the receiving operator reviews attribution and the complete returned document.",identity);
    const grid=node("div",undefined,identity);grid.className="grid";
    field(grid,"Respondent name",draft.respondent.name,v=>draft.respondent.name=v);
    field(grid,"Organisation",draft.respondent.organisation,v=>draft.respondent.organisation=v);
    field(grid,"Role or reference",draft.respondent.role,v=>draft.respondent.role=v);
    choice(identity,"Overall response",draft.overall,[["comments","Comments for review"],["acknowledged","All items acknowledged"],["changes_requested","Changes requested"]],v=>draft.overall=v);
    field(identity,"Overall comments",draft.comment,v=>draft.comment=v,true);
    const items=node("section",undefined,root);node("h2","Review items ("+request.source.items.length+")",items);
    if(!request.source.items.length)node("p","This edition has no individual items. Use the overall response to comment on its complete source.",items);
    request.source.items.forEach((item,index)=>{
      const article=node("article",undefined,items);node("h3",(index+1)+". "+item.title,article);
      node("p",item.kind+" · "+item.id,article).className="muted";
      const details=node("details",undefined,article);node("summary","Open complete original item",details);
      node("pre",JSON.stringify(item.source,null,2),details);
      choice(article,"Your response",draft.items[index].response,[["not_reviewed","Not yet reviewed"],["acknowledged","Acknowledged"],["question","Question"],["change_requested","Change requested"]],v=>draft.items[index].response=v);
      field(article,"Comment or proposed change",draft.items[index].comment,v=>draft.items[index].comment=v,true);
    });
    const original=node("details",undefined,root);node("summary","Complete saved review edition and source identity",original);
    node("p","Workspace "+request.workspaceId+" · Request "+request.id+" · Source "+request.sourceSha256,original);
    node("pre",JSON.stringify(request.source.review,null,2),original);
  }
  function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));
    const a=document.createElement("a");a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function portableJSON(value) {
    let text=JSON.stringify(value,null,2)+"\n";
    if(new Blob([text]).size>8000000)text=JSON.stringify(value)+"\n";
    if(new Blob([text]).size>8000000)throw Error("This complete JSON exceeds the 8 MB receiving limit. Keep the full editable document; shorten the returned comments or agree a smaller selected review with the operator.");
    return text;
  }
  const identifier=()=>crypto.randomUUID();
  const filename=kind=>"review-"+request.id+"-"+kind;
  function response() {
    if(!valid(draft)||!draft.respondent.name.trim())throw Error("Enter the respondent name and keep all original items.");
    if(draft.items.some(row=>["question","change_requested"].includes(row.response)&&!row.comment.trim()))
      throw Error("Explain each question or requested change.");
    if(draft.overall==="acknowledged"&&draft.items.some(row=>row.response!=="acknowledged"))
      throw Error("Acknowledge every original item before choosing overall acknowledgment.");
    if(draft.overall==="changes_requested"&&!draft.comment.trim()&&!draft.items.some(row=>row.response==="change_requested"))
      throw Error("Explain the requested change.");
    const entered=serial(draft);
    const retained=exported?.value;
    const bound=only(retained,["schema","responseId","workspaceId","requestId","requestSha256","sourceSha256","respondent","respondedAt","overall","comment","items"])&&retained.schema==="commons.openlineage.recipient-review-response.v1"&&
      retained.workspaceId===request.workspaceId&&retained.requestId===request.id&&retained.requestSha256===request.contentSha256&&
      retained.sourceSha256===request.sourceSha256&&typeof retained.responseId==="string"&&retained.responseId.length>0&&
      Number.isFinite(Date.parse(retained.respondedAt))&&
      serial({respondent:retained.respondent,overall:retained.overall,comment:retained.comment,items:retained.items})===entered;
    if(!bound||exported.entered!==entered)exported={entered,value:{
      schema:"commons.openlineage.recipient-review-response.v1",responseId:identifier(),workspaceId:request.workspaceId,
      requestId:request.id,requestSha256:request.contentSha256,sourceSha256:request.sourceSha256,
      respondent:structuredClone(draft.respondent),respondedAt:new Date().toISOString(),overall:draft.overall,
      comment:draft.comment,items:structuredClone(draft.items)}};
    return exported.value;
  }
  document.getElementById("return-json").addEventListener("click",()=>{try{
    download(filename("response.json"),portableJSON(response()),"application/json");
    try{localStorage.setItem(key,serial({requestSha256:request.contentSha256,draft,exported}));}catch{}
    say("Complete response JSON downloaded. Return this file through the agreed channel.");
  }catch(error){say(error.message,true);}});
  document.getElementById("working-json").addEventListener("click",()=>{
    try{
      download(filename("working-copy.json"),portableJSON({schema:"commons.openlineage.review-return-working-copy.v1",
        requestSha256:request.contentSha256,draft,exported}),"application/json");say("Working JSON download requested.");
    }catch(error){say(error.message,true);}});
  document.getElementById("editable-html").addEventListener("click",()=>{
    const copy=document.documentElement.cloneNode(true);
    copy.querySelector("#review-data").textContent=JSON.stringify({...seed,draft,exported}).replace(/</g,"\\u003c");
    copy.querySelector("#review-editor").replaceChildren();
    copy.querySelector("#status").textContent="";
    download(filename("editable.html"),"<!doctype html>\n"+copy.outerHTML,"text/html;charset=utf-8");
    say("Complete editable review download requested with your current entries.");});
  let printedDetails=[], printedAreas=[];
  window.addEventListener("beforeprint",()=>{
    printedDetails=[...document.querySelectorAll("details")].map(el=>[el,el.open]);
    printedDetails.forEach(([el])=>el.open=true);
    printedAreas=[...document.querySelectorAll("textarea")].map(el=>[el,el.style.height]);
    printedAreas.forEach(([el])=>el.style.height=el.scrollHeight+"px");
  });
  window.addEventListener("afterprint",()=>{
    printedDetails.forEach(([el,open])=>el.open=open);printedAreas.forEach(([el,height])=>el.style.height=height);
  });
  document.getElementById("print").addEventListener("click",()=>window.print());
  document.getElementById("import").addEventListener("change",async event=>{
    const file=event.target.files[0];if(!file)return;
    try{
      if(file.size>8000000)throw Error("Choose a working copy under 8 MB.");
      const data=JSON.parse(await file.text());let next,nextExported=null;
      if(data.schema==="commons.openlineage.review-return-working-copy.v1"&&data.requestSha256===request.contentSha256){next=data.draft;nextExported=data.exported||null;}
      else if(only(data,["schema","responseId","workspaceId","requestId","requestSha256","sourceSha256","respondent","respondedAt","overall","comment","items"])&&data.schema==="commons.openlineage.recipient-review-response.v1"&&data.requestId===request.id&&
        data.requestSha256===request.contentSha256&&data.sourceSha256===request.sourceSha256&&data.workspaceId===request.workspaceId)
        { next={respondent:data.respondent,overall:data.overall,comment:data.comment,items:data.items};
          nextExported={entered:serial(next),value:structuredClone(data)}; }
      else throw Error("This file belongs to another original request.");
      if(!valid(next))throw Error("Keep the complete original item identities and responses.");
      if(dirty&&!confirm("Replace the entries currently in this page with the selected complete file?"))return;
      draft=structuredClone(next);exported=structuredClone(nextExported);remember(true);paint();say("Complete selected working copy opened.");
    }catch(error){say(error.message,true);}finally{event.target.value="";}
  });
  document.getElementById("recover").addEventListener("click",()=>{try{
    const old=JSON.parse(localStorage.getItem(key)||"null");
    if(!old||old.requestSha256!==request.contentSha256||!valid(old.draft))throw Error("No complete browser working copy is available for this request.");
    if(dirty&&!confirm("Replace the current entries with this browser’s retained working copy?"))return;
    draft=old.draft;exported=old.exported||null;paint();dirty=true;say("Browser working copy restored; review its entries before returning.");
  }catch(error){say(error.message,true);}});
  window.addEventListener("beforeunload",event=>{if(dirty){event.preventDefault();event.returnValue="";}});
  if(!valid(draft)){draft={respondent:{name:request.recipient.name,organisation:request.recipient.organisation,role:""},
    overall:"comments",comment:"",items:request.source.items.map(item=>({itemId:item.id,sourceSha256:seed.itemHashes[item.id],response:"not_reviewed",comment:""}))};
    say("The embedded working copy was incomplete. The exact original review is open.",true);}
  paint();
}
export const RECIPIENT_RUNTIME = "(" + recipientRuntime.toString() + ")();";
export const RECIPIENT_STYLE = `
:root{font-family:system-ui,-apple-system,sans-serif;color:#191919;background:#f3f3f3;line-height:1.5}*{box-sizing:border-box}
body{margin:0}main{max-width:1060px;margin:auto;padding:32px 24px 72px}h1{font-size:28px;line-height:1.25;margin:0 0 12px}h2{font-size:21px}h3{font-size:17px}
section,article,details{background:white;border:1px solid #c8c8c8;border-radius:4px;margin:20px 0;padding:20px}article{background:#fafafa}
details details,article details{padding:12px}summary{cursor:pointer;font-weight:600}p{white-space:pre-wrap;overflow-wrap:anywhere}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;max-height:500px;overflow:auto;background:#f5f5f5;padding:12px}
label{display:block;margin:14px 0}label>span{display:block;font-weight:600;margin-bottom:6px}input,textarea,select{font:inherit;width:100%;padding:10px;border:1px solid #888;border-radius:3px;background:#fff;color:#191919}
textarea{resize:vertical}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0}
button,.file-label{font:inherit;border:1px solid #555;background:#fff;border-radius:3px;padding:10px 14px;cursor:pointer}
button.primary{background:#242424;color:white}.file-label{margin:0}.file-label input{position:absolute;width:1px;height:1px;opacity:0}
button:focus-visible,summary:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible,.file-label:focus-within{outline:3px solid #555;outline-offset:3px}
.muted{color:#555;font-size:13px}#status{min-height:2em;white-space:pre-wrap}#status.error{font-weight:700}.notice{border-left:4px solid #777;padding-left:12px}
@media(max-width:600px){main{padding:20px 12px 40px}.grid{grid-template-columns:1fr;gap:0}section,article,details{padding:14px}h1{font-size:24px}.toolbar>*{flex:1 1 100%}}
@media print{body{background:#fff}main{max-width:none;padding:0}.toolbar,.notice,#status{display:none}section,article,details{border-color:#aaa;break-inside:avoid}input,textarea,select{border:0;padding:0}textarea{min-height:90px}details pre{max-height:none}details{display:block}}
`;

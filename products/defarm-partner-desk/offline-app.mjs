export function startRecipient({core,rows,hash,buildOffline,bank,initial={}}) {
  const $=s=>document.querySelector(s),E=core.escape,records=new Map();
  let current=null,read=0,rowReader=null,tab="overview";
  const status=text=>{$("#recipient-status").textContent=text;};
  const json=x=>"<pre>"+E(JSON.stringify(x,null,2))+"</pre>";
  function download(name,text,type="application/json"){
    const url=URL.createObjectURL(new Blob([text],{type})),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function checkedReview(review,identity) {
    if(review==null)return {schema:"tjlabs.defarm.recipient-notes/1",package_sha256:identity,reviewer:"",note:"",reading:null};
    if(review.schema!=="tjlabs.defarm.recipient-notes/1"||review.package_sha256!==identity||typeof review.reviewer!=="string"||typeof review.note!=="string"||review.reviewer.length>240||review.note.length>20000)throw new Error("Recipient review does not match this original package");
    return {schema:review.schema,package_sha256:identity,reviewer:review.reviewer,note:review.note,reading:review.reading==null?null:rows.sourceState(review.reading)};
  }
  function receiveText(text,carriedReview=null) {
    if(core.bytes(text)>80*1024*1024)throw new Error("Original package exceeds the 80 MiB receiving limit");
    let pkg=JSON.parse(text.replace(/^\uFEFF/,"")),packageText=text,review=carriedReview;
    if(pkg.schema==="tjlabs.defarm.recipient-package/1"){
      if(typeof pkg.original_package_text!=="string")throw new Error("Recipient package needs its complete original");
      packageText=pkg.original_package_text;review=pkg.review;pkg=JSON.parse(packageText.replace(/^\uFEFF/,""));
    }
    const c=core.importCase(pkg,hash),identity=hash(packageText),notes=checkedReview(review,identity);
    const key=identity+(review?":"+hash(JSON.stringify(notes)):"");
    let record=records.get(key);
    if(!record){record={key,packageText,pkg,c,notes,tab:"overview"};records.set(key,record);}
    current=record;tab=record.tab;render();catalogue();
    status("Original package verified. "+c.source_rows.length+" source rows and "+c.events.length+" operations retained.");
    return record;
  }
  function catalogue(){
    $("#recipient-cases").innerHTML=[...records.values()].map(r=>'<option value="'+E(r.key)+'" '+(r===current?"selected":"")+'>'+E(r.c.title)+" · "+E(r.c.state)+" · "+r.key.slice(0,10)+(r.key.includes(":")?" · separate review "+r.key.slice(-6):"")+'</option>').join("");
  }
  function reviewPackage(r){return {schema:"tjlabs.defarm.recipient-package/1",original_package_text:r.packageText,review:JSON.parse(JSON.stringify(r.notes))};}
  function render(){
    rowReader?.destroy();rowReader=null;if(!current)return;const r=current,c=r.c;
    $("#recipient-detail").innerHTML='<h1>'+E(c.title)+'</h1><p><span class="badge">'+E(c.state)+'</span> · '+c.items.length+' original items · '+core.returnedDfids(c).length+' returned DFIDs</p><p class="identity">Case '+c.id+'<br>Exact received package SHA256 '+hash(r.packageText)+'<br>Original source '+E(c.source.name)+' · '+c.source.bytes+' bytes · '+c.source.sha256+'<br>Selected request '+c.payload.sha256+'</p><p class="notice">This is the original operator-authored case. Its exact state, including incomplete or uncertain ingestion, remains unchanged. Only explicit original gateway references associate returned DFIDs with input rows. The reader makes no gateway calls.</p><div class="actions">'+[["package","Exact original package"],["source","Original source file"],["request","Selected request"],["rows","All source rows"],["report","Complete HTML report"],["review","Recipient review JSON"],["offline","Populated offline HTML"],["code","Recipient source"]].map(([id,label])=>'<button data-recipient-action="'+id+'">'+label+'</button>').join("")+'</div><div class="tabs" role="tablist">'+[["overview","Original gateway review"],["source","All source rows"],["history","Complete history"],["verification","Returned DFIDs"],["notes","Recipient notes"]].map(([id,label])=>'<button role="tab" aria-selected="'+(id===tab)+'" data-recipient-tab="'+id+'">'+label+'</button>').join("")+'</div><div id="recipient-panel"></div>';
    const panel=$("#recipient-panel");
    if(tab==="source"){
      panel.innerHTML='<h2>Every original source row and selected item</h2><div id="recipient-rows"></div>';
      rowReader=rows.mountSourceReader($("#recipient-rows"),c,{key:r.key,initial:r.notes.reading??undefined,onState:value=>{r.notes.reading=value;},download});
    }else if(tab==="history"){
      panel.innerHTML='<h2>Complete original operations</h2>'+c.events.map(e=>'<details><summary>'+E(e.kind)+" · "+E(e.status)+" · "+E(e.started_at)+'</summary>'+json(e)+'</details>').join("")+(!c.events.length?"<p>No original gateway operations are recorded.</p>":"");
    }else if(tab==="verification"){
      panel.innerHTML='<h2>Original returned identifiers and reads</h2><p>These identifiers are retained independently of row order. SDK convenience findings are distinct from the raw original verifier response.</p>'+json(core.returnedDfids(c))+c.verifications.map(v=>'<details><summary>'+E(v.dfid)+" · "+E(v.read_at)+'</summary>'+json(v)+'</details>').join("");
    }else if(tab==="notes"){
      panel.innerHTML='<h2>Original operating notes</h2>'+json(c.notes)+'<div class="recipient-review"><h2>Separate recipient review</h2><p>These annotations do not change the original source, case, operation state or revision. Download Recipient review JSON or Populated offline HTML to retain them. Opening another case keeps this working review in the case selector.</p><label>Reviewer<input id="recipient-reviewer" maxlength="240" value="'+E(r.notes.reviewer)+'"></label><label>Review note<textarea id="recipient-note" maxlength="20000">'+E(r.notes.note)+'</textarea></label></div>';
    }else{
      const last=[...c.events].reverse().find(e=>e.assessment);
      panel.innerHTML='<h2>Original source and gateway review</h2><p>Gateway '+E(c.identity.gateway)+' · SDK '+E(c.identity.sdk.name+"@"+c.identity.sdk.version)+'</p><h3>Original mapping</h3>'+json(c.mapping)+'<h3>Latest retained assessment</h3>'+json(last?.assessment??{message:"No original assessment is recorded"})+'<p>Full original response bodies are available in Complete history and the original package. A preview-ready state belongs to its original operator/key; this offline recipient cannot ingest it.</p>';
    }
  }
  $("#recipient-file").onchange=async e=>{
    const file=e.target.files[0],ticket=++read;if(!file){status("Choose a complete original case or recipient review.");return;}
    status("Reading and verifying "+file.name+"…");
    try{
      if(file.size>80*1024*1024)throw new Error("File exceeds the 80 MiB receiving limit");
      const data=await file.arrayBuffer();
      if(ticket!==read||$("#recipient-file").files[0]!==file)return;
      const text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(data);
      receiveText(text);
    }catch(error){if(ticket===read)status(error.message+" The current case is retained.");}
  };
  $("#recipient-cases").onchange=e=>{
    ++read;const r=records.get(e.target.value);if(!r)return;current=r;tab=r.tab;render();status("Reopened the retained original case and its separate review.");
  };
  $("#recipient-detail").oninput=e=>{
    if(!current)return;
    if(e.target.id==="recipient-note")current.notes.note=e.target.value;
    if(e.target.id==="recipient-reviewer")current.notes.reviewer=e.target.value;
  };
  $("#recipient-detail").onclick=e=>{
    const b=e.target.closest("button");if(!b||!current)return;
    if(b.dataset.recipientTab){tab=b.dataset.recipientTab;current.tab=tab;render();return;}
    const action=b.dataset.recipientAction;if(!action)return;const r=current,c=r.c;
    try{
      if(action==="package")download(c.id+"-original-case.json",r.packageText);
      if(action==="source")download(c.source.name,c.source.text,c.source.format==="csv"?"text/csv":"application/json");
      if(action==="request")download(c.id+"-request.json",c.payload.text);
      if(action==="rows")download(c.id+"-all-rows.csv",rows.sourceCSV(c),"text/csv");
      if(action==="report")download(c.id+"-report.html",core.report(c),"text/html");
      if(action==="review")download(c.id+"-recipient-review.json",JSON.stringify(reviewPackage(r),null,2)+"\n");
      if(action==="offline")download(c.id+"-recipient.html",buildOffline(bank,r.packageText,r.notes),"text/html");
      if(action==="code")download("defarm-recipient-source.json",JSON.stringify({schema:"tjlabs.defarm.recipient-source/1",files:Object.entries(bank).map(([path,content])=>({path,content,bytes:core.bytes(content),sha256:hash(content)}))},null,2)+"\n");
    }catch(error){status(error.message);}
  };
  try{if(initial.packageText!=null)receiveText(initial.packageText,initial.review);}catch(error){status("Could not open the embedded original: "+error.message);}
  return {receiveText,current:()=>current,records,render};
}

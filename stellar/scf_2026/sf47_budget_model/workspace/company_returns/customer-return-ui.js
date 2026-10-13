/* Company-scoped Installation observations; standalone and network-free. */
(() => {
  "use strict";
  const seed = JSON.parse(document.getElementById("return-seed").textContent);
  const root = document.getElementById("checks"), status = document.getElementById("status");
  const fields = ["name", "recipient", "environment", "note"];
  const states = ["OPEN", "IN_PROGRESS", "ACCEPTED", "CHANGES_REQUIRED", "NOT_APPLICABLE"];
  const observations = ["state","operator","observedAt","note","sourceIds","workIds","purchaseIds","outcomeIds"];
  const clone = v => JSON.parse(JSON.stringify(v));
  const stable = v => v === null || typeof v !== "object" ? JSON.stringify(v) :
    Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" :
      "{" + Object.keys(v).sort().map(k => JSON.stringify(k)+":"+stable(v[k])).join(",") + "}";
  const uuid = () => {
    const a = new Uint8Array(16); crypto.getRandomValues(a); a[6] = a[6] & 15 | 64; a[8] = a[8] & 63 | 128;
    const s = Array.from(a,v=>v.toString(16).padStart(2,"0")).join("");
    return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join("-");
  };
  const key = "scf-company-return-v1:"+seed.report_sha256+":"+seed.return_seed.return_id;
  let value, available = true, savedAt = null, editGeneration = 0, importGeneration = 0;
  function note(text, error=false) {status.textContent=text;status.className=error?"error":"note";status.setAttribute("role",error?"alert":"status");}
  function fresh() {return clone(seed.return_seed);}
  function validate(v, complete) {
    if (!v || typeof v!=="object" || Array.isArray(v) ||
      stable(Object.keys(v).sort())!==stable(["schema","report_sha256","binding","return_id","previous_return_sha256","inputs"].sort()) ||
      v.schema!==seed.schema || v.report_sha256!==seed.report_sha256 || stable(v.binding)!==stable(seed.binding))
      throw Error("This draft belongs to a different original company report.");
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v.return_id))
      throw Error("Retain the original return ID.");
    if (v.previous_return_sha256!==null && !/^[a-f0-9]{64}$/.test(v.previous_return_sha256))
      throw Error("Retain the previous return file's full SHA-256.");
    const i=v.inputs, original=seed.inputs;
    if (!i || stable(Object.keys(i).sort())!==stable(Object.keys(original).sort()) ||
        ["installationId","revision","sha256"].some(k=>i[k]!==original[k]))
      throw Error("The original saved Installation selection changed.");
    for (const [k,max] of [["name",300],["recipient",500],["environment",8000],["note",12000]]) {
      if (typeof i[k]!=="string" || i[k].length>max || (complete&&!i[k].trim()))
        throw Error("Complete "+k+" within "+max+" characters.");
    }
    if (!Array.isArray(i.observations)||i.observations.length!==original.observations.length) throw Error("Keep every original check.");
    const expected=new Map(original.observations.map(r=>[r.id,r])), seen=new Set();
    for (const row of i.observations) {
      if (!row || !expected.has(row.id)||seen.has(row.id) ||
          stable(Object.keys(row).sort())!==stable(["id",...observations].sort())) throw Error("Keep each original check exactly once.");
      seen.add(row.id);
      if (!states.includes(row.state) || typeof row.operator!=="string" || row.operator.length>500 ||
          typeof row.note!=="string" || row.note.length>8000) throw Error("Check "+row.id+" has an invalid observation.");
      if (row.observedAt!==null && (typeof row.observedAt!=="string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(row.observedAt) || !Number.isFinite(Date.parse(row.observedAt))))
        throw Error("Use an ISO timestamp with a timezone for "+row.id+".");
      for (const k of ["sourceIds","workIds","purchaseIds","outcomeIds"])
        if (stable(row[k])!==stable(expected.get(row.id)[k])) throw Error("Original record links remain selected by the native operator.");
      if (complete && row.state==="ACCEPTED" && (!row.operator.trim()||!row.observedAt||!row.note.trim()))
        throw Error("Accepted check "+row.id+" needs its actual operator, observed time and note.");
      if (complete && row.state==="NOT_APPLICABLE" && !row.note.trim()) throw Error("Explain why "+row.id+" is not applicable.");
    }
  }
  function persist() {
    editGeneration += 1;
    try {validate(value,false);localStorage.setItem(key,JSON.stringify(value));savedAt=new Date().toISOString();
      note("Draft saved in this browser at "+savedAt+". Download the draft to move it or retain another edition.");
    } catch(e) {available=false;note("Browser draft storage is unavailable: "+e.message+". Download the full draft before closing.",true);}
  }
  function element(tag,text,attrs={}) {
    const el=document.createElement(tag);if(text!==null)el.textContent=text;
    for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;
  }
  function render() {
    document.getElementById("return-id").textContent=value.return_id;
    document.getElementById("previous").textContent=value.previous_return_sha256 || "First proposed return";
    fields.forEach(k=>{document.getElementById(k).value=value.inputs[k];});
    root.replaceChildren();
    const definitions=new Map(seed.checks.map(r=>[r.id,r]));
    value.inputs.observations.forEach((row,index)=>{
      const def=definitions.get(row.id), section=element("section",null,{class:"check","data-check":row.id});
      section.append(element("h2",(index+1)+". "+def.title),element("p",def.criterion || "No additional criterion recorded."),
        element("p",row.id+" · "+(def.required?"Required":"Optional")+" · Tranche "+(def.tranche??"not selected"),{class:"muted"}));
      const select=element("select",null,{id:"state-"+index});
      states.forEach(s=>{const opt=element("option",s.replaceAll("_"," "),{value:s});select.append(opt);});
      select.value=row.state;select.addEventListener("change",()=>{row.state=select.value;persist();summary();});
      const label=element("label","Proposed observation state",{for:"state-"+index});label.append(select);section.append(label);
      [["operator","Named observer","input",500],["observedAt","Actual observed time (ISO 8601 with timezone)","input",100],
       ["note","Complete observation and supporting explanation","textarea",8000]].forEach(([k,title,tag,max])=>{
        const lab=element("label",title,{for:k+"-"+index}), input=element(tag,null,{id:k+"-"+index,maxlength:String(max)});
        input.value=row[k]??"";input.addEventListener("input",()=>{row[k]=k==="observedAt"?(input.value.trim()||null):input.value;persist();summary();});
        lab.append(input);section.append(lab);
        if(k==="observedAt") {const now=element("button","Use current observation time",{type:"button",class:"small"});
          now.addEventListener("click",()=>{row.observedAt=new Date().toISOString();input.value=row.observedAt;persist();});section.append(now);}
      });
      const details=element("details"), title=element("summary","Original saved observation and record links");
      details.append(title,element("pre",JSON.stringify(seed.inputs.observations.find(r=>r.id===row.id),null,2)));section.append(details);
      root.append(section);
    });
    summary();
  }
  function summary() {
    const changed=value.inputs.observations.filter(row=>stable(row)!==stable(seed.inputs.observations.find(r=>r.id===row.id)));
    document.getElementById("summary").textContent=value.inputs.observations.length+" original checks · "+changed.length+
      " proposed observation changes. The owner reviews these changes before saving a native Installation revision.";
  }
  function download(raw,name,type="application/json") {
    const url=URL.createObjectURL(new Blob([raw],{type})),a=element("a",name,{href:url,download:name});
    document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
  fields.forEach(k=>document.getElementById(k).addEventListener("input",event=>{value.inputs[k]=event.target.value;persist();}));
  document.getElementById("download-draft").addEventListener("click",()=>{try{validate(value,false);download(JSON.stringify(value,null,2)+"\n","Installation_Return_"+value.return_id+".draft.json");}catch(e){note(e.message,true);}});
  document.getElementById("download-return").addEventListener("click",()=>{try{validate(value,true);download(JSON.stringify(value,null,2)+"\n","Installation_Return_"+value.return_id+".json");persist();note("Complete proposed return downloaded. Send it with the original company report through your agreed channel.");}catch(e){note(e.message,true);}});
  async function importFile(file,corrected) {
    if(!file)return;if(file.size>8*1024*1024)throw Error("The return file is too large.");
    const generation=++importGeneration, originalEdits=editGeneration;
    const raw=await file.arrayBuffer();
    if(generation!==importGeneration)return;
    const parsed=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));validate(parsed,false);
    if(corrected) {
      validate(parsed,true);
      const digest=await crypto.subtle.digest("SHA-256",raw);
      parsed.previous_return_sha256=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
      parsed.return_id=uuid();
    }
    if(generation!==importGeneration)return;
    if(originalEdits!==editGeneration)throw Error("Your current draft changed while this file was being read. It remains intact. Reopen the file explicitly when ready.");
    value=parsed;persist();render();
    if(corrected)note("Corrected edition opened with a new return ID and the exact prior file SHA-256. The earlier file remains a separate original return.");
  }
  for(const [id,corrected] of [["import-draft",false],["correct-return",true]])document.getElementById(id).addEventListener("change",e=>{
    importFile(e.target.files[0],corrected).catch(error=>note(error.message,true)).finally(()=>{e.target.value="";});
  });
  document.getElementById("download-original").addEventListener("click",()=>{
    const bin=atob(seed.report_base64),parts=[];
    for(let i=0;i<bin.length;i+=65536)parts.push(Uint8Array.from(bin.slice(i,i+65536),c=>c.charCodeAt(0)));
    download(new Blob(parts),"Original_Company_Report.zip","application/zip");
  });
  document.getElementById("original-document").textContent=JSON.stringify(seed.document,null,2);
  try {const old=localStorage.getItem(key);value=old?JSON.parse(old):fresh();validate(value,false);
    note(old?"Original browser draft reopened. Keep its return ID for the same proposed return.":"Complete original report opened. Fill the actual receiving details and every check.");}
  catch(e){value=fresh();available=false;note("Stored draft was not used: "+e.message+". The original report is intact; import your retained draft file.",true);}
  render();
  globalThis.scfCompanyReturn={snapshot:()=>clone(value),validate:()=>{validate(value,true);return true;},
    selection:()=>({report_sha256:seed.report_sha256,binding:clone(seed.binding)}),flush:()=>{persist();return {available,savedAt};}};
})();

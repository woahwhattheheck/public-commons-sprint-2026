// MIT. APM2 reading-edition maintainer. Uses the original document layout; no PDF or capacity engine.
export function createDocumentMaintainer({sha256,utf8Encode,checkWorkshareConsistency}) {
 if(typeof sha256!=="function"||typeof utf8Encode!=="function"||typeof checkWorkshareConsistency!=="function")throw Error("Provide the maintained digest, UTF-8 encoder and workshare consistency checker");
 const names=["APM2_Response_Engineering_Binder.md","APM2_Response_Engineering_Binder.html","APM2_Partner_Workshare_Offer.md","APM2_Partner_Workshare_Offer.html","APM2_Response_Review_Register.csv","APM2_Response_Content.json","APM2_Original_Notice.json","APM2_Original_Notice.csv","APM2_Source_Index.json","APM2_Workshare.json","READ_ME.md","index.html"];
 const stems={binder:"APM2_Response_Engineering_Binder",offer:"APM2_Partner_Workshare_Offer"};
 const fail=m=>{throw Error("APM2 documents: "+m);},copy=x=>JSON.parse(JSON.stringify(x));
 const descriptor=(path,content)=>({path,bytes:typeof content==="string"?utf8Encode(content).length:content.length,sha256:sha256(content)});
 const e=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
 const ascii=x=>String(x).replace(/\u2014|\u2013/g,"-"),inline=x=>e(x).replace(/\*\*([^*\n]+)\*\*/g,"<strong>$1</strong>");
 const p=text=>({type:"p",text}),h=(level,text)=>({type:"h",level,text}),list=items=>({type:"list",items}),table=(headers,rows)=>({type:"table",headers,rows});
 const j=(text,label)=>{if(typeof text!=="string")fail("missing "+label);try{return JSON.parse(text);}catch{fail("invalid JSON "+label);}};
 const str=(v,label)=>{if(typeof v!=="string")fail(label+" must be text");return v;};
 function csv(text) {
  const out=[];let row=[],cell="",quoted=false,closed=false;
  for(let i=0;i<text.length;i++){const ch=text[i];
   if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(ch==='"'){quoted=false;closed=true;}else cell+=ch;}
   else if(ch==='"'){if(cell||closed)fail("invalid CSV quote");quoted=true;}
   else if(ch===","){row.push(cell);cell="";closed=false;}
   else if(ch==="\r"||ch==="\n"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);out.push(row);row=[];cell="";closed=false;}
   else{if(closed)fail("text after CSV quote");cell+=ch;}
  }if(quoted)fail("unclosed CSV quote");if(cell||row.length||closed){row.push(cell);out.push(row);}return out;
 }
 function safeURL(v){if(typeof v!=="string"||!/^https?:\/\/[^\s<>"']+$/.test(v))fail("source link must be HTTP(S)");return v;}
 function validateBaseline(b){
  if(b?.schema!=="tjlabs.apm2.document-maintainer-baseline.v1"||!Array.isArray(b.manifest))fail("choose the complete document baseline");
  if(b.manifest.length!==names.length||new Set(b.manifest.map(m=>m.path)).size!==names.length||b.manifest.some(m=>!names.includes(m.path)))fail("baseline inventory must identify exactly twelve members");
  for(const m of b.manifest){const d=descriptor(m.path,b.files[m.path]);if(d.bytes!==m.bytes||d.sha256!==m.sha256)fail("baseline body changed: "+m.path);}
  if(names.some(n=>typeof b.files[n]!=="string"))fail("baseline must retain all twelve original members");
  if(!b.blocks?.binder||!b.blocks?.offer)fail("baseline reading layout missing");
  for(const kind of Object.keys(stems))if(markdown(b.blocks[kind])!==b.files[stems[kind]+".md"])fail("baseline layout differs from original Markdown: "+kind);
  if(!Array.isArray(b.capacity)||b.capacity.length!==5||new Set(b.capacity.map(f=>f.path)).size!==5)fail("retain the five original capacity assets");
  for(const f of b.capacity){if(!["index.html","planner.css","model.js","planner.js","GUIDE.md"].includes(f.path))fail("unexpected capacity path");const d=descriptor(f.path,f.content);if(d.bytes!==f.bytes||d.sha256!==f.sha256)fail("capacity asset changed: "+f.path);}
  if(b.capacityCurrent!==undefined){
   if(!Array.isArray(b.capacityCurrent)||b.capacityCurrent.length!==5||new Set(b.capacityCurrent.map(f=>f.path)).size!==5)fail("complete current capacity asset selection required");
   for(const f of b.capacityCurrent){const original=b.capacity.find(x=>x.path===f.path);if(!original)fail("unknown current capacity path");const d=descriptor(f.path,f.content);if(d.bytes!==f.bytes||d.sha256!==f.sha256)fail("current capacity asset changed: "+f.path);if(f.path!=="planner.js"&&f.content!==original.content)fail("this navigation successor preserves the original capacity model and other assets");}
   if(!b.capacityProvenance||typeof b.capacityProvenance.reason!=="string")fail("retain the selected capacity successor provenance");
  }
 }
 function validateInputs(b,files){
  for(const n of names)str(files[n],n);
  for(const n of ["APM2_Original_Notice.json","APM2_Original_Notice.csv"])if(files[n]!==b.files[n])fail("retain original notice unchanged: "+n);
  const content=j(files["APM2_Response_Content.json"],"response content"),work=j(files["APM2_Workshare.json"],"workshare"),original=j(files["APM2_Original_Notice.json"],"notice"),source=j(files["APM2_Source_Index.json"],"source index");
  if(content.reference!==b.reference||content.solicitation!==b.solicitation||work.reference!==b.reference||work.solicitation!==b.solicitation)fail("original solicitation/reference changed");
  const oldSource=j(b.files["APM2_Source_Index.json"],"baseline source index");
  for(const key of ["originalCapture","dictionary","csvRecordIndex","sourceModelRowNumber"])if(JSON.stringify(source[key])!==JSON.stringify(oldSource[key]))fail("capture/dictionary identity changed: "+key);
  const nr=csv(files["APM2_Original_Notice.csv"]);if(nr.length!==2||nr[0].length!==67||nr[1].length!==67||nr[0].some((key,i)=>original.values[key]!==nr[1][i]))fail("original notice CSV/JSON disagree");
  const register=csv(files["APM2_Response_Review_Register.csv"]),headers=csv(b.files["APM2_Response_Review_Register.csv"])[0];
  if(JSON.stringify(register[0])!==JSON.stringify(headers)||register.slice(1).some(r=>r.length!==headers.length))fail("preserve complete review-register columns");
  if(!Array.isArray(content.responses)||!content.responses.length||content.responses.length>200||!Array.isArray(content.annexes)||!Array.isArray(content.sources))fail("complete response/annex/source collections required");
  const ids=new Set(),sourceIds=new Set(content.sources.map(s=>s.id));if(sourceIds.size!==content.sources.length)fail("duplicate source ID");
  for(const r of content.responses){if(ids.has(r.id))fail("duplicate response ID");ids.add(r.id);for(const k of ["id","title","draft","deliverable","acceptance"])str(r[k],"response."+k);if(!Array.isArray(r.inputs)||!Array.isArray(r.sources))fail("response inputs/sources missing");r.inputs.forEach(x=>str(x,"response input"));r.sources.forEach(x=>{if(!sourceIds.has(x))fail("unknown response source "+x);});if(r.proposedPilotAcceptance!==undefined)str(r.proposedPilotAcceptance,"pilot acceptance");}
  const ri=new Set(register.slice(1).map(r=>r[0]));if(ri.size!==register.length-1||ri.size!==ids.size||[...ids].some(x=>!ri.has(x)))fail("review register must contain every response ID once");
  for(const s of content.sources){for(const k of ["id","title","url","reviewed","kind","summary"])str(s[k],"source."+k);safeURL(s.url);}
  for(const a of content.annexes){str(a.title,"annex title");if(!Array.isArray(a.sections))fail("annex sections missing");for(const s of a.sections){str(s.title,"section title");str(s.text,"section text");}}
  str(content.workshareScope,"workshare scope");if(!/^[A-Z]{3}$/.test(work.currency))fail("currency must be three uppercase letters");
  for(const k of ["fee","productionHours","workingDays","partnerHours"])if(!Number.isFinite(work[k])||work[k]<0)fail("workshare "+k+" needs explicit nonnegative number");
  if(!Array.isArray(work.milestones)||!Array.isArray(work.deliverables)||!Array.isArray(work.acceptance))fail("workshare collections missing");
  for(const row of work.milestones)if(!Array.isArray(row)||row.length!==4||row.some(x=>typeof x!=="string"))fail("milestone needs four text columns");
  for(const row of work.deliverables)if(!Array.isArray(row)||row.length!==2||row.some(x=>typeof x!=="string"))fail("deliverable needs two text columns");
  work.acceptance.forEach(x=>str(x,"workshare acceptance"));
  const amounts=work.milestones.map(r=>r[1].replace(/,/g,""));if(amounts.some(x=>!/^\d+(?:\.\d{1,2})?$/.test(x)))fail("milestone amount must be decimal currency");
  const cents=x=>{const [a,z=""]=String(x).split(".");return BigInt(a)*100n+BigInt((z+"00").slice(0,2));};
  if(!/^\d+(?:\.\d{1,2})?$/.test(String(work.fee))||amounts.reduce((s,x)=>s+cents(x),0n)!==cents(work.fee))fail("milestone amounts must equal fee");
  if(typeof checkWorkshareConsistency==="function"){const findings=checkWorkshareConsistency({content,workshare:work});if(findings?.length)fail("workshare consistency: "+findings.map(x=>typeof x==="string"?x:JSON.stringify(x)).join("; "));}
  const old=j(b.files["APM2_Workshare.json"],"baseline workshare");
  if(["fee","currency","productionHours","workingDays","partnerHours"].some(k=>work[k]!==old[k])&&content.workshareScope===j(b.files["APM2_Response_Content.json"],"baseline content").workshareScope)fail("revise authored scope when fee/hours/calendar change");
  const allocation=work.reviewAllocation||b.blocks.binder[29].rows;
  if(!Array.isArray(allocation)||allocation.some(r=>!Array.isArray(r)||r.length!==2||!Number.isFinite(Number(r[1]))||Number(r[1])<0)||allocation.reduce((s,r)=>s+Number(r[1]),0)!==work.partnerHours)fail("reviewAllocation must sum to partnerHours");
  return {content,work,register,allocation,source};
 }
 const money=w=>w.currency+" "+String(w.fee).replace(/\B(?=(\d{3})+(?!\d))/g,",");
 function structuredBlocks(b,v){
  const {content:c,work:w,register,allocation}=v,bb=copy(b.blocks.binder.slice(0,34)),ob=copy(b.blocks.offer);
  bb[4].text="This editable binder brings the retained notice, "+c.responses.length+" drafted engineering responses, "+c.annexes.length+" complete annexes, supporting sources and the proposed delivery workshare into one reviewable package.";
  bb[5].rows=[["Engineering fee",money(w)],["Production",w.productionHours+" hours across "+w.workingDays+" working days"],["Partner review",w.partnerHours+" hours"],["Source buying stage","Request for Information"]];
  bb[8].items[1]="Review the "+c.responses.length+" coverage topics against the original RFI and its amendments. Enter its actual question/section identifiers in APM2_Response_Review_Register.csv.";
  bb[8].items[2]="Use the "+c.annexes.length+" annexes to complete the selected architecture, operating boundaries and evidence inputs.";
  bb[18].text=bb[18].text.replace("The twelve topics below","The "+c.responses.length+" topics below");
  bb[30].text="Production deployment, configuration changes and remediation are separately selected and agreed work. The proposed pilot criteria in Section 3 describe the solution the supplier may put forward; the response-engineering acceptance above governs this "+money(w)+" package.";
  bb[6].text=bb[20].text=c.workshareScope;bb[21].rows=copy(w.deliverables);bb[23].items=copy(w.acceptance);bb[26].headers[1]=w.currency;bb[26].rows=copy(w.milestones);bb[29].rows=copy(allocation);
  for(let i=0;i<c.responses.length;i++){const r=c.responses[i];bb.push(h(2,(i+1)+". "+r.title),p(r.draft),h(3,"Required inputs"),list(r.inputs),h(3,"Response-engineering deliverable"),p(r.deliverable),h(3,"Response-engineering acceptance"),p(r.acceptance));if(r.proposedPilotAcceptance)bb.push(h(3,"Proposed platform / pilot acceptance"),p(r.proposedPilotAcceptance));bb.push(p("Evidence references: "+(r.sources.join(", ")||"Original issuer attachment and source notice.")));}
  bb.push({type:"break"},h(1,"4. Complete engineering annexes"));
  for(let i=0;i<c.annexes.length;i++){const a=c.annexes[i];if(i)bb.push({type:"break"});bb.push(h(1,"Annex "+String.fromCharCode(65+i)+". "+ascii(a.title)));for(const s of a.sections)bb.push(h(2,ascii(s.title)),p(s.text));}
  bb.push({type:"break"},h(1,"5. Primary-source index"),copy(b.blocks.binder[203]));
  for(const s of c.sources)bb.push(h(2,s.id+". "+ascii(s.title)),p(s.summary),{type:"link",text:s.url,url:s.url},p("Source review: "+s.reviewed+" | "+s.kind));
  bb.push(...copy(b.blocks.binder.slice(228)),h(1,"7. Recorded review decisions"));
  for(const r of register.slice(1))bb.push(h(2,r[0]+" — "+r[1]),table(["Review field","Retained value"],register[0].slice(2).map((key,i)=>[key,r[i+2]||"Not entered"])));
  ob[4].rows=[[money(w),w.productionHours+" hours / "+w.workingDays+" working days",w.partnerHours+" hours"]];
  ob[9].rows=copy(w.deliverables);ob[10].text="**Working scope.** "+c.workshareScope;ob[13].items=copy(w.acceptance);ob[15].headers[1]=w.currency;ob[15].rows=w.milestones.map(r=>r.slice(0,3));
  ob[16].text="The milestone amounts total "+money(w)+". Dates are the original proposed baseline and are confirmed from agreed source inputs and reviewer availability. Product licensing and later implementation remain separate.";
  ob[18].items[2]="Review allocation: "+allocation.map(r=>r[0]+" ("+r[1]+" hours)").join("; ")+".";
  ob[20].text="The accompanying binder contains "+c.responses.length+" drafted responses, "+c.annexes.length+" complete annexes, primary-source notes and the editable review register. Open capacity/index.html for the original planner and retain its complete selected JSON and report.";
  return {binder:bb,offer:ob};
 }
 function markdown(blocks){return blocks.map(b=>{if(b.type==="h")return"#".repeat(b.level)+" "+b.text;if(b.type==="p")return b.text;if(b.type==="list")return b.items.map(x=>"- "+x).join("\n");if(b.type==="link")return"["+b.text+"]("+b.url+")";if(b.type==="table")return"| "+b.headers.join(" | ")+" |\n| "+b.headers.map(()=>"---").join(" | ")+" |\n"+b.rows.map(r=>"| "+r.map(x=>String(x??"").replace(/\|/g,"\\|").replace(/\n/g," ")).join(" | ")+" |").join("\n");return"---";}).join("\n\n")+"\n";}
 function parseMarkdown(text){
  const lines=text.replace(/\r\n/g,"\n").split("\n"),out=[];let i=0;
  const cells=l=>l.trim().replace(/^\|/,"").replace(/\|$/,"").split(/(?<!\\)\|/).map(x=>x.trim().replace(/\\\|/g,"|"));
  while(i<lines.length){let l=lines[i];if(!l.trim()){i++;continue;}const m=l.match(/^(#{1,6}) (.*)$/);
   if(m){out.push(h(m[1].length,m[2]));i++;continue;}if(/^---\s*$/.test(l)){out.push({type:"break"});i++;continue;}
   if(l.startsWith("|")&&/^\|?[\s|:-]+\|?\s*$/.test(lines[i+1]||"")){const headers=cells(l),rows=[];i+=2;while(i<lines.length&&lines[i].startsWith("|")){const row=cells(lines[i++]);if(row.length!==headers.length)fail("Markdown table column count differs");rows.push(row);}out.push(table(headers,rows));continue;}
   if(l.startsWith("- ")){const items=[];while(i<lines.length&&lines[i].startsWith("- "))items.push(lines[i++].slice(2));out.push(list(items));continue;}
   const link=l.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);if(link){out.push({type:"link",text:link[1],url:safeURL(link[2])});i++;continue;}
   if(l.trim().startsWith(String.fromCharCode(96).repeat(3))||l.trim().startsWith("~~~"))fail("code fences are not part of the reading layout; retain code as a separate attachment");
   const parts=[];while(i<lines.length&&lines[i].trim())parts.push(lines[i++]);out.push(p(parts.join("\n")));
  }return out;
 }
 function renderHTML(baseline,kind,blocks,authority="structured"){
  const style=baseline.files[stems[kind]+".html"].match(/<style>([\s\S]*?)<\/style>/)[1];
  const nav=blocks.map((b,i)=>b.type==="h"&&b.level<3?'<li><a href="#section-'+i+'">'+e(b.text)+'</a></li>':"").join("");
  const body=blocks.map((b,i)=>{if(b.type==="h")return"<h"+b.level+' id="section-'+i+'">'+inline(b.text)+"</h"+b.level+">";if(b.type==="p")return"<p>"+inline(b.text)+"</p>";if(b.type==="list")return"<ul>"+b.items.map(x=>"<li>"+inline(x)+"</li>").join("")+"</ul>";if(b.type==="link")return'<p><a href="'+e(safeURL(b.url))+'">'+e(b.text)+"</a></p>";if(b.type==="table")return'<div class="table-wrap"><table><thead><tr>'+b.headers.map(x=>"<th>"+e(x)+"</th>").join("")+"</tr></thead><tbody>"+b.rows.map(r=>"<tr>"+r.map(x=>"<td>"+inline(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";return'<div class="page-break"></div>';}).join("\n");
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>APM2 '+(kind==="binder"?"complete response engineering binder":"partner workshare offer")+'</title><style>'+style+'</style></head><body><header><strong>TJLabs / APM2</strong><a class="button" href="index.html">Package</a><a class="button" href="capacity/index.html">Capacity planner</a><a class="button" href="'+stems[kind]+'.md" download>Editable Markdown</a><button type="button" onclick="window.print()">Print</button></header><main><p class="muted">Supplier review reading edition. PDF editions are identified in the package.'+(authority==="markdown"?' This reading copy follows the selected edited Markdown; retained structured JSON is available separately and has not been inferred from these edits.':"")+'</p><nav aria-label="Document contents"><strong>Contents</strong><ul>'+nav+"</ul></nav>"+body+"</main><footer>Complete incoming edits, original notice, review register and source identities accompany this edition.</footer></body></html>";
 }
 function compose({baseline,files,authority="preserve",capacityProject,capacityReport,tools={},pdfAttachments=[]}){
  validateBaseline(baseline);files=files||copy(baseline.files);const v=validateInputs(baseline,files);
  if(!["preserve","structured","markdown"].includes(authority))fail("select preserve, structured or markdown authority");
  if(authority==="preserve"&&names.some(n=>files[n]!==baseline.files[n]))fail("edited source needs explicit structured or markdown authority");
  const portable=path=>typeof path==="string"&&path.length<2000&&!path.includes("\\")&&!/[\x00-\x1f]/.test(path)&&!path.startsWith("/")&&path.split("/").every(p=>p&&p!=="."&&p!==".."&&p.length<=240&&!/[<>:"|?*]/.test(p)&&!/[. ]$/.test(p)&&!/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
  for(const [name,body]of Object.entries(files))if(!portable(name)||(typeof body!=="string"&&!(body instanceof Uint8Array)))fail("unsafe or invalid input member: "+name);
  const inputDescriptors=Object.keys(files).filter(n=>!n.startsWith("history/")).sort().map(n=>descriptor(n,files[n])),inputId=sha256(JSON.stringify(inputDescriptors)),output={},history="history/input-"+inputId+"/";
  for(const [n,body]of Object.entries(files)){const target=n.startsWith("history/")?n:history+n;if(Object.hasOwn(output,target)&&sha256(output[target])!==sha256(body))fail("conflicting retained history member: "+target);output[target]=body;}
  for(const n of names)output[n]=files[n];
  if(authority!=="preserve"){const blocks=authority==="structured"?structuredBlocks(baseline,v):Object.fromEntries(Object.keys(stems).map(k=>[k,parseMarkdown(files[stems[k]+".md"])]));for(const kind of Object.keys(stems)){if(authority==="structured")output[stems[kind]+".md"]=markdown(blocks[kind]);output[stems[kind]+".html"]=renderHTML(baseline,kind,blocks[kind],authority);}}
  const selectedCapacity=baseline.capacityCurrent||baseline.capacity;
  for(const f of selectedCapacity)output["capacity/"+f.path]=f.content;
  if(baseline.capacityCurrent){const originalDirectory="history/original-capacity-"+sha256(JSON.stringify(baseline.capacity.map(({content,...identity})=>identity)))+"/";for(const f of baseline.capacity)output[originalDirectory+f.path]=f.content;}
  capacityProject??=files["capacity-project.json"];capacityReport??=files["capacity-report.html"];
  if(capacityProject!==undefined)output["capacity-project.json"]=str(capacityProject,"capacity project");
  if(capacityReport!==undefined){if(capacityProject===undefined)fail("capacity report requires its complete project");output["capacity-report.html"]=str(capacityReport,"capacity report");}
  for(const [path,text]of Object.entries(tools)){if(!/^tools\/[A-Za-z0-9_.-]+$/.test(path))fail("unsafe maintainer path");output[path]=text;}
  if(!output["tools/REGENERATE.md"])fail("include the complete regeneration guide");
  const pdfs=baseline.pdfAssets.map(a=>({...copy(a),status:authority==="preserve"?"original-source-reading":"historical-source-reading",local_path:null}));
  const incomingAttachments=[...pdfAttachments],pdfReuse=[];
  if(files["PDF_EDITIONS.json"]!==undefined&&files["EDITION.json"]!==undefined&&files["MANIFEST.json"]!==undefined){
   const priorPdfs=j(files["PDF_EDITIONS.json"],"prior PDF editions"),priorEdition=j(files["EDITION.json"],"prior reading edition"),priorManifest=j(files["MANIFEST.json"],"prior manifest");
   const bound=path=>{const row=priorManifest.files?.find(x=>x.path===path);if(!row||files[path]===undefined)return false;const actual=descriptor(path,files[path]);return actual.bytes===row.bytes&&actual.sha256===row.sha256;};
   if(priorPdfs.schema==="tjlabs.apm2.pdf-editions.v1"&&priorEdition.schema==="tjlabs.apm2.document-edition.v1"&&priorEdition.operation===baseline.operation&&bound("EDITION.json")&&bound("PDF_EDITIONS.json")){
    for(const a of priorPdfs.editions||[]){if(a.status!=="attached-current-reading"||!stems[a.kind]||incomingAttachments.some(x=>x.kind===a.kind))continue;
     const path=stems[a.kind]+".pdf",body=files[path],match=priorEdition.pdfs?.find(x=>x.status==="attached-current-reading"&&x.kind===a.kind&&JSON.stringify(x)===JSON.stringify(a));
     const eligible=match&&a.local_path===path&&bound(path)&&body instanceof Uint8Array&&body.length===a.pdf_bytes&&sha256(body)===a.pdf_sha256&&a.html_sha256===sha256(output[stems[a.kind]+".html"]);
     if(eligible){incomingAttachments.push({...a,content:body});pdfReuse.push({kind:a.kind,status:"retained-current-reading",source_edition_sha256:sha256(files["EDITION.json"])});}
     else pdfReuse.push({kind:a.kind,status:"retained-in-history",reason:"Prior PDF body, source receipt or generated HTML differs; a new current receipt is required."});
    }
   }
  }
  for(const a of incomingAttachments){
   if(!stems[a.kind]||a.html_sha256!==sha256(output[stems[a.kind]+".html"]))fail("PDF receipt does not bind current exact HTML");
   if(!(a.content instanceof Uint8Array)||a.content.length!==a.pdf_bytes||sha256(a.content)!==a.pdf_sha256||String.fromCharCode(...a.content.slice(0,5))!=="%PDF-")fail("PDF bytes differ from renderer receipt");
   const path=stems[a.kind]+".pdf";if(output[path])fail("duplicate PDF receipt");output[path]=a.content;
   pdfs.push({kind:a.kind,status:"attached-current-reading",local_path:path,html_sha256:a.html_sha256,pdf_bytes:a.pdf_bytes,pdf_sha256:a.pdf_sha256,renderer:str(a.renderer,"PDF renderer"),pages:a.pages??null});
  }
  output["PDF_EDITIONS.json"]=JSON.stringify({schema:"tjlabs.apm2.pdf-editions.v1",editions:pdfs},null,2)+"\n";
  // Preserve exact original reading copies under history. Local PDF controls there
  // are intentionally historical; the active package exposes provider/source identity.
  if(authority==="preserve")for(const kind of Object.keys(stems)){const name=stems[kind]+".pdf",attached=pdfs.find(x=>x.kind===kind&&x.status==="attached-current-reading"),original=pdfs.find(x=>x.kind===kind);if(!attached)output[stems[kind]+".html"]=output[stems[kind]+".html"].split('href="'+name+'"').join('href="'+e(original.pdfURL)+'"');}
  let index=files["index.html"].replace(/<!-- APM2-MAINTAINER-START -->[\s\S]*?<!-- APM2-MAINTAINER-END -->/g,"");
  const summary=(authority==="markdown"?"Retained structured workshare: ":"Proposed workshare: ")+money(v.work)+" · "+v.work.productionHours+" production hours · "+v.work.workingDays+" working days · "+v.work.partnerHours+" partner hours.";
  index=index.replace(/<p>(?:Proposed workshare:|Retained structured workshare:)[\s\S]*?<\/p>/,()=>"<p>"+e(summary)+"</p>");
  index=index.replace("Twelve draft responses, full annexes, scope, sources and review procedure.",()=>v.content.responses.length+" draft responses, full annexes, scope, sources and review procedure.");
  for(const kind of Object.keys(stems)){const name=stems[kind]+".pdf",attached=pdfs.find(x=>x.kind===kind&&x.status==="attached-current-reading"),original=pdfs.find(x=>x.kind===kind);const target=attached?name:authority==="preserve"?original.pdfURL:"PDF_EDITIONS.json";const label=kind==="binder"?"Binder":"Offer";index=index.replace(new RegExp('<a href="[^"]*">'+label+' PDF(?: pending edited edition)?</a>'),()=>'<a href="'+e(target)+'">'+label+' PDF'+(!attached&&authority!=="preserve"?" pending edited edition":"")+'</a>');}
  const panel='<!-- APM2-MAINTAINER-START --><h2>Continue the editable project</h2><p><a href="capacity/index.html">Open original capacity planner offline</a> · <a href="capacity/GUIDE.md">Capacity guide</a> · <a href="tools/REGENERATE.md">Regenerate this reading edition</a> · <a href="EDITION.json">Source identities</a> · <a href="PDF_EDITIONS.json">PDF edition records</a></p><p>Save the planner’s complete JSON and report. Every incoming file remains in the history directory. Original PDF provider links open the retained original reading edition; an edited document needs its own bound PDF.</p>'+(capacityProject!==undefined?'<p><a href="capacity-project.json" download>Selected capacity project JSON</a>'+(capacityReport!==undefined?' · <a href="capacity-report.html">Selected capacity report</a>':"")+'</p>':"")+(authority==="markdown"?'<p>These commercial values are retained structured inputs. The active reading copies follow your edited Markdown; review and reconcile any differences before approval.</p>':"")+'<!-- APM2-MAINTAINER-END -->';
  if(!index.includes("<h2>Final review</h2>"))fail("retain the package Final review section for the opening links");index=index.replace("<h2>Final review</h2>",panel+"<h2>Final review</h2>");output["index.html"]=index;
  output["READ_ME.md"]=files["READ_ME.md"].replace(/\n\n<!-- APM2-MAINTAINER-START -->[\s\S]*?<!-- APM2-MAINTAINER-END -->\n?/g,"").replace("The twelve coverage topics are notice-derived draft responses.",()=> "The "+v.content.responses.length+" coverage topics are notice-derived draft responses.").replace(/(?:The proposed workshare is|The retained structured workshare is)[^\n]*?(?= The dated milestone)/,()=>(authority==="markdown"?"The retained structured workshare is ":"The proposed workshare is ")+money(v.work)+" for "+v.work.productionHours+" production hours over "+v.work.workingDays+" working days and "+v.work.partnerHours+" partner review hours.")+"\n\n<!-- APM2-MAINTAINER-START -->\n## Complete local opening and regeneration\n\nOpen capacity/index.html with its four siblings to use the original planner offline. Open JSON restores every selected scenario; Save JSON and Export report create the portable input/output pair. The original hosted route is /apm2-capacity/ in CanadaBuys. No estate values or prices are inferred.\n\nUse tools/REGENERATE.md and the included maintainer. Choose structured JSON or Markdown explicitly. All incoming edited files remain under history/input-<identity>/. Markdown authority does not silently rewrite the retained structured JSON. Original notice bytes remain unchanged. Original PDFs stay associated with their retained original source; edited reading copies require a new PDF and an exact HTML-bound renderer receipt.\n<!-- APM2-MAINTAINER-END -->\n";
  const edition={schema:"tjlabs.apm2.document-edition.v1",operation:baseline.operation,source_baseline:baseline.sourceIdentity,input_id:inputId,authority,structured_alignment:authority==="markdown"?"structured-inputs-retained-without-inferred-Markdown-merge":authority==="preserve"?"retained-original-content-navigation-only":"generated-from-retained-structured-inputs",inputs:inputDescriptors,input_snapshot:history,reading:Object.keys(stems).map(kind=>({kind,markdown:descriptor(stems[kind]+".md",output[stems[kind]+".md"]),html:descriptor(stems[kind]+".html",output[stems[kind]+".html"])})),capacity:selectedCapacity.map(f=>({path:"capacity/"+f.path,sha256:f.sha256,bytes:f.bytes})),capacity_original:baseline.capacity.map(f=>({path:f.path,sha256:f.sha256,bytes:f.bytes})),capacity_successor:baseline.capacityProvenance||null,capacity_project:capacityProject===undefined?null:descriptor("capacity-project.json",capacityProject),capacity_report:capacityReport===undefined?null:descriptor("capacity-report.html",capacityReport),pdf_reuse:pdfReuse,pdfs};
  output["EDITION.json"]=JSON.stringify(edition,null,2)+"\n";
  const manifest={schema:"tjlabs.apm2.document-manifest.v1",operation:baseline.operation,sourceBindings:baseline.sourceBindings,edition:descriptor("EDITION.json",output["EDITION.json"]),files:Object.keys(output).sort().map(n=>descriptor(n,output[n]))};
  output["MANIFEST.json"]=JSON.stringify(manifest,null,2)+"\n";return{files:output,edition,manifest};
 }
 return {compose,validateBaseline,parseMarkdown,renderHTML,markdown,csv,names};
}

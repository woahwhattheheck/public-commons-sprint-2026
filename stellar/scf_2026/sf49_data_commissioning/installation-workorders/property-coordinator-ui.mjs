/** Guided original-source selection; all native writes remain in the Installation desk. */
import * as R from "./property-coordinator.mjs";
const clone=R.clone,canonical=R.canonical;
export function mountPropertyCoordinator(ctx){
 const target=ctx.target,doc=target.ownerDocument;
 let bound=null,mapping=null,history=[],preview=null,selectedSource="",page=0,sourcePage=0;
 const sourceDrafts=new Map();
 let reader={filename:"",delimiter:",",header:"1"};
 const element=(tag,value)=>{const n=doc.createElement(tag);if(value!==undefined)n.textContent=String(value);return n;};
 const need=(ok,message)=>{if(!ok)throw Error(message);};
 const status=element("p");status.setAttribute("role","status");
 const controls=element("div"),roster=element("div");
 target.append(element("h2","Guided customer selection"),element("p","Use complete original sources and exact account-specific decisions. Advanced JSON stays available below."),status,controls,roster);
 function report(e){status.textContent=e.message||String(e);}
 function run(fn){return ctx.work(async()=>{try{await fn();}catch(e){report(e);throw e;}});}
 const button=(label,fn)=>{const n=element("button",label);n.type="button";n.addEventListener("click",()=>run(fn));return n;};
 function field(parent,label,value,change,{options=null,multi=false,area=false,type="text"}={}){
  const wrap=element("label",label),input=element(options?"select":area?"textarea":"input");
  if(options){
   input.multiple=multi;
   for(const pair of options){const o=element("option",pair[1]);o.value=pair[0];o.selected=multi?value.includes(pair[0]):String(value??"")===pair[0];input.append(o);}
  }else{input.type=type;input.value=value??"";if(area){input.style.minHeight="5rem";input.rows=3;}}
  input.setAttribute("aria-label",label);
  const handle=()=>{try{change(multi?[...input.selectedOptions].map(o=>o.value):input.value);}catch(e){report(e);}};
  input.addEventListener(options?"change":"input",handle);wrap.append(input);parent.append(wrap);return input;
 }
 function group(parent,title){const d=element("details"),s=element("summary",title),body=element("div");body.className="grid";d.append(s,body);parent.append(d);return body;}
 function current(){const v=JSON.parse(ctx.getSelectionText());need(v.schema==="stellar-forge.property-commissioning-selection.v1","Load an original property selection first.");return v;}
 function write(fn){
  need(bound===ctx.getSelectionText(),"The advanced selection changed. Reload the guided controls before editing.");
  const value=current();fn(value);ctx.setSelection(value,bound);bound=ctx.getSelectionText();preview=null;ctx.touch();
 }
 function sources(value){return value.sourceFiles.map(r=>[r.id,r.id+" · "+r.filename]);}
 const stateOptions=["UNSELECTED","PROPOSED","APPROVED","DECLINED"].map(v=>[v,v]);
 function refs(parent,label,value,apply,options){field(parent,label,value,apply,{options,multi:true});}
 function savedSource(row){return {filename:row.name,bytes:row.raw.length,sha256:row.sha256};}
 function fullSource(name){const row=ctx.getSources().find(r=>r.name===name);need(row,"Reload the complete original "+name+".");return row;}
 function sourceText(row){return new TextDecoder("utf-8",{fatal:true}).decode(row.raw);}
 function snapshot(){return {schema:"stellar-forge.property-coordinator-draft.v1",mapping:clone(mapping),history:clone(history),selectedSource,page,sourcePage,sourceDrafts:[...sourceDrafts].map(([name,value])=>[name,clone(value)]),reader:clone(reader)};}
 function bounded(value){need(new TextEncoder().encode(JSON.stringify(value,null,2)+"\n").length<=8*1024*1024,"The complete retained mapping draft exceeds 8 MiB. Download it before choosing another source.");return value;}
 function retainOld(){if(mapping)bounded({...snapshot(),history:[...history,clone(mapping)]});if(mapping)history.push(clone(mapping));}
 function changeMapping(fn){need(mapping,"Choose an original CSV first.");fn(mapping);preview=null;ctx.touch();}
 function validateDraft(value,originals=ctx.getSources()){
  need(value?.schema==="stellar-forge.property-coordinator-draft.v1"&&Array.isArray(value.history),"Use a complete coordinator draft.");
  bounded(value);
  const object=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
  const sourceByName=new Map(originals.map(r=>[r.name,r]));
  for(const m of [value.mapping,...value.history].filter(v=>v!==null&&v!==undefined)){
   need(object(m)&&m.schema===R.SCHEMA&&object(m.source)&&object(m.basis)&&m.basis.schema==="stellar-forge.property-commissioning-selection.v1","Keep the complete original mapping history.");
   const row=sourceByName.get(m.source.filename);
   need(row&&row.sha256===m.source.sha256&&row.raw.length===m.source.bytes,"Keep every complete original source named by the retained mapping.");
   const table=R.parseRoster(sourceText(row),m);
   need(object(m.fields)&&R.FIELDS.every(k=>object(m.fields[k])),"Keep every original property field mapping.");
   for(const k of R.FIELDS){const spec=m.fields[k];need(spec.kind==="literal"&&typeof spec.value==="string"||spec.kind==="column"&&Number.isSafeInteger(spec.column)&&spec.column>=0&&spec.column<table.columns.length,"Keep the original column or literal for "+k+".");}
   for(const k of ["inspection","template"]){const spec=m[k];need(object(spec)&&(spec.kind==="literal"&&(spec.value===null||typeof spec.value==="string")||spec.kind==="values"&&Number.isSafeInteger(spec.column)&&spec.column>=0&&spec.column<table.columns.length&&object(spec.values)),"Keep the complete "+k+" mapping.");}
   need(Array.isArray(m.rows)&&m.rows.length===table.rows.length&&m.rows.every((r,i)=>object(r)&&r.record===table.rows[i].record&&["UNSELECTED","INCLUDE","EXCLUDE"].includes(r.action)&&typeof r.reason==="string")&&typeof m.note==="string","Keep every original record and its unfinished or selected disposition.");
  }
  need(value.mapping===null||object(value.mapping),"Keep the selected mapping or an explicit null.");
  const result=clone(value);
  result.selectedSource=typeof value.selectedSource==="string"?value.selectedSource:"";
  result.page=Number.isSafeInteger(value.page)?Math.max(0,value.page):0;result.sourcePage=Number.isSafeInteger(value.sourcePage)?Math.max(0,value.sourcePage):0;
  need(value.sourceDrafts===undefined||Array.isArray(value.sourceDrafts),"Keep complete source metadata drafts.");
  result.sourceDrafts=value.sourceDrafts||[];
  const names=new Set();
  for(const row of result.sourceDrafts){need(Array.isArray(row)&&row.length===2&&typeof row[0]==="string"&&!names.has(row[0])&&object(row[1]),"Keep distinct complete source metadata drafts.");names.add(row[0]);}
  result.reader=value.reader?clone(value.reader):{filename:result.selectedSource,delimiter:result.mapping?.delimiter||",",header:String(result.mapping?.headerRow||1)};
  need(object(result.reader)&&typeof result.reader.filename==="string"&&[",","\t",";"].includes(result.reader.delimiter)&&typeof result.reader.header==="string","Keep the complete original reader choices.");
  return result;
 }
 function restore(value){
  const next=validateDraft(value);
  mapping=next.mapping;history=next.history;selectedSource=next.selectedSource;page=next.page;sourcePage=next.sourcePage;
  sourceDrafts.clear();for(const row of next.sourceDrafts)sourceDrafts.set(row[0],clone(row[1]));
  reader=next.reader;preview=null;refresh();
 }
 function refresh(){
  controls.replaceChildren();roster.replaceChildren();preview=null;
  try{
   const value=current();bound=ctx.getSelectionText();
   const options=sources(value);
   const head=element("div");head.className="actions";
   head.append(button("Reload guided controls",async()=>refresh()),button("Download complete mapping history",async()=>ctx.download("Property_Roster_Mapping_Draft.json",JSON.stringify(snapshot(),null,2)+"\n")));
   controls.append(head);
   const identity=group(controls,"Selection, templates and report fields");
   field(identity,"Selecting operator",value.selectedBy,v=>write(s=>s.selectedBy=v));
   field(identity,"Selection time (with timezone)",value.selectedAt,v=>write(s=>s.selectedAt=v===""?null:v));
   field(identity,"Selection note",value.note,v=>write(s=>s.note=v),{area:true});
   field(identity,"Permitted JSON field pointers (one per line)",value.fields.join("\n"),v=>write(s=>s.fields=v===""?[]:v.split("\n")));
   field(identity,"Whole report delivery",String(value.includeWholeReport),v=>write(s=>s.includeWholeReport=v==="true"),{options:[["false","Selected fields only"],["true","Whole report — separate approval required"]]});
   value.templates.forEach((row,index)=>{
    const box=group(controls,"Existing template "+(index+1));
    field(box,"Actual template ID",row.id,v=>write(s=>s.templates[index].id=v));
    field(box,"Template name",row.name,v=>write(s=>s.templates[index].name=v));
    refs(box,"Template source files",row.sourceIds,v=>write(s=>s.templates[index].sourceIds=v),options);
    box.append(button("Remove this draft template",async()=>{write(s=>{const id=s.templates[index].id;need(!s.properties.some(p=>p.templateId===id),"Properties still reference this template. Change those explicit selections first.");s.templates.splice(index,1);});refresh();}));
   });
   controls.append(button("Add existing template",async()=>{write(s=>{need(s.templates.length<3,"The original scope has at most three templates.");s.templates.push({id:"",name:"",sourceIds:[]});});refresh();}));
   for(const side of ["merchant","buyer"]){
    const box=group(controls,side==="merchant"?"Merchant host":"Buyer host"),row=value.hosts[side];
    field(box,"Host / receiving address",row.host,v=>write(s=>s.hosts[side].host=v));
    field(box,"Named operator",row.operator,v=>write(s=>s.hosts[side].operator=v));
    field(box,"Environment",row.environment,v=>write(s=>s.hosts[side].environment=v),{options:["UNSELECTED","STAGING","PRODUCTION"].map(x=>[x,x])});
    refs(box,"Host source files",row.sourceIds,v=>write(s=>s.hosts[side].sourceIds=v),options);
   }
   const route=group(controls,"Existing report / PMS route");
   field(route,"Route name",value.route.name,v=>write(s=>s.route.name=v));
   field(route,"Route kind",value.route.kind,v=>write(s=>s.route.kind=v),{options:["UNSELECTED","REPORT","PMS"].map(x=>[x,x])});
   field(route,"Actual route reference",value.route.reference,v=>write(s=>s.route.reference=v));
   refs(route,"Route source files",value.route.sourceIds,v=>write(s=>s.route.sourceIds=v),options);
   for(const [name,row] of Object.entries(value.rights)){
    const box=group(controls,"Recorded decision · "+name);
    field(box,"Decision state",row.state,v=>write(s=>s.rights[name].state=v),{options:stateOptions});
    field(box,"Decision maker",row.by,v=>write(s=>s.rights[name].by=v));
    field(box,"Decision time (with timezone)",row.at,v=>write(s=>s.rights[name].at=v===""?null:v));
    field(box,"Actual decision and basis",row.note,v=>write(s=>s.rights[name].note=v),{area:true});
    refs(box,"Decision source files",row.sourceIds,v=>write(s=>s.rights[name].sourceIds=v),options);
   }
   value.editions.forEach((row,index)=>{
    const box=group(controls,"Original source edition · "+row.slot);
    field(box,"Actual edition reference",row.reference,v=>write(s=>s.editions[index].reference=v));
    refs(box,"Edition source files",row.sourceIds,v=>write(s=>s.editions[index].sourceIds=v),options);
   });
   const payment=group(controls,"Selected payment path");
   field(payment,"Payment route",value.payment.mode,v=>write(s=>s.payment.mode=v),{options:["UNSELECTED","CONVENTIONAL_API","STELLAR_RESOURCE"].map(x=>[x,x])});
   payment.append(element("p","Keep the original complete native payment terms in Advanced JSON. Selecting a route does not change any atomic price, budget, terms or approval."));
   value.examples.forEach((row,index)=>{
    const box=group(controls,"Customer example · "+row.id);
    refs(box,"Selected property keys",row.propertyKeys,v=>write(s=>s.examples[index].propertyKeys=v),value.properties.map(p=>[p.key,p.key+" · "+p.address]));
    field(box,"Actual useful task",row.task,v=>write(s=>s.examples[index].task=v),{area:true});
    field(box,"Expected customer review",row.expectedReview,v=>write(s=>s.examples[index].expectedReview=v),{area:true});
    refs(box,"Example source files",row.sourceIds,v=>write(s=>s.examples[index].sourceIds=v),options);
   });
   sourceControls(value);
   rosterControls(value);
   status.textContent="Guided controls are bound to this complete selection. Unselected and incomplete decisions remain explicit.";
  }catch(e){bound=null;report(e);controls.append(button("Read current selection",async()=>refresh()));}
 }
 function sourceControls(value){
  const box=group(controls,"Complete original source metadata");
  box.append(element("p","Load each complete original file using Add complete original source files below. Record its actual observation and attachment metadata here; no source is acquired or attached by this editor."));
  for(const row of ctx.getSources()){
   const old=value.sourceFiles.find(s=>s.filename===row.name),entry=element("details"),title=element("summary",row.name+" · "+row.raw.length+" bytes"),form=element("div");form.className="grid";entry.append(title,form);box.append(entry);
   const candidate=sourceDrafts.has(row.name)?clone(sourceDrafts.get(row.name)):old?clone(old):{id:"source-"+row.sha256.slice(0,16),filename:row.name,bytes:row.raw.length,sha256:row.sha256,mediaType:row.name.toLowerCase().endsWith(".csv")?"text/csv":row.name.toLowerCase().endsWith(".tsv")?"text/tab-separated-values":row.name.toLowerCase().endsWith(".json")?"application/json":"application/octet-stream",sourceUrl:"",observedAt:"",nativeSourceId:null};
   const draft=(key,value)=>{candidate[key]=value;sourceDrafts.set(row.name,clone(candidate));ctx.touch();};
   form.append(element("p",row.sha256));
   field(form,"Local source ID",candidate.id,v=>draft("id",v));
   field(form,"Original MIME type",candidate.mediaType,v=>draft("mediaType",v));
   field(form,"Original source URL (blank for local)",candidate.sourceUrl,v=>draft("sourceUrl",v));
   field(form,"Actual observed time (with timezone)",candidate.observedAt,v=>draft("observedAt",v));
   field(form,"Actual attached case source ID (blank if absent)",candidate.nativeSourceId,v=>draft("nativeSourceId",v===""?null:v));
   form.append(button(old?"Apply this source metadata":"Add complete source descriptor",async()=>{
    need(ctx.getSources().some(s=>s.name===row.name&&s.sha256===row.sha256&&s.raw.length===row.raw.length),"The loaded original source changed.");
    write(s=>{
     const at=s.sourceFiles.findIndex(r=>r.filename===row.name);
     need(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(candidate.id)&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,199}$/.test(candidate.filename),"Use safe source IDs and original filenames.");
     need(!s.sourceFiles.some((r,i)=>i!==at&&r.id===candidate.id),"Another original source has this ID.");
     if(at>=0){need(s.sourceFiles[at].id===candidate.id,"Keep referenced source IDs stable; deliberate ID corrections use Advanced JSON.");s.sourceFiles[at]=clone(candidate);}
     else s.sourceFiles.push(clone(candidate));
    });sourceDrafts.delete(row.name);refresh();
   }));
  }
 }
 function rosterControls(value){
  roster.append(element("h3","Receive an original property roster"),element("p","Choose a complete loaded CSV/TSV, select its real header, map exact cells, and give every record an explicit inclusion or exclusion. No property is inferred from an address."));
  const candidates=ctx.getSources().filter(r=>value.sourceFiles.some(s=>s.filename===r.name&&["text/csv","text/tab-separated-values"].includes(s.mediaType)));
  let file=reader.filename||selectedSource||candidates[0]?.name||"",delimiter=reader.delimiter,header=reader.header;
  field(roster,"Complete roster source",file,v=>{file=v;reader.filename=v;ctx.touch();},{options:[["","Select a loaded source"],...candidates.map(r=>[r.name,r.name])]});
  field(roster,"Original delimiter",delimiter,v=>{delimiter=v;reader.delimiter=v;ctx.touch();},{options:[[",","Comma"],["\t","Tab"],[";","Semicolon"]]});
  field(roster,"Logical header record",header,v=>{header=v;reader.header=v;ctx.touch();});
  roster.append(button("Read full roster and start mapping",async()=>{
   const row=fullSource(file),descriptor=current().sourceFiles.find(r=>r.filename===file);
   need(descriptor,"Record this complete source's actual metadata first.");
   need(/^[1-9][0-9]*$/.test(header),"Enter a positive logical header record.");
   const table=R.parseRoster(sourceText(row),{delimiter,headerRow:Number(header)});
   const next=R.createMapping(current(),descriptor,table);retainOld();mapping=next;selectedSource=file;reader={filename:file,delimiter,header};page=0;preview=null;ctx.touch();refresh();
  }));
  if(!mapping)return;
  const original=fullSource(mapping.source.filename),table=R.parseRoster(sourceText(original),mapping);
  const mappingPanel=element("div");roster.append(mappingPanel);
  mappingPanel.append(element("p",table.rows.length+" complete source records; "+table.preamble.length+" preamble records; "+history.length+" retained earlier mapping drafts."));
  const columnOptions=table.columns.map(c=>[String(c.index),(c.index+1)+": "+(c.label||"(blank heading)")]);
  for(const name of R.FIELDS){
   const box=group(mappingPanel,"Property field · "+name),spec=mapping.fields[name];
   field(box,"Mapping mode",spec.kind,v=>{changeMapping(m=>m.fields[name]=v==="column"?{kind:"column",column:0}:{kind:"literal",value:""});refresh();},{options:[["literal","Explicit literal"],["column","Original source column"]]});
   if(spec.kind==="column")field(box,"Original column",String(spec.column),v=>changeMapping(m=>m.fields[name].column=Number(v)),{options:columnOptions});
   else field(box,"Literal text",spec.value,v=>changeMapping(m=>m.fields[name].value=v));
  }
  for(const kind of ["inspection","template"]){
   const box=group(mappingPanel,"Exact "+kind+" choice"),spec=mapping[kind],allowed=kind==="inspection"?["UNSELECTED","REQUIRED","NOT_REQUIRED"].map(x=>[x,x]):[[JSON.stringify(null),"No selected template"],...value.templates.map(r=>[JSON.stringify(r.id),r.id+" · "+r.name])];
   field(box,"Choice mode",spec.kind,v=>{changeMapping(m=>m[kind]=v==="literal"?{kind:"literal",value:kind==="inspection"?"UNSELECTED":null}:{kind:"values",column:0,values:{}});sourcePage=0;refresh();},{options:[["literal","One explicit choice"],["values","Map each exact source value"]]});
   if(spec.kind==="literal")field(box,"Selected choice",kind==="template"?JSON.stringify(spec.value):spec.value,v=>changeMapping(m=>m[kind].value=kind==="template"?JSON.parse(v):v),{options:allowed});
   else{
    field(box,"Original value column",String(spec.column),v=>{changeMapping(m=>m[kind]={kind:"values",column:Number(v),values:{}});sourcePage=0;refresh();},{options:columnOptions});
    const values=[...new Set(table.rows.filter(r=>r.cells.length>spec.column).map(r=>r.cells[spec.column]))];
    const start=Math.min(sourcePage,Math.max(0,Math.ceil(values.length/30)-1))*30;
    values.slice(start,start+30).forEach(v=>{
     const isSet=Object.prototype.hasOwnProperty.call(spec.values,v),currentValue=isSet?(kind==="template"?JSON.stringify(spec.values[v]):spec.values[v]):"__unmapped__";
     field(box,"Exact value "+JSON.stringify(v),currentValue,next=>changeMapping(m=>{
      if(next==="__unmapped__")delete m[kind].values[v];
      else Object.defineProperty(m[kind].values,v,{value:kind==="template"?JSON.parse(next):next,enumerable:true,writable:true,configurable:true});
     }),{options:[["__unmapped__","Not mapped"],...allowed]});
    });
    box.append(element("p","Values "+(values.length?start+1:0)+"–"+Math.min(start+30,values.length)+" of "+values.length));
    if(start>0)box.append(button("Earlier values",async()=>{sourcePage--;refresh();}));
    if(start+30<values.length)box.append(button("Later values",async()=>{sourcePage++;refresh();}));
   }
  }
  field(mappingPanel,"Full mapping note",mapping.note,v=>changeMapping(m=>m.note=v),{area:true});
  const choiceBox=group(mappingPanel,"Every original record and disposition"),start=Math.min(page,Math.max(0,Math.ceil(table.rows.length/20)-1))*20;
  for(let index=start;index<Math.min(start+20,table.rows.length);index++){
   const row=table.rows[index],item=element("details"),summary=element("summary","Record "+row.record+" · lines "+row.lineStart+"–"+row.lineEnd),body=element("div");item.append(summary,body);choiceBox.append(item);
   body.append(element("pre",JSON.stringify(row.cells,null,2)));
   const choice=mapping.rows[index];
   field(body,"Disposition",choice.action,v=>changeMapping(m=>m.rows[index].action=v),{options:["UNSELECTED","INCLUDE","EXCLUDE"].map(v=>[v,v])});
   field(body,"Actual inclusion / exclusion reason",choice.reason,v=>changeMapping(m=>m.rows[index].reason=v));
  }
  choiceBox.append(element("p","Records "+(table.rows.length?start+1:0)+"–"+Math.min(start+20,table.rows.length)+" of "+table.rows.length));
  if(start>0)choiceBox.append(button("Earlier records",async()=>{page--;refresh();}));
  if(start+20<table.rows.length)choiceBox.append(button("Later records",async()=>{page++;refresh();}));
  let bulkAction="INCLUDE",bulkReason="";
  field(choiceBox,"Set all original records to",bulkAction,v=>bulkAction=v,{options:[["INCLUDE","Include every original record"],["EXCLUDE","Exclude every original record"]]});
  field(choiceBox,"Reason applying to every record",bulkReason,v=>bulkReason=v);
  choiceBox.append(button("Apply explicit disposition to all records",async()=>{need(bulkReason.trim(),"Give the actual common reason.");changeMapping(m=>m.rows.forEach(r=>{r.action=bulkAction;r.reason=bulkReason;}));refresh();}));
  mappingPanel.append(button("Bind mapping to current selection",async()=>{retainOld();mapping=R.rebaseMapping(mapping,current());preview=null;ctx.touch();refresh();}),
   button("Review complete mapped roster",async()=>{
    const row=fullSource(mapping.source.filename);
    preview=R.prepareRoster(mapping,current(),sourceText(row),savedSource(row));renderPreview();
   }));
  const p=element("div");p.id="property-coordinator-preview";mappingPanel.append(p);
 }
 function renderPreview(){
  const target=doc.getElementById("property-coordinator-preview");target.replaceChildren();
  if(!preview)return;
  const selected=preview;
  target.append(element("h3","Complete replacement review"),element("p",selected.selection.properties.length+" included; "+selected.excluded.length+" explicitly excluded; "+selected.comparison.added.length+" added; "+selected.comparison.changed.length+" changed; "+selected.comparison.removed.length+" removed; "+selected.findings.length+" unresolved findings."),
   element("pre",JSON.stringify({comparison:selected.comparison,properties:selected.selection.properties,excluded:selected.excluded,findings:selected.findings},null,2)));
  target.append(button("Apply this reviewed roster",async()=>{
   need(preview===selected,"Prepare the current complete mapping again.");
   const row=fullSource(mapping.source.filename),now=current();
   const checked=R.prepareRoster(mapping,now,sourceText(row),savedSource(row));
   need(canonical(checked)===canonical(selected),"The original mapping, source or selection changed.");
   const next=R.applyRoster(checked,now,mapping,savedSource(row),sourceText(row));
   const record={schema:"stellar-forge.property-roster-applied.v1",mapping:clone(mapping),comparison:clone(checked.comparison),included:clone(next.properties),excluded:clone(checked.excluded)};
   const original=ctx.getSelectionText();
   // Publish the complete source record before replacing the visible selected roster.
   const evidence=await ctx.addEvidence(record);
   need(ctx.getSelectionText()===original,"The selected draft changed while retaining its complete mapping.");
   need(!next.sourceFiles.some(r=>r.id===evidence.id&&!eqDescriptor(r,evidence)),"The mapping evidence ID conflicts with an original source.");
   if(!next.sourceFiles.some(r=>r.id===evidence.id))next.sourceFiles.push(evidence);
   need(next.sourceFiles.length<=100,"The selected complete source inventory exceeds 100 files.");
   need(next.sourceFiles.reduce((n,r)=>n+r.bytes,0)<=24*1024*1024,"The full selection including mapping evidence exceeds 24 MiB.");
   const nextHistory=[...history,clone(mapping)],nextMapping=R.rebaseMapping(mapping,next);
   bounded({...snapshot(),mapping:nextMapping,history:nextHistory});
   ctx.setSelection(next,original);bound=ctx.getSelectionText();history=nextHistory;mapping=nextMapping;preview=null;ctx.touch();refresh();
   status.textContent="The complete reviewed roster is in the original selection. Its full original source and mapping record travel with the input packet. Native actions: 0.";
  }));
 }
 function eqDescriptor(a,b){return canonical(a)===canonical(b);}
 return {refresh,snapshot,restore,validateDraft,requireSources(){for(const m of [mapping,...history].filter(Boolean)){const row=fullSource(m.source.filename);need(row.sha256===m.source.sha256&&row.raw.length===m.source.bytes,"Keep the complete original source of every retained mapping.");}},canRemoveSource(name){return ![mapping,...history].filter(Boolean).some(m=>m.source.filename===name);},invalidate(){preview=null;if(bound!==ctx.getSelectionText()){status.textContent="Advanced selection changed. Reload guided controls before editing.";for(const n of controls.querySelectorAll("input,textarea,select"))n.disabled=true;}},availability(){if(bound!==ctx.getSelectionText())for(const n of controls.querySelectorAll("input,textarea,select"))n.disabled=true;},};
}

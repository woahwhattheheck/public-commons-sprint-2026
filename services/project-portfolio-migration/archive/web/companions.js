/* Original companion capture profiles and native source mappings. */
export function createCompanionPanel(C) {
  const {$,el,pretty,api,safe,notice,lock,saveDraft}=C;
  const S={edition:"",epoch:0,items:[],ordinal:null,offset:0,next:null,capture:null,catalogue:{},
    selectedFiles:[],profiles:{},drafts:{},columns:[],mapEpoch:0};
  const clone=x=>structuredClone(x);
  const fileKey=f=>JSON.stringify([f.name,f.size,f.lastModified]);
  const roles=["enterprise_fields","lookup_tables","resource_pool","project_metadata","portfolio_metadata","attachment","target_exceptions"];
  const formats=["auto","csv","tsv","json","jsonl","binary"];
  const change=fn=>{if(C.busy())throw new Error("Reopen the original saved action first.");fn();C.invalidateReview();saveDraft();lock();};
  const currentMappings=()=>S.drafts[S.edition]||(S.drafts[S.edition]=[]);
  function select(values,value,label) {const node=el("select");node.setAttribute("aria-label",label);
    for(const item of values)node.append(new Option(typeof item==="string"?item:item.label,typeof item==="string"?item:item.value));
    node.value=value;return node;}
  function labelled(label,node){const holder=el("label",label);holder.append(node);return holder;}
  function profile(file) {
    const identity=fileKey(file);
    return S.profiles[identity]||(S.profiles[identity]={label:file.name,profile:{format:"auto",role:"attachment",encoding:"utf-8-sig",delimiter:",",json_pointer:""}});
  }
  function renderFiles() {
    const node=$("companion-profiles");node.replaceChildren();
    for(const file of S.selectedFiles) {
      const value=profile(file),box=el("section",undefined,"companion-profile"),title=el("h3",file.name+" · "+file.size+" bytes");
      const label=el("input");label.value=value.label;
      const role=select(roles,value.profile.role,"Companion role"),format=select(formats,value.profile.format,"Input format");
      const encoding=el("input");encoding.value=value.profile.encoding;
      const delimiter=el("input");delimiter.value=value.profile.delimiter;delimiter.maxLength=1;
      const pointer=el("input");pointer.value=value.profile.json_pointer;pointer.placeholder="/items";
      const save=()=>change(()=>{value.label=label.value;value.profile={role:role.value,format:format.value,
        encoding:encoding.value,delimiter:delimiter.value,json_pointer:pointer.value};});
      for(const n of [label,role,format,encoding,delimiter,pointer])n.oninput=n.onchange=()=>safe(save);
      const a=el("div",undefined,"columns"),b=el("div",undefined,"columns"),d=el("div",undefined,"columns");
      a.append(labelled("Captured label",label),labelled("Role",role));b.append(labelled("Format",format),labelled("Encoding",encoding));
      d.append(labelled("CSV delimiter",delimiter),labelled("JSON pointer",pointer));box.append(title,a,b,d);node.append(box);
    }
    lock();
  }
  function descriptors() {
    const files=[...$("companion-files").files];
    return files.map(file=>{const value=profile(file);return{file,label:value.label.trim()||file.name,profile:clone(value.profile)};});
  }
  function renderSelect() {
    const node=$("companion-capture-select");node.replaceChildren(new Option("Select a captured companion",""));
    for(const row of S.items)node.append(new Option((row.label||row.source_id)+" · "+row.role+" · "+(row.row_count??0)+" records",String(row.ordinal)));
    node.value=S.ordinal===null?"":String(S.ordinal);
  }
  function renderMappings() {
    const node=$("companion-map-list");node.replaceChildren();
    for(const [index,mapping]of currentMappings().entries()){
      const detail=el("details"),summary=el("summary",mapping.family+" · "+mapping.source_id.slice(0,12)+" · "+mapping.columns.length+" columns");
      detail.append(summary,el("pre",pretty(mapping)));
      const button=el("button","Remove mapping");button.onclick=()=>safe(()=>change(()=>{currentMappings().splice(index,1);renderMappings();}));
      detail.append(button);node.append(detail);
    }
    $("companion-map-count").textContent=currentMappings().length+" companion mappings will join the next original source review.";
    lock();
  }
  async function load(edition) {
    const epoch=++S.epoch,changed=S.edition!==edition;S.edition=edition;S.items=[];S.capture=null;
    if(changed){S.ordinal=null;S.offset=0;S.columns=[];S.catalogue={};}
    renderMappings();
    if(!edition){renderSelect();$("companion-capture-summary").replaceChildren();$("companion-records").replaceChildren();return;}
    const value=await api("/api/companion-sources?edition_id="+edition);
    if(epoch!==S.epoch||edition!==S.edition)return;
    S.items=value.items;if(S.ordinal!==null&&!S.items.some(x=>x.ordinal===S.ordinal))S.ordinal=null;
    renderSelect();if(S.ordinal!==null)await readCapture();else renderColumns();
  }
  async function readCapture() {
    if(S.ordinal===null)return;const eid=S.edition,ordinal=S.ordinal,offset=S.offset,epoch=S.epoch;
    const value=await api("/api/companion-capture?"+new URLSearchParams({edition_id:eid,ordinal:String(ordinal),offset:String(offset),limit:"25"}));
    if(eid!==S.edition||ordinal!==S.ordinal||offset!==S.offset||epoch!==S.epoch)return;
    S.capture=value;S.next=value.next_offset;
    const summary={source_id:value.source_id,capture_id:value.capture_id,ordinal:value.ordinal,profile_sha256:value.profile_sha256,
      label:value.label,role:value.role,format:value.format,profile:value.profile,row_count:value.row_count,findings:value.findings};
    $("companion-capture-summary").replaceChildren(el("pre",pretty(summary)));
    const holder=$("companion-records");holder.replaceChildren();
    const table=el("table"),head=el("thead"),tr=el("tr"),body=el("tbody");
    tr.append(el("th","Original record"));for(const column of value.columns)tr.append(el("th",column.name+" ["+column.key+"]"));tr.append(el("th","Original values"));head.append(tr);
    for(const row of value.rows){const line=el("tr",undefined,"companion-capture-row");line.append(el("td",row.key));
      for(const column of value.columns){const original=row.cells[column.key],text=original===undefined?"(missing)":typeof original==="string"?original:pretty(original);
        line.append(el("td",text.length>240?text.slice(0,240)+" …":text));}
      const td=el("td"),button=el("button","Inspect record");button.dataset.read="";button.onclick=()=>$("companion-record-detail").replaceChildren(el("pre",pretty(row)));
      td.append(button);line.append(td);body.append(line);}
    table.append(head,body);holder.append(table);
    $("companion-range").textContent=value.rows.length?"Records "+(offset+1)+"–"+(offset+value.rows.length)+" of "+value.row_count:"No structured records in this original capture.";
    $("companion-previous").disabled=offset===0;$("companion-next").disabled=value.next_offset===null;
    const identity=$("companion-identity-column"),selected=identity.value;identity.replaceChildren();
    for(const column of value.columns)identity.append(new Option(column.name+" · "+column.key,column.key));
    if([...identity.options].some(x=>x.value===selected))identity.value=selected;
    await readCatalogue();
  }
  async function readCatalogue() {
    if(!S.edition)return;const epoch=++S.mapEpoch,eid=S.edition,family=$("companion-family").value;
    const value=await api("/api/source-field-catalogue?"+new URLSearchParams({edition_id:eid,family}));
    if(epoch!==S.mapEpoch||eid!==S.edition||family!==$("companion-family").value)return;
    S.catalogue=value.fields;renderColumns();
  }
  function renderColumns() {
    const body=$("companion-map-columns").tBodies[0];body.replaceChildren();
    for(const [index,row]of S.columns.entries()){
      const tr=el("tr"),column=select([{value:"",label:"Original source column"},...(S.capture?.columns||[]).map(x=>({value:x.key,label:x.name+" · "+x.key}))],row.column,"Original source column");
      const field=select([{value:"",label:"Actual native field"},...Object.entries(S.catalogue).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>({value:key,label:key+" · "+value.data_type}))],row.field,"Actual native field");
      const type=select(["string","integer","number","boolean","duration","rate","local_datetime","local_date","local_time","enum"],row.type,"Native typed value");
      const options=el("textarea");options.rows=2;options.value=row.options||"{}";options.setAttribute("aria-label","Exact conversion options");
      const set=()=>change(()=>{row.column=column.value;row.field=field.value;row.type=type.value;row.options=options.value;});
      for(const n of [column,field,type,options]){n.oninput=n.onchange=()=>safe(set);const td=el("td");td.append(n);tr.append(td);}
      const td=el("td"),remove=el("button","Remove");remove.onclick=()=>safe(()=>change(()=>{S.columns.splice(index,1);renderColumns();}));td.append(remove);tr.append(td);body.append(tr);
    }
    lock();
  }
  function addMapping() {
    const capture=S.capture;if(!capture||!S.edition)throw new Error("Choose one original captured companion.");
    if(S.items.filter(x=>x.source_id===capture.source_id).length>1&&!capture.capture_id)
      throw new Error("This file has multiple captures. Reopen it with the current capture-selector source before mapping.");
    const columns=S.columns.map(row=>{
      const options=JSON.parse(row.options||"{}");if(!options||typeof options!=="object"||Array.isArray(options))throw new Error("Use a JSON object for exact conversion options.");
      if(!row.column||!row.field)throw new Error("Select each actual source column and native field.");
      if(["column","field","type"].some(k=>k in options))throw new Error("Choose source, field and type in their original controls.");
      return{...options,column:row.column,field:row.field,type:row.type};
    });
    if(!columns.length)throw new Error("Add at least one original column mapping.");
    const mapping={source_id:capture.source_id,...(capture.capture_id?{capture_id:capture.capture_id}:{}),
      family:$("companion-family").value,identity:{kind:$("companion-identity-kind").value,column:$("companion-identity-column").value},columns};
    change(()=>{currentMappings().push(mapping);S.columns=[];renderColumns();renderMappings();});
    notice("The selected capture and original columns will join the next source review.");
  }
  $("companion-files").onchange=()=>safe(()=>{S.selectedFiles=[...$("companion-files").files];renderFiles();saveDraft();});
  $("companion-capture-select").onchange=()=>safe(async()=>{S.ordinal=$("companion-capture-select").value===""?null:Number($("companion-capture-select").value);
    S.offset=0;S.columns=[];S.capture=null;await readCapture();saveDraft();});
  $("companion-previous").onclick=()=>safe(()=>{S.offset=Math.max(0,S.offset-25);return readCapture();});
  $("companion-next").onclick=()=>safe(()=>{if(S.next!==null){S.offset=S.next;return readCapture();}});
  $("companion-family").onchange=()=>safe(()=>{S.columns=[];return readCatalogue();});
  $("companion-add-column").onclick=()=>safe(()=>change(()=>{S.columns.push({column:"",field:"",type:"string",options:"{}"});renderColumns();}));
  $("companion-add-mapping").onclick=()=>safe(addMapping);
  return{load,descriptors,mappings:()=>({companions:clone(currentMappings())}),
    snapshot:()=>({schema:"portfolio.companion-browser.v1",profiles:S.profiles,drafts:S.drafts,edition:S.edition,ordinal:S.ordinal,
      columns:S.columns,family:$("companion-family").value,identityKind:$("companion-identity-kind").value,identityColumn:$("companion-identity-column").value}),
    restore:value=>{S.profiles=value.profiles||{};S.drafts=value.drafts||{};S.edition=value.edition||"";S.ordinal=value.ordinal??null;
      S.columns=value.columns||[];$("companion-family").value=value.family||"tasks";$("companion-identity-kind").value=value.identityKind||"uid";
      S.selectedFiles=[...$("companion-files").files];renderFiles();renderMappings();}};
}

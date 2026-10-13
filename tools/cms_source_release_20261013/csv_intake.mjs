/** Original CSV intake for the standalone CMS release desk. No network calls. */
export function suggestCsvMappings(headers, knownFields) {
  const known=new Set(knownFields), proposed=headers.map(header=>{
    const spelling=header.replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_|_$/g,"");
    return known.has(header)?header:known.has(spelling)?spelling:"";
  });
  const counts=new Map();for(const field of proposed)if(field)counts.set(field,(counts.get(field)||0)+1);
  return headers.map((source_header,i)=>({source_header,field:counts.get(proposed[i])===1?proposed[i]:""}));
}
export function inspectOriginalCsv(text, filename, api, hash) {
  if(typeof text!=="string"||typeof filename!=="string"||!filename||filename.includes("/")||filename.includes("\\")||filename==="."||filename==="..")throw Error("Choose one original CSV file with a plain filename.");
  const parsed=api.parseCsv(text.charCodeAt(0)===0xfeff?text.slice(1):text);
  if(!parsed.fields.length||!parsed.rows.length||parsed.fields.some(h=>!h)||new Set(parsed.fields).size!==parsed.fields.length)throw Error("The original CSV needs nonempty, unique headers and complete source rows.");
  return {filename,path:"original/"+filename,text,sha256:hash(text),bytes:new TextEncoder().encode(text).length,
    headers:parsed.fields,row_count:parsed.rows.length,examples:parsed.fields.map(header=>parsed.rows.slice(0,3).map(row=>row[header])),
    mapping:suggestCsvMappings(parsed.fields,api.CMS_CANONICAL_FIELDS)};
}
export function prepareOriginalCsv(intake, selection, current, api, hash) {
  if(!intake||selection.confirmed!==true)throw Error("Review and confirm the original-header mapping and source edition.");
  if(!["before","after"].includes(selection.placement))throw Error("Choose how the imported edition is ordered.");
  const request={schema:"source-csv-request/1",dataset_id:"xubh-q36u",scope:{state:"CA"},origin:selection.origin,
    resource_id:selection.resource_id,metadata:{dataset_url:selection.dataset_url,source_url:selection.source_url,dictionary_url:selection.dictionary_url||null,
      captured_on:selection.captured_on,source_released:selection.source_released,source_modified:selection.source_modified||null,
      ...(selection.archive_date?{archive_date:selection.archive_date,archive_date_meaning:selection.archive_date_meaning}:{}),
      ...(selection.date_provenance?{date_provenance:selection.date_provenance}:{}),
      ...(selection.archive_url?{archive_url:selection.archive_url}:{}),...(selection.archive_member?{archive_member:selection.archive_member}:{})},
    column_mapping:selection.mapping.filter(row=>row.field).map(row=>({source_header:row.source_header,field:row.field})),
    original_member:intake.path};
  if(selection.origin==="derived-current-api-csv")request.parent_release={
    release_id:current.manifest.release_id,data_csv_sha256:current.manifest.data_csv_sha256};
  const release=api.buildCsvRelease({path:intake.path,text:intake.text,bytes:intake.bytes,sha256:intake.sha256},request,hash);
  const transfer=api.makeTransfer(release,[{path:intake.path,text:intake.text}]);
  const reopened=api.receiveTransfer(transfer,hash);
  if(reopened.manifest.release_id!==release.manifest.release_id)throw Error("The imported edition did not reopen with its original identity.");
  return {request,release:reopened,transfer,placement:selection.placement};
}
export function attachOriginalCsvIntake({root,api,hash,current,onReceive,download}) {
  if(!root||!api||typeof hash!=="function"||typeof onReceive!=="function")throw Error("Complete original CSV intake bindings are required.");
  const find=id=>root.querySelector("#"+id),form=find("csv-intake-form"),status=find("csv-intake-status");
  let intake=null,prepared=null,version=0;
  const text=(element,value)=>{element.textContent=value;return element;};
  const node=(tag,value)=>text(document.createElement(tag),value);
  const statusText=value=>{status.textContent=value;};
  const invalidate=()=>{prepared=null;find("csv-download-transfer").disabled=true;find("csv-download-request").disabled=true;};
  const resetConfirmation=()=>{find("csv-confirm").checked=false;invalidate();};
  function syncDateControls(){
    const unknown=find("csv-publication-status").value==="unknown",archived=!!find("csv-archive-date").value;
    if(unknown||archived)find("csv-date-attribution").open=true;
    find("csv-released").disabled=unknown;find("csv-released").required=!unknown;
    find("csv-publication-note").required=unknown;find("csv-publication-url").required=unknown;
    for(const id of ["csv-archive-meaning","csv-archive-note","csv-archive-url-source"])find(id).required=archived;
  }
  function setEditionDates(metadata={}){
    find("csv-publication-status").value=metadata.source_released===null?"unknown":"known";
    find("csv-released").value=metadata.source_released||"";
    find("csv-archive-date").value=metadata.archive_date||"";find("csv-archive-meaning").value=metadata.archive_date_meaning||"";
    for(const kind of ["publication","archive"]){
      const proof=metadata.date_provenance?.[kind]||{};
      for(const [part,key]of Object.entries({note:"note",url:"source_url",member:"source_member",sha:"source_sha256"}))
        find("csv-"+kind+"-"+(kind==="archive"?(part==="url"?"url-source":part==="member"?"member-proof":part):part)).value=proof[key]||"";
    }
    syncDateControls();
  }
  function selectedDateAttribution(){
    const result={};
    for(const kind of ["publication","archive"]){
      const value={};
      for(const [part,key]of Object.entries({note:"note",url:"source_url",member:"source_member",sha:"source_sha256"})){
        const text=find("csv-"+kind+"-"+(kind==="archive"?(part==="url"?"url-source":part==="member"?"member-proof":part):part)).value;
        if(text)value[key]=text;
      }
      if(Object.keys(value).length)result[kind]=value;
    }
    return Object.keys(result).length?result:undefined;
  }
  find("csv-publication-status").addEventListener("change",()=>{if(find("csv-publication-status").value==="unknown")find("csv-released").value="";syncDateControls();resetConfirmation();});
  find("csv-archive-date").addEventListener("input",()=>{syncDateControls();resetConfirmation();});
  function renderMapping() {
    const body=find("csv-mapping-rows");body.replaceChildren();
    for(let i=0;i<intake.headers.length;i++){
      const header=intake.headers[i],row=document.createElement("tr"),label=node("th",header);label.scope="row";row.append(label);
      const choice=document.createElement("select");choice.dataset.header=header;choice.setAttribute("aria-label","Known field for original column "+header);
      const keep=node("option","Retain original column, without a known-field mapping");keep.value="";choice.append(keep);
      for(const field of api.CMS_CANONICAL_FIELDS){const option=node("option",field);option.value=field;choice.append(option);}
      choice.value=intake.mapping[i].field;choice.addEventListener("change",resetConfirmation);
      const mapped=document.createElement("td");mapped.append(choice);row.append(mapped);
      const examples=node("td",intake.examples[i].map(value=>value===""?'"" (empty string)':JSON.stringify(value)).join("\n"));
      examples.className="csv-cell-examples";row.append(examples);body.append(row);
    }
  }
  function loadOriginal(original,filename,defaults={}){
    const value=inspectOriginalCsv(original,filename,api,hash);
    version++;intake=null;prepared=null;resetConfirmation();
    intake=value;renderMapping();find("csv-intake-fields").hidden=false;find("csv-submit").disabled=false;
    find("csv-original-file").required=false;
    find("csv-captured").value=defaults.captured_on||new Date().toISOString().slice(0,10);
    find("csv-dataset-url").value=defaults.dataset_url||current.manifest.dataset_url||"https://data.cms.gov/provider-data/dataset/xubh-q36u";
    const fields={"csv-origin":"origin","csv-resource":"resource_id","csv-source-url":"source_url","csv-dictionary-url":"dictionary_url","csv-released":"source_released","csv-modified":"source_modified","csv-archive-url":"archive_url","csv-archive-member":"archive_member"};
    for(const [id,key]of Object.entries(fields))find(id).value=defaults[key]||"";
    setEditionDates(defaults);
    find("csv-source-summary").textContent=filename+" · "+value.bytes+" original UTF-8 bytes · "+value.row_count+" source records · "+value.headers.length+" exact columns · SHA-256 "+value.sha256;
    statusText("Review every proposed mapping and enter this file's actual source edition. Unmapped columns are retained under their exact original headers.");
    return value;
  }
  find("csv-original-file").addEventListener("change",async event=>{
    const file=event.target.files?.[0],mine=++version;intake=null;prepared=null;resetConfirmation();
    find("csv-intake-fields").hidden=true;find("csv-source-summary").textContent="";find("csv-submit").disabled=true;find("csv-original-file").required=true;
    if(!file){statusText("");return;}statusText("Reading the exact original CSV…");
    try{
      const bytes=await file.arrayBuffer();if(mine!==version)return;
      const original=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(bytes);
      if(new TextEncoder().encode(original).length!==bytes.byteLength)throw Error("The original UTF-8 byte count changed during decoding.");
      loadOriginal(original,file.name);
    }catch(error){if(mine===version)statusText("Original CSV could not be read: "+error.message+" Use an original UTF-8 CSV; its bytes are retained without replacement or cell conversion.");}
  });
  find("csv-origin").addEventListener("change",()=>{
    resetConfirmation();if(find("csv-origin").value!=="derived-current-api-csv"){
      for(const id of ["csv-resource","csv-source-url","csv-dictionary-url","csv-released","csv-modified","csv-archive-url","csv-archive-member"])find(id).value="";
      setEditionDates();find("csv-captured").value=new Date().toISOString().slice(0,10);statusText("Enter the actual publisher edition. If its publication date is not supplied, choose that option and retain the source explanation. An archive date has its own meaning.");return;
    }
    const m=current.manifest;find("csv-resource").value=m.resource_id;find("csv-source-url").value=m.source_url||m.dataset_url;
    setEditionDates(m);find("csv-modified").value=m.source_modified||"";find("csv-dictionary-url").value=m.dictionary_url||"";
    find("csv-captured").value=m.captured_on||new Date().toISOString().slice(0,10);
    statusText("This choice requires byte-for-byte equality with the embedded current release's canonical CSV. Its original parent release remains attached.");
  });
  for(const input of form.querySelectorAll("input:not([type=file]):not([type=checkbox]),select:not([data-header]),textarea"))input.addEventListener("input",resetConfirmation);
  find("csv-confirm").addEventListener("change",invalidate);
  form.addEventListener("submit",event=>{
    event.preventDefault();if(!form.reportValidity()||!intake)return;invalidate();
    try{
      const selection={confirmed:find("csv-confirm").checked,placement:find("csv-placement").value,
        origin:find("csv-origin").value,resource_id:find("csv-resource").value,dataset_url:find("csv-dataset-url").value,
        source_url:find("csv-source-url").value,dictionary_url:find("csv-dictionary-url").value,captured_on:find("csv-captured").value,source_released:find("csv-publication-status").value==="unknown"?null:find("csv-released").value,
        archive_date:find("csv-archive-date").value,archive_date_meaning:find("csv-archive-meaning").value,date_provenance:selectedDateAttribution(),
        source_modified:find("csv-modified").value,archive_url:find("csv-archive-url").value,archive_member:find("csv-archive-member").value,
        mapping:[...find("csv-mapping-rows").querySelectorAll("select")].map(select=>({source_header:select.dataset.header,field:select.value}))};
      const result=prepareOriginalCsv(intake,selection,current,api,hash);
      onReceive(result.transfer,result.placement);
      prepared=result;find("csv-download-transfer").disabled=false;find("csv-download-request").disabled=false;
      statusText("Original edition received and reopened: "+result.release.manifest.row_count+" California records from "+result.release.manifest.source_row_count+" source records, "+result.release.manifest.field_count+" retained columns. The comparison is open below; save this edition and its mapping before closing.");
    }catch(error){statusText("Original CSV intake stopped: "+error.message);}
  });
  find("csv-download-transfer").addEventListener("click",()=>{if(prepared)download("cms-imported-complete.release.json",JSON.stringify(prepared.transfer,null,2)+"\n");});
  find("csv-download-request").addEventListener("click",()=>{if(prepared)download("cms-original-csv-request.json",JSON.stringify(prepared.request,null,2)+"\n");});
  return {loadOriginal,revision(){return version;},clear(){version++;find("csv-original-file").value="";intake=null;prepared=null;invalidate();find("csv-confirm").checked=false;find("csv-submit").disabled=true;find("csv-original-file").required=true;find("csv-intake-fields").hidden=true;},current(){return prepared;}};
}

"use strict";

const azureLabels = {
  amount:"Billing amount",currency:"Billing currency",resource_id:"Resource ID",
  resource_group:"Resource group",subscription_id:"Subscription ID",service:"Service",
  date:"Usage / purchase date",charge_type:"Charge type",tags:"Tags",
  billing_period_start:"Billing-period start",cost_allocation_rule:"Azure allocation rule",
  invoice_id:"Invoice ID",description:"Description",billing_account_id:"Billing account ID",
  billing_profile_id:"Billing profile ID"
};
let azureSelection={pane:"sources",profile:null,discovery:null,run:null,source:null,review:null,import:null,delivery:null,partition:0,offset:0};
let azureDriveState=null;
const azList=kind=>(workspace&&workspace[kind])||[];
const azRef=r=>({kind:r.kind,id:r.id,revision:r.revision});
const azButton=(action,title,r=null,extra="")=>'<button data-action="azure-'+action+'"'+(r?' data-id="'+h(r.id)+'" data-revision="'+r.revision+'"':"")+extra+'>'+h(title)+'</button>';
const azSelect=(id,records,selected="")=>'<select id="'+id+'">'+options(records,selected)+'</select>';
const azState=(state)=>badge(state||"");
const azBytes=n=>Number(n||0).toLocaleString()+" bytes";
const azPanel=(title,body)=>'<div class="panel"><h2>'+h(title)+'</h2>'+body+'</div>';
const azFile=(id,multiple=false,accept=".zip,.json")=>'<input type="file" id="'+id+'" accept="'+accept+'"'+(multiple?" multiple":"")+'>';
const azField=(name,id,selected,choices)=>'<label>'+h(name)+'<select id="'+id+'">'+choices.map(([v,l])=>'<option value="'+h(v)+'"'+(v===selected?" selected":"")+'>'+h(l)+'</option>').join("")+'</select></label>';

const azureDrafts=new Map(),azurePendingDrafts=new Map();
let azureDraftVersion=0;
const azDraftKey=(scope,id="new")=>JSON.stringify([workspace.workspace_id,scope,String(id||"new")]);
const azDraftPanel=(scope,id,title,body,revision=0)=>'<div class="panel" data-azure-draft="'+h(azDraftKey(scope,id))+'" data-azure-scope="'+scope+'" data-azure-revision="'+revision+'"><h2>'+h(title)+'</h2><div class="azure-draft-notice muted" hidden></div>'+body+'</div>';

function azureCaptureDraft(panel){
  if(!panel)return null;
  const key=panel.dataset.azureDraft,previous=azureDrafts.get(key),values={};
  panel.querySelectorAll("input[id],select[id],textarea[id]").forEach(field=>{
    if(["az-profile-select","az-preview-part"].includes(field.id))return;
    values[field.id]=field.type==="file"?Array.from(field.files?.length?field.files:previous?.values[field.id]||[]):field.type==="checkbox"?field.checked:field.value;
  });
  const draft={version:++azureDraftVersion,revision:previous?.revision??Number(panel.dataset.azureRevision),values};
  azureDrafts.set(key,draft);return {key,version:draft.version};
}
function azDraftMark(button,fields=null){
  const mark=azureCaptureDraft(button.closest("[data-azure-draft]"));
  return mark?{...mark,fields}:null;
}
function azFiles(id){
  const field=$(id),draft=field&&azureDrafts.get(field.closest("[data-azure-draft]")?.dataset.azureDraft);
  return Array.from(field?.files?.length?field.files:draft?.values[id]||[]);
}
async function azSave(action,body,mark){
  if(busy)throw new Error("The current operation is still running.");
  const pending=act(action,body);
  if(mark&&lastRequest?.action===action)azurePendingDrafts.set(lastRequest.body.operation_id,mark);
  return pending;
}
function azureAfterRender(){
  document.querySelectorAll("[data-azure-draft]").forEach(panel=>{
    const draft=azureDrafts.get(panel.dataset.azureDraft);if(!draft)return;
    panel.querySelectorAll("input[id],select[id],textarea[id]").forEach(field=>{
      if(!Object.hasOwn(draft.values,field.id))return;
      const saved=draft.values[field.id];
      if(field.type==="file"){
        if(saved.length){
          try{const transfer=new DataTransfer();saved.forEach(file=>transfer.items.add(file));field.files=transfer.files;}catch(error){}
          const retained=document.createElement("small");retained.className="muted";retained.textContent="Selected: "+saved.map(file=>file.name).join(", ");field.after(retained);
        }
      }else if(field.type==="checkbox")field.checked=saved;
      else{
        if(field.tagName==="SELECT"&&saved&&!Array.from(field.options).some(option=>option.value===saved)){
          const option=document.createElement("option");option.value=saved;option.textContent=saved+(field.id.startsWith("az-map-")?" (not in this partition)":" (retained selection)");field.append(option);
        }
        field.value=saved;
      }
    });
    const notice=panel.querySelector(".azure-draft-notice"),current=Number(panel.dataset.azureRevision);
    notice.hidden=false;
    notice.textContent=panel.dataset.azureScope==="profile"&&draft.revision&&current!==draft.revision?
      "These edits began at connection revision "+draft.revision+". Saved revision "+current+" is available. ":"Unsaved fields retained. ";
    const reset=document.createElement("button");reset.dataset.action="azure-reset-draft";reset.textContent="Reload saved fields";notice.append(reset);
    if(panel.dataset.azureScope==="profile"){
      const save=panel.querySelector('[data-action="azure-save-profile"]');
      if(save&&draft.revision)save.dataset.revision=String(draft.revision);
    }
  });
}
function azureCaptureInput(event){
  const panel=event.target.closest?.("[data-azure-draft]");if(!panel)return;
  if(event.target.type==="file"){
    const draft=azureDrafts.get(panel.dataset.azureDraft);
    if(draft)draft.values[event.target.id]=Array.from(event.target.files||[]);
  }
  azureCaptureDraft(panel);
}
document.addEventListener("input",azureCaptureInput);
document.addEventListener("change",azureCaptureInput);

async function azureRecord(kind,id,revision){
  if(!id)return null;
  try{return await entity(kind,id,revision);}catch(error){return null;}
}

function azureOperationSaved(action,record,payload={}){
  const mark=azurePendingDrafts.get(payload.operation_id);
  if(mark){
    const draft=azureDrafts.get(mark.key);
    if(draft?.version===mark.version){
      if(mark.fields)mark.fields.forEach(id=>delete draft.values[id]);
      else azureDrafts.delete(mark.key);
    }else if(draft&&action==="azure.profile.save"){
      draft.revision=record.revision;
      const nextKey=azDraftKey("profile",record.id);
      if(nextKey!==mark.key){azureDrafts.delete(mark.key);azureDrafts.set(nextKey,draft);}
    }
    azurePendingDrafts.delete(payload.operation_id);
  }
  const key={azure_profile:"profile",azure_discovery:"discovery",azure_run:"run",azure_source:"source",
    azure_review:"review",azure_import:"import",azure_delivery:"delivery"}[record.kind];
  if(key)azureSelection[key]=record.id;
  if(record.kind==="azure_receive"&&record.payload.source){
    azureSelection.source=record.payload.source.id;azureSelection.pane="sources";
  }
  if(record.kind==="azure_review")azureSelection.source=record.payload.source.id;
  if(action==="azure.source.select"||action==="azure.source.import")azureSelection.pane="sources";
}

async function azureView(){
  if(azureSelection.profile===null&&azList("azure_profile").length)azureSelection.profile=azList("azure_profile")[0].id;
  let body='<div class="actions azure-nav">'+[
    ["sources","Sources & billing"],["connection","Azure connection"],["runs","Native runs"],["receiving","Receiving & handoff"]
  ].map(([key,title])=>azButton("pane",title,null,' data-pane="'+key+'" aria-pressed="'+(key===azureSelection.pane)+'"')).join("")+'</div>';
  if(azureDriveState)body+='<div class="azure-progress" role="status">Continuing '+h(azureDriveState.kind)+' in the original workspace. '+azButton("stop","Stop after this transfer step")+'</div>';
  if(azureSelection.pane==="connection")body+=await azureConnectionView();
  else if(azureSelection.pane==="runs")body+=await azureRunsView();
  else if(azureSelection.pane==="receiving")body+=await azureReceivingView();
  else body+=await azureSourcesView();
  return '<div class="azure-workspace">'+body+'</div>';
}

async function azureConnectionView(){
  const record=await azureRecord("azure_profile",azureSelection.profile),p=record?record.payload:{};
  const select=azList("azure_profile").length?'<label>Saved Azure connection'+azSelect("az-profile-select",azList("azure_profile"),record&&record.id)+'</label>':"";
  const form=select+'<div class="panel-head"><p class="muted">Use an existing Azure scope and Blob container. Credential values stay in the operator process or its existing Azure CLI login.</p>'+azButton("new-profile","New connection")+'</div>'+
    '<div class="grid">'+input("Connection name","az-profile-label",p.label||"Monthly Azure export")+
    input("Existing Azure scope","az-profile-scope",p.scope||"")+
    input("Blob container URL","az-profile-container",p.container_url||"")+
    input("Native folder prefix","az-profile-prefix",p.prefix||"")+'</div>'+
    azField("Authentication","az-profile-credential",p.credential||"environment",[["environment","Environment credential references"],["azure_cli","Existing Azure CLI login"]])+
    '<div class="grid">'+input("Management token variable","az-profile-arm",p.arm_token_env||"AZURE_ARM_ACCESS_TOKEN")+
    input("Storage token variable","az-profile-storage",p.storage_token_env||"AZURE_STORAGE_ACCESS_TOKEN")+
    input("Container SAS variable, if used","az-profile-sas",p.storage_sas_env||"")+
    input("Azure CLI subscription, if selected","az-profile-subscription",p.subscription||"")+'</div>'+
    '<details><summary>API and equipped local source settings</summary><div class="grid">'+
    input("Cost Management API version","az-profile-version",p.api_version||"2025-03-01")+
    input("Local protocol origin, if already configured","az-profile-local",p.local_endpoint||"")+'</div></details>'+
    '<div class="actions">'+azButton("save-profile",record?"Save connection revision":"Save connection",record)+
    (record?historyButton(record):"")+'</div>';
  let body=azDraftPanel("profile",record?.id,"Azure source connection",form,record?.revision||0);
  if(!record)return body;
  const discovery=await azureRecord("azure_discovery",azureSelection.discovery);
  let query='<p>Read existing export definitions or the actual files in this container. Every page and native continuation stays attached to this selection.</p><div class="actions">'+
    azButton("discover-exports","Read exports",record)+azButton("discover-blobs","Read container files",record)+'</div>';
  if(azList("azure_discovery").length)query+=rowsTable(["Retained discovery","Pages","State",""],azList("azure_discovery").map(r=>'<tr><td>'+h(label(r))+'</td><td>'+r.payload.pages.length+'</td><td>'+azState(r.payload.state)+'</td><td>'+azButton("open-discovery","Open retained discovery",r)+'</td></tr>'));
  if(discovery){
    const d=discovery.payload,profileData=' data-profile="'+h(d.profile.id)+'" data-profile-revision="'+d.profile.revision+'"';
    query+='<div class="panel-head"><h3>'+h(d.label)+'</h3>'+azState(d.state)+'</div><p>Connection revision '+d.profile.revision+' · '+d.items.length+' retained entries · '+d.pages.length+' pages</p>'+
      (d.error?'<p class="azure-error">'+h(d.error)+'</p>':"")+'<div class="actions">'+
      azButton("advance-discovery","Read next page",discovery)+azButton("drive-discovery","Read remaining pages",discovery)+historyButton(discovery)+'</div>';
    if(d.category==="exports")query+=rowsTable(["Export","Dataset","Format",""],d.items.map(item=>{
      const x=item.properties||{},def=x.definition||{};
      return '<tr><td>'+h(item.name)+'<div class="muted mono">'+h(item.id)+'</div></td><td>'+h(def.type)+'<div class="muted">'+h(def.timeframe)+'</div></td><td>'+h(x.format)+' / '+h(x.compressionMode||"None")+'</td><td>'+azButton("use-export","Inspect monthly runs",null,' data-export="'+h(item.id)+'"'+profileData)+'</td></tr>';
    }));
    else if(d.category==="blobs")query+=rowsTable(["Native file","Bytes","Modified",""],d.items.map(item=>'<tr><td class="mono">'+h(item.name)+'</td><td>'+azBytes(item.bytes)+'</td><td>'+h(item.modified)+'</td><td>'+azButton("choose-manifest","Select as manifest",null,' data-path="'+h(item.name)+'"'+profileData)+'</td></tr>'));
    else query+=rowsTable(["Run","State","Period"],d.items.map(item=>'<tr><td class="mono">'+h(item.id)+'</td><td>'+h(item.properties?.status)+'</td><td>'+h(item.properties?.startDate)+' → '+h(item.properties?.endDate)+'</td></tr>'));
  }
  body+=azPanel("Discover original Azure sources",query);
  body+=azDraftPanel("manifest",record.id,"Open an exact manifest",'<p class="muted">Use the complete manifestFile path returned by Azure run history, or a manifest selected from the retained container listing.</p>'+
    input("Original manifest blob path","az-direct-manifest")+
    azButton("select-manifest","Acquire original manifest",record));
  return body;
}

let azureChosenExport="",azureChosenProfile=null;
async function azureRunsView(){
  let profiles=azList("azure_profile");
  if(azureChosenProfile){
    const selected=await azureRecord("azure_profile",azureChosenProfile.id,azureChosenProfile.revision);
    if(selected)profiles=profiles.map(profile=>profile.id===selected.id?selected:profile);
  }
  const record=await azureRecord("azure_run",azureSelection.run),p=record&&record.payload;
  let body=azDraftPanel("run","prepare","Inspect or run an existing monthly export",
    '<p>The prepared selection reads the existing export definition. <strong>Run selected month</strong> executes that original export once. Its saved execution boundary and history are used for recovery.</p>'+
    '<div class="grid"><label>Azure connection'+azSelect("az-run-profile",profiles,azureChosenProfile?.id||azureSelection.profile)+'</label>'+
    input("Existing export resource ID","az-run-export",azureChosenExport||p?.export_id||"")+
    input("Billing month","az-run-period",p?.period||"","month")+
    input("Run label","az-run-label",p?.label||"Monthly cost export")+'</div>'+
    azButton("prepare-run","Prepare monthly selection"));
  if(azList("azure_run").length)body+=azPanel("Retained run selections",rowsTable(["Selection","Month","State",""],azList("azure_run").map(r=>'<tr><td>'+h(label(r))+'</td><td>'+h(r.payload.period)+'</td><td>'+azState(r.payload.state)+'</td><td>'+azButton("open-run","Open",r)+'</td></tr>')));
  if(!record)return body;
  let detail='<div class="panel-head"><h3>'+h(p.label)+'</h3>'+azState(p.state)+'</div><p class="mono">'+h(p.export_id)+'</p><p>'+h(p.time_period.from)+' → '+h(p.time_period.to)+' UTC</p>'+
    '<div class="actions">'+(p.state==="prepared"?azButton("submit-run","Run selected month",record):"")+
    azButton("refresh-run",p.history_next?"Read next history page":"Refresh original run history",record)+historyButton(record)+
    objectButton(p.original_definition.file,"Original export definition")+'</div>'+
    (p.error?'<p class="azure-error">'+h(p.error)+'</p>':"")+
    '<p class="muted">Choose the actual native execution ID. The source importer uses its completed manifest and selected destination.</p>';
  if(p.candidates?.length)detail+=rowsTable(["Native execution","Status","Period",""],p.candidates.map(item=>{
    const x=item.properties||{};
    return '<tr><td class="mono">'+h(item.id)+'<div class="muted">'+h(x.submittedTime)+'</div></td><td>'+h(x.status)+'</td><td>'+h(x.startDate)+' → '+h(x.endDate)+'</td><td>'+azButton("select-run","Select this execution",record,' data-native="'+h(item.id)+'"')+'</td></tr>';
  }));
  if(p.selected_run)detail+='<h3>Selected native execution</h3><p class="mono">'+h(p.selected_run.id)+'</p><p>'+h(p.native_status)+' · '+h(p.selected_run.properties?.manifestFile)+'</p>'+
    (p.state==="completed"?azButton("acquire-run","Acquire this run’s manifest",record):"");
  return body+azPanel("Original execution and recovery",detail);
}

async function azureSourcesView(){
  let body=azDraftPanel("native","input","Receive original source files",
    '<p>Open the native Azure manifest and its complete partition ZIP, or choose the manifest alone and receive/download its files in place.</p><div class="grid"><label>Native manifest or full source ZIP'+azFile("az-native-file")+'</label>'+
    input("Manifest path inside ZIP","az-native-manifest","manifest.json")+
    input("ZIP prefix before native blob paths","az-native-prefix","")+'</div>'+
    '<label>Source note<textarea id="az-native-note" rows="2"></textarea></label>'+azButton("import-native","Retain original source"));
  body+=azPanel("Acquired source editions",azList("azure_source").length?rowsTable(["Source edition","Dataset / version","Native files","State",""],azList("azure_source").map(r=>{
    const p=r.payload;
    return '<tr><td>'+h(label(r))+'<div class="muted">'+h(p.run?.runId||r.id)+'</div></td><td>'+h(p.dataset_type)+'<div class="muted">'+h(p.data_version)+'</div></td><td>'+p.parts.length+' · '+azBytes(p.received_bytes)+' / '+azBytes(p.bytes)+'</td><td>'+azState(p.state)+'</td><td>'+azButton("open-source","Open",r)+'</td></tr>';
  })):empty("Select an Azure source","Read the existing Azure exports or receive their native files."));
  const record=await azureRecord("azure_source",azureSelection.source);
  if(!record)return body;
  const p=record.payload;
  let detail='<div class="panel-head"><div><h3>'+h(p.label)+'</h3><p class="mono">'+h(p.manifest_path)+'</p></div>'+azState(p.state)+'</div>'+
    '<div class="grid"><p><strong>'+h(p.dataset_type)+'</strong><br>Data version '+h(p.data_version)+'</p><p>'+h(p.run?.startDate)+' → '+h(p.run?.endDate)+'<br>'+h(p.delivery_config?.dataOverwriteBehavior||"Original selected edition")+'</p></div>'+
    '<p>'+azBytes(p.received_bytes)+' of '+azBytes(p.bytes)+' retained · '+p.parts.filter(part=>part.file).length+' of '+p.parts.length+' complete partitions</p>'+
    '<div class="actions">'+objectButton(p.manifest,"Native manifest")+historyButton(record)+inspectButton(record)+
    (p.state!=="complete"?azButton("advance-source","Transfer next range",record)+azButton("drive-source","Continue all partitions",record)+
      azButton(p.state==="canceled"||p.state==="waiting"||p.state==="attention"?"resume-source":"cancel-source",p.state==="canceled"||p.state==="waiting"||p.state==="attention"?"Resume retained transfer":"Cancel transfer",record):"")+'</div>'+
    (p.error?'<p class="azure-error">'+h(p.error)+'</p>':"")+
    '<details><summary>Bind an existing connection</summary><label>Same source container'+azSelect("az-bind-profile",azList("azure_profile"),p.profile?.id||azureSelection.profile)+'</label>'+azButton("bind-source","Bind connection",record)+'</details>';
  detail+=rowsTable(["Partition","Rows / bytes","Received","Original file"],p.parts.map(part=>'<tr><td class="mono">'+h(part.name)+'</td><td>'+h(part.rows==null?"Native row count unavailable":part.rows)+'<br>'+azBytes(part.bytes)+'</td><td>'+azBytes(part.received)+'</td><td>'+(part.file?objectButton(part.file,"Download original"):'<label>Complete native file'+azFile("az-part-"+part.index,false,".csv,.gz,.gzip,.parquet")+'</label>'+azButton("receive-part","Receive this partition",record,' data-partition="'+part.index+'"'))+'</td></tr>'));
  body+=azDraftPanel("source-files",record.id,"Retained native edition",detail,record.revision);
  if(p.state!=="complete")return body;
  if(!p.parts.length)return body+azPanel("Complete empty export","<p>The original native manifest contains no partitions. Its complete source and run remain retained.</p>");
  const sourceReviews=azList("azure_review").filter(r=>r.payload.source.id===record.id&&r.payload.source.revision===record.revision);
  let review=await azureRecord("azure_review",azureSelection.review);
  if(!review||review.payload.source.id!==record.id||review.payload.source.revision!==record.revision)review=sourceReviews[0]?await entity("azure_review",sourceReviews[0].id):null;
  if(review)azureSelection.review=review.id;
  const supplied=review?.payload.settings||p.received_review?.payload?.settings||{};
  const partIndex=Math.min(azureSelection.partition,Math.max(0,p.parts.length-1));
  let previewData;
  try{previewData=await request("/api/azure/preview?"+new URLSearchParams({id:record.id,revision:record.revision,partition:partIndex,offset:azureSelection.offset,limit:20}));}
  catch(error){return body+azPanel("Original row review",'<p class="azure-error">'+h(error.message)+'</p>');}
  const fields=Object.keys(azureLabels);
  const mapping=supplied.columns||previewData.suggested;
  let sourceReview='<div class="grid"><label>Original partition<select id="az-preview-part">'+p.parts.map(part=>'<option value="'+part.index+'"'+(part.index===partIndex?" selected":"")+'>'+h(part.name)+'</option>').join("")+'</select></label>'+
    input("Billing month","az-review-period",supplied.period||String(p.run?.startDate||"").slice(0,7),"month")+
    azField("Native cost basis","az-review-basis",supplied.basis||(p.dataset_type==="AmortizedCost"?"amortized":"actual"),[["actual","Actual cost"],["amortized","Amortized cost"]])+
    azField("Provider allocation view","az-review-view",supplied.allocation_view||"supplier",[["supplier","Supplier cost"],["allocated","Existing Azure allocated view"]])+
    azField("Supplier period status","az-review-status",supplied.invoice_status||"provisional",[["provisional","Provisional"],["closed","Closed supplier period"]])+
    input("Invoice reference","az-review-invoice",supplied.invoice_id||"")+
    azField("Billing-period date format","az-review-date",supplied.date_format||"iso",[["iso","ISO"],["month_first","Month / day / year"],["day_first","Day / month / year"]])+'</div>'+
    '<details open><summary>Map original columns</summary><div class="grid">'+fields.map(field=>'<label>'+h(azureLabels[field])+'<select id="az-map-'+field+'"><option value="">'+(["amount","currency"].includes(field)?"Select a source column":"Omit this field")+'</option>'+previewData.headers.map(header=>'<option value="'+h(header)+'"'+(mapping[field]===header?" selected":"")+'>'+h(header)+'</option>').join("")+'</select></label>').join("")+'</div></details>'+
    '<label>Source review note<textarea id="az-review-note" rows="3">'+h(review?.payload.note||p.received_review?.payload?.note||"")+'</textarea></label>'+
    '<div class="actions">'+azButton("review-source","Save complete source review",record)+
    (p.received_review?azButton("restore-review","Restore received mapping",record):"")+'</div>'+
    '<h3>Original source rows</h3><div class="actions">'+azButton("preview-prev","Previous rows",null,azureSelection.offset===0?" disabled":"")+
    azButton("preview-next","Next rows",null,azureSelection.offset+20>=previewData.total?" disabled":"")+
    '<span>'+previewData.total+' complete original rows</span></div>'+
    rowsTable(["Native row",...previewData.headers],previewData.rows.map(row=>'<tr><td>'+row.ordinal+'</td>'+previewData.headers.map(header=>'<td>'+h(row.values[header])+'</td>').join("")+'</tr>'));
  body+=azDraftPanel("review",record.id+"@"+record.revision,"Review the complete monthly source",sourceReview,record.revision);
  if(review){
    const r=review.payload;
    body+=azPanel("Saved source review",'<div class="panel-head"><h3>'+h(r.label)+'</h3>'+azState(r.state)+'</div>'+
      '<p>'+r.rows+' rows · '+r.batches.length+' complete billing inputs · '+Object.entries(r.totals).map(([c,t])=>h(c+" "+t)).join(" / ")+'</p>'+
      '<p>'+h(r.note)+'</p><div class="actions">'+azButton("prepare-import","Prepare billing import",review)+
      azButton("prepare-handoff","Prepare portable source handoff",record,' data-review="'+h(review.id)+'" data-review-revision="'+review.revision+'"')+historyButton(review)+'</div>'+
      rowsTable(["Billing input","Currency","Rows",""],r.batches.map(batch=>'<tr><td>'+h(batch.file.name)+'</td><td>'+h(batch.currency)+'</td><td>'+batch.rows+'</td><td>'+objectButton(batch.file,"Reviewed input")+'</td></tr>')));
  }
  const imports=azList("azure_import").filter(r=>r.payload.source.id===record.id);
  if(imports.length)body+=azPanel("Import into the original agency billing engine",imports.map(r=>{
    const x=r.payload;
    return '<section class="azure-import"><div class="panel-head"><h3>'+h(x.label)+'</h3>'+azState(x.state)+'</div>'+
      '<p>'+x.cursor+' of '+x.batch_count+' reviewed inputs imported</p><div class="actions">'+
      (x.state!=="complete"?azButton("advance-import","Import next input",r)+azButton("drive-import","Complete reviewed import",r):"")+
      azButton("open-billing","Open agency billing")+historyButton(r)+'</div>'+
      (x.imports?.length?rowsTable(["Original billing input","Currency","Rows"],x.imports.map(item=>'<tr><td class="mono">'+h(item.billing.id)+'</td><td>'+h(item.currency)+'</td><td>'+item.rows+'</td></tr>')):"")+'</section>';
  }).join(""));
  return body;
}

async function azureReceivingView(){
  let body=azDraftPanel("volumes","input","Receive a portable Azure source",
    '<p>Receive every numbered source volume. Each complete file is reconstructed and checked against its original byte identity. Volumes can arrive in any order, and repeated volumes reopen the same receipt.</p>'+
    '<label>Original receiving ZIP volumes'+azFile("az-receive-volumes",true,".zip")+'</label>'+
    azButton("receive-volumes","Receive selected volumes"));
  if(azList("azure_receive").length)body+=azPanel("Receiving records",azList("azure_receive").map(r=>{
    const p=r.payload;
    return '<section class="azure-import"><h3>'+h(p.label)+'</h3><p>'+h(p.state)+' · '+p.volumes.length+' retained volumes · '+p.missing_objects+' original objects remaining</p>'+
      (p.source?azButton("open-source","Open received source",{id:p.source.id,revision:p.source.revision}):"")+historyButton(r)+'</section>';
  }).join(""));
  const sources=azList("azure_source").filter(r=>r.payload.state==="complete");
  body+=azDraftPanel("handoff","selection","Prepare an independent receiving handoff",'<p>The handoff contains the original native manifest, every exact partition, acquisition metadata, and the selected reviewed mapping. Large sources use complete numbered volumes.</p>'+
    '<label>Complete acquired source'+azSelect("az-export-source",sources,azureSelection.source)+'</label>'+
    '<label>Saved source review, if selected'+azSelect("az-export-review",azList("azure_review"),azureSelection.review)+'</label>'+
    azButton("prepare-selected-handoff","Prepare complete source handoff"));
  if(azList("azure_delivery").length)body+=azPanel("Portable source deliveries",azList("azure_delivery").map(r=>{
    const p=r.payload;
    return '<section class="azure-import"><div class="panel-head"><h3>'+h(p.label)+'</h3>'+azState(p.state)+'</div>'+
      '<p>'+p.cursor+' prepared volumes</p><div class="actions">'+
      (p.state!=="complete"?azButton("advance-handoff","Build next volume",r)+azButton("drive-handoff","Build all source volumes",r):"")+
      objectButton(p.descriptor,"Receiving descriptor")+historyButton(r)+'</div>'+
      p.volumes.map(file=>'<p>'+h(file.name)+' · '+azBytes(file.bytes)+' '+objectButton(file,"Download volume")+'</p>').join("")+'</section>';
  }).join(""));
  return body+azPanel("Whole-workspace recovery",'<p>Use the original Handoff &amp; recovery tab to save all Azure sources, transfer checkpoints, reviewed imports, agency policies and finalized periods together. Restore that encrypted workspace to a new path and reopen its saved work.</p>'+azButton("open-recovery","Open complete workspace recovery"));
}

async function azureDrive(kind,id){
  if(azureDriveState)throw new Error("A source continuation is already active in this browser.");
  const lookup={source:["azure_source","azure.source.advance"],discovery:["azure_discovery","azure.discovery.advance"],
    import:["azure_import","azure.import.advance"],handoff:["azure_delivery","azure.handoff.advance"]};
  const [entityKind,action]=lookup[kind];
  azureDriveState={kind,id,stop:false};
  try{
    while(!azureDriveState.stop){
      const record=await entity(entityKind,id);
      if(record.payload.state==="complete")break;
      if(["attention","source_changed","canceled","waiting"].includes(record.payload.state))break;
      const saved=await act(action,{id,expected:record.revision});
      if(saved.payload.state==="complete"||["attention","source_changed","waiting"].includes(saved.payload.state))break;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    if(azureDriveState.stop&&kind==="source"){
      const record=await entity(entityKind,id);
      if(record.payload.state!=="complete")await act("azure.source.cancel",{id,expected:record.revision});
    }
  }finally{azureDriveState=null;await render();}
}

async function azUpload(id){
  const file=azFiles(id)[0];
  if(!file)throw new Error("Select the complete original input file.");
  return filePayload(file);
}

async function azureAction(action,button){
  const id=button.dataset.id,expected=Number(button.dataset.revision);
  const body={id,expected};
  if(action==="azure-reset-draft"){
    const panel=button.closest("[data-azure-draft]");azureDrafts.delete(panel.dataset.azureDraft);
    if(panel.dataset.azureScope==="run"){azureChosenExport="";azureChosenProfile=null;}
    await render();return;
  }
  if(action==="azure-pane"){azureSelection.pane=button.dataset.pane;await render();return;}
  if(action==="azure-stop"){if(azureDriveState)azureDriveState.stop=true;notify("The current native range will finish, then this transfer will retain its checkpoint and stop.");return;}
  if(action==="azure-new-profile"){azureSelection.profile=false;await render();return;}
  if(action==="azure-save-profile"){
    const mark=azDraftMark(button);
    const record=await azSave("azure.profile.save",{...(id?body:{}),
      label:value("az-profile-label"),scope:value("az-profile-scope"),container_url:value("az-profile-container"),
      prefix:value("az-profile-prefix"),credential:value("az-profile-credential"),arm_token_env:value("az-profile-arm"),
      storage_token_env:value("az-profile-storage"),storage_sas_env:value("az-profile-sas"),
      subscription:value("az-profile-subscription"),api_version:value("az-profile-version"),local_endpoint:value("az-profile-local")},mark);
    azureSelection.profile=record.id;return;
  }
  if(action==="azure-discover-exports"||action==="azure-discover-blobs"){
    const record=await act("azure.discovery.start",{profile_id:id,profile_revision:expected,category:action.endsWith("blobs")?"blobs":"exports"});
    await act("azure.discovery.advance",{id:record.id,expected:record.revision});return;
  }
  if(action==="azure-open-discovery"){
    const record=await entity("azure_discovery",id,expected);
    azureSelection.discovery=id;azureSelection.profile=record.payload.profile.id;azureSelection.pane="connection";
    await render();return;
  }
  if(action==="azure-advance-discovery")return act("azure.discovery.advance",body);
  if(action==="azure-drive-discovery")return azureDrive("discovery",id);
  if(action==="azure-use-export"){
    azureChosenExport=button.dataset.export;azureChosenProfile={id:button.dataset.profile,revision:Number(button.dataset.profileRevision)};
    const draft=azureDrafts.get(azDraftKey("run","prepare"));
    if(draft){draft.values["az-run-export"]=azureChosenExport;draft.values["az-run-profile"]=azureChosenProfile.id;draft.version=++azureDraftVersion;}
    azureSelection.pane="runs";await render();return;
  }
  if(action==="azure-choose-manifest")return act("azure.source.select",{profile_id:button.dataset.profile,profile_revision:Number(button.dataset.profileRevision),manifest_path:button.dataset.path});
  if(action==="azure-select-manifest")return azSave("azure.source.select",{profile_id:id,profile_revision:expected,manifest_path:value("az-direct-manifest")},azDraftMark(button));
  if(action==="azure-prepare-run"){
    const profileId=value("az-run-profile"),profile=azureChosenProfile?.id===profileId?azureChosenProfile:azList("azure_profile").find(r=>r.id===profileId);
    if(!profile)throw new Error("Select a saved Azure connection.");
    return azSave("azure.run.prepare",{profile_id:profileId,profile_revision:profile.revision,export_id:value("az-run-export"),period:value("az-run-period"),label:value("az-run-label")},azDraftMark(button));
  }
  if(action==="azure-open-run"){azureSelection.run=id;azureSelection.pane="runs";await render();return;}
  if(action==="azure-submit-run")return act("azure.run.submit",body);
  if(action==="azure-refresh-run")return act("azure.run.refresh",body);
  if(action==="azure-select-run")return act("azure.run.select",{...body,native_run_id:button.dataset.native});
  if(action==="azure-acquire-run"){
    const record=await entity("azure_run",id,expected);
    return act("azure.source.select",{profile_id:record.payload.profile.id,profile_revision:record.payload.profile.revision,run_id:id,run_revision:expected});
  }
  if(action==="azure-import-native"){
    const mark=azDraftMark(button),settings={manifest_path:value("az-native-manifest"),archive_prefix:value("az-native-prefix"),note:value("az-native-note")};
    return azSave("azure.source.import",{...settings,...await azUpload("az-native-file")},mark);
  }
  if(action==="azure-open-source"){azureSelection.source=id;azureSelection.review=null;azureSelection.partition=0;azureSelection.offset=0;azureSelection.pane="sources";await render();return;}
  if(action==="azure-receive-part"){
    const partition=Number(button.dataset.partition),mark=azDraftMark(button,["az-part-"+partition]),file=azFiles("az-part-"+partition)[0];
    const record=await entity("azure_source",id,expected);
    return azSave("azure.source.receive",{...body,partition,native_name:record.payload.parts[partition].name,...await filePayload(file)},mark);
  }
  if(action==="azure-bind-source")return act("azure.source.bind",{...body,profile_id:value("az-bind-profile")});
  if(action==="azure-advance-source")return act("azure.source.advance",body);
  if(action==="azure-drive-source")return azureDrive("source",id);
  if(action==="azure-cancel-source")return act("azure.source.cancel",body);
  if(action==="azure-resume-source")return act("azure.source.resume",body);
  if(action==="azure-preview-prev"){azureSelection.offset=Math.max(0,azureSelection.offset-20);await render();return;}
  if(action==="azure-preview-next"){azureSelection.offset+=20;await render();return;}
  if(action==="azure-review-source"){
    const columns={};Object.keys(azureLabels).forEach(field=>columns[field]=value("az-map-"+field));
    return azSave("azure.source.review",{source_id:id,source_revision:expected,period:value("az-review-period"),
      basis:value("az-review-basis"),allocation_view:value("az-review-view"),invoice_status:value("az-review-status"),
      invoice_id:value("az-review-invoice"),date_format:value("az-review-date"),columns,note:value("az-review-note")},azDraftMark(button));
  }
  if(action==="azure-restore-review"){
    const mark=azDraftMark(button),record=await entity("azure_source",id,expected),review=record.payload.received_review;
    if(!review)throw new Error("This acquired source has no received mapping.");
    return azSave("azure.source.review",{source_id:id,source_revision:expected,...review.payload.settings,note:review.payload.note},mark);
  }
  if(action==="azure-prepare-import"){
    const record=await act("azure.import.prepare",{review_id:id,review_revision:expected});
    if(record.payload.state!=="complete")return azureDrive("import",record.id);
    return;
  }
  if(action==="azure-advance-import")return act("azure.import.advance",body);
  if(action==="azure-drive-import")return azureDrive("import",id);
  if(action==="azure-open-billing")return changeTab("billing");
  if(action==="azure-prepare-handoff"||action==="azure-prepare-selected-handoff"){
    const requestBody=action==="azure-prepare-handoff"?{source_id:id,source_revision:expected,review_id:button.dataset.review,review_revision:Number(button.dataset.reviewRevision)}:
      {source_id:value("az-export-source"),...(value("az-export-review")?{review_id:value("az-export-review")}:{})};
    const record=await azSave("azure.handoff.prepare",requestBody,azDraftMark(button));
    azureSelection.pane="receiving";await render();
    return azureDrive("handoff",record.id);
  }
  if(action==="azure-advance-handoff")return act("azure.handoff.advance",body);
  if(action==="azure-drive-handoff")return azureDrive("handoff",id);
  if(action==="azure-receive-volumes"){
    const mark=azDraftMark(button),files=azFiles("az-receive-volumes");
    if(!files.length)throw new Error("Select the original receiving volumes.");
    for(let index=0;index<files.length;index++){
      const payload=await filePayload(files[index]);
      if(index===files.length-1)await azSave("azure.handoff.receive",payload,mark);
      else await act("azure.handoff.receive",payload);
    }
    return;
  }
  if(action==="azure-open-recovery")return changeTab("delivery");
}

document.addEventListener("change",event=>run(async()=>{
  if(event.target.id==="az-run-profile"){
    const profile=azList("azure_profile").find(r=>r.id===event.target.value);
    azureChosenProfile=profile?azRef(profile):null;
  }
  if(event.target.id==="az-profile-select"){azureSelection.profile=event.target.value;azureSelection.discovery=null;await render();}
  if(event.target.id==="az-preview-part"){azureSelection.partition=Number(event.target.value);azureSelection.offset=0;await render();}
}));

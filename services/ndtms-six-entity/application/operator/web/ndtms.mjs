/* NDTMS view for the existing source/migration workspace.
 * Uses its original task, object, revision, source-correction and backup APIs.
 */
export function createNdtmsView(c) {
  const {state,esc,json,fmt,short,time,records,record,page,api,mutate,render,
    selection,button,field,select,form,value,submit,panel,body,empty,pageHeader,
    details,table,paging,artifact,artifacts,recordButton,dialog,saveJSON,saveBlob,
    withChange,beginContract,inspectRow,notice} = c;
  const entities = [
    ["client","Clients"],["episode","Episodes"],["intervention","Interventions"],
    ["sir","SIR records"],["top_ypor","TOP / YPOR records"],["cir","CIR records"]
  ];
  let cataloguePromise, fieldFilter="", entityFilter="", findingsOffset=0, rowsOffset=0;
  let selectedEntity="client", draft=null, draftOwner=null, savedRevision=0, savePending=false;
  let saving=false, saveAgain=false, draftError="", conflict=null, draftGeneration=0;
  const scopeDefaults=()=>({editionId:"",tableId:"",profileId:"ndtms-cds-r-technical-v1.3-20261013",
    cohort:"adult",scope:{kind:"full",from:"",to:"",agency:"",note:"",priorSubmission:{editionId:"",reference:"",note:""}}});
  const clone=x=>JSON.parse(JSON.stringify(x));
  let databasePromise;
  function database() {
    if(!databasePromise) databasePromise=new Promise((resolve,reject)=>{
      if(!globalThis.indexedDB){reject(new Error("Browser draft storage is unavailable."));return;}
      const request=indexedDB.open("ndtms-source-drafts-v1",1);
      request.onupgradeneeded=()=>request.result.createObjectStore("drafts",{keyPath:"workspaceId"});
      request.onerror=()=>reject(request.error||new Error("Draft storage could not open."));
      request.onsuccess=()=>resolve(request.result);
    });
    return databasePromise;
  }
  async function draftRead(workspaceId) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("drafts","readonly"),request=tx.objectStore("drafts").get(workspaceId);
      request.onsuccess=()=>resolve(request.result||null);
      request.onerror=()=>reject(request.error||new Error("The saved draft could not be read."));
    });
  }
  async function draftWrite(workspaceId,input,expected) {
    const db=await database();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("drafts","readwrite"),store=tx.objectStore("drafts");
      let result,failure;
      const get=store.get(workspaceId);
      get.onsuccess=()=>{
        const previous=get.result||null,revision=previous?.revision||0;
        if(revision!==expected){failure={code:"DRAFT_CONFLICT",saved:previous};tx.abort();return;}
        result={workspaceId,revision:revision+1,value:clone(input),updatedAt:new Date().toISOString()};
        store.put(result);
      };
      tx.oncomplete=()=>resolve(result);
      tx.onabort=()=>reject(failure||tx.error||new Error("The draft was not saved."));
      tx.onerror=()=>{};
    });
  }
  function validDraft(x) {
    if(!x||typeof x!=="object"||Array.isArray(x)||!x.scope||typeof x.scope!=="object")return false;
    return ["editionId","tableId","profileId","cohort"].every(k=>typeof x[k]==="string"&&x[k].length<=20000)
      &&["kind","from","to","agency","note"].every(k=>typeof x.scope[k]==="string"&&x.scope[k].length<=200000)
      &&(!x.scope.priorSubmission||["editionId","reference","note"].every(k=>typeof x.scope.priorSubmission[k]==="string"&&x.scope.priorSubmission[k].length<=200000));
  }
  async function ensureDraft() {
    const owner=state.overview.workspace.id;
    if(draftOwner===owner&&draft)return;
    draftOwner=owner;draft=scopeDefaults();savedRevision=0;conflict=null;draftError="";draftGeneration++;
    try {
      const saved=await draftRead(owner);
      if(saved){
        if(saved.workspaceId!==owner||!Number.isSafeInteger(saved.revision)||saved.revision<1||!validDraft(saved.value)){
          conflict={saved};draftError="The stored draft needs recovery. Its complete original is available below.";
        } else {draft=clone(saved.value);draft.scope.priorSubmission||={editionId:"",reference:"",note:""};savedRevision=saved.revision;}
      }
    } catch(error){draftError=error.message;}
  }
  function statusText() {
    if(conflict)return "Another saved draft is retained. Your current writing stays here; download either version before choosing one.";
    if(draftError)return "Current writing is retained in this tab. "+draftError;
    return savePending||saving?"Saving the complete input draft…":"Input draft saved in this browser.";
  }
  function updateStatus() {
    const el=document.querySelector("#ndtms-draft-status");
    if(el)el.textContent=statusText();
    const controls=document.querySelector("#ndtms-recovery-controls");if(controls)controls.hidden=!(conflict||draftError);
  }
  async function persistDraft() {
    saveAgain=true;if(saving||conflict)return;
    saving=true;updateStatus();
    try {
      while(saveAgain&&!conflict){
        saveAgain=false;
        const owner=draftOwner,input=clone(draft),generation=draftGeneration,expected=savedRevision;
        try{
          const saved=await draftWrite(owner,input,expected);
          if(owner===draftOwner&&generation===draftGeneration){savedRevision=saved.revision;draftError="";savePending=saveAgain;}
        }catch(error){
          if(owner===draftOwner&&generation===draftGeneration){
            if(error?.code==="DRAFT_CONFLICT")conflict={saved:error.saved};
            else draftError=error?.message||"The browser could not save this draft.";
          }
          break;
        }
      }
    }finally{saving=false;updateStatus();}
  }
  function capture(formNode) {
    if(!draft)return;
    const next=clone(draft);
    for(const key of ["editionId","tableId","cohort"])if(formNode.elements.namedItem(key))next[key]=value(formNode,key);
    for(const key of ["kind","from","to","agency","note"])if(formNode.elements.namedItem("scope_"+key))next.scope[key]=value(formNode,"scope_"+key);
    next.scope.priorSubmission||={editionId:"",reference:"",note:""};
    for(const key of ["editionId","reference","note"])if(formNode.elements.namedItem("prior_"+key))next.scope.priorSubmission[key]=value(formNode,"prior_"+key);
    draft=next;savePending=true;persistDraft();
  }
  document.addEventListener("input",event=>{
    const target=event.target.closest?.("#ndtms-analysis-form");if(target)capture(target);
  });
  document.addEventListener("change",event=>{
    const target=event.target.closest?.("#ndtms-analysis-form");if(target)capture(target);
  });
  async function recoverDraft(useCurrent) {
    if(saving)throw new Error("Wait for the current browser draft write to finish.");
    const current=clone(draft),saved=await draftRead(draftOwner);
    saveJSON({workspaceId:draftOwner,current,saved},"NDTMS_Input_Draft_Recovery.json");
    if(!confirm(useCurrent?"The complete saved and current drafts have been downloaded. Replace the saved draft with the current input?":"The complete saved and current drafts have been downloaded. Open the saved draft in these controls?"))return;
    if(!useCurrent){
      if(!saved||!validDraft(saved.value))throw new Error("The saved record is not a valid input draft; its complete bytes remain in the recovery download.");
      draft=clone(saved.value);draft.scope.priorSubmission||={editionId:"",reference:"",note:""};savedRevision=saved.revision;conflict=null;draftError="";savePending=false;await render();return;
    }
    savedRevision=saved?.revision||0;conflict=null;draftError="";draft= current;savePending=true;await persistDraft();await render();
  }
  async function profile() {
    if(!cataloguePromise)cataloguePromise=api("/api/ndtms-profile").catch(error=>{cataloguePromise=null;throw error;});
    return cataloguePromise;
  }
  function cataloguePanel(catalogue) {
    const query=fieldFilter.toLowerCase();
    const list=catalogue.fields.filter(f=>(!entityFilter||f.entity===entityFilter)&&(!query||[f.header,f.layout,f.entity,...f.inclusion,...f.rules].join(" ").toLowerCase().includes(query)));
    const controls=form('<div class="toolbar">'+field("Find header, layout or rule","filter",fieldFilter)
      +select("Source entity","entity",entities.map(([id,label])=>({value:id,label})),entityFilter,"All entities")+submit("Filter fields","")+"</div>",
      async node=>{fieldFilter=value(node,"filter");entityFilter=value(node,"entity");await render();});
    const rows=list.map(f=>[esc(f.ordinal),esc(f.entity),'<strong>'+esc(f.header)+"</strong>",esc(f.layout),esc(f.inclusion.join(", ")),esc(f.rules.join(", ")),esc(f.introduced.dataset+" / "+f.introduced.month+" "+f.introduced.year)]);
    return details("Complete published field catalogue — "+fmt(catalogue.fields.length)+" fields",
      controls+'<p>'+esc(fmt(list.length)+" matching fields. Published column order is preserved; actual source columns are selected by exact header.")+'</p>'
      +table(["Column","Entity","Header","Layout","Cohorts","Source rules","Introduced"],rows,"tall")
      +'<div class="actions">'+button("Download full catalogue",()=>saveJSON(catalogue,"NDTMS_CDS_R_Field_Catalogue.json"),"small")
      +button("Download blank 290-column CSV",()=>{
        const raw=catalogue.fields.map(x=>x.header).join(",")+"\r\n";
        saveBlob(new Blob([raw],{type:"text/csv;charset=utf-8"}),"NDTMS_CDS_R_Blank_290_Column_Template.csv");
      },"small")+"</div><p>The blank reference template has no agency or client records. The vendor import schema is selected separately in Mapping contracts.</p>");
  }
  async function openWitness(sourceEditionId,sourceTableId,ordinal) {
    const edition=await record("edition",sourceEditionId),tableDef=edition.tables.find(t=>t.id===sourceTableId);
    if(!tableDef||!Number.isSafeInteger(ordinal)||ordinal<2)throw new Error("This source witness has no valid original record selection.");
    const result=await page("source-rows",{editionId:sourceEditionId,tableId:sourceTableId},ordinal-2,1);
    const row=result.items.find(x=>x.sourceRow===ordinal);
    if(!row)throw new Error("The original source witness is unavailable in this selection.");
    inspectRow(edition,tableDef,row);
  }
  function inputRecovery() {
    return '<div class="callout"><p id="ndtms-draft-status">'+esc(statusText())+'</p><div class="actions">'
      +button("Download current input draft",()=>saveJSON({workspaceId:draftOwner,value:clone(draft)},"NDTMS_Current_Input_Draft.json"),"small")
      +'<span id="ndtms-recovery-controls"'+(conflict||draftError?"":" hidden")+'>'+button("Download both & use current",()=>recoverDraft(true),"small")+button("Download both & open saved",()=>recoverDraft(false),"small")+"</span>"
      +"</div></div>";
  }
  async function view() {
    await ensureDraft();
    const [catalogue,editions,analyses]=await Promise.all([profile(),records("edition"),records("ndtms-analysis")]);
    const actualEdition=editions.find(x=>x.id===draft.editionId);
    const selected=actualEdition?await record("edition",actualEdition.id):null;
    if(selected&&!selected.tables.some(x=>x.id===draft.tableId))draft.tableId="";
    const savedId=state.selection.ndtmsAnalysis;
    const analysisId=analyses.some(x=>x.id===savedId)?savedId:(analyses[0]?.id||"");
    if(analysisId)selection("ndtmsAnalysis",analysisId);
    const analysis=analysisId?await record("ndtms-analysis",analysisId):null;
    let html=pageHeader("NDTMS / SOURCE PROJECTION","Client, episode and dated-record intake",
      "Reconcile the original repeated rows into six source-qualified populations, then use the existing mapping, actual target-return and complete handover workflow.",
      '<a class="button small" href="#sources">Import or inspect original source ↗</a>');
    html+=cataloguePanel(catalogue);
    const editionSelector=withChange(select("Original source edition","editionId",editions.map(x=>({value:x.id,label:(x.name||x.id)+" · "+short(x.id)})),draft.editionId,"Choose an exact retained edition"),async event=>{
      const formNode=event.target.closest("form");capture(formNode);draft.editionId=event.target.value;draft.tableId="";savePending=true;await persistDraft();await render();
    });
    const tableSelector=select("Original 290-column CSV table","tableId",(selected?.tables||[]).map(t=>({value:t.id,label:t.name+" · "+fmt(t.rows)+" original rows"})),draft.tableId,"Choose a table");
    const operationForm=form('<div class="form-grid">'+editionSelector+tableSelector+select("Declared cohort","cohort",[
        {value:"adult",label:"Adult community"},{value:"young-person",label:"Young people community"},
        {value:"mixed",label:"Mixed declared population"},{value:"secure-setting",label:"Secure setting (specify adult / young people below)"},
        {value:"other-declared",label:"Other explicitly declared population"}],draft.cohort,null)
      +select("Extract scope","scope_kind",[{value:"full",label:"Declared complete history"},{value:"reporting",label:"Declared reporting-period extract"},{value:"changed-since-prior-submission",label:"Declared changed-since-prior-submission extract"}],draft.scope.kind,null)
      +field("Exact originating agency code","scope_agency",draft.scope.agency,{required:true})
      +field("Declared extraction from date","scope_from",draft.scope.from,{type:"date"})
      +field("Declared extraction to date","scope_to",draft.scope.to,{type:"date"})+"</div>"
      +field("Source scope / published cohort / previous submission / authority","scope_note",draft.scope.note,{type:"textarea",required:true,
        note:"Describe the actual supplied population, published cohort (AD / YP / SA / SY), authority and previous submission where relevant. Cohort-specific clinical rules are listed as unimplemented; the selection does not infer missing history."})
      +details("Prior submission source — required for a changed-only extract",
        '<p>Select the actual separately retained source and its submission reference. This records an operator attestation; a generic vendor comparison baseline does not prove a statutory submission.</p><div class="form-grid">'
        +select("Original prior submission edition","prior_editionId",editions.filter(x=>x.id!==draft.editionId).map(x=>({value:x.id,label:(x.name||x.id)+" · "+short(x.id)})),draft.scope.priorSubmission.editionId,"Choose the actual retained prior source")
        +field("Actual submission reference","prior_reference",draft.scope.priorSubmission.reference)+"</div>"
        +field("Prior-source attestation / acceptance context","prior_note",draft.scope.priorSubmission.note,{type:"textarea",note:"Describe who identifies this source as the prior submission and its actual status. Its original file identity is retained; acceptance remains separately qualified."}),
        draft.scope.kind==="changed-since-prior-submission")
      +inputRecovery()+'<div class="actions">'+submit("Analyse this retained source")+"</div>",
      async node=>{
        capture(node);
        const frozen={editionId:draft.editionId,tableId:draft.tableId,profileId:catalogue.id,cohort:draft.cohort,scope:clone(draft.scope)};frozen.scope.from=frozen.scope.from||null;frozen.scope.to=frozen.scope.to||null;
        const prior=frozen.scope.priorSubmission;
        if(frozen.scope.kind!=="changed-since-prior-submission"&&!Object.values(prior).some(x=>x!==""))delete frozen.scope.priorSubmission;
        if(!frozen.editionId||!frozen.tableId)throw new Error("Choose the exact original edition and table.");
        const result=await mutate("analyse-ndtms",frozen);
        selection("ndtmsAnalysis",result.id);findingsOffset=0;rowsOffset=0;await render();
      },' id="ndtms-analysis-form"');
    html+=details("Analyse an original source selection",operationForm,!analysis);
    if(!analysis)return html+empty("No retained NDTMS analysis yet","Import the actual source CSV, select its declared cohort and extraction scope, then analyse it. The complete public catalogue is already available above.");
    const analysisSelect=withChange(select("Retained analysis","analysis",analyses.map(x=>({value:x.id,label:(x.name||x.id)+" · "+short(x.id)})),analysis.id,null),async event=>{
      selection("ndtmsAnalysis",event.target.value);findingsOffset=0;rowsOffset=0;await render();
    });
    const counts=analysis.counts||{},entityCounts=counts.entities||{};
    html+=panel("Original analysis selection",body(analysisSelect+'<p>'+esc(analysis.ready?"Structurally coherent for source publication.":"Source findings require review before publication.")
      +"</p>"+table(["Original rows","Native clients","Client privacy partitions","Consented source rows","No-consent source rows","Conflicted entities","All row witnesses"],
        [[counts.sourceRows,counts.nativeClients,counts.clientPartitionRows,counts.consentedRows,counts.noConsentRows,counts.conflictedEntities,counts.witnesses].map(n=>esc(fmt(n)))])
      +table(entities.map(x=>x[1]),[entities.map(([id])=>esc(fmt(entityCounts[id])))])
      +'<p>Native clients are counted by their original agency and client ID. A client with Y and N episodes has separate privacy partitions; these do not represent two people.</p>'
      +details("Actual structural coverage",'<p>'+esc(analysis.coverage?.statement||"")+'</p>'
        +table(["Implemented structural checks","Separate clinical / population / supplier checks"],
          [['<ul>'+(analysis.coverage?.implemented||[]).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>',
            '<ul>'+(analysis.coverage?.notImplemented||[]).map(x=>'<li>'+esc(x)+'</li>').join("")+'</ul>']]))
      +details("Declared scope and selected source",'<pre>'+esc(json({editionId:analysis.editionId,tableId:analysis.tableId,profileId:analysis.profileId,cohort:analysis.cohort,scope:analysis.scope,selectionSha256:analysis.selectionSha256}))+"</pre>")
      +artifacts(analysis)+recordButton("ndtms-analysis",analysis.id,"Open full retained analysis")));
    const findings=await page("ndtms-findings",{analysisId:analysis.id},findingsOffset);
    html+=panel("Every source finding",table(["Severity","Code / field","Entity","Original witnesses","Detail"],findings.items.map(f=>[
      esc(f.severity),esc([f.code,f.field].filter(Boolean).join(" / ")),esc(f.entity||""),
      (f.sourceRows||[]).map(w=>button("Record "+w.sourceRow,()=>openWitness(analysis.editionId,analysis.tableId,w.sourceRow),"small quiet")).join(" ")+(f.sourceRows?.length?"":esc((f.rowIds||[]).join(", "))),
      '<pre>'+esc(typeof f.details==="string"?f.details:json(f.details||{}))+"</pre>"
    ]))+paging(findings,async offset=>{findingsOffset=offset;await render();}));
    const entitySelect=withChange(select("Source entity","entity",entities.map(([id,label])=>({value:id,label})),selectedEntity,null),async event=>{selectedEntity=event.target.value;rowsOffset=0;await render();});
    const rows=await page("ndtms-rows",{analysisId:analysis.id,entity:selectedEntity},rowsOffset);
    html+=panel("Projected entities and complete lineage",body(entitySelect)+table(["Exact native key","Source rows","Projection"],rows.items.map(r=>[
      '<code>'+esc(json(r.key))+"</code>",esc(fmt(r.witnessCount)),
      button("Inspect entity & witnesses",()=>entityDialog(analysis,r),"small")
    ]))+paging(rows,async offset=>{rowsOffset=offset;await render();}));
    html+=panel("Continue the original migration workflow",body('<p>Publish the complete source projection, then bind its columns and relationships to the actual supplier contract. The complete source package retains every original row and finding.</p><div class="actions">'
      +button("Publish complete six-entity source",async()=>{
        const result=await mutate("publish-ndtms",{analysisId:analysis.id});
        const edition=result.edition;
        if(!edition?.id)throw new Error("The published operation did not return its original source edition.");
        selection("edition",edition.id);selection("table",edition.tables?.[0]?.id||"");
        await beginContract(edition.id);location.hash="#contracts";await render();
      },"primary",analysis.ready?"":" disabled")
      +'<a class="button small" href="#contracts">Mapping contracts ↗</a><a class="button small" href="#returns">Actual target returns ↗</a><a class="button small" href="#delivery">Full portable delivery ↗</a></div>'));
    return html;
  }
  async function entityDialog(analysis,row,offset=0) {
    const result=await page("ndtms-lineage",{analysisId:analysis.id,entity:row.entity,entityRowId:row.id},offset);
    const content='<p>Consent projection: <strong>'+esc(row.consentScope)+'</strong>. '+esc(row.conflicted?"Conflicting values remain retained.":"")+'</p><p>Exact key: <code>'+esc(json(row.key))+'</code></p><pre>'+esc(json(row.values))+"</pre>"
      +table(["Original record","Source row identity / original proof","Effective proof / corrections","Complete projected variant"],result.items.map(x=>[
        button("Record "+x.sourceRow,()=>openWitness(analysis.editionId,analysis.tableId,x.sourceRow),"small quiet"),
        '<code>'+esc(x.sourceRowId)+"</code><br><code>"+esc(x.rawSha256)+"</code>",
        '<code>'+esc(x.effectiveSha256)+"</code><pre>"+esc(json(x.correctionIds||[]))+"</pre>",
        '<pre>'+esc(json(x.projectedValues))+"</pre>"
      ]))+paging(result,next=>entityDialog(analysis,row,next));
    dialog("Retained entity and every original witness",content);
  }
  return view;
}

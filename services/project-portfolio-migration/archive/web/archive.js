import {createTimephasedPanel} from './timephased.js';
/* Original portfolio archive desk. All mutations use the existing saved operator action. */
export function createArchivePanel(C) {
  const {$,el,pretty,short,api,safe,artifacts,notice,lock,saveDraft,action,uploadArchive}=C;
  const A={id:"",loaded:null,loading:false,drafts:{},version:0,epoch:0,rows:[],cursor:"",editions:[],
    coverage:null,coverageKey:"",publicationId:"",table:"projects",offset:0,nextOffset:null,query:null,
    inspection:null,upload:null};
  const clone=x=>structuredClone(x);
  const empty=()=>({name:"",description:"",members:[],profile:{metrics:{grain:"leaf_tasks",measures:[]}},
    baseRevision:0,dirty:false});
  const draft=()=>A.drafts[A.id||"new"]||(A.drafts[A.id||"new"]=empty());
  const json=id=>{const value=JSON.parse($(id).value||"{}");if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Use a JSON object for the reporting profile.");return value;};
  const busy=()=>C.busy();
  const mutate=fn=>{if(busy()||A.loading)throw new Error("Reopen the saved workspace action first.");fn();A.version++;draft().dirty=true;saveDraft();renderStatus();lock();};
  const context=()=>({archiveId:A.id,archiveVersion:A.version});
  function changed() {mutate(()=>{draft().name=$("archive-name").value;draft().description=$("archive-description").value;});}
  function profileValue() {return json("archive-profile");}
  function setProfile(value) {draft().profile=clone(value);draft().profileText=pretty(value);$("archive-profile").value=draft().profileText;}
  function commitProfile() {mutate(()=>{draft().profile=profileValue();});renderMeasures();}
  function fillProfile(value) {$("archive-profile").value=draft().profileText||pretty(value);$("archive-grain").value=value.metrics?.grain||"leaf_tasks";renderMeasures();}
  function selected() {
    if(!A.id||!A.loaded||A.loaded.cohort.id!==A.id)throw new Error("Select the original saved cohort.");
    return A.loaded.cohort;
  }
  function publication() {
    const value=A.loaded?.publications.find(x=>x.id===A.publicationId);
    if(!value)throw new Error("Select a completed original publication.");
    return value;
  }
  function renderStatus() {
    const d=draft(), c=A.loaded?.cohort;
    $("archive-draft-status").textContent=(A.id?"Cohort "+A.id+" · saved base "+d.baseRevision:"New cohort")+
      (d.dirty?" · draft changes":" · saved selection")+
      (c&&c.id===A.id&&c.revision!==d.baseRevision?" · current stored revision "+c.revision+"; reload it before another saved change.":"");
    $("archive-save").dataset.unavailable=d.members.length?"false":"true";
    $("archive-review").dataset.unavailable=A.id&&!d.dirty&&c?.revision===d.baseRevision?"false":"true";
    const review=A.loaded?.review;
    $("archive-publish").dataset.unavailable=A.id&&!d.dirty&&c?.id===A.id&&review?.value&&review.value.cohort_revision===c.revision&&
      review.value.definition_sha256===c.definition_sha256&&d.baseRevision===c.revision?"false":"true";
  }
  function renderSelectors() {
    const choose=$("archive-cohort");choose.replaceChildren(new Option("New or selected cohort",""));
    for(const row of A.rows)choose.append(new Option(row.name+" · revision "+row.revision,row.id));
    if(A.id&&!A.rows.some(x=>x.id===A.id))choose.append(new Option(short(A.id)+" · selected cohort",A.id));
    choose.value=A.id;$("archive-more").hidden=!A.cursor;
  }
  function renderMembers() {
    const body=$("archive-members").tBodies[0];body.replaceChildren();
    for(const [index,row] of draft().members.entries()) {
      const tr=el("tr"),project=el("input"),label=el("input"),edition=el("select"),currency=el("input"),note=el("input");
      project.value=row.project_key;project.placeholder="project-key";project.setAttribute("aria-label","Business project key");
      label.value=row.label;label.placeholder="Project label";label.setAttribute("aria-label","Project label");
      edition.append(new Option("Select original native edition",""));
      for(const e of A.editions)edition.append(new Option(short(e.id)+" · "+e.kind+" · "+(e.label||e.created_at||""),e.id));
      if(row.edition_id&&!A.editions.some(x=>x.id===row.edition_id))edition.append(new Option(row.edition_id,row.edition_id));
      edition.value=row.edition_id;edition.setAttribute("aria-label","Original edition");
      currency.value=row.currency?.code||"";currency.placeholder="Native / ISO code";currency.maxLength=3;currency.setAttribute("aria-label","Currency declaration");
      note.value=row.currency?.note||"";note.placeholder="Required only when declaring currency";note.setAttribute("aria-label","Currency declaration note");
      const update=()=>mutate(()=>{row.project_key=project.value;row.label=label.value;if(row.edition_id!==edition.value){A.coverage=null;A.coverageKey="";}row.edition_id=edition.value;
        if(currency.value.trim())row.currency={code:currency.value.trim().toUpperCase(),note:note.value.trim()};else delete row.currency;});
      project.oninput=label.oninput=currency.oninput=note.oninput=()=>safe(update);
      edition.onchange=()=>safe(()=>{update();renderMeasures();});
      for(const node of [project,label,edition,currency,note]){const td=el("td");td.append(node);tr.append(td);}
      const remove=el("button","Remove");remove.onclick=()=>safe(()=>{mutate(()=>draft().members.splice(index,1));renderMembers();});
      const td=el("td");td.append(remove);tr.append(td);body.append(tr);
    }
    renderStatus();lock();
  }
  function renderMeasures() {
    const profile=draft().profile||{}, metrics=profile.metrics||{grain:"leaf_tasks",measures:[]};
    $("archive-grain").value=metrics.grain;
    const box=$("archive-measures");box.replaceChildren();
    for(const [index,value] of (metrics.measures||[]).entries()){
      const row=el("div",undefined,"archive-measure"),label=el("span",value.name+" · "+value.field+" · "+value.kind);
      const remove=el("button","Remove");remove.onclick=()=>safe(()=>{mutate(()=>{const p=clone(draft().profile);p.metrics.measures.splice(index,1);setProfile(p);});renderMeasures();});
      row.append(label,remove);box.append(row);
    }
    const family=metrics.grain==="leaf_tasks"?"tasks":metrics.grain, select=$("archive-measure-field"),old=select.value;
    select.replaceChildren(new Option("Read selected field definitions first",""));
    for(const info of A.coverage?.[family]||[]){
      const types=[...new Set(Object.values(info.definitions).map(x=>x.data_type))];
      if(types.length&&types.every(x=>["CURRENCY","WORK","DURATION","DELAY","NUMERIC","INTEGER","SHORT"].includes(x)))
        select.append(new Option(info.field+" · "+types.join(" / "),info.field));
    }
    if([...select.options].some(x=>x.value===old))select.value=old;
    timephased.renderProfile();lock();
  }
  async function readFields() {
    const ids=draft().members.map(x=>x.edition_id);
    if(!ids.length||ids.some(x=>!x)||new Set(ids).size!==ids.length)throw new Error("Select each exact edition once before reading its native fields.");
    const key=ids.join(","),epoch=A.epoch,version=A.version;
    const value=await api("/api/archive-fields?editions="+encodeURIComponent(key));
    if(epoch!==A.epoch||version!==A.version)return;
    A.coverage=value;A.coverageKey=key;renderFields();renderMeasures();
  }
  function renderFields() {
    const family=$("archive-field-family").value, search=$("archive-field-search").value.trim().toLowerCase();
    const body=$("archive-fields").tBodies[0];body.replaceChildren();
    const rows=(A.coverage?.[family]||[]).filter(x=>!search||x.field.toLowerCase().includes(search));
    for(const info of rows){
      const tr=el("tr"),types=[...new Set(Object.values(info.definitions).map(x=>x.data_type))],button=el("button","Include column");
      button.onclick=()=>safe(()=>{mutate(()=>{const p=profileValue();p.columns=p.columns||{};
        const existing=p.columns[family]||[];if(!existing.includes(info.field))p.columns[family]=[...existing,info.field];setProfile(p);});});
      const detail=el("details"),summary=el("summary","Native definitions");detail.append(summary,el("pre",pretty(info)));
      for(const value of [info.field,types.join(" / "),String(info.editions.length)])tr.append(el("td",value));
      const cell=el("td");cell.append(detail,button);tr.append(cell);body.append(tr);
    }
    $("archive-field-count").textContent=rows.length+" actual "+family+" field definitions. Explicit columns apply to the whole cohort; the complete original fields table is always retained.";
    lock();
  }
  function tableView(node,columns,rows,{inspect=true}={}) {
    const holder=el("div",undefined,"table-scroll"),table=el("table"),head=el("thead"),tr=el("tr"),body=el("tbody");
    for(const name of columns)tr.append(el("th",name));if(inspect)tr.append(el("th","Full row"));head.append(tr);
    for(const row of rows){
      const values=Array.isArray(row)?row:columns.map(x=>row[x]),line=el("tr");
      for(const value of values){const text=value===null||value===undefined?"":typeof value==="object"?pretty(value):String(value);
        const td=el("td",text.length>320?text.slice(0,320)+" …":text);td.title=text.length>320?"Full original value is available in Inspect row and the complete download.":"";line.append(td);}
      if(inspect){const td=el("td"),button=el("button","Inspect row");button.dataset.read="";
        button.onclick=()=>$("archive-row-detail").replaceChildren(el("pre",pretty(Object.fromEntries(columns.map((x,i)=>[x,values[i]])))));td.append(button);line.append(td);}
      body.append(line);
    }
    table.append(head,body);holder.append(table);node.replaceChildren(holder);
  }
  function renderReview() {
    timephased.renderReview();
    const area=$("archive-review-summary");area.replaceChildren();const review=A.loaded?.review;
    if(!review){for(const id of ["archive-counts","archive-totals","archive-findings","archive-review-json"])$(id).replaceChildren();area.append(el("p",A.loading?"Reading the selected original cohort…":"Save and review the selected original project editions.","empty"));renderStatus();return;}
    const value=review.value;
    const dl=el("dl");for(const [k,v]of Object.entries({"Review":review.sha256,"Cohort revision":value.cohort_revision,
      "Projects":value.members.length,"Aggregation grain":value.profile.metrics.grain,"Findings":value.findings.length})){dl.append(el("dt",k),el("dd",String(v)));}
    area.append(dl);
    tableView($("archive-counts"),["table","rows"],Object.entries(value.tables).map(([table,rows])=>({table,rows})),{inspect:false});
    const totals=value.measure_totals||[];
    tableView($("archive-totals"),["project_key","metric","field","kind","grain","currency","units","elapsed","total_text","contributing_rows","missing_rows","unsupported_rows","completeness"],totals);
    const list=$("archive-findings");list.replaceChildren();
    for(const f of value.findings){const item=el("details"),heading=el("summary",(f.project_key?f.project_key+" · ":"")+(f.code||"Finding"));
      item.append(heading,el("p",f.message||""),el("pre",pretty(f)));list.append(item);}
    $("archive-review-json").textContent=pretty(value);renderStatus();lock();
  }
  function renderPublications() {
    const rows=A.loaded?.publications||[],select=$("archive-publication"),old=A.publicationId;
    select.replaceChildren(new Option("Select a completed publication",""));
    for(const p of rows)select.append(new Option(p.created_at+" · "+short(p.id)+" · "+p.file_count+" files",p.id));
    if(!rows.some(x=>x.id===old))A.publicationId=A.loaded?.cohort.latest_publication||rows.at(-1)?.id||"";
    select.value=A.publicationId;
    const p=rows.find(x=>x.id===A.publicationId);
    timephased.selectPublication(p);
    artifacts($("archive-artifacts"),p?[p.archive,...p.artifacts.filter(x=>x.role!=="table_csv")]:[]);
    $("archive-publication-identity").textContent=p?"Archive "+p.archive.sha256+" · "+p.archive.bytes+" bytes · exact review "+p.review_sha256:"";
    const table=$("archive-table"),before=table.value;table.replaceChildren();
    for(const name of Object.keys(p?.dataset.columns||{}))table.append(new Option(name+" · "+p.dataset.tables[name]+" rows",name));
    A.table=Object.hasOwn(p?.dataset.columns||{},before)?before:Object.hasOwn(p?.dataset.columns||{},"projects")?"projects":table.options[0]?.value||"";
    table.value=A.table;renderFilter();renderQueryExports();lock();
  }
  function renderFilter() {
    const p=A.loaded?.publications.find(x=>x.id===A.publicationId),select=$("archive-filter-column"),old=select.value;
    select.replaceChildren(new Option("All rows",""));for(const name of p?.dataset.columns[A.table]||[])select.append(new Option(name,name));
    if([...select.options].some(x=>x.value===old))select.value=old;
  }
  function renderQueryExports() {
    const node=$("archive-query-exports");node.replaceChildren();
    for(const q of A.loaded?.query_exports||[]){const entry=el("details"),heading=el("summary",q.created_at+" · "+q.rows+" rows · "+short(q.publication_id));
      entry.append(heading,el("pre",pretty({sql:q.sql,parameters:q.parameters,columns:q.columns,database_sha256:q.database_sha256})));
      const box=el("div");artifacts(box,[q.artifact]);entry.append(box);node.append(entry);}
  }
  async function readTable() {
    const p=publication(),cid=A.id,selected=p.id,table=A.table,offset=A.offset,epoch=A.epoch;
    const args=new URLSearchParams({cohort_id:cid,publication_id:selected,table,offset:String(offset),limit:"50",
      filter_column:$("archive-filter-column").value,filter_text:$("archive-filter-text").value});
    const value=await api("/api/archive-table?"+args);
    if(cid!==A.id||selected!==A.publicationId||table!==A.table||offset!==A.offset||epoch!==A.epoch)return;
    A.nextOffset=value.next_offset;tableView($("archive-table-view"),value.columns,value.rows);
    $("archive-range").textContent=(value.rows.length?"Rows "+(offset+1)+"–"+(offset+value.rows.length):"No rows")+" · "+value.unfiltered_rows+" original rows before the selected filter";
    $("archive-previous").disabled=offset===0;$("archive-next").disabled=value.next_offset===null;
    const csv=p.artifacts.find(x=>x.role==="table_csv"&&x.table===table);artifacts($("archive-table-download"),csv?[csv]:[]);
  }
  async function readQuery() {
    const p=publication(),cid=A.id,version=A.version,epoch=A.epoch;
    const args={cohort_id:cid,publication_id:p.id,sql:$("archive-sql").value,parameters:JSON.parse($("archive-parameters").value||"[]"),limit:100};
    const value=await api("/api/archive-query",{method:"POST",body:args});
    if(cid!==A.id||p.id!==A.publicationId||version!==A.version||epoch!==A.epoch)return;
    A.query={arguments:args,result:value};tableView($("archive-query-view"),value.columns,value.rows);
    $("archive-query-status").textContent=value.rows.length+" preview rows"+(value.has_more?" · further rows available in the complete query export":" · complete preview");
  }
  async function load(identity,{reset=false}={}) {
    const epoch=++A.epoch,hadDraft=!!A.drafts[identity];A.id=identity;A.loaded=null;A.coverage=null;A.query=null;A.offset=0;
    A.loading=!!identity;paint();
    if(!identity){if(reset)A.drafts.new=empty();paint();return;}
    let value;try{value=await api("/api/cohorts/"+identity);}catch(error){if(epoch===A.epoch){A.loading=false;paint();}throw error;}
    if(epoch!==A.epoch||A.id!==identity)return;
    A.loading=false;A.loaded=value;
    if(reset||!hadDraft){
      const definition=value.definition;
      A.drafts[identity]={name:definition.name,description:definition.description,
        members:definition.members.map(x=>Object.fromEntries(["project_key","label","edition_id","currency"].filter(k=>k in x).map(k=>[k,clone(x[k])]))),
        profile:clone(definition.profile),baseRevision:value.cohort.revision,dirty:false};
    }
    paint();saveDraft();
  }
  function paint() {
    const d=draft();$("archive-name").value=d.name;$("archive-description").value=d.description;fillProfile(d.profile);
    renderSelectors();renderMembers();renderReview();renderPublications();
  }
  async function acceptResult(request,result,ctx) {
    if(!request.kind.startsWith("archive_"))return false;
    if(request.kind==="archive_inspect"){
      if(ctx.archiveVersion===undefined||ctx.archiveVersion===A.version){A.inspection={...result,request_id:request.id};A.upload=result.source;
        $("archive-receive-summary").replaceChildren(el("pre",pretty({archive:result.archive,manifest_sha256:result.manifest_sha256,
          projects:result.review.members,name:result.review.name,profile:result.review.profile,approval:result.approval,file_count:result.file_count})));
        $("archive-receive").dataset.unavailable="false";}
      lock();return true;
    }
    if(request.kind==="archive_receive"){
      if(ctx.archiveId===undefined||ctx.archiveId===A.id&&ctx.archiveVersion===A.version){A.id=result.cohort_id;await load(A.id,{reset:true});C.showTab("archive");}
      notice("Original archive received into cohort "+result.cohort_id+".");return true;
    }
    const same=ctx.archiveId===undefined||ctx.archiveId===A.id;
    if(result.cohort_id&&same){
      if(ctx.archiveId===undefined&&A.id!==result.cohort_id){A.id=result.cohort_id;await load(A.id);}
      const current=draft(),unchanged=ctx.archiveVersion===A.version;
      if(!A.id){delete A.drafts.new;A.id=result.cohort_id;A.drafts[A.id]=current;}
      if(ctx.archiveId!==undefined)current.baseRevision=result.cohort_revision;
      if(request.kind==="archive_save"&&unchanged)current.dirty=false;
      await load(A.id);
      if(result.publication_id){A.publicationId=result.publication_id;renderPublications();}
    }
    if(result.artifact)notice("Complete query export retained: "+result.rows+" rows.");
    return true;
  }
  function updateState(value,editions) {
    A.editions=editions;
    if(value.cohorts){const old=new Map(A.rows.map(x=>[x.id,x]));for(const row of value.cohorts.items)old.set(row.id,row);
      A.rows=[...old.values()].sort((a,b)=>String(b.updated_at||b.created_at).localeCompare(String(a.updated_at||a.created_at)));
      if(!A.cursor)A.cursor=value.cohorts.next_cursor||"";}
    renderSelectors();renderMembers();
  }
  function snapshot() {return{schema:"portfolio.archive-browser.v1",id:A.id,drafts:A.drafts,version:A.version,
    publicationId:A.publicationId,inspection:A.inspection?{schema:A.inspection.schema,source:A.inspection.source,archive:A.inspection.archive,
      manifest_sha256:A.inspection.manifest_sha256,review_sha256:A.inspection.review_sha256,request_id:A.inspection.request_id,
      file_count:A.inspection.file_count,approval:A.inspection.approval}:null,upload:A.upload,
    sql:$("archive-sql").value,parameters:$("archive-parameters").value};}
  function restore(value={}) {
    A.id=value.id||"";A.drafts=value.drafts||{};A.version=value.version||0;A.publicationId=value.publicationId||"";
    A.inspection=value.inspection||null;A.upload=value.upload||null;
    if(value.sql)$("archive-sql").value=value.sql;if(value.parameters)$("archive-parameters").value=value.parameters;
    if(A.inspection){$("archive-receive-summary").replaceChildren(el("pre",pretty(A.inspection)));
      $("archive-receive").dataset.unavailable="false";}
    paint();
  }
  const timephased=createTimephasedPanel({$,el,pretty,safe,lock,mutate,profileValue,setProfile,api,
    getDraft:draft,getCoverage:()=>A.coverage,getReview:()=>A.loaded?.review?.value,
    getIdentity:()=>A.id,readFields,tableView});
  $("archive-name").oninput=$("archive-description").oninput=()=>safe(changed);
  $("archive-profile").oninput=()=>safe(()=>mutate(()=>{draft().profileText=$("archive-profile").value;}));
  $("archive-profile").onchange=()=>safe(commitProfile);
  $("archive-cohort").onchange=()=>safe(async()=>{saveDraft();await load($("archive-cohort").value);});
  $("archive-new").onclick=()=>safe(async()=>{saveDraft();A.version++;await load("",{reset:true});saveDraft();});
  $("archive-reload").onclick=()=>safe(async()=>{if(!A.id)throw new Error("Select a saved cohort.");A.version++;await load(A.id,{reset:true});});
  $("archive-more").onclick=()=>safe(async()=>{if(!A.cursor)return;const value=await api("/api/cohorts?cursor="+encodeURIComponent(A.cursor));
    const items=new Map(A.rows.map(x=>[x.id,x]));for(const row of value.items)items.set(row.id,row);A.rows=[...items.values()];A.cursor=value.next_cursor||"";renderSelectors();});
  $("archive-add-member").onclick=()=>safe(()=>{mutate(()=>draft().members.push({project_key:"",label:"",edition_id:C.sourceId()||""}));renderMembers();});
  $("archive-read-fields").onclick=()=>safe(readFields);
  $("archive-field-family").onchange=$("archive-field-search").oninput=renderFields;
  $("archive-grain").onchange=()=>safe(()=>{mutate(()=>{const p=profileValue();p.metrics=p.metrics||{measures:[]};
    p.metrics.grain=$("archive-grain").value;setProfile(p);});renderMeasures();});
  $("archive-add-measure").onclick=()=>safe(()=>{const field=$("archive-measure-field").value,name=$("archive-measure-name").value.trim(),kind=$("archive-measure-kind").value;
    if(!field||!name)throw new Error("Select an actual native field and name the measure.");
    mutate(()=>{const p=profileValue();p.metrics=p.metrics||{grain:$("archive-grain").value,measures:[]};p.metrics.measures=[...(p.metrics.measures||[]),{name,field,kind}];setProfile(p);});renderMeasures();});
  $("archive-save").onclick=()=>safe(()=>{const d=draft();d.profile=profileValue();const args={name:d.name.trim(),description:d.description,members:clone(d.members),profile:clone(d.profile)};
    if(A.id){args.cohort_id=A.id;args.expected_revision=d.baseRevision;}
    return action("archive_save",args,context());});
  $("archive-review").onclick=()=>safe(()=>{const c=selected();if(draft().dirty)throw new Error("Save the current cohort draft first.");
    return action("archive_review",{cohort_id:c.id,expected_revision:draft().baseRevision},context());});
  $("archive-publish").onclick=()=>safe(()=>{const c=selected(),review=A.loaded.review;
    if(draft().dirty||!review)throw new Error("Review the exact saved cohort first.");
    return action("archive_publish",{cohort_id:c.id,expected_revision:draft().baseRevision,review_sha256:review.sha256,
      reviewer:$("archive-reviewer").value.trim(),note:$("archive-review-note").value.trim()},context());});
  $("archive-publication").onchange=()=>safe(()=>{A.publicationId=$("archive-publication").value;A.offset=0;A.query=null;renderPublications();saveDraft();});
  $("archive-table").onchange=()=>safe(()=>{A.table=$("archive-table").value;A.offset=0;renderFilter();return readTable();});
  $("archive-read-table").onclick=()=>safe(()=>{A.offset=0;return readTable();});
  $("archive-previous").onclick=()=>safe(()=>{A.offset=Math.max(0,A.offset-50);return readTable();});
  $("archive-next").onclick=()=>safe(()=>{if(A.nextOffset!==null){A.offset=A.nextOffset;return readTable();}});
  $("archive-query").onclick=()=>safe(readQuery);
  $("archive-query-export").onclick=()=>safe(()=>{const p=publication();return action("archive_query_export",
    {cohort_id:A.id,publication_id:p.id,sql:$("archive-sql").value,parameters:JSON.parse($("archive-parameters").value||"[]")},context());});
  $("archive-sql").oninput=$("archive-parameters").oninput=()=>{A.version++;A.query=null;saveDraft();};
  $("archive-inspect").onclick=()=>safe(async()=>{if(busy())throw new Error("Finish the saved workspace action first.");
    const file=$("archive-receive-file").files[0];if(!file)throw new Error("Choose the original complete archive.");
    C.setPosting(true);let source;try{source=await uploadArchive(file);}finally{C.setPosting(false);}
    A.upload=source;A.inspection=null;saveDraft();return action("archive_inspect",{source},context());});
  $("archive-receive").onclick=()=>safe(()=>{if(!A.inspection||!A.upload)throw new Error("Inspect the original complete archive first.");
    return action("archive_receive",{source:A.upload,manifest_sha256:A.inspection.manifest_sha256,
      reviewer:$("archive-receive-reviewer").value.trim(),note:$("archive-receive-note").value.trim()},context());});
  return{updateState,snapshot,restore,acceptResult,reopen:()=>A.id?load(A.id):Promise.resolve(),refresh:()=>A.id?load(A.id):Promise.resolve()};
}

import {comparePublications,reopenComparison,loadPublication,comparisonHTML,comparisonCSV} from './comparison.mjs';

/* The original Archive read API owns every source. This panel performs no action. */
export function createPublicationComparisonPanel(C){
 const {el,api,artifacts,saveDraft}=C;
 const root=el("section",undefined,"card portfolio-comparison"),heading=el("h2","Compare retained publications");
 root.id="archive-comparison";root.append(heading,el("p","Choose two saved reporting publications, then confirm each business-project pairing. The comparison reads their original totals and retains every unmatched group."));
 C.$("panel-archive").append(root);
 if(!document.getElementById("archive-comparison-style")){const link=el("link");link.id="archive-comparison-style";link.rel="stylesheet";link.href="/assets/comparison.css";document.head.append(link);}
 const status=el("p","Select the left and right publications.","hint"),error=el("p",undefined,"error"),choices=el("div",undefined,"columns"),mapping=el("div"),actions=el("div",undefined,"actions"),result=el("div");
 status.setAttribute("role","status");error.setAttribute("role","alert");
 const state={epoch:0,metadataEpoch:{left:0,right:0},rows:[],selection:{left:{cohort_id:"",publication_id:""},right:{cohort_id:"",publication_id:""}},cohorts:{},sources:null,pairs:[],result:null,busy:false,page:0};
 const controls={};
 const read=node=>{node.dataset.read="";return node;};
 function button(label,fn){const b=read(el("button",label));b.type="button";b.onclick=()=>run(fn);return b;}
 function current(epoch,workspace){return epoch===state.epoch&&workspace===C.workspaceId()&&root.isConnected;}
 function invalidate(){state.epoch++;state.sources=null;state.result=null;state.page=0;mapping.replaceChildren();result.replaceChildren();error.textContent="";state.busy=false;status.textContent="Selection changed. Read the selected publications.";enable();}
 function persist(){saveDraft();}
 function enable(){loadButton.disabled=state.busy||!state.selection.left.publication_id||!state.selection.right.publication_id;compareButton.disabled=state.busy||!state.sources;cancelButton.disabled=!state.busy;for(const n of mapping.querySelectorAll('select'))n.disabled=state.busy;}
 async function run(fn){try{error.textContent="";await fn();}catch(e){error.textContent=e.message||String(e);}}
 function chooseOptions(node,rows,value,placeholder){node.replaceChildren(new Option(placeholder,""));for(const x of rows)node.append(new Option(x.label,x.id));if(value&&!rows.some(x=>x.id===value))node.append(new Option(value,value));node.value=value;}
 for(const side of ["left","right"]){
  const box=el("fieldset"),legend=el("legend",side==="left"?"Left publication":"Right publication"),cohort=read(el("select")),publication=read(el("select"));
  cohort.dataset.pcCohort=side;publication.dataset.pcPublication=side;
  const cl=el("label","Saved cohort"),pl=el("label","Completed publication");cl.append(cohort);pl.append(publication);box.append(legend,cl,pl);choices.append(box);controls[side]={cohort,publication};
  cohort.onchange=()=>run(async()=>{
   invalidate();const request=++state.metadataEpoch[side];state.selection[side]={cohort_id:cohort.value,publication_id:""};delete state.cohorts[side];persist();
   chooseOptions(publication,[],"","Reading original publications…");
   if(!cohort.value){enable();return;}
   const id=cohort.value,workspace=C.workspaceId(),active=()=>request===state.metadataEpoch[side]&&workspace===C.workspaceId()&&root.isConnected&&state.selection[side].cohort_id===id;
   try{const value=await api("/api/cohorts/"+id);if(!active())return;state.cohorts[side]=value;fillPublications(side);}
   catch(e){if(active())throw e;}
  });
  publication.onchange=()=>run(()=>{invalidate();state.selection[side].publication_id=publication.value;persist();enable();});
 }
 function fillPublications(side){
  const c=state.cohorts[side],s=state.selection[side];
  chooseOptions(controls[side].publication,(c?.publications||[]).map(p=>({id:p.id,label:p.created_at+" · "+p.id.slice(0,12)+" · "+p.file_count+" files"})),s.publication_id,"Choose an original publication");enable();
 }
 function fillCohorts(){
  for(const side of ["left","right"])chooseOptions(controls[side].cohort,state.rows.map(x=>({id:x.id,label:x.name+" · "+x.id.slice(0,12)})),state.selection[side].cohort_id,"Choose a saved cohort");
 }
 function renderPairs(){
  mapping.replaceChildren(el("h3","Business-project correspondence"),el("p","Confirm these original project keys. A blank right-hand choice retains the left project as unmatched; every unselected right project is also retained."));
  const holder=el("div",undefined,"table-scroll"),table=el("table"),thead=el("thead"),hr=el("tr"),body=el("tbody");for(const t of ["Left project","Right project"])hr.append(el("th",t));thead.append(hr);
  const left=state.sources.left.definition.members,right=state.sources.right.definition.members;
  for(const item of left){
   const tr=el("tr"),select=read(el("select")),td=el("td"),pair=state.pairs.find(x=>x.left===item.project_key);
   select.setAttribute("aria-label","Right project corresponding to "+item.label);select.dataset.pcProject=item.project_key;
   chooseOptions(select,right.map(x=>({id:x.project_key,label:x.label+" · "+x.project_key})),pair?.right||"","Unmatched");
   select.onchange=()=>run(()=>{state.epoch++;state.result=null;result.replaceChildren();state.pairs=state.pairs.filter(x=>x.left!==item.project_key);if(select.value)state.pairs.push({left:item.project_key,right:select.value});persist();});
   td.append(select);tr.append(el("td",item.label+" · "+item.project_key),td);body.append(tr);
  }table.append(thead,body);holder.append(table);mapping.append(holder);enable();
 }
 async function loadPair(){
  const epoch=++state.epoch,workspace=C.workspaceId(),selection=structuredClone(state.selection),savedPairs=structuredClone(state.pairs);
  state.busy=true;state.sources=null;state.result=null;result.replaceChildren();mapping.replaceChildren();enable();status.textContent="Reading the complete original reporting tables…";
  try{
   const sources={};
   for(const side of ["left","right"])sources[side]=await loadPublication(api,selection[side].cohort_id,selection[side].publication_id,{isCurrent:()=>current(epoch,workspace),
    progress:p=>{if(current(epoch,workspace))status.textContent=(side==="left"?"Left: ":"Right: ")+p.table.replaceAll("_"," ")+" · "+p.rows+" / "+p.total+" original rows";}});
   if(!current(epoch,workspace))return;
   state.sources=sources;
   const left=new Set(sources.left.definition.members.map(x=>x.project_key)),right=new Set(sources.right.definition.members.map(x=>x.project_key));
   state.pairs=savedPairs.length?savedPairs.filter(x=>left.has(x.left)&&right.has(x.right)):[...left].filter(k=>right.has(k)).map(k=>({left:k,right:k}));
   status.textContent="Both complete publications are loaded. Confirm the project correspondence and compare.";renderPairs();persist();
  }catch(e){if(current(epoch,workspace))throw e;}
  finally{if(current(epoch,workspace)){state.busy=false;enable();}}
 }
 async function compare(){
  const epoch=++state.epoch,workspace=C.workspaceId();state.busy=true;enable();status.textContent="Verifying original tables and comparing exact totals…";
  try{const value=await comparePublications(state.sources.left,state.sources.right,state.pairs);if(!current(epoch,workspace))return;state.result=value;state.page=0;paintResult();persist();}
  catch(e){if(current(epoch,workspace))throw e;}
  finally{if(current(epoch,workspace)){state.busy=false;enable();}}
 }
 function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type})),a=el("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
 function paintResult(){
  result.replaceChildren();const value=state.result;if(!value)return;
  const all=[...value.scalar,...value.periods],comparable=all.filter(x=>x.delta_text!==null).length;
  status.textContent=all.length+" complete measure groups · "+comparable+" exact subtotal differences · "+value.selection.unmatched_left.length+" unmatched left projects · "+value.selection.unmatched_right.length+" unmatched right projects.";
  const ds=el("div",undefined,"actions");
  ds.append(button("Download complete comparison JSON",()=>download("portfolio-comparison-"+value.id.slice(0,12)+".json",JSON.stringify(value,null,2)+"\n","application/json")),
   button("Download report HTML",()=>download("portfolio-comparison-"+value.id.slice(0,12)+".html",comparisonHTML(value),"text/html")),
   button("Download every comparison row CSV",()=>download("portfolio-comparison-"+value.id.slice(0,12)+".csv",comparisonCSV(value),"text/csv")));
  result.append(el("h3",value.left.definition.name+" → "+value.right.definition.name),ds,
   el("p","Changes are right minus left. Partial subtotal changes keep missing and unsupported coverage visible. Different field definitions, currencies, units or period boundaries do not receive a numeric change."));
  const table=el("table"),head=el("thead"),hr=el("tr"),body=el("tbody");
  for(const t of ["Project · left / right","Measure / period","Left total","Right total","Change","Basis and coverage","Original rows"])hr.append(el("th",t));head.append(hr);
  const from=state.page*50;
  for(const row of all.slice(from,from+50)){
   const a=row.left||{},b=row.right||{},tr=el("tr"),statusText=row.status.startsWith("incompatible:")?"Different "+row.status.slice(13).replaceAll("_"," ").replaceAll(",",", "):row.status.replaceAll("_"," ");
   for(const value of [(row.left_project||"—")+" / "+(row.right_project||"—"),row.measure+(row.period_key?" · "+row.period_key:""),a.total_text??"Unavailable",b.total_text??"Unavailable",row.delta_text??"Unavailable",
    statusText+" · "+[a.currency||b.currency,a.units||b.units,a.elapsed?"elapsed "+a.elapsed:"",a.material_label||b.material_label].filter(Boolean).join(" · ")+" · "+(a.completeness||"absent")+" / "+(b.completeness||"absent")])tr.append(el("td",String(value)));
   const detail=el("details"),summary=el("summary","Complete original rows");detail.append(summary,el("pre",JSON.stringify(row,null,2)));const td=el("td");td.append(detail);tr.append(td);body.append(tr);
  }table.append(head,body);const holder=el("div",undefined,"table-scroll");holder.append(table);result.append(holder);
  const pager=el("div",undefined,"actions"),previous=button("Previous groups",()=>{state.page--;paintResult();}),next=button("More groups",()=>{state.page++;paintResult();});
  previous.disabled=state.page===0;next.disabled=from+50>=all.length;pager.append(previous,el("span",all.length?"Groups "+(from+1)+"–"+Math.min(from+50,all.length)+" of "+all.length:"No selected measure groups"),next);result.append(pager);
  const source=el("div");artifacts(source,[value.left.publication.archive,value.right.publication.archive]);
  result.append(el("h3","Complete original portfolio sources"),el("p","Download both original ZIPs to reopen the full native project source through Archive receive. The comparison JSON reopens this complete retained reporting capture."),source);
  for(const side of ["left","right"]){const details=el("details");details.append(el("summary",(side==="left"?"Left":"Right")+" original definition, review and source identity"),el("pre",JSON.stringify({publication:value[side].publication,definition:value[side].definition,review:value[side].review},null,2)));result.append(details);}
 }
 const loadButton=button("Read selected publications",loadPair),compareButton=button("Compare confirmed projects",compare),cancelButton=button("Cancel this read",()=>{state.epoch++;state.busy=false;status.textContent="Read cancelled. Original publications are unchanged.";enable();});
 loadButton.dataset.pcAction="load";compareButton.dataset.pcAction="compare";cancelButton.dataset.pcAction="cancel";
 const file=read(el("input"));file.type="file";file.accept=".json,application/json";file.dataset.pcImport="";
 const open=button("Open saved comparison JSON",async()=>{
  const selected=file.files[0];if(!selected)throw new Error("Choose the complete saved comparison JSON.");
  const epoch=++state.epoch,workspace=C.workspaceId();state.metadataEpoch.left++;state.metadataEpoch.right++;state.busy=true;enable();status.textContent="Checking the complete saved comparison…";
  try{const value=await reopenComparison(JSON.parse(await selected.text()));if(!current(epoch,workspace))return;
   state.selection={left:{cohort_id:value.left.publication.cohort_id,publication_id:value.left.publication.id},right:{cohort_id:value.right.publication.cohort_id,publication_id:value.right.publication.id}};
   state.sources={left:value.left,right:value.right};state.pairs=value.selection.pairs;state.result=value;state.page=0;
   for(const side of ["left","right"])state.cohorts[side]={publications:[value[side].publication]};
   fillCohorts();for(const side of ["left","right"])fillPublications(side);renderPairs();paintResult();persist();
  }catch(e){if(current(epoch,workspace))throw e;}finally{if(current(epoch,workspace)){state.busy=false;enable();}}
 });
 actions.append(loadButton,compareButton,cancelButton,file,open);root.append(choices,actions,status,error,mapping,result);enable();
 return{
  updateCohorts(rows){state.rows=rows;fillCohorts();},
  snapshot(){return{schema:"portfolio.archive-comparison-draft.v1",selection:structuredClone(state.selection),pairs:structuredClone(state.pairs)};},
  restore(value){invalidate();state.metadataEpoch.left++;state.metadataEpoch.right++;state.cohorts={};state.selection={left:{cohort_id:"",publication_id:""},right:{cohort_id:"",publication_id:""}};state.pairs=[];
   if(value?.schema==="portfolio.archive-comparison-draft.v1"){for(const side of ["left","right"]){const s=value.selection?.[side];if(s&&["cohort_id","publication_id"].every(k=>typeof s[k]==="string"&&(!s[k]||/^[0-9a-f]{64}$/.test(s[k]))))state.selection[side]=structuredClone(s);}if(Array.isArray(value.pairs))state.pairs=value.pairs.filter(x=>x&&typeof x.left==="string"&&typeof x.right==="string").map(x=>({left:x.left,right:x.right}));}
   fillCohorts();for(const side of ["left","right"])fillPublications(side);
  }
 };
}

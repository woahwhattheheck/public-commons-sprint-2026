/* Native period selection inside the existing Portfolio Archive panel. */
const TYPES={work:new Set(["WORK"]),money:new Set(["CURRENCY"]),material:new Set(["NUMERIC","UNITS"])};
const FIELDS={
  work:new Set(["WORK","ACTUAL_WORK","ACTUAL_REGULAR_WORK","ACTUAL_OVERTIME_WORK","REMAINING_WORK","REMAINING_REGULAR_WORK","REMAINING_OVERTIME_WORK","PLANNED_WORK","BUDGET_WORK"]),
  money:new Set(["COST","ACTUAL_COST","ACTUAL_REGULAR_COST","ACTUAL_OVERTIME_COST","REMAINING_COST","REMAINING_REGULAR_COST","REMAINING_OVERTIME_COST","PLANNED_COST","BUDGET_COST"]),
  material:new Set(["MATERIAL","ACTUAL_MATERIAL","REMAINING_MATERIAL","PLANNED_MATERIAL"])
};
for(let i=0;i<=10;i++)for(const [kind,suffix] of [["work","WORK"],["money","COST"],["material","MATERIAL"]])
  {FIELDS[kind].add("BASELINE"+(i?i:"")+"_"+suffix);
   if(kind!=="material")FIELDS[kind].add("BASELINE"+(i?i:"")+"_BUDGET_"+suffix);}
const UNITS=["MINUTES","HOURS","DAYS","WEEKS","MONTHS","YEARS"].flatMap(x=>[x,"ELAPSED_"+x]);
const SCHEMA="portfolio.timephased-profile.v1";
const clone=x=>structuredClone(x);
const localDate=x=>{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(x))throw new Error("Choose a complete local calendar date.");
  const [year,month,day]=x.split("-").map(Number),value=new Date(0);
  value.setUTCFullYear(year,month-1,day);value.setUTCHours(0,0,0,0);
  if(value.getUTCFullYear()!==year||value.getUTCMonth()!==month-1||value.getUTCDate()!==day)
    throw new Error("Choose an actual calendar date.");
  return value;
};
const dateText=value=>String(value.getUTCFullYear()).padStart(4,"0")+"-"+String(value.getUTCMonth()+1).padStart(2,"0")+"-"+String(value.getUTCDate()).padStart(2,"0");
function nextDate(value,grain,monthDay=value.getUTCDate()){
  const out=new Date(value.getTime());
  if(grain==="daily"||grain==="weekly")out.setUTCDate(out.getUTCDate()+(grain==="daily"?1:7));
  else{
    const day=monthDay;out.setUTCDate(1);out.setUTCMonth(out.getUTCMonth()+1);
    const last=new Date(out.getTime());last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
    out.setUTCDate(Math.min(day,last.getUTCDate()));
  }
  return out;
}

export function createTimephasedPanel(C){
  const {$,el,pretty,safe,lock,mutate,profileValue,setProfile,getDraft,getCoverage,getReview,getIdentity,readFields,tableView}=C;
  const box=el("section"),heading=el("h3","Work, cost and material by period");
  box.id="archive-timephased-editor";
  const explain=el("p","Select native assignment series and explicit project-local periods. Review uses the original MPXJ period methods for each selected source edition. Saved results, raw spans, calendars and resource rates travel with the archive.","hint");
  const toggle=el("input");toggle.type="checkbox";toggle.id="archive-timephased-enabled";
  const toggleLabel=el("label","Include native period reporting ");toggleLabel.prepend(toggle);
  const controls=el("div"),read=el("button","Read original assignment field definitions");read.dataset.read="";read.id="archive-timephased-fields";
  const generator=el("div",undefined,"columns"),start=el("input"),finish=el("input"),grain=el("select");
  start.type=finish.type="date";start.id="archive-period-start";finish.id="archive-period-finish";grain.id="archive-period-grain";
  for(const [value,label]of [["monthly","Monthly"],["weekly","Weekly"],["daily","Daily"]])grain.append(new Option(label,value));
  const labelled=(label,node)=>{const out=el("label",label);out.append(node);return out;};
  generator.append(labelled("First local date",start),labelled("Final local boundary",finish),labelled("Generate periods",grain));
  const generate=el("button","Replace selected periods");generate.id="archive-period-generate";
  const periodStatus=el("p",undefined,"hint"),periodHolder=el("div",undefined,"table-scroll"),periodTable=el("table");
  periodTable.id="archive-periods";periodHolder.append(periodTable);
  const pagers=el("div",undefined,"actions"),previous=el("button","Previous periods"),next=el("button","Next periods");
  previous.dataset.read=next.dataset.read="";pagers.append(previous,next);
  const addPeriod=el("button","Add explicit period");addPeriod.id="archive-period-add";
  const seriesTitle=el("h4","Native assignment series"),seriesStatus=el("p",undefined,"hint"),seriesHolder=el("div",undefined,"table-scroll"),seriesTable=el("table");
  seriesTable.id="archive-timephased-series";seriesHolder.append(seriesTable);
  const addSeries=el("button","Add native series");addSeries.id="archive-timephased-add-series";
  const scope=el("p","Assignment grain keeps task and resource links. Work uses the selected native unit and elapsed flag; cost uses the project currency; material totals remain separate for each actual resource. Native nulls stay distinct from zero. Baseline series retain the project baseline calendar. Native instant cost accrual includes endpoints and uses the first matching range; duration overlap excludes its finish. Pro-rata COST-resource actual amounts require an equal-width contiguous whole-minute grid. Task fixed costs remain in their original task fields.","hint");
  controls.append(read,generator,generate,periodStatus,periodHolder,pagers,addPeriod,seriesTitle,seriesStatus,seriesHolder,addSeries,scope);
  box.append(heading,explain,toggleLabel,controls);
  $("archive-profile").closest("details").before(box);
  const result=el("section");result.id="archive-timephased-review";
  const resultHeading=el("h3","Native period calculation review"),summary=el("p"),captures=el("div"),totals=el("div"),resultNote=el("p",undefined,"hint");
  const openTotals=el("button","Open complete period totals"),openValues=el("button","Open original assignment values"),openBasis=el("button","Open calendars and rate basis");
  openTotals.dataset.read=openValues.dataset.read=openBasis.dataset.read="";
  const buttons=el("div",undefined,"actions");buttons.append(openTotals,openValues,openBasis);
  result.append(resultHeading,summary,captures,totals,resultNote,buttons);
  $("archive-totals").after(result);
  let offset=0,lastIdentity=null,publicationReview=null,selectedReviewSha="",pendingReviewSha="",reviewEpoch=0;
  const periodProfile=()=>getDraft().profile?.timephased;
  const fresh=()=>({schema:SCHEMA,periods:[],series:[]});
  function edit(fn,{render=true}={}){
    mutate(()=>{const p=profileValue();p.timephased=p.timephased||fresh();fn(p.timephased,p);setProfile(p);});
    if(render)renderProfile();
  }
  function known(kind,selected=""){
    const values=(getCoverage()?.assignments||[]).filter(row=>{
      const types=Object.values(row.definitions||{}).map(x=>x.data_type);
      return FIELDS[kind]?.has(row.field)&&types.length&&types.every(x=>TYPES[kind].has(x));
    }).map(row=>row.field);
    if(selected&&!values.includes(selected))values.unshift(selected);
    return values;
  }
  function fieldSelect(kind,selected){
    const out=el("select");out.append(new Option("Choose original native field",""));
    for(const value of known(kind,selected))out.append(new Option(value,value));
    out.value=selected||"";return out;
  }
  function editorSettings(){
    return getDraft().timephasedEditor||{start:"",finish:"",grain:"monthly"};
  }
  for(const [name,node]of [["start",start],["finish",finish],["grain",grain]]){
    const save=()=>safe(()=>mutate(()=>{getDraft().timephasedEditor={...editorSettings(),[name]:node.value};}));
    node.onchange=save;
  }
  toggle.onchange=()=>safe(()=>{
    mutate(()=>{const p=profileValue();if(toggle.checked)p.timephased=p.timephased||fresh();else delete p.timephased;setProfile(p);});
    offset=0;renderProfile();
  });
  read.onclick=()=>safe(readFields);
  generate.onclick=()=>safe(()=>{
    const a=localDate(start.value),end=localDate(finish.value);
    if(!(a<end))throw new Error("The final boundary must follow the first local date.");
    const periods=[];let current=a;
    while(current<end){
      if(periods.length>=3660)throw new Error("Choose at most 3,660 reporting periods.");
      let after=nextDate(current,grain.value,a.getUTCDate());if(after>end)after=end;
      const first=dateText(current),last=dateText(after);
      periods.push({key:"p_"+first.replaceAll("-","")+"_"+last.replaceAll("-",""),label:first+" to "+last,
        start:first+"T00:00:00",finish:last+"T00:00:00"});
      current=after;
    }
    offset=0;edit(p=>{p.periods=periods;});
  });
  addPeriod.onclick=()=>safe(()=>{
    if((periodProfile()?.periods?.length||0)>=3660)throw new Error("Select at most 3,660 periods.");
    edit(p=>{
      const i=p.periods.length;p.periods.push({key:"period_"+(i+1),label:"Period "+(i+1),start:p.periods.at(-1)?.finish||"",finish:""});
      offset=Math.floor(i/50)*50;
    });
  });
  previous.onclick=()=>{offset=Math.max(0,offset-50);renderPeriods();lock();};
  next.onclick=()=>{offset+=50;renderPeriods();lock();};
  addSeries.onclick=()=>safe(()=>{
    if((periodProfile()?.series?.length||0)>=32)throw new Error("Select at most 32 native series.");
    edit(p=>{
      const field=known("work")[0]||"";
      let index=p.series.length+1;while(p.series.some(x=>x.name==="series_"+index))index++;
      p.series.push({name:"series_"+index,kind:"work",field,units:"HOURS"});
    });
  });
  function renderPeriods(){
    const periods=periodProfile()?.periods||[];
    if(offset>=periods.length)offset=Math.max(0,Math.floor((periods.length-1)/50)*50);
    const head=el("thead"),tr=el("tr"),body=el("tbody");
    for(const label of ["Key","Label","Local start","Local finish",""])tr.append(el("th",label));
    head.append(tr);periodTable.replaceChildren(head,body);
    for(let i=offset;i<Math.min(offset+50,periods.length);i++){
      const row=periods[i],line=el("tr");
      for(const field of ["key","label","start","finish"]){
        const node=el("input");node.value=row[field]||"";node.setAttribute("aria-label","Period "+(i+1)+" "+field);
        if(field==="start"||field==="finish")node.placeholder="2026-01-01T00:00:00";
        node.oninput=()=>safe(()=>edit(p=>{p.periods[i][field]=node.value;},{render:false}));
        const td=el("td");td.append(node);line.append(td);
      }
      const remove=el("button","Remove");remove.onclick=()=>safe(()=>edit(p=>p.periods.splice(i,1)));
      const td=el("td");td.append(remove);line.append(td);body.append(line);
    }
    periodStatus.textContent=periods.length+" selected periods · showing "+(periods.length?offset+1:0)+"–"+Math.min(offset+50,periods.length)+". Keep them ordered, nonoverlapping and nonempty. No timezone conversion is applied.";
    previous.disabled=offset===0;previous.dataset.unavailable=String(offset===0);
    next.disabled=offset+50>=periods.length;next.dataset.unavailable=String(offset+50>=periods.length);
    addPeriod.dataset.unavailable=String(periods.length>=3660);
  }
  function renderSeries(){
    const rows=periodProfile()?.series||[],head=el("thead"),tr=el("tr"),body=el("tbody");
    for(const label of ["Series name","Kind","Original field","Work unit",""])tr.append(el("th",label));head.append(tr);
    seriesTable.replaceChildren(head,body);
    for(const [i,row]of rows.entries()){
      const line=el("tr"),name=el("input"),kind=el("select"),field=fieldSelect(row.kind,row.field),units=el("select");
      name.value=row.name||"";name.setAttribute("aria-label","Native series "+(i+1)+" name");
      for(const [value,label]of [["work","Work"],["money","Currency amount"],["material","Material quantity"]])kind.append(new Option(label,value));
      kind.value=row.kind;kind.setAttribute("aria-label","Native series "+(i+1)+" kind");
      field.setAttribute("aria-label","Native series "+(i+1)+" field");
      for(const unit of UNITS)units.append(new Option(unit,unit));
      units.value=row.units||"HOURS";units.dataset.unavailable=String(row.kind!=="work");
      units.setAttribute("aria-label","Native series "+(i+1)+" work unit");
      name.oninput=()=>safe(()=>edit(p=>{p.series[i].name=name.value;},{render:false}));
      kind.onchange=()=>safe(()=>edit(p=>{
        p.series[i]={name:p.series[i].name,kind:kind.value,field:known(kind.value)[0]||"",
          ...(kind.value==="work"?{units:"HOURS"}:{})};
      }));
      field.onchange=()=>safe(()=>edit(p=>{p.series[i].field=field.value;},{render:false}));
      units.onchange=()=>safe(()=>edit(p=>{p.series[i].units=units.value;},{render:false}));
      for(const node of [name,kind,field,units]){const td=el("td");td.append(node);line.append(td);}
      const remove=el("button","Remove");remove.onclick=()=>safe(()=>edit(p=>p.series.splice(i,1)));
      const td=el("td");td.append(remove);line.append(td);body.append(line);
    }
    const available=getCoverage()?.assignments?.length||0;
    seriesStatus.textContent=rows.length+" selected series. "+(available?"The field choices use the original selected edition definitions.":"Read original assignment field definitions to choose supported series.")+" The complete cohort is limited to two million assignment × series × period facts.";
    addSeries.dataset.unavailable=String(rows.length>=32);
  }
  function renderProfile(){
    const id=getIdentity();if(id!==lastIdentity){lastIdentity=id;offset=0;}
    const profile=periodProfile(),editor=editorSettings();
    toggle.checked=profile!==undefined&&profile!==null;controls.hidden=!toggle.checked;
    start.value=editor.start||"";finish.value=editor.finish||"";grain.value=editor.grain||"monthly";
    if(toggle.checked){renderPeriods();renderSeries();}
    lock();
  }
  function openTable(name){
    const select=$("archive-table");
    if(![...select.options].some(row=>row.value===name))throw new Error("Select a completed native period publication first.");
    select.value=name;select.dispatchEvent(new Event("change"));select.scrollIntoView({block:"center"});
  }
  openTotals.onclick=()=>safe(()=>openTable("timephased_totals"));
  openValues.onclick=()=>safe(()=>openTable("timephased_values"));
  openBasis.onclick=()=>safe(()=>openTable("timephased_assignment_basis"));
  function renderReview(){
    const review=getReview()||publicationReview,value=review?.timephased;
    result.hidden=!value;
    if(!value){summary.textContent="";captures.replaceChildren();totals.replaceChildren();return;}
    const periods=review.profile.timephased.periods.length,series=review.profile.timephased.series.length;
    summary.textContent=periods+" exact local periods · "+series+" native series · "+
      value.captures.reduce((n,x)=>n+x.fact_count,0)+" retained assignment facts · "+
      value.captures.reduce((n,x)=>n+x.native_errors,0)+" native series errors.";
    tableView(captures,["edition_id","capture_id","assignment_count","fact_count","native_errors","sha256","bytes"],value.captures);
    tableView(totals,["project_key","period_key","series","kind","currency","units","elapsed","material_resource_entity_id",
      "total_text","value_rows","null_rows","not_applicable_rows","error_rows","completeness"],value.totals_preview);
    resultNote.textContent="Showing "+value.totals_preview.length+" of "+value.totals_count+
      " total rows. The complete publication includes every fact, total, raw span, resource-rate definition, assignment effective calendar and project baseline calendar. Receiving verifies these exact saved calculations without starting MPXJ.";
    lock();
  }
  function selectPublication(publication){
    const sha=publication?.review_sha256||"";
    if(selectedReviewSha===sha&&(publicationReview||pendingReviewSha===sha))return;
    selectedReviewSha=sha;publicationReview=null;const epoch=++reviewEpoch;
    if(!sha){pendingReviewSha="";renderReview();return;}
    if(getReview()){pendingReviewSha="";renderReview();return;}
    pendingReviewSha=sha;
    safe(async()=>{
      try{
        const value=await C.api("/api/objects/"+sha);
        if(epoch!==reviewEpoch||selectedReviewSha!==sha)return;
        if(value?.schema!=="portfolio.archive-review.v1")throw new Error("The original publication review changed.");
        publicationReview=value;renderReview();
      }finally{if(epoch===reviewEpoch)pendingReviewSha="";}
    });
  }
  return {renderProfile,renderReview,selectPublication};
}

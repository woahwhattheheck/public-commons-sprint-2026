/* MIT. Directory standards assessment and review inside the original operator. */
export function installDirectoryConformance(ctx){
  const {S,root,views,el,button,heading,panel,table,badge,api,download,showDialog,showRecord,
    jsonView,saveJSON,rowsOf,pager,formEditor,collectionPanel,browseRecords,browseRows,showRow,
    commonDraft,readDraft,loadDraft,persistDraft,filtered,describe,short,actor,showError,
    okToLeave,captureDraft,setDirty}=ctx;
  const kinds={plans:"conformancePlans",assessments:"conformanceAssessments",
    reviews:"conformanceReviews",comparisons:"conformanceComparisons"};
  const labels={report:"Readable report",findings:"Complete findings",rows:"Complete rows",
    index:"Complete index",rules:"Selected rules",summary:"Summary",package:"Complete package"};
  const count=value=>Number(value||0).toLocaleString();
  const endpoint=(collection,id,tail)=>"/api/directory/conformance/"+collection+"/"+encodeURIComponent(id)+(tail?"/"+tail:"");
  const original=(collection,id)=>api("/api/directory/"+kinds[collection]+"/"+encodeURIComponent(id));
  const draftKey=id=>"conformance-review-"+id;
  const draft=id=>loadDraft(draftKey(id),{...commonDraft("Directory assessment review"),assessmentId:id,
    disposition:"needs-correction",declaration:"",decisions:[],groups:[]});
  const saveDraft=(id,value)=>persistDraft(draftKey(id),value);
  const itemTitle=(record,open)=>el("div",{},[
    button(record.label||short(record.id),open,{kind:"link"}),
    el("code",{class:"cell-sub",text:record.id})]);
  function files(collection,record){
    return el("div",{class:"conformance-files"},Object.entries(record.files||{}).map(([kind,value])=>
      el("div",{class:"conformance-file"},[
        button(labels[kind]||kind,()=>download(endpoint(collection,record.id,"files/"+kind)),
          {kind:kind==="package"?"small primary":"small",test:"conformance-download-"+collection+"-"+kind}),
        el("small",{class:"help",text:count(value.bytes)+" bytes"}),
        el("code",{class:"cell-sub",text:value.sha256||""})])));
  }
  function summaryGrid(values){
    return el("div",{class:"metrics conformance-metrics"},values.map(([label,value,detail])=>
      el("div",{class:"metric"},[el("span",{class:"eyebrow",text:label}),
        el("strong",{text:count(value)}),el("small",{text:detail||""})])));
  }
  function sourceButton(ref){
    if(!ref?.sourceId||!ref?.recordId)return el("span",{class:"muted",text:"Selected rule coverage"});
    return button("Open original row",()=>showRow({sourceId:ref.sourceId,recordId:ref.recordId}),{kind:"small"});
  }
  async function selectedRecord(collection,id){
    const record=await original(collection,id),body=el("div",{},[
      el("p",{class:"muted",text:record.declaration||record.scopeNote||record.scope||""}),
      files(collection,record),jsonView(record,true)]);
    showDialog(record.label||"Complete conformance record",body);
  }
  async function findingDetails(assessmentId,id){
    const finding=await api(endpoint("assessments",assessmentId,"findings/"+encodeURIComponent(id)));
    showDialog(finding.code+" · "+finding.severity,el("div",{},[
      el("p",{text:finding.message}),el("div",{class:"actions"},[
        sourceButton(finding.ref),button("Save finding",()=>saveJSON(finding,"Directory_Finding_"+id+".json"))]),
      panel("Original value and requirement",[jsonView({pointer:finding.originalPointer,
        requirementSource:finding.requirementSource,actual:finding.actual,related:finding.related},true)]),
      jsonView(finding)]));
  }
  const overlap=(a,b)=>a.code===b.code&&(!a.severity||!b.severity||a.severity===b.severity)&&
    (!Object.hasOwn(a,"table")||!Object.hasOwn(b,"table")||a.table===b.table);
  async function decisionEditor(assessment,finding,{group=false,changed=()=>{}}={}){
    const current=draft(assessment.id),selector={code:finding.code,severity:finding.severity,
      ...(typeof finding.table==="string"?{table:finding.table}:{})};
    let matched=1;
    if(group){
      const q=new URLSearchParams({...selector,offset:"0",limit:"1"});
      const page=await api(endpoint("assessments",assessment.id,"findings")+"?"+q);
      matched=page.total;
    }
    const prior=group?(current.groups||[]).find(row=>JSON.stringify([row.code,row.severity,row.table])===
      JSON.stringify([selector.code,selector.severity,selector.table])):
      (current.decisions||[]).find(row=>row.findingId===finding.id);
    const disposition=el("select",{"aria-label":"Finding disposition","data-testid":"conformance-decision-disposition"},[
      el("option",{value:"requires-correction",text:"Requires correction"}),
      el("option",{value:"accepted-deviation",text:"Accept this deviation for the stated use"}),
      el("option",{value:"not-applicable",text:"Requirement does not apply to the stated use"})]);
    disposition.value=prior?.disposition||"requires-correction";
    const reason=el("textarea",{rows:5,maxLength:4000,value:prior?.reason||"",
      "aria-label":"Decision reason","data-testid":"conformance-decision-reason"}),
      error=el("div",{role:"alert"});
    const form=el("form",{},[
      el("p",{text:group?"This decision selects all "+count(matched)+" findings with the rule and severity below"+(Object.hasOwn(selector,"table")?" in the selected table.":" across all tables; this group has no table filter."):
        "This decision applies to the selected finding in this assessment."}),
      el("dl",{class:"record-meta"},[
        el("dt",{text:"Rule"}),el("dd",{text:finding.code}),el("dt",{text:"Severity"}),el("dd",{text:finding.severity}),
        el("dt",{text:"Table"}),el("dd",{text:group&&!Object.hasOwn(selector,"table")?"All tables / rule coverage":finding.table||"Rule coverage"})]),
      el("label",{class:"conformance-label"},["Disposition",disposition]),
      el("label",{class:"conformance-label"},["Reason for this receiving use",reason]),error,
      el("div",{class:"actions"},[el("button",{type:"submit",class:"primary",
        text:"Add to review draft","data-testid":"conformance-decision-save"})])]);
    form.onsubmit=async event=>{
      event.preventDefault();error.replaceChildren();
      try{
        if(!reason.value.trim())throw new Error("Enter the reason for this finding decision.");
        const value=draft(assessment.id),decision={disposition:disposition.value,reason:reason.value.trim()};
        if(group){
          const next={...selector,...decision},groups=value.groups||[],same=(row)=>
            JSON.stringify([row.code,row.severity,row.table])===JSON.stringify([selector.code,selector.severity,selector.table]);
          if(groups.some(row=>!same(row)&&overlap(row,next)))throw new Error(
            "This selection overlaps another group in the draft. Edit or remove that group before adding this one.");
          value.groups=[...groups.filter(row=>!same(row)),next];
        }else value.decisions=[...(value.decisions||[]).filter(row=>row.findingId!==finding.id),
          {findingId:finding.id,...decision}];
        saveDraft(assessment.id,value);setDirty(true);document.querySelector("#record-dialog").close();await changed();
      }catch(e){error.append(el("p",{class:"callout bad",text:e.message}));}
    };
    showDialog(group?"Review complete finding group":"Review selected finding",form);
  }
  function draftSummary(assessment,onReview){
    const value=draft(assessment.id),individual=(value.decisions||[]).length,groups=(value.groups||[]).length;
    return el("div",{class:"conformance-draft"},[
      el("p",{text:count(individual)+" individual decisions and "+count(groups)+" groups in the review draft."}),
      button("Open review draft",onReview,{kind:"primary",test:"conformance-open-review"})]);
  }
  async function findingsWorkbench(record,onReview){
    const summary=record.summary,box=el("div",{"data-testid":"conformance-assessment-workbench"}),
      draftHost=el("div"),body=el("div"),controls=el("form",{class:"toolbar conformance-filter"});
    const fields={severity:el("select",{"aria-label":"Finding severity"},[
      el("option",{value:"",text:"All severities"}),
      ...["error","warning","not-evaluated"].map(value=>el("option",{value,text:value}))]),
      table:el("input",{"aria-label":"Finding table",placeholder:"Table or resource type"}),
      code:el("input",{"aria-label":"Finding rule",placeholder:"Exact rule code"}),
      sourceId:el("input",{"aria-label":"Finding source",placeholder:"Source ID"}),
      recordId:el("input",{"aria-label":"Finding record",placeholder:"Record ID"})};
    const mode=el("select",{"aria-label":"Assessment detail view","data-testid":"conformance-detail-view"},[
      el("option",{value:"findings",text:"Findings"}),el("option",{value:"rows",text:"Assessed rows"})]);
    let offset=0,generation=0;
    const updateDraft=()=>draftHost.replaceChildren(draftSummary(record,onReview));
    const load=async()=>{
      const own=++generation,view=mode.value,q=new URLSearchParams({offset:String(offset),limit:"25"});
      for(const [key,input]of Object.entries(fields))
        if(input.value.trim()&&(view==="findings"||key==="table"))q.set(key,input.value.trim());
      body.setAttribute("aria-busy","true");
      try{
        const page=await api(endpoint("assessments",record.id,view)+"?"+q);
        if(own!==generation)return;
        const columns=view==="findings"?[
          {label:"Finding",get:r=>el("div",{},[button(r.code,()=>findingDetails(record.id,r.id),{kind:"link"}),
            el("span",{class:"cell-sub",text:r.message})])},
          {label:"Severity",get:r=>badge(r.severity)},
          {label:"Original location",get:r=>el("div",{},[el("strong",{text:r.table||"Rule coverage"}),
            el("code",{class:"cell-sub",text:r.originalPointer}),sourceButton(r.ref)])},
          {label:"Review",get:r=>el("div",{class:"actions"},[
            button("This finding",()=>decisionEditor(record,r,{changed:updateDraft}),{kind:"small"}),
            button("Complete group",()=>decisionEditor(record,r,{group:true,changed:updateDraft}),{kind:"small"})])}
        ]:[
          {label:"Original row",get:r=>el("div",{},[el("strong",{text:r.nativeId||short(r.recordId)}),
            el("code",{class:"cell-sub",text:r.recordId}),sourceButton(r.ref||r)])},
          {label:"Table",get:r=>r.table},{label:"Findings",get:r=>count(r.findings)},
          {label:"Checks",get:r=>el("div",{},Object.entries(r.checks||{}).map(([key,value])=>
            el("span",{class:"cell-sub",text:key+": "+count(value)})))},
          {label:"Complete row",get:r=>button("Open",()=>showDialog("Assessed original row",jsonView(r,true)),{kind:"small"})}
        ];
        body.replaceChildren(page.rows.length?table(columns,page.rows):el("p",{class:"empty",text:"No "+view+" match this selection."}),
          pager(page,async next=>{offset=next;await load();}));
      }finally{if(own===generation)body.removeAttribute("aria-busy");}
    };
    controls.append(el("label",{},["View",mode]),...Object.entries(fields).map(([key,input])=>
      el("label",{"data-filter":key},[key==="code"?"Rule":key==="sourceId"?"Source":key==="recordId"?"Record":key,input])),
      el("button",{type:"submit",text:"Apply filters","data-testid":"conformance-filter-submit"}));
    controls.onsubmit=e=>{e.preventDefault();offset=0;load().catch(showError);};
    mode.onchange=()=>{for(const [key,input]of Object.entries(fields)){
      input.disabled=mode.value==="rows"&&key!=="table";
      input.closest("label").hidden=input.disabled;
    }offset=0;load().catch(showError);};
    const selectedPlan=await original("plans",record.planId);
    box.append(summaryGrid([
      ["Assessed rows",summary.selectedRows,count(summary.originalRows)+" rows in the selected source"],
      ["Errors",summary.severityCounts.error,"Original findings"],
      ["Warnings",summary.severityCounts.warning,"Original findings"],
      ["Review requirements",summary.severityCounts["not-evaluated"],"Requirements retained for review"]]),
      panel(record.label||"Selected assessment",[
        el("p",{class:"muted",text:selectedPlan.scope}),el("dl",{class:"record-meta"},[
          el("dt",{text:"Standard"}),el("dd",{text:record.family}),el("dt",{text:"Selection"}),el("dd",{text:selectedPlan.profileDisposition}),
          el("dt",{text:"Publisher profile"}),el("dd",{text:selectedPlan.publisherProfile||"No profile recorded"}),
          el("dt",{text:"Format policy"}),el("dd",{text:selectedPlan.formatPolicy}),
          el("dt",{text:"Covered rules"}),el("dd",{text:count(summary.rules)})]),
        files("assessments",record),el("details",{},[
          el("summary",{text:"Rule coverage and selected population"}),
          table([{label:"Coverage",get:r=>r[0]},{label:"Rules",get:r=>count(r[1])}],Object.entries(summary.ruleCoverage||{})),
          table([{label:"Table",get:r=>r[0]},{label:"Assessed rows",get:r=>count(r[1])}],Object.entries(summary.populations||{})),
          button("Open complete assessment",()=>selectedRecord("assessments",record.id),{kind:"small"})])]),
      draftHost,panel("Findings and original rows",[controls,body]));
    updateDraft();await load();return box;
  }
  views.conformance=async()=>{
    const specs=S.catalogue.inputSchemas;
    if(!specs.conformance_plan)throw new Error("This Directory installation needs the complete conformance engine before opening this section.");
    root.replaceChildren(heading("Directory conformance",
      "Assess selected source material against its recorded standard, review findings, and compare complete results."));
    const tabs=el("div",{class:"tabbar","aria-label":"Conformance workflow"}),body=el("div");
    const routes=[["assessments","Assessments"],["plans","Standards & scope"],["reviews","Review decisions"],["comparisons","Compare results"]];
    const renderGeneration=S.generation;let displayGeneration=0;
    const display=async tab=>{
      if(S.section!=="conformance"||S.generation!==renderGeneration)return;
      const own=++displayGeneration,current=()=>own===displayGeneration&&S.generation===renderGeneration&&S.section==="conformance";
      const replaceBody=(...nodes)=>{if(current())body.replaceChildren(...nodes);};
      const appendBody=(...nodes)=>{if(current())body.append(...nodes);};
      S.selected.conformanceTab=tab;S.editor=null;
      tabs.querySelectorAll("button").forEach(b=>{b.classList.toggle("active",b.dataset.tab===tab);b.setAttribute("aria-selected",String(b.dataset.tab===tab));});
      replaceBody(el("p",{class:"loading",text:"Opening conformance records…"}));
      const openReview=async id=>{captureDraft();S.selected.conformanceAssessment=id;await display("reviews");};
      if(tab==="plans"){
        const selectedInfo=el("div"),spec=specs.conformance_plan;
        let editor;
        const selectSubject=async()=>{
          const value=readDraft(editor),kind=value.subjectKind||"sources";
          await browseRecords({kind,native:false},record=>{
            editor.patch({subjectKind:kind,subjectId:record.id,tables:[]});
            selectedInfo.replaceChildren(el("p",{text:"Selected "+kind.slice(0,-1)+": "+describe(record)}),
              button("Inspect selected original",()=>showRecord(kind,record.id),{kind:"small"}));
          },"Choose the complete source or edition to assess");
        };
        const addDefinition=async()=>{
          await browseRecords({kind:"sources",native:false},async source=>{
            await browseRows("sources",source.id,{table:"StructureDefinition",title:"Choose a published HSD 1.0.0 profile snapshot",
              onPick:row=>{
                const value=readDraft(editor),ref={sourceId:row.sourceId||row.ref?.sourceId||source.id,
                  recordId:row.recordId||row.ref?.recordId};
                if(!ref.recordId)throw new Error("The selected row omitted its original record identity.");
                const refs=value.definitionRefs||[];
                if(refs.some(r=>r.sourceId===ref.sourceId&&r.recordId===ref.recordId))return;
                if(refs.length>=3)throw new Error("Select at most one snapshot for each of the three HSD resource types.");
                editor.patch({family:"fhir-hsd-1.0.0",definitionRefs:[...refs,ref]});
              }});
          },"Choose the source containing the published profile snapshots");
        };
        editor=formEditor({key:"conformance-plan",title:"Select standard and complete assessment scope",
          spec,value:{...commonDraft("Directory standards assessment"),subjectKind:"sources",subjectId:"",
            family:"hsds-3.3.1",profileDisposition:"migration-assessment",publisherProfile:"",
            scope:"",formatPolicy:"annotation",tables:[],definitionRefs:[]},
          path:"/api/directory/conformance/plans",submitText:"Save assessment plan",
          extra:[button("Choose source or edition",selectSubject,{kind:"small",test:"conformance-choose-subject"}),
            button("Choose HSD profile snapshot",addDefinition,{kind:"small",test:"conformance-choose-profile"})],
          after:async record=>{S.selected.conformancePlan=record.id;await display("assessments");}});
        replaceBody(panel("Assessment plan",[el("p",{class:"muted",text:
          "Choose sources or editions before browsing. Leave tables empty to assess the complete applicable population. HSD uses the retained published profile snapshots selected below."}),
          selectedInfo,editor.root]),await collectionPanel(kinds.plans,{title:"Saved assessment plans",actions:record=>[
            button("Assess this plan",async()=>{captureDraft();S.selected.conformancePlan=record.id;await display("assessments");},{kind:"small primary"}),
            button("Inspect",()=>showRecord(kinds.plans,record.id),{kind:"small"}),
            button("Use as new plan",async()=>{const full=await original("plans",record.id);editor.set(filtered(full,spec));},{kind:"small"})]}));
      }else if(tab==="assessments"){
        const planId=S.selected.conformancePlan||"",assessmentId=S.selected.conformanceAssessment;
        const editor=formEditor({key:"conformance-assess-"+(planId||"new"),title:"Run selected assessment",
          spec:specs.conformance_assess,value:{...commonDraft("Directory conformance assessment"),planId},
          path:"/api/directory/conformance/assessments",submitText:"Assess complete selected population",
          after:async record=>{S.selected.conformanceAssessment=record.id;await display("assessments");}});
        replaceBody(panel("Assess",editor.root),await collectionPanel(kinds.assessments,{
          title:"Saved complete assessments",columns:[
            {label:"Assessment",get:r=>itemTitle(r,async()=>{captureDraft();S.selected.conformanceAssessment=r.id;await display("assessments");})},
            {label:"Standard",get:r=>r.family},{label:"Rows",get:r=>count(r.summary?.selectedRows)},
            {label:"Errors",get:r=>count(r.summary?.severityCounts?.error)},
            {label:"Review",get:r=>button("Open review draft",()=>openReview(r.id),{kind:"small"})}
          ]}));
        if(assessmentId)appendBody(await findingsWorkbench(await original("assessments",assessmentId),()=>openReview(assessmentId)));
      }else if(tab==="reviews"){
        const id=S.selected.conformanceAssessment;
        if(id){
          const assessment=await original("assessments",id),value=draft(id);
          if(!current())return;
          if(value.assessmentId!==id)throw new Error("This review draft belongs to a different assessment.");
          const editor=formEditor({key:draftKey(id),title:"Receiving review",spec:specs.conformance_review,
            value,path:"/api/directory/conformance/reviews",submitText:"Save complete review",
            onSubmit:async input=>{if(input.assessmentId!==id)throw new Error("Keep this review attached to its selected assessment.");
              return api("/api/directory/conformance/reviews",{method:"POST",body:input});},
            after:async record=>{S.selected.conformanceReview=record.id;
              appendBody(panel("Saved receiving review",[files("reviews",record),
                el("p",{text:record.declaration}),jsonView(record.summary)]));}});
          const selector=editor.root.querySelector('[data-field="'+draftKey(id)+'.assessmentId"]');
          if(selector){selector.readOnly=true;selector.closest(".control")?.querySelectorAll("button").forEach(b=>b.disabled=true);}
          replaceBody(panel(assessment.label,[
            el("p",{text:count(assessment.summary.findings)+" findings across "+count(assessment.summary.selectedRows)+" original rows."}),
            el("p",{class:"muted",text:"Review decisions retain the original findings. Accepting for receiving requires an explicit accepted-deviation or not-applicable decision for every error."}),
            el("div",{class:"actions"},[
              button("Return to findings",async()=>{captureDraft();await display("assessments");},{kind:"small"}),
              button("Choose another assessment",()=>browseRecords({kind:kinds.assessments,native:false},
                r=>openReview(r.id),"Choose the assessment to review"),{kind:"small"})]),
            editor.root]));
        }else replaceBody(panel("Choose an assessment",[
          el("p",{text:"Open an assessment to inspect its findings and prepare the receiving review."}),
          button("Choose assessment",()=>browseRecords({kind:kinds.assessments,native:false},
            r=>openReview(r.id),"Choose the assessment to review"),{kind:"primary"})]));
        appendBody(await collectionPanel(kinds.reviews,{title:"Saved receiving reviews",columns:[
          {label:"Review",get:r=>itemTitle(r,()=>selectedRecord("reviews",r.id))},
          {label:"Disposition",get:r=>badge(r.disposition)},
          {label:"Reviewer",get:r=>r.actor},
          {label:"Actions",get:r=>el("div",{class:"actions"},[
            button("Complete package",()=>download(endpoint("reviews",r.id,"files/package")),{kind:"small"}),
            button("Prepare successor",async()=>{
              const full=await original("reviews",r.id);captureDraft();
              saveDraft(full.assessmentId,{...filtered(full,specs.conformance_review),predecessorId:full.id});
              S.selected.conformanceAssessment=full.assessmentId;await display("reviews");
            },{kind:"small"})])}
        ]}));
      }else{
        const editor=formEditor({key:"conformance-compare",title:"Compare complete assessment results",
          spec:specs.conformance_compare,value:{...commonDraft("Directory conformance comparison"),
            beforeAssessmentId:"",afterAssessmentId:S.selected.conformanceAssessment||"",scopeNote:""},
          path:"/api/directory/conformance/comparisons",submitText:"Save complete comparison",
          after:async record=>appendBody(panel("Saved complete comparison",[
            el("p",{text:record.scopeNote}),files("comparisons",record),jsonView(record.summary)]))});
        replaceBody(panel("Selected populations",[
          el("p",{class:"muted",text:"Choose the earlier and later assessments and describe their populations. The comparison retains both complete original packages and each rule outcome."}),
          editor.root]),await collectionPanel(kinds.comparisons,{title:"Saved comparisons",columns:[
            {label:"Comparison",get:r=>itemTitle(r,()=>selectedRecord("comparisons",r.id))},
            {label:"Changed rule groups",get:r=>count(r.summary?.changedRuleGroups)},
            {label:"Rule groups",get:r=>count(r.summary?.ruleGroups)},
            {label:"Complete files",get:r=>button("Download package",()=>download(endpoint("comparisons",r.id,"files/package")),{kind:"small"})}
          ]}));
      }
    };
    for(const [id,label]of routes)tabs.append(button(label,async()=>{
      if(!okToLeave())return;captureDraft();setDirty(false);await display(id);
    },{test:"conformance-tab-"+id}));
    [...tabs.children].forEach((node,index)=>{node.dataset.tab=routes[index][0];node.setAttribute("role","tab");});
    tabs.setAttribute("role","tablist");root.append(tabs,body);
    const initial=routes.some(([id])=>id===S.selected.conformanceTab)?S.selected.conformanceTab:"assessments";
    await display(initial);
  };
}

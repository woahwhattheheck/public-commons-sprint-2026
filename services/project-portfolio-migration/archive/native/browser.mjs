/** Continue the original migration desk receiving operation with its archive workflow. */
import {join} from "node:path";
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?
  Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

export async function receiveArchiveDesk(H) {
  const {entry,out,progress,api,page,action,downloadArtifact,screenshot,waitFor,requireValue,errors,hello}=H;
  const artifacts=[];
  const withPeriods=entry.profile?.timephased!==undefined;
  const queryTable=withPeriods?"timephased_totals":"tasks";
  const querySql=withPeriods?
    "SELECT project_key, period_key, series, kind, currency, units, elapsed, material_resource_entity_id, total_text, value_rows, null_rows, not_applicable_rows, error_rows FROM timephased_totals ORDER BY project_key, period_key, series, currency, units, material_resource_entity_id":
    "SELECT project_key, source_key, name FROM tasks ORDER BY project_key, source_key";
  async function selectNativePeriods(){
    const selected=entry.profile.timephased;
    await page.locator("#archive-timephased-enabled").check();
    await page.locator("#archive-timephased-fields").click();
    await waitFor(async()=>(await page.locator("#archive-timephased-editor").innerText()).includes("field choices use"),
      "The actual assignment field definitions did not reach the original period controls.");
    for(const [i,period] of selected.periods.entries()){
      await page.locator("#archive-period-add").click();
      const row=page.locator("#archive-periods tbody tr").last();
      for(const [index,key] of ["key","label","start","finish"].entries())
        await row.locator("input").nth(index).fill(period[key]);
    }
    for(const [i,series] of selected.series.entries()){
      await page.locator("#archive-timephased-add-series").click();
      let row=page.locator("#archive-timephased-series tbody tr").nth(i);
      await row.locator("select").nth(0).selectOption(series.kind);
      row=page.locator("#archive-timephased-series tbody tr").nth(i);
      await row.locator("input").fill(series.name);
      await row.locator("select").nth(1).selectOption(series.field);
      if(series.kind==="work")await row.locator("select").nth(2).selectOption(series.units);
    }
    const actual=JSON.parse(await page.locator("#archive-profile").inputValue());
    requireValue(canonical(actual.timephased)===canonical(selected),
      "The original editable period controls changed the selected complete native profile.");
  }
  const openArchive=async()=>page.locator('[data-tab="archive"]').click();
  const readCohort=async id=>api("/api/cohorts/"+id);
  const selectCohort=async id=>{
    await openArchive();
    for(let count=0;count<10000;count++){
      if(await page.locator('#archive-cohort option[value="'+id+'"]').count())break;
      const more=page.locator("#archive-more");
      requireValue(await more.isVisible(),"The exact original cohort is absent from the complete catalogue.");
      const before=await page.locator("#archive-cohort option").count();
      await more.click();
      await waitFor(async()=>await page.locator("#archive-cohort option").count()>before||!await more.isVisible(),
        "The original cohort page did not advance.",10000);
    }
    await page.locator("#archive-cohort").selectOption(id);
    await waitFor(async()=>(await page.locator("#archive-draft-status").innerText()).includes(id),
      "The original saved cohort did not open.");
  };
  const inspectPublication=async(cohortId,publicationId)=>{
    await selectCohort(cohortId);
    await page.locator("#archive-publication").selectOption(publicationId);
    const saved=await readCohort(cohortId),publication=saved.publications.find(x=>x.id===publicationId);
    requireValue(publication,"The exact original publication is absent.");
    await page.locator("#archive-table").selectOption(queryTable);
    await page.locator("#archive-filter-column").selectOption("");
    await page.locator("#archive-filter-text").fill("");
    await page.locator("#archive-read-table").click();
    await waitFor(async()=>(await page.locator("#archive-range").innerText()).includes(String(publication.dataset.tables[queryTable])+" original rows"),
      "The retained original reporting table did not load.");
    await page.locator("#archive-sql").fill(querySql);
    await page.locator("#archive-parameters").fill("[]");
    await page.locator("#archive-query").click();
    await waitFor(async()=>(await page.locator("#archive-query-status").innerText()).includes("preview rows"),
      "The original reporting SQL did not return.");
    if(withPeriods){
      const nativeReview=await api("/api/objects/"+publication.review_sha256);
      requireValue(nativeReview.timephased &&
        nativeReview.timephased.captures.every(x=>x.native_errors===0) &&
        nativeReview.timephased.captures.some(x=>x.fact_count>0),
        "The original native fixture did not complete its source-bound period calculation.");
      requireValue(publication.dataset.tables.timephased_values===
        nativeReview.timephased.captures.reduce((n,x)=>n+x.fact_count,0),
        "The complete native fact table differs from the retained calculation count.");
      await waitFor(async()=>await page.locator("#archive-timephased-review").isVisible(),
        "The original saved native calculation did not reopen in its publication review.");
      await page.locator("#archive-timephased-review").scrollIntoViewIfNeeded();
    }
    return publication;
  };
  const retainDownloads=async publication=>{
    artifacts.push(await downloadArtifact(publication.archive,"#archive-artifacts"));
    for(const role of ["report","data_dictionary","power_query","azure_sql","operating_guide","relational_database"]){
      const candidates=publication.artifacts.filter(x=>x.role===role);
      requireValue(candidates.length===1,"The complete original delivery has no unique "+role+".");
      artifacts.push(await downloadArtifact(candidates[0],"#archive-artifacts"));
    }
  };
  await openArchive();
  if(entry.phase==="archive-reopened"){
    const original=entry.original;
    const publication=await inspectPublication(original.cohort_id,original.publication_id);
    requireValue(publication.archive.sha256===original.archive.sha256 &&
      publication.review_sha256===original.review_sha256,"The source-absent reporting publication changed.");
    for(const member of entry.members){
      const edition=await api("/api/editions/"+member.edition_id);
      requireValue(edition.id===member.edition_id,"An original received project edition is absent.");
    }
    artifacts.push(await screenshot("archive-reopened-desktop.png",1440));
    artifacts.push(await screenshot("archive-reopened-mobile.png",390));
    return{schema:"portfolio.archive-native-browser-result.v1",operation_id:entry.operation_id,phase:entry.phase,
      workspace_id:hello.workspace_id,cohort_id:original.cohort_id,publication_id:publication.id,
      archive:original.archive,review_sha256:publication.review_sha256,artifacts,errors,completed_at:new Date().toISOString()};
  }
  if(entry.phase==="archive-restored"){
    const inspected=await action("01-inspect-original-archive","archive_inspect",async()=>{
      await openArchive();await page.locator("#archive-receive-file").setInputFiles(entry.original.archive.path);
      await page.locator("#archive-inspect").click();
    });
    requireValue(inspected.result.archive.sha256===entry.original.archive.sha256,
      "The inspected original archive differs from the published bytes.");
    const received=await action("02-receive-original-archive","archive_receive",async()=>{
      await openArchive();await page.locator("#archive-receive-reviewer").fill(entry.reviewer);
      await page.locator("#archive-receive-note").fill("Receive this complete original native project cohort and its reviewed reporting source.");
      await page.locator("#archive-receive").click();
    },{discardReply:true});
    const publication=await inspectPublication(received.result.cohort_id,received.result.publication_id);
    requireValue(publication.id===entry.original.publication_id&&publication.archive.sha256===entry.original.archive.sha256&&
      publication.review_sha256===entry.original.review_sha256,"Receiving changed the original reporting identities.");
    const receivedEditions=[];
    for(const member of entry.members){
      const source=await api("/api/editions/"+member.edition_id);
      requireValue(source.id===member.edition_id,"The original selected native edition did not reopen.");
      receivedEditions.push(source.id);
    }
    await retainDownloads(publication);
    artifacts.push(await screenshot("archive-received-desktop.png",1440));
    artifacts.push(await screenshot("archive-received-mobile.png",390));
    return{schema:"portfolio.archive-native-browser-result.v1",operation_id:entry.operation_id,phase:entry.phase,
      workspace_id:hello.workspace_id,cohort_id:received.result.cohort_id,publication_id:publication.id,
      review_sha256:publication.review_sha256,archive:{...publication.archive,path:join(out,publication.archive.filename)},
      inspection_request_id:inspected.id,receiving_request_id:received.id,selected_upload:received.arguments.source,
      edition_ids:receivedEditions,original_request_ids:[inspected.id,received.id],dataset:publication.dataset,
      discarded_reply:progress.steps["02-receive-original-archive"].discarded_response||null,
      carrier_recovery:progress.steps["02-receive-original-archive"].carrier_recovery||null,
      artifacts,errors,completed_at:new Date().toISOString()};
  }
  requireValue(entry.phase==="archive"&&Array.isArray(entry.members)&&entry.members.length,
    "Select the actual parent operation's retained native project editions.");
  const saved=await action("01-save-cohort","archive_save",async()=>{
    await openArchive();await page.locator("#archive-new").click();
    await page.locator("#archive-name").fill(entry.name);
    await page.locator("#archive-description").fill("Original native project editions retained by the existing portfolio receiving operation.");
    for(const [index,member]of entry.members.entries()){
      await page.locator("#archive-add-member").click();
      let row=page.locator("#archive-members tbody tr").nth(index);
      while(!await row.locator('select option[value="'+member.edition_id+'"]').count()){
        await page.locator('[data-tab="source"]').click();
        const more=page.locator("#more-editions");
        requireValue(await more.isVisible(),"The exact selected native edition is absent from the original source catalogue.");
        const before=await page.locator("#source-edition option").count();await more.click();
        await waitFor(async()=>await page.locator("#source-edition option").count()>before,
          "The original source catalogue did not advance.");
        await openArchive();row=page.locator("#archive-members tbody tr").nth(index);
      }
      await row.locator("input").nth(0).fill(member.project_key);
      await row.locator("input").nth(1).fill(member.label);
      await row.locator("select").selectOption(member.edition_id);
      if(member.currency){await row.locator("input").nth(2).fill(member.currency.code);await row.locator("input").nth(3).fill(member.currency.note);}
    }
    await page.getByText("Complete column and measure profile",{exact:true}).click();
    const baseProfile=structuredClone(entry.profile);delete baseProfile.timephased;
    await page.locator("#archive-profile").fill(JSON.stringify(baseProfile,null,2));
    await page.locator("#archive-profile").dispatchEvent("change");
    if(withPeriods)await selectNativePeriods();
    await page.locator("#archive-save").click();
  },{discardReply:true});
  const cohortId=saved.result.cohort_id;
  const reviewed=await action("02-review-cohort","archive_review",async()=>{
    await selectCohort(cohortId);await page.locator("#archive-review").click();
  });
  const published=await action("03-publish-cohort","archive_publish",async()=>{
    await openArchive();await page.locator("#archive-reviewer").fill(entry.reviewer);
    await page.locator("#archive-review-note").fill("Retain the complete original source closure, native measures and reporting tables for customer handover.");
    await page.locator("#archive-publish").click();
  });
  const publication=await inspectPublication(cohortId,published.result.publication_id);
  const exported=await action("04-export-complete-query","archive_query_export",async()=>{
    await openArchive();await page.locator("#archive-query-export").click();
  });
  requireValue(exported.result.rows===Number(publication.dataset.tables[queryTable]),
    "The full original query export differs from the selected reporting table count.");
  await retainDownloads(publication);
  await page.locator("#archive-query-exports details").filter({has:page.locator('button[title="'+exported.result.artifact.sha256+'"]')}).locator("summary").click();
  artifacts.push(await downloadArtifact(exported.result.artifact,"#archive-query-exports"));
  artifacts.push(await screenshot("archive-desktop.png",1440));
  artifacts.push(await screenshot("archive-mobile.png",390));
  return{schema:"portfolio.archive-native-browser-result.v1",operation_id:entry.operation_id,phase:entry.phase,
    workspace_id:hello.workspace_id,cohort_id:cohortId,publication_id:publication.id,
    review_sha256:reviewed.result.review_sha256,archive:{...publication.archive,path:join(out,publication.archive.filename)},
    query_export:exported.result,original_request_ids:[saved.id,reviewed.id,published.id,exported.id],
    edition_ids:entry.members.map(x=>x.edition_id),dataset:publication.dataset,
    discarded_reply:progress.steps["01-save-cohort"].discarded_response||null,
    carrier_recovery:progress.steps["01-save-cohort"].carrier_recovery||null,
    artifacts,errors,completed_at:new Date().toISOString()};
}

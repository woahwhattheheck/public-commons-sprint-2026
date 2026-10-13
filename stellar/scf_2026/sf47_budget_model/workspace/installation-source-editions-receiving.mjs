// Operate customer source editions inside the original Source Desk receiving.
// The original BrowserReceiving owns the server, browser, journal and artifacts.
export async function receiveCustomerEditions(R,H){
  const {need,same,sha,stable,object,pretty}=H;
  const field=async(name,value,attrs='')=>{
    const node=R.page.locator('[data-source-edition-field="'+name+'"]'+attrs);
    if(await node.evaluate(el=>el.tagName)==='SELECT')await node.selectOption(String(value));
    else{await node.fill(String(value));await node.blur();}
    await R.idle();
  };
  const snapshot=label=>R.working(label,{fresh:true});
  const edition=async label=>{
    const copy=await snapshot(label),work=copy.state?.editionWork;
    need(work?.targetDraftId===R.report.browserDraftId,'Keep the complete edition review in the original browser draft.');
    return {copy,work};
  };
  const jsonDownload=async(action,filename,value,label)=>{
    const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
    const [file]=await R.downloads(()=>R.click(action),[{filename,bytes:raw.length,sha256:sha(raw)}],label);
    need(same(await object(file.path),value),'The complete downloaded edition JSON changed its selected source.');
    return file;
  };
  const originalPreparation=async(draftId,id)=>R.api(R.deskPrefix+'/'+draftId+'/preparations/'+id);
  const openCurrent=async()=>{
    await R.tab('editions');
    if(await R.page.locator('[data-source-action="current-open"]').count()){
      const current=await snapshot('edition-current-view');
      if(current.selectedRevision!==(await R.draft()).revision)await R.click('current-open');
      await R.tab('editions');
    }
  };
  const choose=async(comparison)=>{
    const selected=[];
    // Original source and browser target contain the same complete customer
    // inputs. Use the actual full metadata to choose each individual binding.
    for(const original of comparison.source.draft.files){
      const target=comparison.target.draft.files.find(f=>f.filename===original.filename);
      need(target&&['bytes','sha256','mediaType','sourceUrl','observedAt'].every(k=>same(original[k],target[k])),
        'The complete original cohort changed; choose the customer successor explicitly before continuing.');
      const attrs='[data-file-id="'+original.id+'"]';
      const decision=same(original,target)?'retain':'replace';
      // Locate every row through its real table search; this also works when
      // the original cohort grows beyond the visible forty rows.
      await field('search',original.filename,'[data-source-edition-view="choices"]');
      await field('choice',decision,attrs);
      if(decision==='replace')await field('targetFileId',target.id,attrs);
      selected.push({sourceFileId:original.id,choice:decision,targetFileId:decision==='replace'?target.id:null});
    }
    await field('search','','[data-source-edition-view="choices"]');
    return selected;
  };
  await R.stage('10-customer-edition-comparison-and-original-downloads',async()=>{
    await openCurrent();
    if(!R.report.customerEditions){
      const source=await R.api(R.deskPrefix+'/'+R.input.draftId),target=await R.draft();
      need(source.caseId===R.input.caseId&&source.id!==target.id&&
        same(source.selection,R.input.sourceSelection)&&same(target.selection,R.input.sourceSelection),
        'Use the original native source and browser target in the same customer case.');
      need(source.preparations.some(x=>x.id===R.input.preparation.id),'The original complete source preparation is absent.');
      const targetPreparation=R.report.phases['05-full-native-preparation-and-downloads'].id;
      need(target.preparations.some(x=>x.id===targetPreparation),'The original browser preparation is absent.');
      R.report.customerEditions={source:{draftId:source.id,revision:source.revision,sha256:sha(Buffer.from(stable(source)))},
        target:{draftId:target.id,revision:target.revision,sha256:sha(Buffer.from(stable(target)))},
        sourcePreparationId:R.input.preparation.id,targetPreparationId:targetPreparation};
      await R.save();
    }
    const pins=R.report.customerEditions;
    need((await R.draft()).revision===pins.target.revision,'The original target advanced before its customer-edition comparison.');
    await field('sourceDraftId',pins.source.draftId);
    await field('sourceRevisionText',pins.source.revision);
    await R.click('edition-compare');
    await field('sourcePreparationId',pins.sourcePreparationId);
    await field('targetPreparationId',pins.targetPreparationId);
    await R.click('edition-compare');
    const {work}=await edition('edition-complete-comparison'),c=work.comparison;
    need(same(c.source.ref,pins.source)&&same(c.target.ref,pins.target)&&
      c.preparations.source.id===pins.sourcePreparationId&&c.preparations.target.id===pins.targetPreparationId,
      'The displayed full comparison changed a selected original revision or preparation.');
    pins.comparison=c;await R.save();
    await jsonDownload('edition-download-comparison','customer-source-edition-comparison.json',c,'edition-comparison');
    for(const [view,list]of [['files',c.files],['mapping',c.selectionChanges],['outputs',c.preparations.files],['reports',c.preparations.reportChanges]]){
      await field('search','__no_original_customer_row_'+R.input.operationId+'__','[data-source-edition-view="'+view+'"]');
      const section=R.page.locator('section').filter({has:R.page.locator('[data-source-edition-view="'+view+'"]')}).last();
      need((await section.textContent()).includes('0 matching of '+list.length+' total rows'),'The complete-table empty search lost its population.');
      await R.capture('10-edition-empty-'+view);
      await field('search','','[data-source-edition-view="'+view+'"]');
      const pages=Math.max(1,Math.ceil(list.length/40));
      for(let page=1;page<pages;page++)await R.click('edition-page','[data-view="'+view+'"][data-page="'+page+'"]');
      if(pages>1)await R.click('edition-page','[data-view="'+view+'"][data-page="'+(pages-2)+'"]');
      // Reset to the whole population at its first page before source downloads.
      await field('search','','[data-source-edition-view="'+view+'"]');
    }
    for(const side of ['source','target']){
      for(const file of c[side].draft.files){
        await field('search',file.filename,'[data-source-edition-view="files"]');
        const selector='[data-side="'+side+'"][data-filename="'+file.filename+'"]:not([data-output])';
        await R.downloads(()=>R.page.locator('[data-source-action="edition-original-file"]'+selector).first().click(),
          [file],'edition-'+side+'-originals');
      }
      await field('search','','[data-source-edition-view="files"]');
      for(const file of c.preparations[side].files){
        await field('search',file.filename,'[data-source-edition-view="outputs"]');
        await R.downloads(()=>R.click('edition-original-file',
          '[data-side="'+side+'"][data-filename="'+file.filename+'"][data-output="true"]'),
          [file],'edition-'+side+'-prepared');
      }
      await field('search','','[data-source-edition-view="outputs"]');
    }
    await R.capture('10-full-customer-edition-comparison');
    return {source:pins.source,target:pins.target,comparisonSha256:c.sha256,
      originalFiles:{source:c.source.draft.files.length,target:c.target.draft.files.length},
      preparedFiles:{source:c.preparations.source.files.length,target:c.preparations.target.files.length}};
  });
  await R.stage('11-explicit-successor-and-unfinished-working-reopen',async()=>{
    await openCurrent();const pins=R.report.customerEditions;
    const current=await edition('edition-review-before-choices');
    need(current.work.comparison.sha256===pins.comparison.sha256,'Reopen the original complete customer comparison.');
    await R.page.setViewportSize({width:390,height:1000});
    const choices=await choose(pins.comparison);
    // Preserve real unfinished mapping text in the actual downloadable working
    // file, then receive that file through the original UI before completing it.
    const complete=JSON.stringify(R.input.sourceSelection,null,2)+'\n';
    await field('mappingMode','explicit');
    await field('mappingText',complete.slice(0,-3));
    need(await R.page.locator('[data-source-action="edition-preview"]').isDisabled(),
      'An unfinished full mapping must remain editable before native preview.');
    await R.capture('11-unfinished-customer-mapping');
    const before=await snapshot('edition-unfinished-original');
    const retained=Object.values(R.report.workingSnapshots).findLast(x=>x.sha256===sha(Buffer.from(JSON.stringify(before,null,2)+'\n')));
    // The maintained working helper records the exact actual filename; retrieve
    // the latest matching whole snapshot by its parsed content as a fallback.
    let source=retained;
    if(!source)for(const file of Object.values(R.report.workingSnapshots).reverse()){
      if(same(await object(file.path),before)){source=file;break;}
    }
    need(source,'Retain the actual full unfinished working-copy download.');
    await R.page.setViewportSize({width:390,height:1000});
    await R.downloads(async()=>{await R.page.locator('[data-source-working-file]').setInputFiles(source.path);await R.idle();},
      [null],'edition-before-working-reopen-'+Date.now());
    const restored=await snapshot('edition-unfinished-reopened');
    need(same(restored.state.editionWork,before.state.editionWork)&&same(restored.requests,before.requests)&&
      same(restored.state.rawFields,before.state.rawFields)&&same(restored.state.fieldErrors,before.state.fieldErrors),
      'Receiving the whole working file must preserve all original review fields, unfinished text and requests.');
    await field('mappingText',complete);
    // Carry the complete original customer mapping forward. This exact
    // cohort already contains every native descriptor field and its retained
    // source identities, so all customer values remain unchanged.
    await field('mappingMode','source');
    await R.click('edition-preview');
    await R.capture('11-narrow-operated-successor-preview');
    let review=await edition('edition-successor-preview');
    need(same(review.work.plan.files,choices)&&same(review.work.plan.selection,R.input.sourceSelection)&&
      same(review.work.plan.resultFiles,pins.comparison.target.draft.files),
      'The successor must preserve the entire original customer cohort and its exact commercial mapping.');
    await jsonDownload('edition-download-plan','customer-source-edition-plan.json',review.work.plan,'edition-plan');
    // A changed decision invalidates the earlier preview while retaining it.
    const first=pins.comparison.source.draft.files[0],chosen=choices[0];
    await field('search',first.filename,'[data-source-edition-view="choices"]');
    await field('choice','remove','[data-file-id="'+first.id+'"]');
    need(await R.page.locator('[data-source-action="edition-apply"]').isDisabled(),
      'An earlier preview must not save after its explicit file choice changes.');
    await R.capture('11-stale-successor-preview');
    await field('choice',chosen.choice,'[data-file-id="'+first.id+'"]');
    if(chosen.choice==='replace')await field('targetFileId',chosen.targetFileId,'[data-file-id="'+first.id+'"]');
    await field('search','','[data-source-edition-view="choices"]');
    await R.click('edition-preview');review=await edition('edition-frozen-successor');
    need(same(review.work.plan.files,choices)&&same(review.work.plan.selection,R.input.sourceSelection),
      'The exact restored customer choices changed before their original application.');
    pins.plan=review.work.plan;pins.choices=choices;pins.unfinishedWorking=source;await R.save();
    await R.capture('11-complete-successor-ready');
    return {planSha256:pins.plan.sha256,choices,unfinishedWorking:source};
  });
  await R.stage('12-original-edition-apply-and-request-recovery',async()=>{
    await openCurrent();const pins=R.report.customerEditions;
    let requests=await R.requests('edition.apply');
    need(requests.length<=1,'Keep the single original complete customer-edition application.');
    if(!requests.length){
      need((await R.draft()).revision===pins.plan.target.revision,'The target changed before its original successor request.');
      const review=await edition('edition-before-original-apply');
      need(same(review.work.plan,pins.plan),'Reopen the whole reviewed successor before recording it.');
      R.report.editionFault??={state:'ARMED',kind:'edition-response-after-native-commit'};
      need(R.report.editionFault.state==='ARMED','Recover the original customer-edition request before another save.');
      await R.save();
      await R.confirmClick('edition-apply',
        'Archive your complete unsaved mapping and Installation fields, then replace the current mapping with this successor preview?');
      await R.capture('12-original-edition-response-recovery');
      await R.recoverPending();
      requests=await R.requests('edition.apply');
    }else await R.recoverPending();
    requests=await R.requests('edition.apply');
    need(requests.length===1,'Retain one exact original successor application.');
    const {requestId,record,entry}=requests[0];
    need(record.state==='RECORDED'&&same(entry.body.data.plan,pins.plan)&&
      entry.body.expectedRevision===pins.plan.target.revision&&record.result.result?.planSha256===pins.plan.sha256,
      'The original request must accept this exact complete reviewed successor.');
    const transition=record.result.result,current=await R.draft();
    need(current.editionTransitions.some(x=>same(x,transition))&&same(current.selection,pins.plan.selection)&&
      same(current.files,pins.plan.resultFiles),'The saved successor lost its explicit choices, mapping or original bytes.');
    const status=await R.api(R.deskPrefix+'/'+current.id+'/requests/'+encodeURIComponent(requestId));
    need(status.state==='RECORDED'&&same(status.result,record.result),'The interrupted original apply did not reopen unchanged.');
    need(['RESPONSE_WITHHELD','ORIGINAL_RESPONSE_LOST'].includes(R.report.editionFault?.state)&&
      R.report.editionFault.requestId===requestId,'Preserve the actual interrupted original customer-edition response.');
    pins.transition=transition;pins.requestId=requestId;await R.save();
    await R.tab('editions');
    await jsonDownload('edition-download-transition','customer-source-edition-transition.json',transition,'edition-transition');
    need(await R.page.locator('[data-source-action="edition-apply"]').isDisabled(),
      'The accepted plan must remain historical after its target advances.');
    await R.capture('12-saved-customer-successor');
    return {requestId,transition};
  });
  await R.stage('13-successor-native-preparation-and-complete-downloads',async()=>{
    const pins=R.report.customerEditions;await R.tab('mapping');
    let requests=(await R.requests('prepare')).filter(x=>x.entry.body.expectedRevision===pins.transition.draftRevision);
    need(requests.length<=1,'Preserve one native preparation for the accepted successor revision.');
    if(!requests.length){
      need((await R.draft()).revision===pins.transition.draftRevision,'The accepted source advanced before its original native preparation.');
      await R.click('prepare');await R.recoverPending();
      requests=(await R.requests('prepare')).filter(x=>x.entry.body.expectedRevision===pins.transition.draftRevision);
    }else await R.recoverPending();
    requests=(await R.requests('prepare')).filter(x=>x.entry.body.expectedRevision===pins.transition.draftRevision);
    need(requests.length===1&&requests[0].record.state==='RECORDED','Recover the exact successor preparation request.');
    const accepted=requests[0].record.result.result;
    const prepared=await originalPreparation(R.report.browserDraftId,accepted.id);
    need(same(prepared,accepted)&&prepared.selectionSha256===sha(pretty(pins.plan.selection))&&
      prepared.report.cases.length===R.input.sourceSelection.cases.length,'The successor native preparation changed its full customer mapping.');
    for(const selected of R.input.sourceSelection.cases){
      const actual=prepared.report.cases.find(x=>x.caseId===selected.caseId);
      need(actual?.planSha256===selected.planSha256&&actual.profile===selected.profile&&
        String(actual.completeEffort.hours)===String(selected.effortTotal.hours),
        'Keep all original customer phases, profile and complete effort in the successor.');
    }
    await R.tab('outputs');await R.click('preparation-open','[data-id="'+prepared.id+'"]');
    for(const file of prepared.files)await R.downloads(()=>R.click('output-download','[data-filename="'+file.filename+'"]'),
      [file],'edition-successor-prepared');
    const archive=await R.api(R.deskPrefix+'/'+R.report.browserDraftId+'/preparations/'+prepared.id+'/archive?describe=1');
    need(archive.preparationId===prepared.id,'Keep the exact full successor native archive.');
    await R.downloads(()=>R.click('archive-download'),[archive],'edition-successor-archive');
    const priorSource=await originalPreparation(pins.source.draftId,pins.sourcePreparationId);
    const priorTarget=await originalPreparation(pins.target.draftId,pins.targetPreparationId);
    need(same(priorSource,pins.comparison.preparations.source)&&same(priorTarget,pins.comparison.preparations.target),
      'Earlier complete customer preparations changed during successor preparation.');
    pins.preparation=prepared;pins.archive=archive;await R.save();
    await R.capture('13-complete-native-successor');
    return {requestId:requests[0].requestId,id:prepared.id,files:prepared.files,archive};
  });
  await R.stage('14-edition-history-and-final-working-reopen',async()=>{
    const pins=R.report.customerEditions;
    // Opening a historical draft intentionally starts another local review.
    // Save the complete accepted review before that navigation and restore
    // this exact file afterwards, keeping the original request history.
    if(!pins.finalWorking){
      await R.tab('editions');
      const complete=await snapshot('edition-final-original');
      let file;for(const candidate of Object.values(R.report.workingSnapshots).reverse()){
        if(same(await object(candidate.path),complete)){file=candidate;break;}
      }
      need(file&&same(complete.state.editionWork?.applied,pins.transition),
        'Retain the whole accepted customer review before opening its history.');
      pins.finalWorking=file;await R.save();
    }
    const complete=await object(pins.finalWorking.path);
    await R.tab('history');
    await R.page.locator('[data-source-revision]').fill(String(pins.target.revision));await R.click('revision-open');
    const historical=await snapshot('edition-prior-target-reopened');
    need(same(historical.saved,pins.comparison.target.draft),'The retained complete pre-successor target changed.');
    await R.capture('14-original-target-history');
    await R.click('current-open');await R.tab('editions');
    await R.page.setViewportSize({width:390,height:1000});
    await R.downloads(async()=>{
      await R.page.locator('[data-source-working-file]').setInputFiles(pins.finalWorking.path);await R.idle();
    },[null],'edition-final-before-open-'+Date.now());
    const reopened=await snapshot('edition-final-reopened');
    need(same(reopened.state.editionWork,complete.state.editionWork)&&same(reopened.requests,complete.requests)&&
      same(reopened.saved,complete.saved)&&same(reopened.prepared,complete.prepared),
      'The independent complete working-copy open lost its accepted transition, original requests or native preparation.');
    await jsonDownload('edition-download-review','customer-source-edition-review.json',
      reopened.state.editionWork,'edition-final-review');
    await R.capture('14-reopened-complete-customer-edition');
    return {working:pins.finalWorking,transition:pins.transition,preparationId:pins.preparation.id,
      currentRevision:(await R.draft()).revision};
  });
  return R.report.customerEditions;
}


// Read the actual retained originals again before COMPLETE, including when a
// completed browser report is adopted after the parent process was interrupted.
export async function verifyCustomerEditions(R,H){
  const {need,same,sha,stable,object,verifyReceipt}=H;
  const expected=[
    '01-original-source-desk','02-every-original-file',
    '03-guided-mapping-and-original-request-recovery',
    '05-full-native-preparation-and-downloads','06-atomic-original-case-attachment',
    '07-complete-native-profile','08-original-installation-edit-and-save',
    '09-earlier-source-history-and-working-download',
    '10-customer-edition-comparison-and-original-downloads',
    '11-explicit-successor-and-unfinished-working-reopen',
    '12-original-edition-apply-and-request-recovery',
    '13-successor-native-preparation-and-complete-downloads',
    '14-edition-history-and-final-working-reopen'];
  need(same(Object.keys(R.report.phases),expected),
    'Keep the full original and customer-edition receiving sequence before completing.');
  const phases=R.report.phases,p=R.report.customerEditions;
  need(p&&p.source&&p.target&&p.comparison&&p.plan&&p.transition&&p.preparation&&p.archive&&p.finalWorking,
    'Retain every complete customer-edition source, transition, preparation and working file.');
  const c=phases[expected[8]],choices=phases[expected[9]],apply=phases[expected[10]],
    preparation=phases[expected[11]],finished=phases[expected[12]];
  need(same(c.source,p.source)&&same(c.target,p.target)&&c.comparisonSha256===p.comparison.sha256&&
    choices.planSha256===p.plan.sha256&&same(choices.choices,p.choices)&&same(choices.unfinishedWorking,p.unfinishedWorking)&&
    apply.requestId===p.requestId&&same(apply.transition,p.transition)&&
    preparation.id===p.preparation.id&&same(preparation.files,p.preparation.files)&&same(preparation.archive,p.archive)&&
    finished.preparationId===p.preparation.id&&same(finished.transition,p.transition)&&same(finished.working,p.finalWorking),
    'The completed phase results must retain their exact original customer-edition objects.');
  for(const value of [p.comparison,p.plan,p.transition]){
    const original={...value};delete original.sha256;
    need(value.sha256===sha(Buffer.from(stable(original))),'A complete saved customer-edition object changed its identity.');
  }
  for(const [name,ref]of [['source',p.source],['target',p.target]]){
    const original=await R.api(R.deskPrefix+'/'+ref.draftId+'?revision='+ref.revision);
    need(sha(Buffer.from(stable(original)))===ref.sha256&&same(original,p.comparison[name].draft)&&
      same(ref,p.comparison[name].ref),'The earlier complete customer source revision changed.');
    const id=name==='source'?p.sourcePreparationId:p.targetPreparationId;
    const prepared=await R.api(R.deskPrefix+'/'+ref.draftId+'/preparations/'+id);
    need(same(prepared,p.comparison.preparations[name]),'An earlier complete customer preparation changed.');
  }
  const accepted=await R.api(R.deskPrefix+'/'+R.report.browserDraftId+'?revision='+p.transition.draftRevision);
  const current=await R.draft();
  need(same(accepted.files,p.plan.resultFiles)&&same(accepted.selection,p.plan.selection)&&
    accepted.editionTransitions.some(x=>same(x,p.transition))&&same(current.selection,R.input.sourceSelection)&&
    current.revision===finished.currentRevision&&current.preparations.some(x=>x.id===p.preparation.id),
    'Keep the accepted complete customer successor and final native preparation in their original history.');
  const applyRequests=await R.requests('edition.apply');
  need(applyRequests.length===1&&applyRequests[0].requestId===p.requestId&&
    applyRequests[0].record.state==='RECORDED'&&same(applyRequests[0].entry.body.data.plan,p.plan)&&
    same(applyRequests[0].record.result.result,p.transition),
    'The complete customer transition must remain bound to its one original accepted request.');
  const prepareRequests=(await R.requests('prepare')).filter(x=>x.entry.body.expectedRevision===p.transition.draftRevision);
  need(prepareRequests.length===1&&prepareRequests[0].requestId===preparation.requestId&&
    prepareRequests[0].record.state==='RECORDED'&&same(prepareRequests[0].record.result.result,p.preparation),
    'The complete native successor output must remain bound to its original preparation request.');
  const prepared=await R.api(R.deskPrefix+'/'+R.report.browserDraftId+'/preparations/'+p.preparation.id);
  const archive=await R.api(R.deskPrefix+'/'+R.report.browserDraftId+'/preparations/'+p.preparation.id+'/archive?describe=1');
  need(same(prepared,p.preparation)&&same(archive,p.archive),'The complete native successor or archive changed after receiving.');
  for(const file of [p.unfinishedWorking,p.finalWorking]){
    need(Object.values(R.report.artifacts).some(x=>same(x,file)),'Keep each whole original working file in the retained delivery.');
    await verifyReceipt(file);
  }
  const unfinished=await object(p.unfinishedWorking.path),working=await object(p.finalWorking.path),review=working.state?.editionWork;
  need(unfinished.sourceDraftId===R.report.browserDraftId&&unfinished.scope.caseId===R.input.caseId&&
    same(unfinished.state.editionWork.comparison,p.comparison)&&
    working.sourceDraftId===R.report.browserDraftId&&working.scope.caseId===R.input.caseId&&
    working.scope.planId===R.input.planId&&same(working.saved,current)&&same(working.prepared,p.preparation)&&
    same(review?.comparison,p.comparison)&&same(review?.plan,p.plan)&&
    same(review?.applied,p.transition)&&same(review?.appliedPlan,p.plan)&&
    working.requests.some(x=>x.body?.requestId===p.requestId&&same(x.receipt,applyRequests[0].record.result))&&
    working.requests.some(x=>x.body?.requestId===preparation.requestId&&same(x.receipt,prepareRequests[0].record.result)),
    'Reopen the complete original unfinished and accepted working files with their exact request and preparation lineage.');
  return {source:p.source,target:p.target,requestId:p.requestId,preparationId:p.preparation.id,
    currentRevision:current.revision,working:p.finalWorking,archive:p.archive};
}

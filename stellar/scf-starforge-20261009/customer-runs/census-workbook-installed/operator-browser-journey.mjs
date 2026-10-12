// MIT. One retained original Census workbook merchant/customer operating journey.
await (async function runWorkbookJourney(){
  const assert=(await import('node:assert/strict')).default;
  const fs=await import('node:fs/promises');
  const {createHash}=await import('node:crypto');
  const {join,resolve}=await import('node:path');
  const {pathToFileURL,fileURLToPath}=await import('node:url');
  const {createServer}=await import('node:http');
  const {once}=await import('node:events');
  const {spawn}=await import('node:child_process');
  const required=name=>{const value=process.env[name];if(!value)throw new TypeError(name+' is required');return resolve(value);};
  const packageRoot=required('SCF_MERCHANT_PACKAGE');
  const python=process.env.SCF_PYTHON||'python3';
  const project=resolve(process.env.SCF_CENSUS_WORKSPACE||fileURLToPath(new URL('.',import.meta.url)));
  const root=join(packageRoot,'source/stellar/scf-starforge-20261009');
  const publisher=join(root,'sf30-seller-sdk/dataset-refresh');
  const run=join(project,'browser-run'),state=join(run,'state');
  const sourceFile=join(project,'inputs/2023_Jam_Values.xlsx');
  const sourceHash='c884b6c56f0951b8fbc28217b00577fbc22e2372dc375686d024e507c4e8d807';
  const inputName='2023_Jam_Values.xlsx';
  const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
  const exists=async p=>{try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
  await fs.mkdir(run,{recursive:true,mode:0o700});await fs.chmod(run,0o700);
  const checkpointFile=join(run,'checkpoint.json'),resultFile=join(run,'result.json');
  let checkpoint=await exists(checkpointFile)?JSON.parse(await fs.readFile(checkpointFile,'utf8')):{schema:'stellar-forge.workbook-native-journey.v1',phases:[],input:{url:'https://www2.census.gov/programs-surveys/acs/tech_docs/jam_values/2023_Jam_Values.xlsx',filename:inputName,sha256:sourceHash}};
  const phaseDone=name=>checkpoint.phases.some(x=>x.name===name);
  async function save(){await fs.writeFile(checkpointFile,JSON.stringify(checkpoint,null,2)+'\n',{mode:0o600});}
  async function phase(name,fn){
    if(phaseDone(name))return checkpoint.phases.find(x=>x.name===name).result;
    const result=await fn();checkpoint.phases.push({name,completedAt:new Date().toISOString(),result:result??null});await save();
    console.log(JSON.stringify({phase:name,result:result??null}));
    return result;
  }
  const {openDatasetVersions,DATASET_SNAPSHOT_PARAMETER}=await import(pathToFileURL(join(publisher,'versions.mjs')));
  const {startVersionedDatasetSeller,datasetControl}=await import(pathToFileURL(join(publisher,'service.mjs')));
  const {startDatasetPublishingWorkspace}=await import(pathToFileURL(join(publisher,'workspace.mjs')));
  const {buildDatasetSellerConfig}=await import(pathToFileURL(join(root,'sf30-seller-sdk/dataset-cli.mjs')));
  const {callWorkbookWorkspace}=await import(pathToFileURL(join(publisher,'workbook/cli.mjs')));
  const {chromium}=await import(pathToFileURL(required('SCF_PLAYWRIGHT_MODULE')));
  const initialCsv=join(run,'initial.csv'),initialConfig=join(run,'initial.json');
  if(!await exists(initialCsv))await fs.writeFile(initialCsv,'topic,lower_meaning,lower_value,upper_meaning,upper_value\nAge,Under 1 year old,0,100 years and over,101\n',{mode:0o600});
  if(!await exists(initialConfig))await fs.writeFile(initialConfig,JSON.stringify({
    schema:'stellar-forge.csv-dataset.v1',name:'Census 2023 ACS special-value reference',
    file:initialCsv,columns:{topic:'string',lower_meaning:'string',lower_value:'integer',upper_meaning:'string',upper_value:'integer'},
    filters:['topic'],ranges:['lower_value','upper_value'],sorts:['topic','lower_value','upper_value'],
    defaultLimit:5,maxLimit:25,maxRows:1000,maxBytes:1048576,maxCellChars:4096
  },null,2)+'\n',{mode:0o600});
  const original=await fs.readFile(sourceFile);assert.equal(original.length,13138);assert.equal(digest(original),sourceHash);
  let versions,seller,workspace,browser,context,page,freeServer;
  const browserErrors=[];let requests=0;
  const sessionFile=join(run,'publisher-session.json');
  async function startWorkspace(){
    workspace=await startDatasetPublishingWorkspace({directory:state,port:0,seller:seller.url,resource:'https://dataset.example/data',workbookPython:python});
    await fs.writeFile(sessionFile,JSON.stringify({schema:'stellar-forge.dataset-publisher-session.v1',origin:workspace.origin,token:workspace.token})+'\n',{mode:0o600});
    await fs.chmod(sessionFile,0o600);
  }
  async function api(action,payload,{method=payload===undefined?'GET':'POST',code=200}={}){
    const response=await fetch(workspace.origin+'/api/'+action,{method,headers:{authorization:'Bearer '+workspace.token,...(payload===undefined?{}:{'content-type':'application/json'})},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(140000)});
    const result=await response.json();assert.equal(response.status,code,action+': '+JSON.stringify(result));return result;
  }
  const status=()=>api('status');
  async function uiAction(action,fn,code=200){
    const before=await page.evaluate(()=>window.__nativeActionSequence??0);
    await fn();
    await page.waitForFunction(({path,before})=>(window.__nativeActionResponses??[]).some(x=>x.path===path&&x.seq>before&&x.complete),{path:'/api/'+action,before},{timeout:145000});
    const response=await page.evaluate(({path,before})=>(window.__nativeActionResponses??[]).find(x=>x.path===path&&x.seq>before&&x.complete),{path:'/api/'+action,before});
    assert.equal(response.error,undefined,action+': response decode');
    assert.equal(response.status,code,action+': '+JSON.stringify(response.body));
    await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
    return response.body;
  }
  async function refreshPage(){
    // Re-enter the original app with a full document load. A hash-only goto
    // can retain the pre-mutation source/plan state in the same document.
    if(new URL(page.url()).origin===workspace.origin){
      await page.evaluate(token=>{location.hash=token;},workspace.token);
      await page.reload({waitUntil:'domcontentloaded'});
    }else await page.goto(workspace.origin+'/#'+workspace.token,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#revision')?.textContent!=='—'&&!document.querySelector('#refresh')?.disabled,{timeout:30000});
  }
  async function download(selector,destination){
    const [dl]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);
    assert.equal(await dl.failure(),null);await dl.saveAs(destination);return{filename:dl.suggestedFilename(),bytes:(await fs.stat(destination)).size,sha256:digest(await fs.readFile(destination))};
  }
  try{
    versions=await openDatasetVersions(await exists(join(state,'state.json'))
      ? {directory:state} : {directory:state,initialConfig,retentionMs:86400000,maxVersions:8});
    const config=await buildDatasetSellerConfig(versions,{origin:'https://dataset.example',path:'/data',payment:{
      scheme:'exact',network:'stellar:testnet',asset:'C'+'A'.repeat(55),payTo:'G'+'A'.repeat(55),amount:'100',maxTimeoutSeconds:60}});
    config.routes[0].definition.queryParameters.push({...DATASET_SNAPSHOT_PARAMETER});
    seller=await startVersionedDatasetSeller({versions,config,port:0,controlTransport:'loopback'});
    await startWorkspace();
    browser=await chromium.launch({executablePath:required('SCF_CHROMIUM'),headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
    context=await browser.newContext({viewport:{width:1360,height:1000},acceptDownloads:true});
    await context.addInitScript(()=>{
      // Capture the actual UI fetch response inside the page, without another request or Chromium's inspector-body cache.
      const originalFetch=window.fetch.bind(window);
      window.__nativeActionSequence=0;window.__nativeActionResponses=[];
      window.fetch=async(...args)=>{
        const response=await originalFetch(...args);
        const input=args[0],options=args[1]??{};
        const url=new URL(typeof input==='string'?input:input.url,location.href);
        const method=String(options.method??input?.method??'GET').toUpperCase();
        if(url.origin===location.origin&&url.pathname.startsWith('/api/')&&method!=='GET'){
          const item={seq:++window.__nativeActionSequence,path:url.pathname,status:response.status,complete:false};
          window.__nativeActionResponses.push(item);
          if(window.__nativeActionResponses.length>100)window.__nativeActionResponses.shift();
          response.clone().json().then(body=>{item.body=body;item.complete=true;},error=>{item.error=String(error);item.complete=true;});
        }
        return response;
      };
    });
    page=await context.newPage();page.on('pageerror',e=>browserErrors.push(e.message));
    await refreshPage();
    await phase('native-initial-source',async()=>{const view=await status();checkpoint.initialSnapshot=view.status.current;
      const response=await fetch(seller.url+'/data?limit=1');assert.equal(response.status,402);
      const body=await response.json();checkpoint.originalOffer=body.accepts;
      return{snapshot:view.status.current,rows:view.status.versions.find(x=>x.snapshot===view.status.current)?.rows??1,workbookBytes:original.length,sha256:sourceHash,native402:true};});
    await phase('original-workbook-ui-intake',async()=>{
      const before=await status();let source=before.workspace.workbookSources.find(x=>x.sha256===sourceHash);
      if(!source){await page.locator('#wb-file').setInputFiles(sourceFile);const value=await uiAction('workbook',()=>page.locator('#wb-upload').click());source=value.source;}
      checkpoint.sourceId=source.id;assert.equal(source.sha256,sourceHash);assert.equal(source.filename,inputName);
      return{sourceId:source.id,sheets:source.workbook.sheets.map(x=>({name:x.name,range:x.observedRange})),sourceBytes:source.sourceBytes};
    });
    async function openSource(){
      await refreshPage();const row=page.locator('#wb-sources tbody tr').filter({hasText:inputName}).first();
      await uiAction('workbook/inspect',()=>row.getByRole('button',{name:'Open workbook'}).click());
    }
    await openSource();
    await phase('original-range-and-cell-inspection',async()=>{
      await page.locator('#wb-sheet').selectOption('Jam Values');await page.locator('#wb-range').fill('A20:G36');await page.locator('#wb-header').fill('20');
      const data=await uiAction('workbook/inspect',()=>page.locator('#wb-inspect').click());
      assert.equal(data.inspection.rows.length,17);
      const find=coordinate=>data.inspection.rows.flatMap(r=>r.cells).find(c=>c.cell===coordinate);
      assert.equal(find('D21').value,'0');assert.equal(find('B20').value,'Meaning:');assert.equal(find('E20').value,'Meaning:');
      assert.equal(find('B27').value,'Less than $100 ');
      await page.locator('[data-cell="D21"]').click();
      assert.match(await page.locator('#wb-cell-content').innerText(),/Original XML value token/);
      return{range:data.inspection.range,rows:17,literalZero:find('D21'),originalTrailingSpace:find('B27').value};
    });
    await phase('reviewed-public-mapping',async()=>{
      const current=await status();const source=current.workspace.workbookSources.find(x=>x.id===checkpoint.sourceId);
      let plan=source.plans.find(x=>x.plan.name==='Census jam values: original published fields');
      if(!plan){
        await page.locator('#wb-range').fill('A20:G36');await page.locator('#wb-header').fill('20');
        await page.locator('#wb-plan-name').fill('Census jam values: original published fields');
        for(const [field,column]of Object.entries({topic:'A',lower_meaning:'B',lower_value:'D',upper_meaning:'E',upper_value:'G'}))
          await page.getByRole('textbox',{name:field+' source column',exact:true}).fill(column);
        await page.locator('#wb-notes').fill('Original Census special-value reference table; preserve original literal values and whitespace. Duplicate header labels are selected by exact worksheet coordinates.');
        const saved=await uiAction('workbook/plan',()=>page.locator('#wb-save-plan').click());plan=saved.plan;
      }
      checkpoint.planId=plan.id;checkpoint.planRevision=plan.revision;
      return{id:plan.id,revision:plan.revision,planSha256:plan.planSha256};
    });
    await phase('native-candidate-from-reviewed-plan',async()=>{
      await openSource();
      const prepared=await uiAction('workbook/prepare',()=>page.locator('#wb-prepare').click());
      checkpoint.candidateId=prepared.draft.id;checkpoint.candidateSnapshot=prepared.draft.dataset.snapshot;
      assert.equal(prepared.draft.dataset.rowCount,16);assert.equal(prepared.draft.workbookSource.sourceSha256,sourceHash);
      assert.equal(prepared.draft.workbookSource.headerRow,20);
      return{id:prepared.draft.id,snapshot:prepared.draft.dataset.snapshot,rows:16,origin:prepared.draft.workbookSource};
    });
    await phase('original-typed-query-and-source-map',async()=>{
      const query='fields=topic,lower_value,upper_value&lte_lower_value=0&sort=topic&limit=25';
      const preview=await api('preview',{target:'draft:'+checkpoint.candidateId,query});
      assert.equal(preview.result.rows.length,3);assert(preview.result.rows.every(x=>x.lower_value===0));
      const full=await api('preview',{target:'draft:'+checkpoint.candidateId,query:'limit=25'});
      assert.equal(full.result.rows.length,16);
      assert.equal(full.result.rows.find(x=>x.topic==='Monthly Housing Costs').lower_meaning,'Less than $100 ');
      await page.locator('#preview-draft').click();await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
      await page.locator('#limit').fill('25');await uiAction('preview',()=>page.locator('#run-query').click());
      await page.screenshot({path:join(run,'merchant-desktop.png'),fullPage:true});
      return{rows:16,zeroRows:preview.result.rows.map(x=>x.topic),trailingSpacePreserved:true};
    });
    await phase('same-session-cli-candidate-reopen',async()=>{
      const reopened=await callWorkbookWorkspace({sessionFile,action:'prepare',payload:{id:checkpoint.sourceId,planId:checkpoint.planId,expectedPlanRevision:checkpoint.planRevision}});
      assert.equal(reopened.draft.id,checkpoint.candidateId);assert.equal(reopened.reused,true);
      return{candidateId:reopened.draft.id,reused:reopened.reused};
    });
    await phase('retained-mapping-edition-and-stale-refusal',async()=>{
      const view=await status(),source=view.workspace.workbookSources.find(x=>x.id===checkpoint.sourceId);
      const current=source.plans.find(x=>x.id===checkpoint.planId);
      const baseline=[current,...(current.editions??[])].find(x=>x.revision===checkpoint.planRevision);
      assert(baseline,'The candidate retains its original mapping edition');
      assert.equal(baseline.id,checkpoint.planId);
      const desired={...baseline.plan,notes:baseline.plan.notes+' Reviewed source coordinate labels once more; no public value changes.'};
      let retained=checkpoint.mappingReview;
      if(!retained){
        retained={schema:'stellar-forge.workbook-journey-mapping-review.v1',
          sourceId:source.id,planId:baseline.id,baseRevision:baseline.revision,
          basePlanSha256:baseline.planSha256,
          request:{id:source.id,planId:baseline.id,expectedSourceRevision:source.revision,
            expectedPlanRevision:baseline.revision,plan:desired,
            expectedSnapshot:baseline.expectedSnapshot,expectedRevision:baseline.expectedRevision}};
        checkpoint.mappingReview=retained;await save();
      }
      assert.equal(retained.sourceId,source.id);assert.equal(retained.planId,baseline.id);
      assert.equal(retained.baseRevision,baseline.revision);assert.equal(retained.basePlanSha256,baseline.planSha256);
      assert.deepEqual(retained.request.plan,desired);
      let saved;
      if(current.revision===baseline.revision){
        assert(!retained.saved,'A completed mapping revision remains retained');
        saved=(await api('workbook/plan',retained.request)).plan;
      }else{
        // The earlier command saved this exact revision before its UI wait
        // failed. Reuse that native result instead of adding the note again.
        assert.equal(current.revision,baseline.revision+1,'Select the same reviewed successor mapping');
        assert.deepEqual(current.plan,desired);
        assert.equal(current.configHash,baseline.configHash);
        assert.equal(current.expectedSnapshot,baseline.expectedSnapshot);
        assert.equal(current.expectedRevision,baseline.expectedRevision);
        saved=current;
      }
      if(retained.saved)assert.equal(retained.saved.planSha256,saved.planSha256);
      retained.saved={revision:saved.revision,planSha256:saved.planSha256};
      checkpoint.latestPlanRevision=saved.revision;await save();
      assert.equal(saved.revision,baseline.revision+1);
      await api('workbook/plan',retained.request,{code:409});
      await refreshPage();
      await uiAction('workbook/inspect',()=>page.locator('#wb-candidate-source').click());
      const visible=await page.evaluate(()=>({
        hidden:document.querySelector('#wb-copy-edition').hidden,
        state:document.querySelector('#wb-plan-state').textContent,
        notice:document.querySelector('#notice').textContent,
        selected:document.querySelector('#wb-plan-select').value}));
      assert.equal(visible.hidden,false,JSON.stringify(visible));
      assert.equal(await page.locator('#wb-prepare').isDisabled(),true);
      assert.equal(visible.state,'Retained historical edition',JSON.stringify(visible));
      return{candidatePlanRevision:baseline.revision,currentPlanRevision:saved.revision,
        staleWriteRejected:true,originalEditionReopened:true};
    });
    await phase('private-source-download-and-exact-bundle',async()=>{
      const raw=join(run,'downloaded-original.xlsx'),bundle=join(run,'workbook-private.zip');
      const a=await download('#wb-original',raw);assert.equal(a.sha256,sourceHash);
      const b=await download('#wb-private-export',bundle);checkpoint.privateBundle=bundle;
      const py="import json,zipfile,hashlib,sys\nfrom pathlib import Path\np=Path(sys.argv[1]);z=zipfile.ZipFile(p)\nnames=z.namelist();assert len(names)==9\nexpected={'original.xlsx','data.csv','dataset.json','workbook-projection.json','source-rows.jsonl','workbook-parser.py','candidate.json','review.json','manifest.json'}\nassert set(names)==expected\nmanifest=json.loads(z.read('manifest.json'))\nrows=z.read('source-rows.jsonl').decode().splitlines();assert len(rows)==16\nassert hashlib.sha256(z.read('original.xlsx')).hexdigest()==sys.argv[2]\nprint(json.dumps({'members':names,'manifest':manifest,'sourceRows':len(rows),'firstSourceRow':json.loads(rows[0])}))\n";
      const output=await new Promise((res,rej)=>{const child=spawn(python,['-c',py,bundle,sourceHash],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('error',rej);child.on('close',code=>code===0?res(out):rej(Error(err)));});
      const result=JSON.parse(output);await fs.writeFile(join(run,'private-bundle-inspection.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});
      return{download:a,bundle:b,members:result.members,sourceRows:result.sourceRows};
    });
    await phase('original-publication-and-retained-review',async()=>{
      const view=await status();let published;
      if(view.status.current!==checkpoint.candidateSnapshot){
        await refreshPage();published=await uiAction('publish',()=>page.locator('#publish').click());
      }else published=view;
      assert.equal(published.status.current,checkpoint.candidateSnapshot);
      checkpoint.publishedRevision=published.status.revision;
      await refreshPage();
      await uiAction('draft/select',()=>page.locator('[data-candidate="'+checkpoint.candidateId+'"]').click());
      const exported=await download('#export-review',join(run,'publisher-review.json'));checkpoint.reviewFile=join(run,'publisher-review.json');
      const review=JSON.parse(await fs.readFile(checkpoint.reviewFile,'utf8'));assert.equal(review.candidate.workbookSource.sourceSha256,sourceHash);
      return{snapshot:published.status.current,revision:published.status.revision,review:exported};
    });
    await phase('original-buyer-preparation',async()=>{
      await refreshPage();await uiAction('preview',()=>page.locator('#preview-current').click());
      await page.locator('#limit').fill('5');await uiAction('preview',()=>page.locator('#run-query').click());
      const offer=await uiAction('buyer-offer',()=>page.locator('#load-offer').click());
      assert.equal(offer.selection.matchingRows,16);assert.deepEqual(offer.accepts,checkpoint.originalOffer);
      await page.locator('#buyer-intent').fill('census-jam-2023-workbook-82e4');
      const prepared=await uiAction('buyer-prepare',()=>page.locator('#prepare-buyer').click());
      const configFile=join(run,'prepared-buyer.json');const downloaded=await download('#download-buyer',configFile);
      assert.equal(await fs.readFile(configFile,'utf8'),prepared.configText);
      checkpoint.configFile=configFile;checkpoint.prepared=prepared.config;checkpoint.preparedSelection=offer.selection;
      return{config:downloaded,snapshot:checkpoint.candidateSnapshot,matchingRows:16,query:offer.query??null,buyerId:prepared.savedBuyer?.id??null};
    });
    await phase('publisher-close-reopen-and-mobile',async()=>{
      await workspace.close();workspace=null;await startWorkspace();await refreshPage();
      const view=await status();assert.equal(view.status.current,checkpoint.candidateSnapshot);
      assert.equal(view.workspace.workbookSources.find(x=>x.id===checkpoint.sourceId).plans.find(x=>x.id===checkpoint.planId).revision,checkpoint.latestPlanRevision);
      assert.equal(view.workspace.candidates.find(x=>x.id===checkpoint.candidateId).workbookSource.planRevision,checkpoint.planRevision);
      assert(view.workspace.buyers.length>=1);
      await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(run,'merchant-mobile.png'),fullPage:true});
      const dimensions=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
      assert(dimensions.documentWidth<=dimensions.width+1,JSON.stringify(dimensions));await page.setViewportSize({width:1360,height:1000});
      return{sources:view.workspace.workbookSources.length,candidates:view.workspace.candidates.length,buyers:view.workspace.buyers.length,viewport:dimensions};
    });
    await phase('original-rollback-and-current-restore',async()=>{
      let view=await status();
      const rolled=await api('activate',{snapshot:checkpoint.initialSnapshot,expectedSnapshot:view.status.current,expectedRevision:view.status.revision});
      assert.equal(rolled.status.current,checkpoint.initialSnapshot);
      const restored=await api('activate',{snapshot:checkpoint.candidateSnapshot,expectedSnapshot:rolled.status.current,expectedRevision:rolled.status.revision});
      assert.equal(restored.status.current,checkpoint.candidateSnapshot);
      const prepared=JSON.parse(await fs.readFile(checkpoint.configFile,'utf8'));
      assert.equal(new URL(prepared.operation.url).searchParams.get('snapshot'),checkpoint.candidateSnapshot);
      return{rollback:rolled.status.current,restored:restored.status.current,revision:restored.status.revision};
    });
    // One original page-acquisition path is delegated to B710's composed driver.
    // Its host hook receives live native objects, not a replacement seller/parser.
    const customerDriver=join(project,'original-customer-continuation.mjs');
    if(!await exists(customerDriver))throw Object.assign(Error('Merchant phases are complete; retain this checkpoint and provide the original B710 customer driver before continuing the single acquisition.'),{code:'CUSTOMER_DRIVER_PENDING'});
    await phase('same-original-customer-acquisition-and-receiving',async()=>{
      const driver=await import(pathToFileURL(customerDriver));
      const result=await driver.receivePublishedWorkbook({versions,seller,workspace,project,run,
        reviewFile:checkpoint.reviewFile,configFile:checkpoint.configFile,snapshot:checkpoint.candidateSnapshot,
        expectedRows:16,sourceHash,sourceId:checkpoint.sourceId,candidateId:checkpoint.candidateId});
      checkpoint.customer=result;return result;
    });
    await phase('actual-annual-edition-and-native-publication',async()=>{
      const {continueCensusWorkbook2024}=await import(pathToFileURL(join(publisher,'workbook-comparison/census-example.mjs')));
      const annual=await continueCensusWorkbook2024({sessionFile,operationDirectory:join(run,'annual-2024'),
        publisherDirectory:publisher,targetFile:join(project,'inputs/2024_Jam_Values.xlsx'),
        baseline:{sourceId:checkpoint.sourceId,planId:checkpoint.planId,planRevision:checkpoint.planRevision}});
      checkpoint.annual=annual;
      assert.equal(annual.sourceRows,16);assert.equal(annual.counts.changed,1);assert.equal(annual.counts.unchanged,15);
      const earlier=await api('preview',{target:checkpoint.candidateSnapshot,query:'limit=25'});
      const updated=await api('preview',{target:annual.snapshot,query:'limit=25'});
      assert.equal(earlier.result.rows.find(x=>x.topic==='Year Moved In').upper_value,2022);
      assert.equal(updated.result.rows.find(x=>x.topic==='Year Moved In').upper_value,2024);
      return annual;
    });
    await phase('annual-review-ui-and-original-customer-pins',async()=>{
      await refreshPage();
      const row=page.locator('#we-history tbody tr').filter({hasText:checkpoint.annual.comparisonId});
      const opened=await uiAction('workbook/editions/read',()=>row.getByRole('button',{name:'Open review'}).click());
      assert.equal(opened.comparison.sha256,checkpoint.annual.comparisonSha256);
      const changed=await uiAction('workbook/editions/read',()=>page.locator('#we-kind').selectOption('changed'));
      assert.equal(changed.page.rows.length,1);
      await page.locator('#we-rows').getByRole('button',{name:'Inspect cells'}).click();
      assert.match(await page.locator('#we-cell-body').innerText(),/Moved in 2023 or later/);
      const exported=await download('#we-export',join(run,'annual-2024','comparison-ui.json'));
      const full=JSON.parse(await fs.readFile(join(run,'annual-2024','comparison-ui.json'),'utf8'));
      assert.equal(full.rows.length,16);assert.equal(full.comparison.sha256,checkpoint.annual.comparisonSha256);
      await page.screenshot({path:join(run,'annual-review-desktop.png'),fullPage:true});
      const buyer=JSON.parse(await fs.readFile(checkpoint.configFile,'utf8'));
      assert.equal(new URL(buyer.operation.url).searchParams.get('snapshot'),checkpoint.candidateSnapshot);
      assert.equal(checkpoint.customer.acquisition.snapshot,checkpoint.candidateSnapshot);
      await workspace.close();workspace=null;await startWorkspace();await refreshPage();
      const reopened=await status();assert.equal(reopened.status.current,checkpoint.annual.snapshot);
      assert.equal(reopened.workspace.workbookSources.filter(x=>x.sha256==='14a61938cff58166ef265af9a324b8a6f4cf6040f8630634e5711cb5b07e2cf5').length,1);
      await uiAction('workbook/editions/read',()=>page.locator('#we-history tbody tr').filter({hasText:checkpoint.annual.comparisonId}).getByRole('button',{name:'Open review'}).click());
      await page.setViewportSize({width:390,height:844});
      const dimensions=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth}));
      assert(dimensions.documentWidth<=dimensions.width+1,JSON.stringify(dimensions));
      await page.screenshot({path:join(run,'annual-review-mobile.png'),fullPage:true});
      return{comparisonId:checkpoint.annual.comparisonId,review:exported,reopenedCurrent:reopened.status.current,
        originalCustomerSnapshot:checkpoint.customer.acquisition.snapshot,viewport:dimensions};
    });
    assert.deepEqual(browserErrors,[]);
    await phase('owned-native-shutdown',async()=>{await context.close();context=null;await browser.close();browser=null;await workspace.close();workspace=null;await seller.close();seller=null;versions=null;await fs.rm(sessionFile,{force:true});return{closed:true,browserErrors};});
    const result={...checkpoint,status:'PASS',completedAt:new Date().toISOString(),sourceFile,sourceHash,actualSourceRows:16,
      statement:'Original Census workbook bytes through the native workbook publisher, saved-buyer preparation, free dataset acquisition, Inbox/Analysis receiving and annual edition comparison.'};
    await fs.writeFile(resultFile,JSON.stringify(result,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:'PASS',phases:checkpoint.phases.length,resultFile}));
  }catch(error){
    if(page&&!page.isClosed()){
      const observed=await page.evaluate(()=>({
        notice:document.querySelector('#notice')?.textContent,
        noticeKind:document.querySelector('#notice')?.dataset.kind,
        planState:document.querySelector('#wb-plan-state')?.textContent,
        selectedPlan:document.querySelector('#wb-plan-select')?.value,
        historicalCopyHidden:document.querySelector('#wb-copy-edition')?.hidden
      })).catch(()=>null);
      if(observed)await fs.writeFile(join(run,'last-ui-state.json'),JSON.stringify(observed,null,2)+'\n',{mode:0o600}).catch(()=>{});
      await page.screenshot({path:join(run,'last-ui-state.png'),fullPage:true}).catch(()=>{});
    }
    await fs.writeFile(join(run,'last-error.json'),JSON.stringify({code:error.code??null,message:error.message,stack:error.stack,phases:checkpoint.phases.map(x=>x.name),at:new Date().toISOString()},null,2)+'\n',{mode:0o600});
    console.error(error.stack);process.exitCode=1;
  }finally{
    await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await workspace?.close().catch(()=>{});
    if(freeServer)await new Promise(resolve=>freeServer.close(resolve));
    if(seller)await seller.close().catch(()=>{});else await versions?.close().catch(()=>{});
    await fs.rm(sessionFile,{force:true}).catch(()=>{});
  }
})();

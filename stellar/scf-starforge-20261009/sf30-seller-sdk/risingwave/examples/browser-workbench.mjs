// MIT. Observe the same retained RisingWave Applications command in Chromium.
// The original managed-workbench operator awaits this callback before stopping it.
import assert from 'node:assert/strict';
import { open, mkdir, lstat, chmod, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';

const HASH = /^[a-f0-9]{64}$/;
const CAPTURE_NAMES = ['json','ndjson','csv','events','checkpoint','state','manifest'];
const DIFFERENCE_NAMES = ['added','removed','changed','manifest'];
const stamp = () => new Date().toISOString();
const encoded = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
function need(condition, code, detail='') {
  if (!condition) throw Object.assign(new Error(code+(detail?': '+detail:'')),{code});
}
function sameFile(a,b) {
  return a.dev===b.dev && a.ino===b.ino && a.size===b.size &&
    a.mtimeMs===b.mtimeMs && a.ctimeMs===b.ctimeMs;
}
async function privateDirectory(path) {
  await mkdir(path,{recursive:true,mode:0o700});
  const stat=await lstat(path);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&!(stat.mode&0o077),
    'PRIVATE_BROWSER_DIRECTORY_REQUIRED',path);
  if (typeof process.getuid==='function')
    need(stat.uid===process.getuid(),'BROWSER_DIRECTORY_OWNER_CHANGED',path);
  return path;
}
async function fileIdentity(path) {
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const before=await file.stat();
    need(before.isFile(),'BROWSER_ORIGINAL_FILE_REQUIRED',path);
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);
    let bytes=0;
    for (;;) {
      const next=await file.read(buffer,0,buffer.length,null);
      if (!next.bytesRead) break;
      hash.update(buffer.subarray(0,next.bytesRead));bytes+=next.bytesRead;
    }
    need(bytes===before.size&&sameFile(before,await file.stat()),
      'BROWSER_ORIGINAL_FILE_CHANGED',path);
    return {path,bytes,sha256:hash.digest('hex')};
  } finally { await file.close(); }
}
async function exactOriginal(path,expected) {
  need(expected&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&HASH.test(expected.sha256??''),
    'BROWSER_FILE_SELECTION_INVALID');
  const actual=await fileIdentity(path);
  assert.equal(actual.bytes,expected.bytes);
  assert.equal(actual.sha256,expected.sha256);
  return actual;
}
function fileIn(directory,descriptor) {
  need(descriptor&&typeof descriptor.path==='string'&&
    basename(descriptor.path)===descriptor.path&&!['.','..'].includes(descriptor.path),
  'BROWSER_FILE_NAME_INVALID');
  return join(directory,descriptor.path);
}
async function privateJson(path,value) {
  await writeFile(path,encoded(value),{flag:'wx',mode:0o600});
  const file=await open(path,'r');
  try { await file.sync(); } finally { await file.close(); }
}
async function facts(locator) {
  return locator.evaluate(node=>{
    const result={};
    const children=[...node.children];
    for(let i=0;i<children.length;i++) {
      if(children[i].tagName==='DT'&&children[i+1]?.tagName==='DD')
        result[children[i].textContent.trim()]=children[++i].textContent.trim();
    }
    return result;
  });
}
function namedRows(table,text) {
  return table.locator('tbody tr').filter({hasText:text});
}
async function until(predicate,message,timeoutMs=30000) {
  const deadline=Date.now()+timeoutMs;
  while(Date.now()<deadline) {
    if(await predicate()) return;
    await new Promise(done=>setTimeout(done,100));
  }
  throw Object.assign(new Error(message),{code:'BROWSER_EXPECTED_VIEW_TIMEOUT'});
}

/**
 * Optional environment:
 * RISINGWAVE_PLAYWRIGHT_MODULE: absolute original Playwright module path.
 * RISINGWAVE_CHROMIUM_EXECUTABLE: absolute existing Chromium executable.
 * When module is omitted, use the installed package's normal "playwright" import.
 * Keep the managed caller and database alive; this function owns only its browser.
 */
export async function inspectRisingWaveManagedApplication(context) {
  const {phase,application,client,url,directory,nativeResult:native,runtime,opened}=context??{};
  need(/^[A-Za-z0-9_-]{1,64}$/.test(phase??'')&&client&&
    native?.schema==='native.risingwave-source-publisher-journey.v1'&&native.outcome==='PASS'&&
    opened?.schema==='native.risingwave-managed-open.v1'&&opened.phase===phase&&
    application?.current?.id&&typeof url==='string'&&isAbsolute(directory??''),
  'ORIGINAL_MANAGED_BROWSER_CONTEXT_REQUIRED');
  const address=new URL(url),token=address.hash.slice(1);
  need(['http:','https:'].includes(address.protocol)&&/^[A-Za-z0-9_-]{43}$/.test(token)&&
    !address.username&&!address.password,'ORIGINAL_PRIVATE_BROWSER_URL_REQUIRED');
  const redact=value=>String(value).split(url).join(address.origin+'/[private]').split(token).join('[private]');
  const attempt=randomUUID(),root=await privateDirectory(join(resolve(directory),'browser',phase));
  const output=await privateDirectory(join(root,attempt)),resultPath=join(output,'browser-result.json');
  const selection={schema:'native.risingwave-browser-selection.v1',attempt,phase,
    applicationId:application.id,operationId:application.current.id,
    nativeSourcePin:native.sourcePin,protocolSourcePin:native.protocolSourcePin,
    sourceRevision:opened.sourceRevision,publicationId:native.context.publicationId,
    firstCaptureId:native.context.firstCaptureId,secondCaptureId:native.context.secondCaptureId,
    firstRun:native.context.firstRun,secondRun:native.context.secondRun,
    comparisonId:native.context.comparisonId,origin:address.origin,
    installationId:runtime.installationId,sourceManifestSha256:runtime.sourceManifestSha256};
  await privateJson(join(output,'selection.json'),selection);
  const result={schema:'native.risingwave-managed-browser.v1',outcome:'RUNNING',
    startedAt:stamp(),selection,paths:{directory:output,result:resultPath},
    views:[],screens:[],downloads:[],reports:[],subscriptions:[],runs:[],requests:[],
    pageErrors:[],consoleErrors:[],requestFailures:[],responseFailures:[],mutationAttempts:[]};
  let browser,browserContext,page,lastStep='prepare',failure;
  const remember=(list,value)=>{if(list.length<1000)list.push(value);};
  const safeRequest=request=>{
    const value=new URL(request.url());return {method:request.method(),origin:value.origin,path:value.pathname};
  };
  async function step(name,action) {
    lastStep=name;
    const value=await action();
    result.views.push({name,completedAt:stamp()});
    return value;
  }
  async function tab(name) {
    await page.locator('nav button[data-tab="'+name+'"]').click();
    await page.locator('#'+name).waitFor({state:'visible'});
    await page.waitForFunction(n=>document.querySelector('nav button[data-tab="'+n+'"]')
      ?.getAttribute('aria-selected')==='true',name);
  }
  async function healthy() {
    const error=await page.locator('#notice.error').count();
    need(!error,'WORKBENCH_VISIBLE_ERROR',error?await page.locator('#notice').innerText():'');
    assert.equal(await page.locator('#draft-status').innerText(),'Saved');
    const body=await page.locator('body').innerText();
    need(!body.includes('[object HTML'),'BROWSER_DOM_OBJECT_RENDERED');
  }
  async function screenshot(name) {
    await healthy();
    const viewport=page.viewportSize();
    const layout=await page.evaluate(()=>({
      width:innerWidth,documentWidth:document.documentElement.scrollWidth,
      bodyWidth:document.body.scrollWidth,height:innerHeight
    }));
    need(layout.documentWidth<=layout.width+1&&layout.bodyWidth<=layout.width+1,
      'WORKBENCH_PAGE_OVERFLOW',JSON.stringify(layout));
    const path=join(output,name+'.png');
    await page.screenshot({path,fullPage:true,animations:'disabled'});
    await chmod(path,0o600);
    result.screens.push({name,viewport,layout,...await fileIdentity(path)});
  }
  async function download(button,expected,retainedPath,label) {
    const original=await exactOriginal(retainedPath,expected);
    const pending=page.waitForEvent('download',{timeout:120000});
    await button.click();
    const transfer=await pending;
    try {
      assert.equal(transfer.suggestedFilename(),expected.path??basename(retainedPath));
      const stream=await transfer.createReadStream();
      need(stream,'BROWSER_DOWNLOAD_STREAM_MISSING',label);
      const hash=createHash('sha256');let bytes=0;
      for await(const chunk of stream) {
        bytes+=chunk.length;
        need(bytes<=expected.bytes,'BROWSER_DOWNLOAD_EXCEEDED_ORIGINAL',label);
        hash.update(chunk);
      }
      need(await transfer.failure()===null,'BROWSER_DOWNLOAD_FAILED',label);
      assert.equal(bytes,expected.bytes);assert.equal(hash.digest('hex'),expected.sha256);
      await exactOriginal(original.path,expected);
      result.downloads.push({label,bytes,sha256:expected.sha256,retainedPath:original.path,
        transport:'original browser download',verifiedAt:stamp()});
    } finally { await transfer.delete(); }
  }
  async function locateCapture(id) {
    for(let pageNumber=0;pageNumber<1000;pageNumber++) {
      const cards=page.locator('#captures-list article.capture-card');
      const matches=await cards.evaluateAll((nodes,id)=>nodes.flatMap((node,index)=>{
        const label=[...node.querySelectorAll('dl.facts > dt')].find(item=>item.textContent.trim()==='Edition');
        return label?.nextElementSibling?.textContent.trim()===id?[index]:[];
      }),id);
      if(matches.length) {assert.equal(matches.length,1);return cards.nth(matches[0]);}
      const next=page.locator('#captures-next');
      if(await next.isDisabled()) break;
      const previous=await page.locator('#captures-page').innerText();
      await next.click();
      await until(async()=>await page.locator('#captures-page').innerText()!==previous,
        'The original edition page did not advance.');
    }
    throw Object.assign(new Error('Original capture is absent: '+id),{code:'BROWSER_CAPTURE_NOT_FOUND'});
  }
  async function edition(label) {
    const id=native.context[label+'CaptureId'],expected=native[label].capture;
    await until(async()=>await page.locator('#captures-list article.capture-card').count()>0,
      'The saved edition list did not open.');
    const card=await locateCapture(id),shown=await facts(card.locator('dl.facts'));
    assert.equal(shown.Edition,id);
    assert.equal(shown['Report rows'],String(expected.rowCount));
    assert.equal(shown['Source rows'],String(expected.sourceRowCount));
    assert.equal(shown.Mode,expected.effectiveMode);
    assert.equal(await card.locator('.badge').innerText(),'COMPLETE');
    const received=opened.receiving.find(row=>row.label===label);
    need(received?.directory,'ORIGINAL_RECEIVED_CAPTURE_REQUIRED',label);
    assert.deepEqual(Object.keys(expected.files).sort(),[...CAPTURE_NAMES].sort());
    for(const key of CAPTURE_NAMES) {
      const file=expected.files[key],button=card.getByRole('button',{
        name:file.path+' · '+file.bytes+' bytes',exact:true
      });
      assert.equal(await button.count(),1);
      await download(button,file,fileIn(received.directory,file),label+'/'+key);
    }
    result[label]={captureId:id,nativeCaptureId:expected.id,rows:expected.rowCount,
      sourceRows:expected.sourceRowCount,orderedRowsSha256:expected.orderedRowsSha256};
  }
  async function openComparison() {
    for(let pageNumber=0;pageNumber<1000;pageNumber++) {
      const rows=page.locator('#comparisons-list tbody tr').filter({
        hasText:native.context.firstCaptureId
      }).filter({hasText:native.context.secondCaptureId});
      if(await rows.count()) {
        // This original case creates one retained comparison for these two captures.
        need(await rows.count()===1,'BROWSER_COMPARISON_SELECTION_AMBIGUOUS');
        await rows.getByRole('button',{name:'Open complete differences',exact:true}).click();
        await page.getByText('Complete comparison: '+native.context.comparisonId,{exact:true}).waitFor();
        break;
      }
      const next=page.locator('#comparisons-next');
      if(await next.isDisabled()) throw Object.assign(new Error('Original complete comparison is absent.'),
        {code:'BROWSER_COMPARISON_NOT_FOUND'});
      const previous=await page.locator('#comparisons-page').innerText();
      await next.click();
      await until(async()=>await page.locator('#comparisons-page').innerText()!==previous,
        'The original comparison page did not advance.');
    }
    const shown=await page.locator('#comparison-result .metric-row').evaluate(node=>
      Object.fromEntries([...node.children].map(item=>[
        item.querySelector('span').textContent.trim().toLowerCase(),
        item.querySelector('strong').textContent.trim()
      ])));
    for(const key of ['before','after','added','removed','changed','unchanged'])
      assert.equal(shown[key],String(native.comparison.counts[key]));
    for(const key of DIFFERENCE_NAMES) {
      const file=native.comparison.files[key];
      await download(page.locator('#comparison-result').getByRole('button',{
        name:file.path+' · '+file.bytes+' bytes',exact:true
      }),file,fileIn(opened.comparisonReceiving.directory,file),'comparison/'+key);
    }
    result.comparison={id:native.context.comparisonId,counts:native.comparison.counts};
  }
  async function openProduct() {
    const product=await client.publication(native.context.publicationId);
    await until(async()=>await page.locator('#products-list article.capture-card').count()>0,
      'The original product list did not open.');
    const card=page.locator('#products-list article.capture-card').filter({
      has:page.locator('p').filter({hasText:product.path})
    }).filter({has:page.getByRole('heading',{name:product.query,exact:true})});
    assert.equal(await card.count(),1);
    await card.getByRole('button',{name:'Open product',exact:true}).click();
    await page.locator('#selected-product').waitFor({state:'visible'});
    await until(async()=>(await facts(page.locator('#product-facts'))).Product===product.id,
      'The selected original product did not open.');
    const shown=await facts(page.locator('#product-facts'));
    assert.equal(shown.Product,product.id);assert.equal(shown.Scheduler,'Enabled');
    assert.equal(shown.Seller,product.seller.origin);
    assert.equal(shown['Saved source revision'],String(product.revision));
    for(const label of ['first','second']) {
      const runId=native.context[label+'Run'];
      const row=namedRows(page.locator('#product-runs'),runId);
      assert.equal(await row.count(),1);
      need((await row.innerText()).includes('PUBLISHED'),'BROWSER_PUBLISHED_RUN_MISSING',runId);
      await row.getByRole('button',{name:'Inspect',exact:true}).click();
      const detail=page.locator('#product-runs details').filter({
        has:page.locator('summary').filter({hasText:'Run '+runId})
      });
      await detail.waitFor();
      await detail.locator('summary').click();
      await detail.locator('pre').waitFor({state:'visible'});
      const value=JSON.parse(await detail.locator('pre').textContent());
      assert.equal(value.run.id,runId);
      assert.equal(value.preview.page.total,native[label].capture.rowCount);
      assert.equal(value.run.data.candidate.dataset.snapshot,opened[label].snapshot);
      for(const valueRow of value.preview.rows) {
        assert.equal(valueRow.null_note,null);assert.equal(valueRow.empty_note,'');
        for(const key of ['public_key','exact_decimal','observed_at'])
          assert.equal(typeof valueRow[key],'string');
      }
      result.runs.push({id:runId,rows:value.preview.page.total,
        snapshot:value.run.data.candidate.dataset.snapshot});
    }
    await page.locator('#buyer-run').selectOption(native.context.firstRun);
    await page.locator('#buyer-query').fill('limit=20');
    await page.locator('#read-offer').click();
    const detail=page.locator('#buyer-result details').filter({
      has:page.getByText('Exact customer offer',{exact:true})
    });
    await detail.waitFor();
    await detail.locator('summary').click();
    await detail.locator('pre').waitFor({state:'visible'});
    const offer=JSON.parse(await detail.locator('pre').textContent());
    assert.deepEqual(offer.accepts,native.paid.accepts);
    const choices=await page.locator('#buyer-option option').allTextContents();
    assert.deepEqual(choices,native.paid.accepts.map((choice,index)=>
      index+' · '+choice.network+' · '+choice.amount));
    result.offer={snapshot:native.paid.snapshot,accepts:offer.accepts,
      originalBuyerRequestId:native.paid.buyerRequestId,originalIntentId:native.paid.intentId};
    const href=await page.locator('#publisher-link').getAttribute('href'),consoleUrl=new URL(href);
    need(consoleUrl.hostname===address.hostname&&!consoleUrl.username&&!consoleUrl.password,
      'ORIGINAL_PUBLICATION_CONSOLE_REQUIRED');
    result.publication={id:product.id,revision:product.revision,sellerOrigin:product.seller.origin,
      consoleOrigin:consoleUrl.origin,schedulePolicyId:opened.schedule.policyId,
      scheduleRevision:opened.schedule.revision};
    return product;
  }
  try {
    const modulePath=process.env.RISINGWAVE_PLAYWRIGHT_MODULE;
    need(!modulePath||isAbsolute(modulePath),'ABSOLUTE_PLAYWRIGHT_MODULE_REQUIRED');
    const playwright=await import(modulePath?pathToFileURL(modulePath).href:'playwright');
    const chromium=playwright.chromium??playwright.default?.chromium;
    need(chromium,'ORIGINAL_PLAYWRIGHT_CHROMIUM_REQUIRED');
    const executablePath=process.env.RISINGWAVE_CHROMIUM_EXECUTABLE;
    need(!executablePath||isAbsolute(executablePath),'ABSOLUTE_CHROMIUM_EXECUTABLE_REQUIRED');
    browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{}),
      args:['--no-sandbox','--disable-dev-shm-usage']});
    result.browserVersion=browser.version();
    browserContext=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:960}});
    await browserContext.route('**/api/**',async route=>{
      const request=route.request(),value=safeRequest(request);
      if(!['GET','HEAD'].includes(request.method())) {
        remember(result.mutationAttempts,value);await route.abort('blockedbyclient');return;
      }
      await route.continue();
    });
    browserContext.on('page',current=>{
      current.on('pageerror',issue=>remember(result.pageErrors,{message:redact(issue.message)}));
      current.on('console',message=>{
        const location=message.location();
        if(message.type()==='error'&&(!location.url||new URL(location.url).pathname!=='/favicon.ico'))
          remember(result.consoleErrors,{message:redact(message.text())});
      });
      current.on('requestfailed',request=>{
        const selected=safeRequest(request);
        if(selected.path!=='/favicon.ico')remember(result.requestFailures,{
          ...selected,error:redact(request.failure()?.errorText??'Unknown request failure')
        });
      });
      current.on('response',response=>{
        const selected=safeRequest(response.request());
        if(response.status()>=400&&selected.path!=='/favicon.ico')remember(result.responseFailures,{
          ...selected,status:response.status()
        });
      });
      current.on('request',request=>{
        const parsed=new URL(request.url());
        if(parsed.pathname.startsWith('/api/'))remember(result.requests,safeRequest(request));
      });
    });
    page=await browserContext.newPage();
    page.setDefaultTimeout(30000);
    await step('open original application',async()=>{
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
      await page.getByText('Saved revision '+opened.sourceRevision,{exact:true}).waitFor();
      await healthy();
    });
    const current=await client.revision(opened.sourceRevision);
    await step('saved source and payment terms',async()=>{
      assert.deepEqual(JSON.parse(await page.locator('#source-json').inputValue()),current.source);
      assert.deepEqual(JSON.parse(await page.locator('#payment-json').inputValue()),
        current.merchant.paymentOptions??[current.merchant.payment]);
      assert.equal(await page.locator('#connection-env').inputValue(),current.source.connectionStringEnv);
      assert.equal(await page.locator('#tls').inputValue(),current.source.tls);
      await screenshot('01-source-desktop');
    });
    await step('all saved report declarations',async()=>{
      await tab('reports');
      for(const [name,report]of Object.entries(current.source.queries)) {
        await page.locator('#report-select').selectOption(name);
        assert.equal(await page.locator('#report-name').inputValue(),name);
        assert.equal(await page.locator('#relation-schema').inputValue(),report.relation.schema);
        assert.equal(await page.locator('#relation-name').inputValue(),report.relation.name);
        assert.equal(await page.locator('#subscription-schema').inputValue(),report.subscription.schema);
        assert.equal(await page.locator('#subscription-name').inputValue(),report.subscription.name);
        assert.deepEqual((await page.locator('#report-key').inputValue()).split(',').map(v=>v.trim()),report.key);
        const columns=Object.entries(report.columns);
        assert.equal(await page.locator('#report-columns tr').count(),columns.length);
        for(let index=0;index<columns.length;index++) {
          const [alias,column]=columns[index];
          assert.equal(await page.getByLabel('Output alias '+index,{exact:true}).inputValue(),alias);
          assert.equal(await page.getByLabel('Native column '+index,{exact:true}).inputValue(),column.column);
          assert.equal(await page.getByLabel('Type '+index,{exact:true}).inputValue(),column.type);
          assert.equal(await page.locator('#report-columns tr').nth(index)
            .getByLabel('Nullable '+index,{exact:true}).isChecked(),column.nullable===true);
        }
        const parameters=Object.entries(report.parameters??{});
        assert.equal(await page.locator('#report-parameters tr').count(),parameters.length);
        for(let index=0;index<parameters.length;index++) {
          const [parameter,spec]=parameters[index],row=page.locator('#report-parameters tr').nth(index);
          assert.equal(await row.getByLabel('Parameter name '+index,{exact:true}).inputValue(),parameter);
          assert.equal(await row.getByLabel('Parameter type '+index,{exact:true}).inputValue(),spec.type);
          assert.equal(await row.getByLabel('Required '+index,{exact:true}).isChecked(),spec.required!==false);
          assert.equal(await row.getByLabel('Nullable '+index,{exact:true}).isChecked(),spec.nullable===true);
          assert.equal(await row.getByLabel('Array '+index,{exact:true}).isChecked(),spec.array===true);
        }
        result.reports.push({name,columns:columns.length,parameters:parameters.length,key:report.key});
      }
      await page.locator('#report-select').selectOption(native.first.capture.query);
      await screenshot('02-reports-desktop');
    });
    await step('original subscription reviews',async()=>{
      await tab('subscriptions');
      for(const id of native.context.subscriptionRequestIds) {
        await until(async()=>await namedRows(page.locator('#subscription-operations'),id).count()===1,
          'The original subscription review did not appear.');
        await namedRows(page.locator('#subscription-operations'),id)
          .getByRole('button',{name:'Open review',exact:true}).click();
        await page.locator('#subscription-review').waitFor({state:'visible'});
        const shown=await facts(page.locator('#subscription-review-facts'));
        assert.equal(shown.Request,id);
        result.subscriptions.push({id,relation:shown.Relation,subscription:shown.Subscription,
          sourceRevision:shown['Saved source revision'],retention:shown.Retention,result:shown.Result});
      }
      await screenshot('03-subscriptions-desktop');
    });
    await step('two complete browser editions',async()=>{
      await tab('captures');
      await edition('first');await edition('second');
      await screenshot('04-editions-desktop');
    });
    await step('all complete differences',async()=>{
      await openComparison();
      await screenshot('05-comparison-desktop');
    });
    await step('published runs and original customer offer',async()=>{
      await tab('products');await openProduct();
      await screenshot('06-products-desktop');
    });
    await step('saved source and merchant downloads',async()=>{
      await tab('transfer');
      const source=await fileIdentity(current.sourceFile);
      assert.equal(source.sha256,current.sourceHash);
      await download(page.getByRole('button',{name:'Download saved source',exact:true}),
        {...source,path:'RisingWave-Source.json'},source.path,'saved source');
      const merchant=await fileIdentity(join(dirname(current.sourceFile),'merchant.json'));
      assert.equal(merchant.sha256,current.merchantHash);
      await download(page.getByRole('button',{name:'Download saved merchant terms',exact:true}),
        {...merchant,path:'RisingWave-Merchant.json'},merchant.path,'saved merchant');
      await screenshot('07-transfer-desktop');
    });
    await step('390 pixel source editions and product',async()=>{
      await page.setViewportSize({width:390,height:844});
      await tab('source');await screenshot('08-source-mobile');
      await tab('captures');
      await until(async()=>await page.locator('#captures-list article.capture-card').count()>0,
        'The original mobile editions did not open.');
      await screenshot('09-editions-mobile');
      await tab('products');
      await until(async()=>(await facts(page.locator('#product-facts'))).Product===native.context.publicationId,
        'The original mobile product did not open.');
      await screenshot('10-products-mobile');
    });
    await healthy();
    need(result.mutationAttempts.length===0,'BROWSER_ATTEMPTED_UNREVIEWED_MUTATION');
    need(result.pageErrors.length===0&&result.consoleErrors.length===0&&
      result.requestFailures.length===0&&result.responseFailures.length===0,
    'BROWSER_NATIVE_INTERFACE_FAILURE',JSON.stringify({
      pageErrors:result.pageErrors,consoleErrors:result.consoleErrors,
      requestFailures:result.requestFailures,responseFailures:result.responseFailures
    }));
    const after=await client.state();
    assert.equal(after.revision,opened.sourceRevision);
    assert.equal(after.sourceHash,current.sourceHash);
    assert.equal(after.merchantHash,current.merchantHash);
    result.sourceUnchanged=true;
    result.outcome='PASS';
  } catch(issue) {
    failure=issue;result.outcome='FAILED';
    result.error={code:issue.code??'RISINGWAVE_BROWSER_RECEIVING_FAILED',message:redact(issue.message),lastStep};
    if(page&&!page.isClosed())try {
      const path=join(output,'failure.png');
      await page.screenshot({path,fullPage:true,animations:'disabled',timeout:10000});
      await chmod(path,0o600);result.screens.push({name:'failure',...await fileIdentity(path)});
    } catch(secondary) {result.screenshotError=redact(secondary.message);}
  } finally {
    const cleanup=[];
    if(browserContext)try {await browserContext.close();}
      catch(issue){cleanup.push({action:'close original browser context',message:redact(issue.message)});}
    if(browser)try {await browser.close();}
      catch(issue){cleanup.push({action:'close original Chromium',message:redact(issue.message)});}
    if(cleanup.length) {
      failure??=Object.assign(new Error('The original browser did not confirm complete cleanup.'),
        {code:'BROWSER_CLEANUP_INCOMPLETE'});
      result.outcome='FAILED';result.cleanup=cleanup;
    }
    result.completedAt=stamp();
    await privateJson(resultPath,result);
  }
  if(failure)throw Object.assign(new Error(result.error?.message??failure.message),{
    code:result.error?.code??failure.code??'RISINGWAVE_BROWSER_RECEIVING_FAILED',resultPath
  });
  return result;
}

// MIT. Observe the same retained RisingWave Applications command in Chromium.
// The original managed-workbench operator awaits this callback before stopping it.
import assert from 'node:assert/strict';
import { open, mkdir, lstat, chmod, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, isAbsolute, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { validateBrowserState } from '../workspace/public/recovery.mjs';

const HASH = /^[a-f0-9]{64}$/;
const CAPTURE_NAMES = ['json','ndjson','csv','events','checkpoint','state','manifest'];
const DIFFERENCE_NAMES = ['added','removed','changed','manifest'];
const BROWSER_DYNAMIC_FORMS = ['payments','report-columns','report-parameters','report-filters','preview-parameters','capture-parameters'];
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
  const originalWorkspace=await client.state();
  need(HASH.test(originalWorkspace.workspaceIdentity??''),'ORIGINAL_BROWSER_WORKSPACE_IDENTITY_REQUIRED');
  assert.equal(originalWorkspace.revision,opened.sourceRevision);
  const selection={schema:'native.risingwave-browser-selection.v1',attempt,phase,
    workspaceIdentity:originalWorkspace.workspaceIdentity,
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
    pageErrors:[],consoleErrors:[],requestFailures:[],responseFailures:[],mutationAttempts:[],
    browserWorkspaceWrites:[],browserWorkspaceFiles:[]};
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
    await page.waitForFunction(()=>!document.body.inert);
    const paths=name==='captures'?['/api/captures','/api/comparisons']:
      name==='subscriptions'?['/api/subscriptions']:name==='products'?['/api/state']:[];
    if(name==='products'&&!(await page.locator('#selected-product').evaluate(node=>node.hidden))) {
      const selected=(await facts(page.locator('#product-facts'))).Product;
      if(selected)paths.push('/api/publications/'+selected);
    }
    const replies=Promise.all(paths.map(async path=>{
      const response=await page.waitForResponse(response=>{
        const request=response.request(),target=new URL(request.url());
        return request.method()==='GET'&&target.origin===address.origin&&target.pathname===path;
      });
      await response.finished();
      need(response.ok(),'ORIGINAL_BROWSER_TAB_READ_FAILED',path);
    }));
    void replies.catch(()=>{});
    await page.locator('nav button[data-tab="'+name+'"]').click();
    await page.locator('#'+name).waitFor({state:'visible'});
    await page.waitForFunction(n=>document.querySelector('nav button[data-tab="'+n+'"]')
      ?.getAttribute('aria-selected')==='true',name);
    await replies;
    await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>done())));
  }
  async function healthy(draft=false) {
    const error=await page.locator('#notice.error').count();
    need(!error,'WORKBENCH_VISIBLE_ERROR',error?await page.locator('#notice').innerText():'');
    assert.equal(await page.locator('#draft-status').innerText(),draft?'Unsaved changes':'Saved');
    const body=await page.locator('body').innerText();
    need(!body.includes('[object HTML'),'BROWSER_DOM_OBJECT_RENDERED');
  }
  async function screenshot(name,draft=false) {
    await healthy(draft);
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

  async function checkpointRecord() {
    const selected=await page.evaluate(identity=>{
      const raw=localStorage.getItem('risingwave-browser:'+identity);
      return raw?JSON.parse(raw):null;
    },selection.workspaceIdentity);
    need(selected&&/^browser-[a-z0-9-]{1,90}$/.test(selected.id??'')&&
      Number.isSafeInteger(selected.version)&&selected.version>0,
    'BROWSER_WORKSPACE_CHECKPOINT_REQUIRED');
    validateBrowserState(selected.state,selection.workspaceIdentity);
    return selected;
  }
  async function visibleDraft() {
    return page.evaluate(names=>{
      const value=node=>({kind:node.type==='checkbox'?'checked':'value',
        value:node.type==='checkbox'?node.checked:node.value});
      return {
        form:Object.fromEntries([...document.querySelectorAll('input[id],select[id],textarea[id]')]
          .filter(node=>node.type!=='file'&&!node.id.startsWith('recovery-'))
          .map(node=>[node.id,value(node)])),
        parameterInputs:Object.fromEntries(names.map(name=>[name,
          [...document.getElementById(name).querySelectorAll('input,select,textarea')].map(value)])),
        tab:document.querySelector('nav button[aria-selected="true"]')?.dataset.tab??'source'
      };
    },BROWSER_DYNAMIC_FORMS);
  }
  async function assertDraftView(expected) {
    validateBrowserState(expected,selection.workspaceIdentity);
    const shown=await visibleDraft();
    assert.deepEqual(shown.form,expected.form,'Every original static form field must reopen exactly.');
    assert.deepEqual(shown.parameterInputs,expected.parameterInputs,
      'Every dynamic payment, column, parameter, filter and execution field must reopen exactly.');
    assert.equal(shown.tab,expected.view.tab);
    await healthy(Boolean(expected.dirty||expected.reportDirty||
      Object.values(expected.rawEditors??{}).some(Boolean)));
  }
  async function saveBrowserDraft() {
    await tab('transfer');
    const save=page.locator('#recovery-save');
    await save.click();
    await until(async()=>await save.isEnabled()&&
      (await page.locator('#notice').innerText())==='Saved the complete browser workspace with this workbench.',
    'The complete browser workspace save did not finish.');
    await until(async()=>{
      if(await page.locator('#recovery-status.error-text').count())return false;
      const shown=await page.locator('#recovery-status').innerText();
      if(!shown.startsWith('Browser workspace ')||!shown.includes(' · saved version '))return false;
      try{return !(await checkpointRecord()).pending;}catch{return false;}
    },'The original complete browser write did not settle.');
    const local=await checkpointRecord();
    need(!local.pending,'BROWSER_WORKSPACE_WRITE_STILL_PENDING');
    const record=await client.browserWorkspace(local.id);
    assert.equal(record.schema,'stellar-forge.risingwave-browser-workspace.v1');
    assert.equal(record.id,local.id);assert.equal(record.version,local.version);
    assert.deepEqual(record.state,local.state,'The host must retain the complete current browser state.');
    assert.equal(record.stateSha256,createHash('sha256').update(encoded(record.state)).digest('hex'));
    const listed=await client.browserWorkspaces();
    assert.equal(listed.workspaceIdentity,selection.workspaceIdentity);
    const entry=listed.items.find(item=>item.id===record.id);
    need(entry,'BROWSER_SAVED_WORKSPACE_NOT_LISTED');
    assert.equal(entry.version,record.version);assert.equal(entry.stateSha256,record.stateSha256);
    await assertDraftView(record.state);
    return record;
  }
  async function exportBrowserDraft(label,record) {
    const expected=validateBrowserState(record.state,selection.workspaceIdentity);
    const pending=page.waitForEvent('download',{timeout:30000});
    await page.locator('#recovery-export').click();
    const transfer=await pending;
    try {
      assert.equal(transfer.suggestedFilename(),'RisingWave-Browser-Workspace-'+record.id+'.json');
      const stream=await transfer.createReadStream();
      need(stream,'BROWSER_WORKSPACE_DOWNLOAD_REQUIRED');
      const parts=[];let bytes=0;
      for await(const part of stream) {
        bytes+=part.length;
        need(bytes<=8*1024*1024,'BROWSER_WORKSPACE_EXPORT_TOO_LARGE');
        parts.push(part);
      }
      need(await transfer.failure()===null,'BROWSER_WORKSPACE_EXPORT_FAILED');
      const raw=Buffer.concat(parts),value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
      validateBrowserState(value,selection.workspaceIdentity);
      assert.deepEqual(value,expected,'The complete downloaded editor must equal the retained host state.');
      assert.equal(raw.toString('utf8'),encoded(expected).toString('utf8'));
      const path=join(output,label+'.json');
      await writeFile(path,raw,{flag:'wx',mode:0o600});
      const handle=await open(path,'r');
      try{await handle.sync();}finally{await handle.close();}
      const identity=await fileIdentity(path);
      assert.equal(identity.bytes,bytes);
      assert.equal(identity.sha256,record.stateSha256);
      const received={label,browserId:record.id,version:record.version,
        stateSha256:record.stateSha256,...identity,verifiedAt:stamp()};
      result.browserWorkspaceFiles.push(received);
      return received;
    } finally {await transfer.delete();}
  }
  async function importBrowserDraft(file,expected) {
    await exactOriginal(file.path,file);
    await page.locator('#recovery-file').setInputFiles(file.path);
    await page.locator('#recovery-import').click();
    await until(async()=>await page.locator('body').evaluate(node=>!node.inert)&&
      await page.locator('#recovery-import').isEnabled()&&
      (await page.locator('#notice').innerText())===
        'Imported the complete browser workspace and its original operation selections.',
    'The original complete browser workspace import did not finish.');
    const record=await saveBrowserDraft();
    assert.deepEqual(record.state,expected,
      'Import must restore every field, exact array value and original operation body.');
    await assertDraftView(expected);
    return record;
  }
  async function typeParameters(container,report) {
    let index=0;
    for(const [name,spec]of Object.entries(report.parameters??{})) {
      const fields=page.locator('#'+container);
      const actual=fields.locator('[data-parameter]');
      const nodes=await actual.evaluateAll((nodes,name)=>nodes.flatMap((node,index)=>
        node.dataset.parameter===name?[index]:[]),name);
      assert.equal(nodes.length,1);
      const values={string:'Draft selection · '+phase,integer:7,number:17.625,boolean:false,
        bigint:'9007199254740993',decimal:'12345678901234567890.123400',
        timestamp:'2026-10-12 18:00:01.123456',timestamptz:'2026-10-12 18:00:01.123456+00',
        date:'2026-10-12',time:'18:00:01.123456',interval:'2 days 03:04:05',
        uuid:'123e4567-e89b-42d3-a456-426614174000',json:'{"draft":"'+phase+'","empty":"","nil":null}',
        bytes:'\\x00ff01'};
      need(Object.hasOwn(values,spec.type),'BROWSER_TYPED_PARAMETER_UNSUPPORTED',spec.type);
      const text=spec.array?JSON.stringify([values[spec.type],values[spec.type]]):String(values[spec.type]);
      await actual.nth(nodes[0]).fill(text);
      const positions=await fields.locator('[data-include]').evaluateAll((nodes,name)=>
        nodes.flatMap((node,index)=>node.dataset.include===name?[index]:[]),name);
      assert.equal(positions.length,1);
      const include=fields.locator('[data-include]').nth(positions[0]);
      if(!await include.isDisabled())await include.setChecked(index%3!==2);
      const nullPositions=await fields.locator('[data-null]').evaluateAll((nodes,name)=>
        nodes.flatMap((node,index)=>node.dataset.null===name?[index]:[]),name);
      assert.equal(nullPositions.length,1);
      const nil=fields.locator('[data-null]').nth(nullPositions[0]);
      if(!await nil.isDisabled())await nil.setChecked(index%3===1);
      index++;
    }
    return index;
  }
  async function editCompleteDraft(current) {
    const queries=Object.entries(current.source.queries);
    need(queries.length>0,'ORIGINAL_REPORT_REQUIRED');
    const [query,report]=queries.slice().sort((a,b)=>
      Object.keys(b[1].parameters??{}).length-Object.keys(a[1].parameters??{}).length)[0];
    const tag='browser_'+phase.toLowerCase().replace(/[^a-z0-9_]/g,'_');
    await tab('reports');
    await page.locator('#report-select').selectOption(query);
    const previewCount=await typeParameters('preview-parameters',report);
    await tab('captures');
    await page.locator('#capture-query').selectOption(query);
    const captureCount=await typeParameters('capture-parameters',report);
    await page.locator('#capture-mode').selectOption('auto');
    await page.locator('#capture-gap').selectOption('rebuild');
    const retainedBase=await page.locator('#capture-base option').evaluateAll((nodes,id)=>
      nodes.some(node=>node.value===id),native.context.firstCaptureId);
    if(retainedBase)await page.locator('#capture-base').selectOption(native.context.firstCaptureId);
    const settings=page.locator('details').filter({
      has:page.getByText('Capture resource settings',{exact:true})
    });
    if(!await settings.evaluate(node=>node.open))await settings.locator('summary').click();
    for(const [id,value]of Object.entries({'capture-max-rows':'2000000','capture-max-bytes':'536870912',
      'capture-max-row-bytes':'2097152','capture-duration':'420','capture-batch':'250','capture-timeout':'2',
      'compare-keys':report.key.join(', '),'compare-limit':'137'}))
      await page.locator('#'+id).fill(value);
    await page.locator('#compare-before').selectOption(native.context.firstCaptureId);
    await page.locator('#compare-after').selectOption(native.context.secondCaptureId);
    await tab('subscriptions');
    await page.locator('#subscription-query').selectOption(query);
    await page.locator('#subscription-retention').fill('2 days');
    await tab('products');
    await until(async()=>(await facts(page.locator('#product-facts'))).Product===native.context.publicationId,
      'The original customer product did not remain selected.');
    await page.locator('#product-query').selectOption(query);
    await page.locator('#product-path').fill('/datasets/'+tag+'-draft');
    await page.locator('#buyer-run').selectOption(native.context.secondRun);
    await page.locator('#buyer-query').fill('limit=11');
    await page.locator('#read-offer').click();
    await until(async()=>await page.locator('#read-offer').isEnabled()&&
      await page.locator('#buyer-option option').count()===native.paid.accepts.length,
      'The exact selected original edition offer did not return.');
    await page.locator('#buyer-intent').fill(tag+'-'+native.paid.intentId);
    await page.locator('#buyer-option').selectOption(String(native.paid.accepts.length-1));
    await tab('source');
    const sourceFields={'connection-env':'RISINGWAVE_BROWSER_DRAFT_URL',
      'ca-env':'RISINGWAVE_BROWSER_DRAFT_CA','query-timeout':'41000','max-inflight':'2',
      'merchant-origin':current.merchant.publicOrigin,
      'merchant-service':(current.merchant.serviceName??'RisingWave')+' · '+phase+' draft',
      'merchant-description':(current.merchant.description??'')+'\nDraft receiving · '+phase,
      'discovery-schemas':report.relation.schema};
    for(const [id,value]of Object.entries(sourceFields))await page.locator('#'+id).fill(value);
    await page.locator('#tls').selectOption('require');
    await page.locator('#allow-local').setChecked(!current.source.allowLocal);
    const originalPayments=current.merchant.paymentOptions??[current.merchant.payment];
    need(originalPayments.length>0,'ORIGINAL_MERCHANT_PAYMENT_REQUIRED');
    for(let index=0;index<originalPayments.length;index++) {
      const original=originalPayments[index];
      for(const name of ['scheme','network','asset','payTo'])
        await page.getByLabel(name+' for payment choice '+index,{exact:true}).fill(String(original[name]));
      await page.getByLabel('amount for payment choice '+index,{exact:true}).fill(String(original.amount)+'0');
      await page.getByLabel('maxTimeoutSeconds for payment choice '+index,{exact:true})
        .fill(String((original.maxTimeoutSeconds??60)+1));
    }
    await tab('reports');
    for(const [id,value]of Object.entries({
      'report-name':query+'_'+tag,'report-description':(report.description??'')+'\nComplete draft · '+phase,
      'relation-schema':report.relation.schema,'relation-name':report.relation.name,
      'subscription-schema':report.subscription.schema,'subscription-name':report.subscription.name,
      'report-key':report.key.join(', '),'report-max-rows':'173','report-max-bytes':'2097152'
    }))await page.locator('#'+id).fill(value);
    const columnIndex=await page.locator('#report-columns tr').count();
    const sourceColumn=Object.values(report.columns)[0];
    await page.locator('#add-column').click();
    await page.getByLabel('Output alias '+columnIndex,{exact:true}).fill(tag+'_exact');
    await page.getByLabel('Native column '+columnIndex,{exact:true}).fill(sourceColumn.column);
    await page.locator('#report-columns tr').nth(columnIndex)
      .getByLabel('Type '+columnIndex,{exact:true}).selectOption(sourceColumn.type);
    await page.locator('#report-columns tr').nth(columnIndex)
      .getByLabel('Nullable '+columnIndex,{exact:true}).setChecked(sourceColumn.nullable===true);
    const definitions=[
      {name:tag+'_exact_ids',type:'bigint',required:true,nullable:false,array:true,
        included:true,probe:'["9007199254740993","9007199254740995"]',nil:false},
      {name:tag+'_null',type:'decimal',required:false,nullable:true,array:false,
        included:true,probe:'12345678901234567890.123400',nil:true},
      {name:tag+'_empty',type:'string',required:false,nullable:true,array:false,
        included:true,probe:'',nil:false},
      {name:tag+'_omitted',type:'string',required:false,nullable:false,array:false,
        included:false,probe:'Retained original omitted draft · '+phase,nil:false}
    ];
    for(const parameter of definitions) {
      const index=await page.locator('#report-parameters tr').count();
      await page.locator('#add-parameter').click();
      const row=page.locator('#report-parameters tr').nth(index);
      await row.getByLabel('Parameter name '+index,{exact:true}).fill(parameter.name);
      await row.getByLabel('Parameter type '+index,{exact:true}).selectOption(parameter.type);
      for(const [label,value]of [['Required',parameter.required],['Nullable',parameter.nullable],
        ['Array',parameter.array],['Include probe',parameter.included],['NULL probe',parameter.nil]])
        await row.getByLabel(label+' '+index,{exact:true}).setChecked(value);
      await row.getByLabel('Probe value '+index,{exact:true}).fill(parameter.probe);
    }
    const filterIndex=await page.locator('#report-filters tr').count();
    await page.locator('#add-filter').click();
    const filter=page.locator('#report-filters tr').nth(filterIndex);
    await filter.getByLabel('Filter field '+filterIndex,{exact:true}).fill(tag+'_exact');
    await filter.getByLabel('Comparison '+filterIndex,{exact:true}).selectOption('in');
    await filter.getByLabel('Filter parameter '+filterIndex,{exact:true}).fill(definitions[0].name);
    await screenshot('11-complete-authoring-draft-desktop',true);
    await tab('source');
    for(const id of ['source-json','payment-json']) {
      const details=page.locator('#'+id).locator('..');
      if(!await details.evaluate(node=>node.open))await details.locator('summary').click();
    }
    const sourceText=JSON.stringify({...current.source,connectionStringEnv:'RISINGWAVE_RAW_DRAFT_URL',
      queryTimeoutMs:43000},null,4)+'\n';
    const paymentText=JSON.stringify(originalPayments.map((choice,index)=>({
      ...choice,amount:String(choice.amount)+(index+1),maxTimeoutSeconds:(choice.maxTimeoutSeconds??60)+2
    })),null,4)+'\n';
    await page.locator('#source-json').fill(sourceText);
    await page.locator('#payment-json').fill(paymentText);
    await screenshot('12-raw-source-and-payment-draft-desktop',true);
    await tab('transfer');
    return {query,previewCount,captureCount,sourceText,paymentText,
      columnIndex,filterIndex,definitions};
  }
  async function browserDraftJourney(current) {
    await page.setViewportSize({width:1440,height:960});
    const baseline=await saveBrowserDraft();
    const baselineFile=await exportBrowserDraft('original-browser-workspace',baseline);
    const edited=await editCompleteDraft(current);
    const draft=await saveBrowserDraft();
    const selected=draft.state;
    need(selected.dirty&&selected.reportDirty&&selected.rawEditors.source&&selected.rawEditors.payments,
      'COMPLETE_BROWSER_DRAFT_REQUIRED');
    assert.equal(selected.form['source-json'].value,edited.sourceText);
    assert.equal(selected.form['payment-json'].value,edited.paymentText);
    assert.equal(selected.parameters.length,Object.keys(current.source.queries[edited.query].parameters??{}).length+
      edited.definitions.length);
    for(const expected of edited.definitions) {
      const retained=selected.parameters.find(value=>value.name===expected.name);
      need(retained,'ORIGINAL_PARAMETER_DRAFT_MISSING',expected.name);
      assert.deepEqual({type:retained.type,required:retained.required,nullable:retained.nullable,
        array:retained.array,included:retained.probeIncluded,probe:retained.probe,nil:retained.probeNull},
      {type:expected.type,required:expected.required,nullable:expected.nullable,array:expected.array,
        included:expected.included,probe:expected.probe,nil:expected.nil});
    }
    assert.deepEqual(selected.requests,baseline.state.requests,
      'Editing a browser draft must keep every original native request body and ID.');
    assert.deepEqual(selected.journal,baseline.state.journal);
    assert.deepEqual(selected.downloads,baseline.state.downloads);
    assert.equal(selected.view.productId,native.context.publicationId);
    assert.equal(selected.buyerDrafts[native.context.publicationId].form['buyer-run'].value,
      native.context.secondRun);
    const draftFile=await exportBrowserDraft('complete-browser-draft',draft);
    await page.reload({waitUntil:'domcontentloaded',timeout:60000});
    await until(async()=>await page.locator('body').evaluate(node=>!node.inert)&&
      (await page.locator('#notice').innerText())==='Opened the original workbench and retained browser workspace.',
    'The full browser draft did not reopen after reload.');
    const reloaded=await saveBrowserDraft();
    assert.equal(reloaded.id,draft.id);
    assert.deepEqual(reloaded.state,selected,
      'Reload must preserve the entire original browser state, including all requests and arrays.');
    await assertDraftView(selected);
    await exportBrowserDraft('reloaded-browser-draft',reloaded);
    await screenshot('13-reloaded-browser-workspace-desktop',true);
    const imported=await importBrowserDraft(draftFile,selected);
    need(imported.id!==draft.id,'BROWSER_IMPORT_MUST_RETAIN_ORIGINAL_DRAFT');
    await exportBrowserDraft('imported-browser-draft',imported);
    await page.setViewportSize({width:390,height:844});
    await screenshot('14-imported-browser-workspace-mobile',true);
    // Restore the retained pre-edit browser edition through its own UI, then open
    // the current original source. Both edited workspaces remain in Transfer.
    await page.setViewportSize({width:1440,height:960});
    await importBrowserDraft(baselineFile,baseline.state);
    await page.locator('#reload').click();
    await until(async()=>await page.locator('body').evaluate(node=>!node.inert)&&
      await page.locator('#reload').isEnabled()&&
      (await page.locator('#notice').innerText())===
        'Opened the latest saved source. The previous complete draft remains in Transfer.',
    'The original saved source did not reopen after the complete draft journey.');
    const clean=await saveBrowserDraft();
    assert.equal(clean.state.dirty,false);assert.equal(clean.state.reportDirty,false);
    assert.deepEqual(clean.state.rawEditors,{});
    assert.deepEqual(clean.state.source,current.source);assert.deepEqual(clean.state.merchant,current.merchant);
    assert.deepEqual(clean.state.payments,current.merchant.paymentOptions??[current.merchant.payment]);
    assert.equal(clean.state.baseRevision,opened.sourceRevision);
    assert.deepEqual(clean.state.requests,baseline.state.requests);
    assert.deepEqual(clean.state.journal,baseline.state.journal);
    assert.deepEqual(clean.state.downloads,baseline.state.downloads);
    await exportBrowserDraft('clean-browser-workspace',clean);
    const retained=await client.browserWorkspace(draft.id);
    assert.deepEqual(retained.state,selected);
    assert.equal(retained.stateSha256,draft.stateSha256);
    const retainedImport=await client.browserWorkspace(imported.id);
    assert.deepEqual(retainedImport.state,selected);
    await healthy();
    result.browserRecovery={workspaceIdentity:selection.workspaceIdentity,baseRevision:opened.sourceRevision,
      baseline:{id:baseline.id,version:baseline.version,stateSha256:baseline.stateSha256},
      draft:{id:draft.id,version:draft.version,stateSha256:draft.stateSha256},
      reloaded:{id:reloaded.id,version:reloaded.version,stateSha256:reloaded.stateSha256},
      imported:{id:imported.id,version:imported.version,stateSha256:imported.stateSha256},
      clean:{id:clean.id,version:clean.version,stateSha256:clean.stateSha256},
      completeFormFields:Object.keys(selected.form).length,
      dynamicFields:Object.fromEntries(Object.entries(selected.parameterInputs).map(([name,fields])=>[name,fields.length])),
      requestCounts:Object.fromEntries(Object.entries(selected.requests).map(([name,values])=>[name,values.length])),
      originalJournalEntries:selected.journal.length,originalDownloads:selected.downloads.length,
      originalBuyerDrafts:Object.keys(selected.buyerDrafts).length,
      typedPreviewParameters:edited.previewCount,typedCaptureParameters:edited.captureCount,
      originalDraftRetained:true,importedDraftRetained:true,cleanWorkspaceSaved:true};
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
        const target=new URL(request.url());
        if(request.method()==='POST'&&target.origin===address.origin&&
          target.pathname==='/api/browser-workspace'&&!target.search&&!target.hash) {
          try {
            const raw=request.postData();
            need(typeof raw==='string'&&Buffer.byteLength(raw)<=8*1024*1024+16384,
              'ORIGINAL_BROWSER_WORKSPACE_BODY_REQUIRED');
            const body=JSON.parse(raw);
            need(body&&typeof body==='object'&&!Array.isArray(body)&&
              Object.keys(body).length===4&&['id','expectedVersion','writeId','state'].every(key=>Object.hasOwn(body,key))&&
              /^browser-[a-z0-9-]{1,90}$/.test(body.id??'')&&
              /^draft-[a-z0-9-]{1,90}$/.test(body.writeId??'')&&
              Number.isSafeInteger(body.expectedVersion)&&body.expectedVersion>=0,
            'ORIGINAL_BROWSER_WORKSPACE_REQUEST_REQUIRED');
            validateBrowserState(body.state,selection.workspaceIdentity);
            need(await request.headerValue('authorization')==='Bearer '+token,
              'ORIGINAL_BROWSER_WORKSPACE_CONNECTION_REQUIRED');
            remember(result.browserWorkspaceWrites,{...value,id:body.id,writeId:body.writeId,
              expectedVersion:body.expectedVersion,workspaceIdentity:body.state.workspaceIdentity,
              stateSha256:createHash('sha256').update(encoded(body.state)).digest('hex')});
            await route.continue();return;
          } catch(issue) {
            remember(result.mutationAttempts,{...value,error:redact(issue.message)});
            await route.abort('blockedbyclient');return;
          }
        }
        remember(result.mutationAttempts,value);await route.abort('blockedbyclient');return;
      }
      await route.continue();
    });
    browserContext.on('page',current=>{
      current.on('pageerror',issue=>remember(result.pageErrors,{message:redact(issue.message)}));
      current.on('dialog',async dialog=>{
        if(dialog.type()==='beforeunload')await dialog.accept();
        else{remember(result.pageErrors,{message:'Unexpected '+dialog.type()+' dialog: '+redact(dialog.message())});await dialog.dismiss();}
      });
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
      await until(async()=>await page.locator('body').evaluate(node=>!node.inert)&&
        (await page.locator('#notice').innerText())==='Opened the original workbench and retained browser workspace.',
      'The original browser workspace initialization did not finish.');
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
    await step('complete draft save export reload import and original source reopen',()=>browserDraftJourney(current));
    await healthy();
    need(result.browserWorkspaceWrites.length>0&&result.browserRecovery?.cleanWorkspaceSaved,
      'ORIGINAL_BROWSER_WORKSPACE_RECEIVING_REQUIRED');
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
    assert.equal(after.workspaceIdentity,selection.workspaceIdentity);
    assert.deepEqual(after.merchant,current.merchant);
    const afterRevision=await client.revision(after.revision);
    assert.equal(afterRevision.sourceHash,current.sourceHash);
    assert.equal(afterRevision.merchantHash,current.merchantHash);
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

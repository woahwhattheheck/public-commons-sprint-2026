#!/usr/bin/env node
/* MIT. Operate the complete conformance browser and normal Merchant client on a received Directory. */
import {randomBytes} from 'node:crypto';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {createRequire} from 'node:module';
import {absolute,privateDirectory,readJSON,saveJSON,digest,operationLease,need,now}
  from '../../distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {HumanServicesDirectoryConnection,readHumanServicesDirectoryConfiguration} from './connected/connection.mjs';
import {CONNECTION_SCHEMA,OPERATOR_SCHEMA,canonical,SHA} from './connected/contracts.mjs';
import {humanServicesDirectoryActions,directoryInputSchemas} from './connected/catalog.mjs';
import {initializeHumanServicesDirectoryMerchant} from './connected/setup.mjs';
import {openHumanServicesDirectoryMerchantClient,readHumanServicesDirectoryValue,
  downloadHumanServicesDirectoryExport,reopenHumanServicesDirectoryExport,
  iterateHumanServicesDirectoryConformance,downloadHumanServicesDirectoryConformance} from './connected/client.mjs';
import {fileIdentity,readSourceFile} from './connected/files.mjs';

const OPERATION='SCF-DIRECTORY-CONFORMANCE-CLIENTS-450E-20261012';
const args={};
for(let i=2;i<process.argv.length;i+=2){
  const key=process.argv[i],value=process.argv[i+1];
  need(['--native','--workspace','--out','--chromium'].includes(key)&&value&&!value.startsWith('--')&&!Object.hasOwn(args,key),
    'DIRECTORY_CONFORMANCE_CLIENTS_ARGUMENTS','Use --native OPERATED_DIRECTORY_CONFORMANCE.json --workspace RECEIVED_WORKSPACE --out PRIVATE_OUTPUT --chromium EXECUTABLE.');
  args[key]=absolute(value);
}
for(const key of ['--native','--workspace','--out','--chromium'])need(args[key],'DIRECTORY_CONFORMANCE_CLIENTS_ARGUMENTS',key);
process.umask(0o077);
await mkdir(args['--out'],{recursive:true,mode:0o700});await privateDirectory(args['--out']);
const out=args['--out'],raw=await readSourceFile(args['--native'],{maxBytes:64*1024*1024}),native=JSON.parse(raw.toString('utf8'));
need(native.schema==='stellar-forge.directory-conformance-operated.v1'&&native.workspaceId&&
  ['planIds','assessmentIds','reviewIds','comparisonIds'].every(key=>Array.isArray(native[key])&&native[key].length&&
    native[key].every(id=>new RegExp(SHA).test(id))),
  'DIRECTORY_CONFORMANCE_NATIVE_RESULT_REQUIRED');
need(native.planIds.length===native.assessmentIds.length&&native.reviewIds.length===native.assessmentIds.length,
  'DIRECTORY_CONFORMANCE_NATIVE_RECORD_ALIGNMENT_REQUIRED');
const binding={nativeSha256:digest(raw),workspaceId:native.workspaceId,workspace:args['--workspace']};
const journalPath=join(out,'CONFORMANCE_CLIENTS_JOURNEY.json');
let journal,lease,owner,merchant,client,browser,context;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const emit=(stage,value={})=>process.stdout.write(JSON.stringify({stage,operation:OPERATION,...value})+'\n');
async function checkpoint(){journal.updatedAt=now();await saveJSON(journalPath,journal,true);}
async function jsonFile(name,value){
  const file=join(out,name);await mkdir(dirname(file),{recursive:true,mode:0o700});await saveJSON(file,value,true);
  return {file,...await fileIdentity(file,{maxBytes:64*1024*1024})};
}
async function checkedFile(value){
  const actual=await fileIdentity(value.file,{maxBytes:1024*1024*1024});
  need(actual.bytes===value.bytes&&actual.sha256===value.sha256,'DIRECTORY_CONFORMANCE_RETAINED_FILE_CHANGED',value.file);
  return {file:value.file,...actual};
}
async function readResult(row){
  await checkedFile(row);return JSON.parse((await readFile(row.file)).toString('utf8'));
}
async function call(key,action,input){
  let row=journal.calls[key];
  if(row){
    need(row.action===action&&same(row.input,input),'DIRECTORY_CONFORMANCE_REQUEST_CHANGED',key);
    if(row.state==='complete')return readResult(row.file);
  }else journal.calls[key]=row={action,input,state:'prepared',at:now()};
  await checkpoint();
  const result=await client.call(action,input,{timeoutMs:600000});
  row.result=result;await checkpoint();
  need(result.retention?.state==='COMPLETE'&&result.native?.ok,'DIRECTORY_CONFORMANCE_NATIVE_CALL_FAILED',action);
  const value=await readHumanServicesDirectoryValue({client,result});
  row.file=await jsonFile('calls/'+key+'.json',{result,value});row.state='complete';await checkpoint();
  return {result,value};
}
async function fileCall(key,action,input){
  journal.exports??={};let row=journal.exports[key];
  if(row){need(row.action===action&&same(row.input,input),'DIRECTORY_CONFORMANCE_EXPORT_SELECTION_CHANGED');
    if(row.result?.native?.ok&&row.result.retention?.state==='COMPLETE'){
      const manifest=await client.manifest({workspace:'conformance',exportId:row.result.exportId});
      need(manifest.state==='MANIFEST_RETAINED'&&manifest.exportId===row.result.exportId&&
        manifest.manifestFile.sha256===row.result.manifestSha256,'DIRECTORY_CONFORMANCE_EXPORT_CHANGED');return row.result;}}
  else journal.exports[key]=row={action,input,at:now()};
  await checkpoint();const result=await client.call(action,input,{timeoutMs:600000});
  row.result=result;await checkpoint();
  need(result.native?.ok&&result.retention?.state==='COMPLETE','DIRECTORY_CONFORMANCE_FILE_REQUIRED',action);
  return result;
}
async function record(collection,id){
  return (await call('record-'+collection+'-'+id,'directory_record',{workspace:'conformance',collection,recordId:id})).value;
}
function inputFor(record,schema){
  return Object.fromEntries(Object.keys(schema.properties).filter(key=>record[key]!==undefined).map(key=>[key,record[key]]));
}
async function verifyOriginals(){
  const stateResult=await client.call('directory_state',{workspace:'conformance'});
  need(stateResult.native?.ok&&stateResult.retention?.state==='COMPLETE','DIRECTORY_CONFORMANCE_STATE_REQUIRED');
  const state=await readHumanServicesDirectoryValue({client,result:stateResult});
  need(state.workspaceId===native.workspaceId&&state.directory.workspaceId===native.workspaceId,'DIRECTORY_CONFORMANCE_UUID_CHANGED');
  for(const [kind,key]of [['conformancePlans','planIds'],['conformanceAssessments','assessmentIds'],
    ['conformanceReviews','reviewIds'],['conformanceComparisons','comparisonIds']]){
    let offset=0;const ids=[];
    while(true){
      const result=await client.call('directory_records',{workspace:'conformance',collection:kind,offset,limit:100});
      need(result.native?.ok&&result.retention?.state==='COMPLETE','DIRECTORY_CONFORMANCE_COLLECTION_REQUIRED');
      const page=await readHumanServicesDirectoryValue({client,result});ids.push(...page.rows.map(r=>r.id));
      if(page.nextOffset===null){need(ids.length===page.total,'DIRECTORY_CONFORMANCE_COLLECTION_INCOMPLETE');break;}
      need(page.nextOffset>offset,'DIRECTORY_CONFORMANCE_CURSOR_CHANGED');offset=page.nextOffset;
    }
    need(native[key].every(id=>ids.includes(id)),'DIRECTORY_CONFORMANCE_ORIGINAL_RECORD_MISSING',kind);
  }
  return state;
}
async function browse(){
  if(journal.browser?.state==='complete'){
    for(const file of Object.values(journal.browser.files))await checkedFile(file);
    return;
  }
  const require=createRequire(import.meta.url),modules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||
    '/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules';
  const {chromium}=require(join(modules,'playwright'));
  const executable=await stat(args['--chromium']);
  need(executable.isFile()&&(executable.mode&0o111)!==0,'DIRECTORY_CONFORMANCE_BROWSER_REQUIRED');
  const operator=await readJSON(join(args['--workspace'],'directory','operator-connection.json'),true);
  need(operator.schema===OPERATOR_SCHEMA&&operator.active&&operator.workspaceId===native.workspaceId,'DIRECTORY_CONFORMANCE_OPERATOR_CHANGED');
  journal.browser??={state:'prepared',files:{},requests:[],errors:[]};await checkpoint();
  browser=await chromium.launch({headless:true,executablePath:args['--chromium'],
    args:['--no-sandbox','--disable-dev-shm-usage']});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page=await context.newPage();
  page.on('dialog',dialog=>dialog.accept().catch(()=>{}));
  page.on('pageerror',error=>journal.browser.errors.push(error.message));
  await page.goto(operator.url+'#'+operator.accessToken,{waitUntil:'domcontentloaded',timeout:120000});
  await page.waitForSelector('body[data-directory-ready="true"]',{timeout:120000});
  await page.locator('[data-nav="conformance"]').click();
  async function postDraft(tab,key,input,target,expectedId){
    await page.locator('[data-testid="conformance-tab-'+tab+'"]').click();
    const draft=join(out,'browser-inputs',key+'.json');await mkdir(dirname(draft),{recursive:true,mode:0o700});
    await saveJSON(draft,{input},true);
    await page.locator('[data-testid="'+key+'-draft-file"]').setInputFiles(draft);
    await page.waitForFunction(({key,label})=>document.querySelector('[data-field="'+key+'.label"]')?.value===label,
      {key,label:input.label},{timeout:120000});
    const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname===target&&
      response.request().method()==='POST',{timeout:600000});
    await page.locator('[data-testid="'+key+'-submit"]').click();
    const response=await responsePromise,value=await response.json();
    need(response.status()===201&&value.id===expectedId,'DIRECTORY_CONFORMANCE_BROWSER_RECORD_CHANGED',target);
    journal.browser.requests.push({target,recordId:value.id,status:response.status(),at:now()});await checkpoint();
    await page.waitForFunction(()=>document.querySelector('#draft-state')?.textContent==='Ready',undefined,{timeout:120000});
    return value;
  }
  for(let index=0;index<native.assessmentIds.length;index++){
    const plan=await record('conformancePlans',native.planIds[index]),
      assessment=await record('conformanceAssessments',native.assessmentIds[index]),
      review=await record('conformanceReviews',native.reviewIds[index]);
    await postDraft('plans','conformance-plan',inputFor(plan,directoryInputSchemas.conformance_plan),
      '/api/directory/conformance/plans',plan.id);
    await postDraft('assessments','conformance-assess-'+plan.id,inputFor(assessment,directoryInputSchemas.conformance_assess),
      '/api/directory/conformance/assessments',assessment.id);
    await page.waitForSelector('[data-testid="conformance-assessment-workbench"]',{timeout:120000});
    await page.locator('[data-testid="conformance-open-review"]').click();
    await postDraft('reviews','conformance-review-'+assessment.id,inputFor(review,directoryInputSchemas.conformance_review),
      '/api/directory/conformance/reviews',review.id);
  }
  const comparison=await record('conformanceComparisons',native.comparisonIds[0]);
  await postDraft('comparisons','conformance-compare',inputFor(comparison,directoryInputSchemas.conformance_compare),
    '/api/directory/conformance/comparisons',comparison.id);
  for(const [name,viewport]of [['desktop',{width:1440,height:1000}],['phone',{width:390,height:844}]]){
    await page.setViewportSize(viewport);
    await page.locator('[data-testid="conformance-tab-assessments"]').click();
    await page.waitForSelector('[data-testid="conformance-assessment-workbench"]',{timeout:120000});
    const file=join(out,'Directory_Conformance_'+name+'.png');
    await page.screenshot({path:file,fullPage:false});journal.browser.files[name]={file,...await fileIdentity(file,{maxBytes:16*1024*1024})};
    const layout=await page.evaluate(()=>({width:innerWidth,documentWidth:document.documentElement.scrollWidth,
      workspace:document.querySelector('#workspace-id')?.textContent}));
    need(layout.documentWidth<=layout.width+1&&layout.workspace===native.workspaceId,'DIRECTORY_CONFORMANCE_BROWSER_LAYOUT_CHANGED');
    journal.browser[name]=layout;await checkpoint();
  }
  await page.setViewportSize({width:1440,height:1000});
  const selected=await record('conformanceAssessments',native.assessmentIds.at(-1));
  const transfer=page.waitForEvent('download',{timeout:120000});
  await page.locator('[data-testid="conformance-download-assessments-report"]').click();
  const downloaded=await transfer,file=join(out,'Directory_Conformance_Browser_Report.html');
  await downloaded.saveAs(file);need(!(await downloaded.failure()),'DIRECTORY_CONFORMANCE_BROWSER_DOWNLOAD_FAILED');
  const identity={file,...await fileIdentity(file,{maxBytes:64*1024*1024})};
  need(identity.bytes===selected.files.report.bytes&&identity.sha256===selected.files.report.sha256,
    'DIRECTORY_CONFORMANCE_BROWSER_REPORT_CHANGED');
  journal.browser.files.report=identity;
  need(journal.browser.errors.length===0,'DIRECTORY_CONFORMANCE_BROWSER_ERROR',journal.browser.errors.join('\n'));
  journal.browser.state='complete';journal.browser.completedAt=now();await checkpoint();
  await context.close();context=null;await browser.close();browser=null;
  emit('DIRECTORY_CONFORMANCE_BROWSER_COMPLETE',{records:journal.browser.requests.length,files:journal.browser.files});
}
async function reopenDownloads(){
  for(const [key,value]of Object.entries(journal.connected.downloads)){
    const reopen=await reopenHumanServicesDirectoryExport({workspace:'conformance',exportId:value.result.exportId,
      expectedManifestSha256:value.result.manifestSha256,directory:value.receipt.directory});
    need(reopen.state==='REOPENED','DIRECTORY_CONFORMANCE_DOWNLOAD_REOPEN_FAILED',key);
    value.reopened=reopen;
  }
}
async function connected(){
  if(journal.connected?.state==='complete'){
    for(const value of Object.values(journal.connected.files))await checkedFile(value);
    await reopenDownloads();return;
  }
  journal.connected??={state:'prepared',pages:{},files:{},downloads:{}};await checkpoint();
  for(const id of native.assessmentIds){
    const assessment=await record('conformanceAssessments',id);
    for(const kind of ['findings','rows']){
      const key=id+'-'+kind;
      if(journal.connected.pages[key]?.state==='complete')continue;
      let total=0,ordinal=0;
      for await(const {page,result}of iterateHumanServicesDirectoryConformance({
        client,workspace:'conformance',assessmentId:id,kind,limit:100,requestOptions:{timeoutMs:600000}})){
        const file=await jsonFile('pages/'+key+'-'+String(ordinal++).padStart(5,'0')+'.json',{result,page});
        journal.connected.files['page-'+key+'-'+ordinal]=file;total+=page.rows.length;
        if(kind==='findings'&&page.rows.length){
          const first=page.rows[0],single=await call('finding-'+id+'-'+first.id,'directory_conformance_finding',
            {workspace:'conformance',assessmentId:id,findingId:first.id});
          need(same(single.value,first),'DIRECTORY_CONFORMANCE_EXACT_FINDING_CHANGED');
        }
        await checkpoint();
      }
      need(total===(kind==='findings'?assessment.summary.findings:assessment.summary.selectedRows),
        'DIRECTORY_CONFORMANCE_COMPLETE_PAGE_COUNT_CHANGED');
      journal.connected.pages[key]={state:'complete',rows:total,pages:ordinal};await checkpoint();
    }
    const plan=await record('conformancePlans',assessment.planId);
    const planResult=await call('reuse-plan-'+plan.id,'directory_conformance_plan',
      {workspace:'conformance',conformance_plan:inputFor(plan,directoryInputSchemas.conformance_plan)});
    need(planResult.value.id===plan.id,'DIRECTORY_CONFORMANCE_SDK_PLAN_CHANGED');
    const assessed=await call('reuse-assessment-'+id,'directory_conformance_assess',
      {workspace:'conformance',conformance_assess:inputFor(assessment,directoryInputSchemas.conformance_assess)});
    need(assessed.value.id===id,'DIRECTORY_CONFORMANCE_SDK_ASSESSMENT_CHANGED');
  }
  for(const id of native.reviewIds){
    const review=await record('conformanceReviews',id),result=await call('reuse-review-'+id,'directory_conformance_review',
      {workspace:'conformance',conformance_review:inputFor(review,directoryInputSchemas.conformance_review)});
    need(result.value.id===id,'DIRECTORY_CONFORMANCE_SDK_REVIEW_CHANGED');
  }
  for(const id of native.comparisonIds){
    const comparison=await record('conformanceComparisons',id),result=await call('reuse-comparison-'+id,'directory_conformance_compare',
      {workspace:'conformance',conformance_compare:inputFor(comparison,directoryInputSchemas.conformance_compare)});
    need(result.value.id===id,'DIRECTORY_CONFORMANCE_SDK_COMPARISON_CHANGED');
  }
  if(!journal.connected.downloads.comparison){
    const value=await downloadHumanServicesDirectoryConformance({
      client,workspace:'conformance',collection:'comparisons',recordId:native.comparisonIds[0],fileKind:'package',
      directory:join(out,'complete-comparison'),requestOptions:{timeoutMs:600000}});
    journal.connected.downloads.comparison=value;await checkpoint();
  }
  const workspaceResult=await fileCall('complete-workspace','directory_workspace_packet',{workspace:'conformance'});
  const received=await downloadHumanServicesDirectoryExport({
    client,workspace:'conformance',exportId:workspaceResult.exportId,
    expectedManifestSha256:workspaceResult.manifestSha256,directory:join(out,'complete-workspace')});
  journal.connected.downloads.workspace={result:workspaceResult,receipt:received};
  await reopenDownloads();
  journal.connected.state='complete';journal.connected.completedAt=now();await checkpoint();
  emit('DIRECTORY_CONFORMANCE_CONNECTED_COMPLETE',{assessments:native.assessmentIds.length,downloads:journal.connected.downloads});
}
async function main(){
  lease=await operationLease(join(out,'conformance-clients.lock'));
  journal=await readJSON(journalPath,true);
  if(journal)need(journal.operation===OPERATION&&same(journal.binding,binding),'DIRECTORY_CONFORMANCE_CLIENTS_SELECTION_CHANGED');
  else journal={schema:'stellar-forge.directory-conformance-clients-journey.v1',operation:OPERATION,binding,
    startedAt:now(),calls:{},failures:[]};
  await checkpoint();
  const connection=join(out,'conformance-connection.json'),configuration={schema:CONNECTION_SCHEMA,
    workspaces:{conformance:{directory:args['--workspace'],label:'Received Directory conformance',allowStart:true}}};
  const previous=await readJSON(connection,true);
  if(previous)need(same(previous,configuration),'DIRECTORY_CONFORMANCE_CONFIGURATION_CHANGED');
  else await saveJSON(connection,configuration,true);
  const bindingConfiguration=await readHumanServicesDirectoryConfiguration(connection);
  owner=new HumanServicesDirectoryConnection(bindingConfiguration.workspaces.conformance);await owner.open();
  const setup=await initializeHumanServicesDirectoryMerchant({directory:join(out,'merchant'),connection,
    name:'Human Services Directory complete conformance'});
  const tokenEnv='DIRECTORY_CONFORMANCE_MCP_CODE',environment={...process.env,[tokenEnv]:randomBytes(32).toString('base64url')};
  merchant=await startMerchantMcp({configPath:setup.configuration,port:0,tokenEnv,environment});
  client=await openHumanServicesDirectoryMerchantClient({url:merchant.url,tokenEnv,environment});
  const catalogue=await client.schema(),expected=Object.values(humanServicesDirectoryActions).map(row=>row.name).sort();
  need(Array.isArray(catalogue.tools)&&same(catalogue.tools.map(row=>row.name).sort(),expected),
    'DIRECTORY_CONFORMANCE_COMPLETE_CATALOGUE_CHANGED');
  journal.catalogue=await jsonFile('CONFORMANCE_CONNECTED_CATALOGUE.json',catalogue);
  await verifyOriginals();await browse();await connected();await verifyOriginals();
  journal.completedAt??=now();await checkpoint();
  const result={schema:'stellar-forge.directory-conformance-clients-operated.v1',operation:OPERATION,
    completedAt:journal.completedAt,...binding,catalogue:journal.catalogue,browser:journal.browser,
    connected:journal.connected,originalRecords:{plans:native.planIds,assessments:native.assessmentIds,
      reviews:native.reviewIds,comparisons:native.comparisonIds}};
  journal.result=await jsonFile('OPERATED_DIRECTORY_CONFORMANCE_CLIENTS.json',result);await checkpoint();
  emit('DIRECTORY_CONFORMANCE_CLIENTS_COMPLETE',{result:journal.result,workspaceId:native.workspaceId});
}
try{await main();}
catch(error){
  if(journal){journal.failures.push({at:now(),code:error.code||error.name,message:error.message,stack:error.stack});await checkpoint();}
  process.stderr.write(JSON.stringify({operation:OPERATION,error:{code:error.code||error.name,message:error.message}})+'\n');
  process.exitCode=1;
}finally{
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});await client?.close().catch(()=>{});
  await merchant?.close().catch(()=>{});await owner?.close().catch(()=>{});
  await lease?.close();if(journal)await checkpoint();
}

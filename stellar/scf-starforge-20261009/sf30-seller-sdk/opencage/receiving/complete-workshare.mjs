import { readFile, mkdir, open, link, unlink, rename, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';

const { values: args } = parseArgs({ options: {
  source: { type: 'string' }, 'source-manifest': { type: 'string' },
  'provider-record': { type: 'string' }, output: { type: 'string' },
  playwright: { type: 'string' }, browser: { type: 'string' },
  python: { type: 'string' }, 'buyer-script': { type: 'string' }, 'pty-script': { type: 'string' },
  resource: { type: 'string' },
} });
for (const key of ['source','source-manifest','provider-record','output','playwright','browser','python','buyer-script','pty-script','resource'])
  if (!args[key]) throw Error('Missing --' + key);
const source=resolve(args.source), output=resolve(args.output), record=resolve(args['provider-record']);
const component=join(source,'stellar/scf-starforge-20261009/sf30-seller-sdk/opencage');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const imp=path=>import(pathToFileURL(path).href);
const assert=(value,message)=>{if(!value)throw Error(message);};
await mkdir(output,{recursive:true,mode:0o700});
assert(await realpath(output)===output,'Use a canonical private output directory');
async function atomic(path,bytes,{replace=false}={}) {
  bytes=Buffer.isBuffer(bytes)?bytes:jsonBytes(bytes);
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(!replace){try{assert((await readFile(path)).equals(bytes),'Retained file changed: '+relative(output,path));return;}
    catch(error){if(error.code!=='ENOENT')throw error;}}
  const temporary=path+'.next-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try {
    await handle.writeFile(bytes);await handle.sync();await handle.close();
    if(replace)await rename(temporary,path);else{await link(temporary,path);await unlink(temporary);}
    const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await handle.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
const report={schema:'commons.scf-opencage-retained-completion/v1',startedAt:new Date().toISOString(),stages:[]};
async function stage(name,details){
  report.stages.push({name,at:new Date().toISOString(),...details});
  await atomic(join(output,'journey.json'),report,{replace:true});
  console.log(JSON.stringify({stage:name,...details}));
}
let workspace,server,browser,child;
try {
  const closureBytes=await readFile(resolve(args['source-manifest'])),closure=JSON.parse(closureBytes);
  assert(digest(closureBytes)==='be4e5afaf63ca73f8285b439abf3c42be0e81cdafd9a4223b2b6f7122826b290',
    'Installed source manifest differs from the retained selection');
  assert(closure.sourceCommit==='5e323e89a92b8859eb851205d69c6cc420ff7020'&&closure.sourceRoot===source,
    'Use the selected complete MCP/source installation');
  assert(closure.overlays?.some(row=>row.sourceCommit==='f2d1e326f2c7f60db77e5ea264c235590af84daf'&&
    row.path.endsWith('/opencage/ui/app.js')&&row.gitBlob==='b276f878ee222ac4503ffa0eb165dbd9a1c2169b'),
    'Use the published original release-selection correction');
  for(const file of closure.files){const bytes=await readFile(join(source,file.path));
    assert(bytes.length===file.bytes&&digest(bytes)===file.sha256,'Installed source changed: '+file.path);}
  const requestBytes=await readFile(join(record,'request.json')),request=JSON.parse(requestBytes);
  const resultBytes=await readFile(join(record,'result.json')),result=JSON.parse(resultBytes);
  const manifestBytes=await readFile(join(record,'artifacts.json')),manifest=JSON.parse(manifestBytes);
  assert(result.state==='failed'&&result.exit_code===1,'Retain the original interrupted workshare outcome');
  const intent=request.intent,argv=intent.command;
  assert(Array.isArray(argv)&&typeof intent.project==='string','Original native command is required');
  const option=name=>{const at=argv.indexOf(name);assert(at>=0&&typeof argv[at+1]==='string','Missing original '+name);return resolve(argv[at+1]);};
  const producer=option('--work'),producerSource=option('--source');
  assert(producer===join(resolve(intent.project),'run'),'Original output/project changed');
  const files=new Map(manifest.files.map(file=>[file.path,file]));
  async function retained(name){
    const path=join(producer,name),bytes=await readFile(path),key=relative(resolve(intent.project),path).split('\\').join('/');
    const file=files.get(key);assert(file&&file.bytes===bytes.length&&file.sha256===digest(bytes),'Original artifact changed: '+name);return bytes;
  }
  const original=JSON.parse(await retained('journey.json'));
  const body=await retained('native-response.json'),observationBytes=await retained('native-http-observation.json');
  const observation=JSON.parse(observationBytes),native=JSON.parse(body);
  const completedNames=new Set(original.stages.map(stage=>stage.name));
  for(const name of ['native-provider','native-zero-result','browser-original-http-import','browser-candidate-delivery'])
    assert(completedNames.has(name),'Original successful source stage is missing: '+name);
  assert(observation.response.status===200&&observation.bodySha256===digest(body)&&observation.bodyBytes===body.length&&
    native.results.length===1&&native.licenses?.length,'Original source/observation changed');
  const priorExport=JSON.parse(await retained('operator-export.json'));
  const priorSDK=JSON.parse(await retained('generated-sdk.json'));
  const resource=new URL(args.resource);
  assert(resource.origin==='https://raw.githubusercontent.com'&&
    resource.pathname==='/woahwhattheheck/public-commons-sprint-2026/f2d1e326f2c7f60db77e5ea264c235590af84daf/stellar/scf-starforge-20261009/sf30-seller-sdk/opencage/fixtures/native-reverse.json'&&
    !resource.search&&!resource.hash,'Use the exact published native response');
  const binding={operationId:intent.operation_id,record,requestSha256:digest(requestBytes),resultSha256:digest(resultBytes),
    artifactsSha256:digest(manifestBytes),sourceRoot:producerSource,workspace:join(producer,'workspace'),
    responseSha256:digest(body),responseBytes:body.length,sourceOutcome:result.state,
    existingExportId:priorExport.exportId,existingPackageId:priorSDK.packageId};
  report.provider=binding;report.source={baseCommit:closure.sourceCommit,overlays:closure.overlays,
    files:closure.files.length,manifestSha256:digest(closureBytes),sourceRoot:source};
  await atomic(join(output,'provider-binding.json'),binding);
  await atomic(join(output,'native-response.json'),body);
  await atomic(join(output,'native-http-observation.json'),observationBytes);
  await stage('original-native-source-joined',binding);

  const [{GeocodeWorkspace},{GeocodeDelivery},{createGeocodeServer},{chromium}]=await Promise.all([
    imp(join(component,'workspace.mjs')),imp(join(component,'customer.mjs')),imp(join(component,'server.mjs')),imp(args.playwright)]);
  const environment={...process.env,OPENCAGE_API_KEY:'6d0e711d72d74daeb2b0bfd2a5cdfdba'};
  workspace=await GeocodeWorkspace.open(binding.workspace,{env:environment});
  const selected=await workspace.get('native-reverse');
  assert(selected.responseSha256===digest(body)&&selected.decision.revision===1&&selected.decision.current.index===0,
    'Original selected candidate changed');
  const before=workspace.source.inspect();
  const reopened=await workspace.openExport(priorExport.exportId);
  assert(reopened.delivery.bytes().equals(body),'Original customer export changed');
  const terms=workspace.configuration.terms;
  let state=await workspace.overview();
  assert(state.merchant.state.generation===0&&!state.merchant.state.active&&
    state.merchant.releases.some(row=>row.id==='geocode-v1'),'Original staged release selection changed');
  server=await createGeocodeServer({workspace});
  browser=await chromium.launch({executablePath:args.browser,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const context=await browser.newContext({viewport:{width:1440,height:1060},acceptDownloads:true});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#request-list')?.textContent.includes('native-reverse'));
  const call=async(selector,path)=>{
    const pending=page.waitForResponse(r=>new URL(r.url()).pathname===path&&r.request().method()==='POST',{timeout:60000});
    await page.locator(selector).click();const response=await pending,value=await response.json();
    assert(response.ok(),'Original UI '+path+': '+JSON.stringify(value));return value;
  };
  async function compare(){
    const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/release-diff',{timeout:30000});
    await page.locator('#compare-release').click();const response=await pending,value=await response.json();
    assert(response.ok(),'Original release review: '+JSON.stringify(value));
    await page.waitForFunction(()=>!document.querySelector('#activate-release').disabled);return value;
  }
  async function challenge(running,name,amount){
    const url=new URL('/geocode/reverse',running.url);
    for(const [key,value]of Object.entries(observation.request.query))url.searchParams.set(key,value);
    const response=await fetch(url,{redirect:'error'}),bytes=Buffer.from(await response.arrayBuffer());
    assert(response.status===402,'Original seller did not return its payment challenge');
    const encoded=response.headers.get('payment-required'),document=encoded?JSON.parse(Buffer.from(encoded,'base64').toString('utf8')):JSON.parse(bytes);
    assert(document.accepts?.some(option=>String(option.amount??option.maxAmountRequired)===amount&&
      option.asset===terms.paymentOptions[0].asset&&option.payTo===terms.paymentOptions[0].payTo&&
      option.network===terms.paymentOptions[0].network),'Original payment terms changed');
    await atomic(join(output,name+'.json'),bytes);
    return {httpStatus:response.status,amount,mode:running.mode,responseSha256:digest(bytes)};
  }
  await page.locator('nav button[data-view="merchant"]').click();
  await page.locator('#release-select').selectOption('geocode-v1');
  const diff1=await compare();await atomic(join(output,'release-v1-diff.json'),diff1);
  await call('#activate-release','/api/activate');
  const running1=await call('#start-release','/api/start');
  const first=await challenge(running1,'merchant-v1-challenge',terms.paymentOptions[0].amount);
  await stage('original-staged-merchant-started',{releaseId:'geocode-v1',...first});
  const revised=structuredClone(terms);revised.paymentOptions[0].amount='30000';
  await page.locator('#terms').fill(JSON.stringify(revised,null,2));
  const package2=await call('#prepare-package','/api/package');
  await page.waitForFunction(id=>document.querySelector('#package-select')?.value===id,package2.packageId);
  await page.locator('#release-id').fill('geocode-v2');
  await page.locator('#release-label').fill('Reviewed revised geocoding offer');
  await call('#stage-package','/api/stage');
  // The original action stays busy through refresh and saved release selection.
  const diff2=await compare();assert(JSON.stringify(diff2).includes('30000'),'Price review omitted changed atomic amount');
  await atomic(join(output,'release-v2-diff.json'),diff2);
  await call('#activate-release','/api/activate');
  await page.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');
  await page.screenshot({path:join(output,'operator-release-change.png'),fullPage:true});
  await call('#stop-release','/api/stop');
  const running2=await call('#start-release','/api/start');
  const second=await challenge(running2,'merchant-v2-challenge','30000');
  await call('#stop-release','/api/stop');await call('#rollback-release','/api/rollback');
  await page.waitForFunction(()=>document.body.getAttribute('aria-busy')!=='true');
  state=await workspace.overview();
  assert(state.merchant.state.active==='geocode-v1'&&state.merchant.state.generation===3,'Original rollback changed selection');
  assert(workspace.source.inspect().started===before.started,'Retained completion dispatched another provider request');
  await page.setViewportSize({width:760,height:1040});
  await page.locator('nav button[data-view="requests"]').click();
  await page.getByRole('button',{name:'native-reverse',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#review-id')?.textContent==='native-reverse');
  await page.screenshot({path:join(output,'operator-compact.png'),fullPage:true});
  assert(errors.length===0,'Original browser errors: '+errors.join('; '));
  await stage('browser-price-restart-and-rollback',{first,second,active:state.merchant.state.active,
    generation:state.merchant.state.generation,sourceDispatches:workspace.source.inspect().started,browserErrors:errors});
  await browser.close();browser=null;await server.close();server=null;workspace=null;

  const delivery=await GeocodeDelivery.open(reopened.directory);
  server=await createGeocodeServer({delivery});
  browser=await chromium.launch({executablePath:args.browser,headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
  const customer=await browser.newPage({viewport:{width:1440,height:1060}});
  await customer.goto(server.url,{waitUntil:'domcontentloaded'});
  await customer.waitForFunction(()=>document.querySelector('#review-state')?.textContent==='CANDIDATES');
  await customer.screenshot({path:join(output,'customer-reopened.png'),fullPage:true});
  await browser.close();browser=null;await server.close();server=null;
  await stage('original-customer-reopened',{identity:delivery.identity,responseSha256:delivery.responseSha256,
    selectedIndex:delivery.inspect().selectedIndex,directory:reopened.directory});

  const buyerRoot=join(output,'buyer');await mkdir(buyerRoot,{mode:0o700,recursive:true});
  await atomic(join(buyerRoot,'customer-resource.json'),{url:resource.href,responseSha256:digest(body),
    responseBytes:body.length,query:observation.request.query});
  await atomic(join(buyerRoot,'native-terms.json'),terms);
  const payer=await readJson(join(producer,'native-payer.json'));
  assert(payer.payer==='GBC5J6QTAU2OTX4FW4CBNK3QMKZUWKD45ZN2FB3XGAEZUG4H5IHVINKM','Original public testnet payer changed');
  await atomic(join(buyerRoot,'native-payer.json'),payer);
  const buyerExit=await new Promise((done,reject)=>{
    child=spawn(args.python,[args['pty-script'],process.execPath,args['buyer-script'],'--source',producerSource,
      '--work',buyerRoot,'--python',args.python],{stdio:'inherit',env:process.env});
    child.once('error',reject);child.once('exit',(code,signal)=>signal?reject(Error('Original Buyer child '+signal)):done(code));
  });
  child=null;assert(buyerExit===0,'Original Buyer did not finish');
  const buyerBytes=await readFile(join(buyerRoot,'buyer-complete.json')),buyer=JSON.parse(buyerBytes);
  assert(buyer.httpStatus===200&&buyer.responseSha256===digest(body)&&buyer.responseBytes===body.length&&
    buyer.recoveredIntentId===buyer.intentId,'Original recovered Buyer response changed');
  report.buyer={directory:buyerRoot,reportSha256:digest(buyerBytes),...buyer};
  await stage('original-buyer-executed-and-recovered',report.buyer);
  report.outcome='COMPLETE';report.finishedAt=new Date().toISOString();
  await atomic(join(output,'journey.json'),report,{replace:true});
  console.log(JSON.stringify({outcome:report.outcome,stages:report.stages.length,report:join(output,'journey.json')}));
}catch(error){
  report.outcome='FAILED';report.finishedAt=new Date().toISOString();
  report.error={name:error.name,code:error.code,message:error.message};
  await atomic(join(output,'journey.json'),report,{replace:true}).catch(()=>{});
  console.error(error.stack);process.exitCode=1;
}finally{
  await browser?.close().catch(()=>{});await server?.close().catch(()=>{});
  if(!server)await workspace?.close().catch(()=>{});
}

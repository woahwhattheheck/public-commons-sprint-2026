#!/usr/bin/env node
// MIT. Complete Boston commissioning through the actual SQLite product, CLI, MCP and browser desks.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const product = resolve(config.product), output = resolve(config.output), repo = resolve(product, '../../../..');
const operation = join(repo, 'operations/open311-boston-8e5f-20261012');
const { openWorkspace, canonical } = await import(pathToFileURL(join(product, 'workspace.mjs')));
const { createClient, describeRequests } = await import(pathToFileURL(join(product, 'client.mjs')));
const { startOpen311Server } = await import(pathToFileURL(join(product, 'server.mjs')));
const { MerchantOpen311Workspaces } = await import(pathToFileURL(join(product, 'mcp.mjs')));
const { Open311MerchantClient } = await import(pathToFileURL(join(product, 'mcp-client.mjs')));
const { normalizeCollectionPlan, collectionNodeQuery } = await import(pathToFileURL(join(product, 'collection-domain.mjs')));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const check = (ok, message) => { if (!ok) throw new Error(message); };
const equal = (a,b,message) => check(canonical(a) === canonical(b), message);
const at = () => new Date().toISOString();
const launch = promisify(execFile);
await mkdir(output, { recursive: true, mode: 0o700 });
await mkdir(join(output, 'originals'), { mode: 0o700 });
const journey = { schema: 'commons.open311.boston-commissioning.v1', runId: randomUUID(),
  state: 'running', startedAt: at(), node: process.version, sourceEdition: config.edition,
  sourceFiles: config.sourceFiles, checks: [], files: [], sourceCalls: [] };
const retained = new Map(), byId = new Map();
const servers = [];
let source, receiver, provider;
async function save(name, body, contentType='application/json') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : json(body));
  await writeFile(join(output, name), bytes, { flag: 'wx', mode: 0o600 });
  journey.files.push({ name, bytes: bytes.length, sha256: sha(bytes), contentType }); return bytes;
}
function sourceKey(input) {
  const url = new URL(String(input));
  check(!url.username && !url.password, 'Source URLs must not contain credentials.');
  const dates = new Set(['start_date','end_date','updated_after','updated_before']);
  const entries = [...url.searchParams].map(([name,value]) =>
    [name, dates.has(name) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : value])
    .sort((a,b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  return url.origin + url.pathname + '?' + new URLSearchParams(entries);
}
for (const entry of config.retained.captures) {
  const bytes = Buffer.from(entry.raw.body, 'base64');
  check(bytes.length === entry.raw.bytes && sha(bytes) === entry.raw.sha256, 'Original source bytes changed: ' + entry.id);
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  check(Array.isArray(value), 'The complete original must contain the source array.');
  const original = { ...entry, bytes, value };
  const key = sourceKey(entry.receipt.url);
  check(!retained.has(key) && !byId.has(entry.id), 'Duplicate retained input identity.');
  retained.set(key, original); byId.set(entry.id, original);
  await save('originals/' + entry.id + '.json', bytes);
}
function clientFactory(connection) {
  let selected;
  const client = createClient(connection, { fetchImpl: async (url, init) => {
    check(init.method === 'GET', 'The source boundary requires the original GET method.');
    selected = retained.get(sourceKey(url));
    check(selected, 'No complete original matches this source selection: ' + url);
    journey.sourceCalls.push({ originalId: selected.id, originalUrl: selected.receipt.url,
      selectedUrl: String(url), admittedAt: at(), admittedMs: Date.now(), sha256: selected.raw.sha256 });
    return new Response(selected.bytes, { status: selected.receipt.status ?? 200,
      headers: selected.receipt.headers ?? { 'content-type': selected.raw.contentType } });
  } });
  return Object.fromEntries(['services','requests','service','request','token','discovery'].map(method =>
    [method, async (...args) => {
      selected = null;
      const result = await client[method](...args), original = selected;
      check(original && result.raw.sha256 === original.raw.sha256, 'Source decoding changed the complete original response.');
      return { ...result, receipt: { ...original.receipt,
        method: original.receipt.method ?? null, status: original.receipt.status ?? null,
        headers: original.receipt.headers ?? null, startedAt: original.receipt.startedAt ?? null,
        observedAt: original.receipt.observedAt, durationMs: original.receipt.durationMs ?? null,
        kind: result.receipt.kind, query: result.receipt.query,
        ...(result.receipt.coverage ? { coverage: result.receipt.coverage } : {}),
        replayedAt: at(), replaySource: 'Complete retained original Boston response',
        replayTransportStatus: original.receipt.status ?? 200 } };
    }]));
}
const action = (desk, extra={}) => ({requestId:randomUUID(),expectedRevision:desk.state().revision,...extra});
const connection = config.connection;
const policy = { strategy:'pages',maxWindowDays:90,queryQuantumMs:1000,minimumWindowMs:1000,boundaryOverlapMs:1000 };
const createdQuery = { start_date:'2026-10-08T08:00:00Z',end_date:'2026-10-08T12:00:00Z',per_page:40,extensions:true };
const updatedQuery = { updated_after:'2026-10-08T17:40:00Z',updated_before:'2026-10-08T17:50:00Z',per_page:300,extensions:true };
const emptyQuery = { updated_after:'2026-10-12T08:00:00Z',updated_before:'2026-10-12T08:15:00Z',per_page:300,extensions:true };
async function collection(name, query, selectedPolicy=policy) {
  const createInput=action(source,{connectionId:connection.id,name,query,policy:selectedPolicy});
  const created=source.createCollection(createInput);
  equal(source.createCollection(createInput),created,'A retained collection-create command changed when recovered.');
  const runInput=action(source,{collectionId:created.collection.id});
  const run=await source.runCollection(runInput);
  check(run.collection.state==='COMPLETE' && run.collection.capResolved,'Source collection did not complete: '+canonical(run));
  equal(await source.runCollection(runInput),run,'A retained completed run changed when recovered.');
  const detail=source.collectionInfo({id:created.collection.id,limit:1000});
  const rows=source.requests({collection:created.collection.id,limit:1000});
  return {id:created.collection.id,createInput,runInput,run,detail,rows};
}
async function exportCollection(value, label) {
  const results={};
  for(const [kind,suffix] of [['json','json'],['csv','csv'],['report','html']]) {
    const exported=source.export({kind,collection:value.id});
    const name=label+'-collection.'+suffix;
    await save(name,exported.body,exported.contentType);
    results[kind]=exported.body;
  }
  return results;
}
try {
  const firstPage=byId.get('requests-page1-size40'),secondPage=byId.get('requests-page2-size40'),thirdPage=byId.get('requests-page3-size40');
  equal([...firstPage.value,...secondPage.value,...thirdPage.value],byId.get('requests-page1-size300').value,'Original pagination changes the 84 retained Boston source records.');
  const createdPlan=normalizeCollectionPlan(connection,{name:'Boston created source pages',query:createdQuery,policy});
  check(describeRequests(connection,collectionNodeQuery({...createdPlan,connection},createdPlan.nodes[0])).documentedLimit===40,'The Boston provider page-size limit changed.');
  const sourceDirectory=join(output,'source-workspace');
  source=openWorkspace(sourceDirectory,{clientFactory});
  source.putConnection(action(source,{connection}));
  const catalogue=await source.capture(action(source,{connectionId:connection.id,kind:'services',query:{}}));
  check(catalogue.capture.rowCount===byId.get('services').value.length,'The original Boston catalogue differs.');
  const created=await collection('Boston created cases, original pages40+40+4',createdQuery);
  check(created.rows.total===84 && created.rows.items.length===84,'Original created-case population differs.');
  equal(created.detail.items.map(item=>item.capture.rowCount),[40,40,4],'The actual provider page sequence differs.');
  equal(created.detail.items.map(item=>item.state),['PAGED','PAGED','CAPTURED'],'The saved page-continuation topology differs.');
  equal(created.detail.items.map(item=>item.page),[1,2,3],'The collector did not own the provider page sequence.');
  const wide=await collection('Boston same created period, page size300',{...createdQuery,per_page:300});
  const difference=source.diff({kind:'collection',before:created.id,after:wide.id});
  check(difference.scopeComparable && difference.unchanged.length===84 && !difference.added.length && !difference.changed.length &&
    !difference.missingFromCapture.length,'Equivalent complete source collections differ when provider page size changes.');
  await save('page-size-comparison.json',difference);
  const updated=await collection('Boston changed cases,8October17:40–17:50UTC',updatedQuery,{...policy,timeBasis:'updated'});
  check(updated.rows.total===21,'The original updated feed must retain21 cases.');
  const oldCases=updated.rows.items.filter(row=>Date.parse(row.requestedAt)<Date.parse('2026-10-01T00:00:00Z'));
  check(oldCases.length>0,'Updated selection discarded the original older cases.');
  const empty=await collection('Boston empty updated period,12October08:00–08:15UTC',emptyQuery,{...policy,timeBasis:'updated'});
  check(empty.rows.total===0 && empty.detail.items.length===1 && empty.detail.items[0].state==='CAPTURED','An empty original updated response must complete and retain its source page.');
  const active=created.rows.items.find(row=>row.source.status_notes) ?? created.rows.items[0];
  const reviewInput=action(source,{connectionId:connection.id,serviceRequestId:active.serviceRequestId,captureId:active.captureId,
    expectedSourceSha256:active.sourceSha256,review:{status:'in_progress',assignee:'Boston review desk',
      dueDate:'2026-10-13',note:'Review the retained original closure reason and receiving-team assignment.'}});
  const reviewed=source.putReview(reviewInput);
  equal(source.putReview(reviewInput),reviewed,'Recovered source-pinned review changed.');
  const createdExports=await exportCollection(created,'created');
  await exportCollection(updated,'updated');await exportCollection(empty,'empty-updated');
  const sourceEnvelope=JSON.parse(createdExports.json);
  check(sourceEnvelope.originals.length===3,'The full created collection did not retain all3 original pages.');
  for(const member of created.detail.items){
    const exported=source.export({kind:'source',capture:member.captureId});
    check(sha(exported.body)===member.capture.sourceSha256,'An original page export differs from its saved body.');
  }
  const complete=source.export({kind:'workspace'});
  await save('complete-workspace.json',complete.body,complete.contentType);
  const completeBundle=JSON.parse(complete.body);
  check(completeBundle.payload.collections.length===4,'The entire desk must contain all4 native collection editions.');
  journey.checks.push({name:'native-created-updated-and-empty-collections',created:84,updated:21,olderChangedCases:oldCases.length,
    originalPages:[40,40,4],empty:0,collectionIds:{created:created.id,wide:wide.id,updated:updated.id,empty:empty.id},
    originalReviewRequestId:reviewInput.requestId});
  const merchantExports=join(output,'merchant-exports');await mkdir(merchantExports,{mode:0o700});
  const host={schema:'stellar-forge.open311-workspace-host.v1',path:join(output,'merchant-host.json'),
    workspaces:{desk:{label:'Boston collection and review desk',directory:sourceDirectory,inputs:{},connectionProfiles:{}}}};
  await save('merchant-host.json',host);
  provider=new MerchantOpen311Workspaces({open311Workspaces:host,exportsDirectory:merchantExports});
  const merchant=new Open311MerchantClient((name,args)=>provider.call(name,args),'desk');
  const status=await merchant.status();
  const windows=[];let offset=0,page;
  do {page=await merchant.collectionInfo({id:created.id,expectedRevision:status.revision,offset,limit:2});windows.push(...page.items);offset=page.nextOffset;}while(offset!==null);
  check(windows.length===3,'Installed MCP paging omitted an original provider page.');
  const changedRows=await merchant.requests({collection:updated.id,expectedRevision:status.revision,limit:25});
  check(changedRows.total===21,'Installed MCP updated-case worklist differs.');
  const downloaded=await merchant.downloadFile({kind:'csv',collection:created.id,expectedRevision:status.revision},{limit:4096});
  check(downloaded.bytes.equals(Buffer.from(createdExports.csv)),'Typed MCP download differs from the actual consolidated CSV.');
  const originalDownload=await merchant.downloadFile({kind:'source',capture:created.detail.items[0].captureId},{limit:4096});
  check(originalDownload.file.sha256===firstPage.raw.sha256,'Typed MCP original body differs.');
  await provider.close();provider=null;
  journey.checks.push({name:'installed-mcp-typed-client-and-original-file-download',windows:windows.length,
    updatedCases:changedRows.total,csvBytes:downloaded.bytesRead,originalBytes:originalDownload.bytesRead});
  const receiverDirectory=join(output,'received-workspace');
  receiver=openWorkspace(receiverDirectory);
  const received=receiver.receive(action(receiver,{bundle:completeBundle}));
  receiver.close();receiver=openWorkspace(receiverDirectory);
  equal(receiver.requests({collection:created.id,limit:1000}).items,source.requests({collection:created.id,limit:1000}).items,'Independently received and reopened source/review worklist differs.');
  equal(receiver.requests({collection:updated.id,limit:1000}).items,source.requests({collection:updated.id,limit:1000}).items,'Reopened updated cases differ.');
  check(receiver.export({kind:'csv',collection:created.id}).body===createdExports.csv,'Reopened consolidated source CSV differs.');
  const reopened=JSON.parse(receiver.export({kind:'workspace'}).body);
  for(const key of ['connections','captures','reviews','collections'])equal(reopened.payload[key],completeBundle.payload[key],'Reopened '+key+' differs.');
  for(const original of completeBundle.payload.operations)equal(reopened.payload.operations.find(item=>item.requestId===original.requestId),original,'The original operation history changed during receiving.');
  await save('reopened-workspace.json',receiver.export({kind:'workspace'}).body);
  const cli=await launch(process.execPath,[join(product,'cli.mjs'),'collection-info','--workspace',receiverDirectory,'--id',updated.id,'--limit','100'],{maxBuffer:4*1024*1024});
  const cliResult=JSON.parse(cli.stdout);
  check(cliResult.collection.id===updated.id && cliResult.collection.policy.timeBasis==='updated','The actual CLI did not reopen the selected updated collection.');
  await save('cli-collection-info.json',cli.stdout);
  journey.checks.push({name:'independent-desk-receive-reopen-and-cli',workspaceId:receiver.state().workspaceId,
    revision:receiver.state().revision,sourceOperations:completeBundle.payload.operations.length,received});
  receiver.close();receiver=null;
  source.close();source=null;
  const operatorDesk=await startOpen311Server({workspace:join(output,'browser-operator-workspace'),clientFactory});
  servers.push(operatorDesk);
  operatorDesk.workspace.putConnection(action(operatorDesk.workspace,{connection}));
  await operatorDesk.workspace.capture(action(operatorDesk.workspace,{connectionId:connection.id,kind:'services',query:{}}));
  const receivingDesk=await startOpen311Server({workspace:join(output,'browser-receiving-workspace'),clientFactory});
  servers.push(receivingDesk);
  const playwright=await import(pathToFileURL(config.playwrightModule)),{chromium}=playwright.default??playwright;
  const {runBostonBrowserJourney}=await import(pathToFileURL(join(operation,'browser-journey.mjs')));
  const sourceFiles=ids=>ids.map(id=>({path:join(output,'originals',id+'.json'),sha256:byId.get(id).raw.sha256}));
  journey.browser=await runBostonBrowserJourney({chromium,executablePath:config.chromiumExecutablePath,
    sourceUrl:operatorDesk.url,receivingUrl:receivingDesk.url,connectionId:connection.id,outputDirectory:join(output,'browser'),
    cases:[
      {key:'created',name:'Boston browser created cases',query:createdQuery,policy,sourceFiles:sourceFiles(['requests-page1-size40','requests-page2-size40','requests-page3-size40']),expectedPageRows:[40,40,4]},
      {key:'updated',name:'Boston browser changed cases',query:updatedQuery,policy:{...policy,timeBasis:'updated'},sourceFiles:sourceFiles(['updated-20261008-1740-1750']),expectedPageRows:[21]},
      {key:'empty-updated',name:'Boston browser empty updated period',query:emptyQuery,policy:{...policy,timeBasis:'updated'},sourceFiles:sourceFiles(['updated-20261012-0800-0815']),expectedPageRows:[0]}
    ],timeoutMs:90000});
  await receivingDesk.close();await operatorDesk.close();servers.length=0;
  journey.checks.push({name:'browser-created-updated-review-export-and-independent-receiving',browser:journey.browser});
  const gaps=journey.sourceCalls.slice(1).map((call,index)=>call.admittedMs-journey.sourceCalls[index].admittedMs);
  check(gaps.every(ms=>ms>=connection.minimumRequestIntervalMs-10),'Source clients recreated across collection steps did not share documented request pacing.');
  journey.checks.push({name:'provider-request-admission-across-native-and-browser-clients',calls:journey.sourceCalls.length,
    minimumRequestIntervalMs:connection.minimumRequestIntervalMs,observedMinimumGapMs:Math.min(...gaps)});
  const reportingConfig={...config,requestId:'boston-reporting-8e5f-20261012-01',collectionOutput:output,
    reportingProduct:join(product,'reporting'),output:join(output,'reporting'),
    reportingSourceFiles:config.sourceFiles.filter(item=>item.path.includes('/open311/reporting/')),
    options:{uiRunner:await readFile(join(operation,'reporting-browser-journey.mjs'),'utf8'),bostonUiRunnerPath:join(operation,'browser-journey.mjs')}};
  const reportingConfigPath=join(output,'reporting-job.json');await save('reporting-job.json',reportingConfig);
  const priorArg=process.argv[2];process.argv[2]=reportingConfigPath;
  try {await import(pathToFileURL(join(operation,'reporting-journey.mjs')));}finally{process.argv[2]=priorArg;}
  journey.reporting=JSON.parse(await readFile(join(output,'reporting/journey.json'),'utf8'));
  check(journey.reporting.state==='passed','The complete Boston reporting journey failed: '+json(journey.reporting.error??{}));
  journey.checks.push({name:'source-reporting-calendar-review-and-browser-receiving',reporting:journey.reporting.checks});
  journey.state='passed';
} catch(error) {
  journey.state='failed';journey.error={message:error.message,code:error.code,status:error.status,details:error.details,stack:error.stack};
  process.exitCode=1;
} finally {
  if(provider)await provider.close().catch(error=>{journey.closeError=error.message;});
  if(receiver)receiver.close();if(source)source.close();
  for(const server of servers.reverse())await server.close().catch(error=>{journey.closeError=error.message;journey.state='failed';process.exitCode=1;});
  journey.completedAt=at();
  await writeFile(join(output,'journey.json'),json(journey),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({state:journey.state,output,checks:journey.checks.length,files:journey.files.length,
    sourceCalls:journey.sourceCalls.length,error:journey.error}));
}

// MIT — One native dataset→SF81 free response→SF31 writer→SF100 delivery journey.
// Transport calls the real SF30 loader in-process. Retained inbox envelopes are
// fixtures around original SF81/SF82 results; no paid request or live sale.
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, chmod, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {loadCsvDataset} from '../../sf30-seller-sdk/dataset-handler.mjs';
import {OperatorApprovedBuyer} from '../../sf81-buyer-operator-bridge/bridge.mjs';
import {executeWithEvidence} from '../../sf82-checkout-evidence/evidence.mjs';
import {prepareBuyerResponseFile} from '../../sf31-buyer-client/response-file.mjs';
import {init, append, scan, checkPage} from '../../sf100-buyer-dataset-delivery/deliver.mjs';
import {initializeQueue, openQueue} from '../queue.mjs';
import {exportQueueDataset} from '../queue-dataset.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const dir = await mkdtemp(join(tmpdir(), 'sf88-dataset-delivery-'));
await chmod(dir, 0o700);
const root = join(dir, 'inbox'), evidenceDir = join(dir, 'evidence');
await mkdir(evidenceDir, {mode:0o700});
const file = join(dir, 'inventory.csv');
await writeFile(file, 'sku,category,quantity,price,note\n' +
  'A,tools,5,8.5,=2+2\nB,tools,7,12.25,"steel, item"\n' +
  'C,tools,3,12.25,mètre\nD,tools,9,2.5,\nE,office,4,19,paper\n' +
  'F,tools,11,99,outside range\nG,tools,3,8.5,tie\nH,tools,6,0,free item\n' +
  'I,office,1,1,pen\n', {mode:0o600});
const columns = {sku:'string',category:'string',quantity:'integer',price:'number',
  note:{type:'string',nullable:true}};
const advanced = await loadCsvDataset({file,name:'inventory',columns,
  filters:['category'],ranges:['quantity'],sorts:['price'],defaultLimit:2});
const legacy = await loadCsvDataset({file,name:'inventory-legacy',columns,
  filters:['category'],defaultLimit:1});
const signerModule = join(dir, 'signer.mjs'), policy = join(dir, 'policy.json');
await writeFile(signerModule, 'export function sign(){throw Error("UNEXPECTED_SIGN");}\n', {mode:0o600});
await writeFile(policy, '{}\n', {mode:0o600});
const operator = {python:'/usr/bin/python3',actor:'local-dataset-operator',service:'native-dataset-journey',
  policy,ledger:join(dir,'unused-ledger.sqlite')};
const environment = Object.fromEntries(['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64']
  .map(key => [key,'unused-on-original-free-response-path']));
await initializeQueue(root);
const queue = await openQueue(root);
let calls = 0, signed = 0;
async function capture(dataset, query, prefix) {
  const ids = [], bodies = [];
  let cursor;
  do {
    const intentId = prefix + '-' + (ids.length + 1);
    const url = new URL('https://dataset.example/inventory');
    url.search = new URLSearchParams({...query,...(cursor === undefined ? {} : {cursor})});
    const destination = join(dir, intentId + '.response.json');
    const cfg = {operation:{intentId,url:url.href,method:'GET',
      expect:{scheme:'exact',network:'stellar:testnet',asset:'LOCAL_TEST_ASSET',payTo:'LOCAL_TEST_RECIPIENT',maxAtomic:'1'}},
      operator,signerModule,evidenceDir,captureBody:false,responseFile:{destination}};
    const path = join(dir, intentId + '.config.json');
    await writeFile(path, JSON.stringify(cfg), {mode:0o600});
    const queued = await queue.enqueue(path);
    const attempt = {schema:queued.schema,kind:'EXECUTE',id:randomUUID(),intentId,
      configSha256:queued.configSha256,startedAt:new Date().toISOString()};
    const job = join(root,'jobs',queued.id);
    await writeFile(join(job,'attempt.json'),JSON.stringify(attempt),{mode:0o600,flag:'wx'});
    const writer = await prepareBuyerResponseFile({destination});
    const native = new OperatorApprovedBuyer({operator:{...operator,environment},fetchImpl:async requested => {
      calls++;
      const result = dataset.handle({query:new URL(requested).searchParams});
      assert.equal(result.status,200);
      bodies.push(result.body);
      return new Response(JSON.stringify(result.body),{status:result.status,headers:result.headers});
    }});
    let saved;
    const observed = await executeWithEvidence({buyer:{async call(options) {
      const result = await native.call(options);
      saved = {status:'SAVED',...await writer.save(result)};
      return result;
    }},call:{...cfg.operation,sign(){signed++;throw new Error('UNEXPECTED_SIGN');}},outputDir:evidenceDir});
    assert.equal(observed.error,null);
    assert.equal(observed.result.status,'NO_PAYMENT_REQUIRED');
    const summary = {mode:'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT',intentId,
      status:observed.result.status,httpStatus:observed.result.response.status,
      sellerReportedSettlement:observed.result.settlement,evidencePath:observed.evidencePath,
      originalOutcomeReport:observed.report,operatorReservation:null,responseFile:saved,
      interrupted:false,retry:'NO_AUTOMATIC_RETRY'};
    await writeFile(join(job,'terminal.json'),JSON.stringify({schema:queued.schema,attemptId:attempt.id,
      intentId,completedAt:new Date().toISOString(),summary,error:null}),{mode:0o600,flag:'wx'});
    await writer.abort();
    ids.push(intentId);
    cursor = bodies.at(-1).page.nextCursor;
  } while (cursor !== null);
  return {ids,bodies};
}

const a = await capture(advanced,{fields:'sku,quantity,price,note',where_category:'tools',
  gte_quantity:'3',lte_quantity:'9',sort:'-price',limit:'2'},'advanced');
assert.equal(a.ids.length,3);
const out = join(dir,'advanced-delivery');
const result = await exportQueueDataset({root,intents:a.ids,destination:out});
assert.equal(result.rows,6);
const rows = (await readFile(result.jsonl,'utf8')).trim().split('\n').map(JSON.parse);
assert.deepEqual(rows.map(row => row.sku),['B','C','A','G','D','H']);
assert.equal(rows[4].note,null);
assert.match(await readFile(result.csv,'utf8'),/"'=2\+2"/);
const manifest = JSON.parse(await readFile(join(out,'dataset','manifest.json'),'utf8'));
assert.equal(manifest.dataset.order.direction,'desc');
assert.equal(manifest.dataset.ranges.length,2);
const envelope = JSON.parse(await readFile(result.manifest.path,'utf8'));
assert.equal(envelope.operations.length,3);
for (const entry of envelope.operations) {
  assert.equal(sha(await readFile(join(out,entry.source.path))),entry.source.sha256);
  const original = JSON.parse(await readFile(join(out,entry.originalOperation.path),'utf8'));
  assert.equal(original.outcome.status,'NO_PAYMENT_REQUIRED');
}
await assert.rejects(exportQueueDataset({root,intents:a.ids,destination:out}),{code:'EEXIST'});
await assert.rejects(exportQueueDataset({root,intents:[a.ids[0],a.ids[2]],destination:join(dir,'skipped-page')}));
await assert.rejects(stat(join(dir,'skipped-page')),{code:'ENOENT'});

// An invalid next page must not poison the accepted native SF100 session.
const partial = join(dir,'native-append');
await init(partial);
const malformed = structuredClone(a.bodies[0]); malformed.page.nextCursor = null;
const badFile = join(dir,'premature.json');
await writeFile(badFile,JSON.stringify(malformed),{mode:0o600});
await assert.rejects(append(partial,{page:badFile,intent:'premature-page'}));
assert.equal((await scan(partial)).pages.length,0);
await append(partial,{page:join(dir,a.ids[0]+'.response.json'),intent:a.ids[0]});
assert.equal((await scan(partial)).count,2);

const l = await capture(legacy,{where_category:'office',limit:'1'},'legacy');
const p = l.bodies[0], checked = checkPage(p);
assert.equal(checked.signature,sha(JSON.stringify([p.dataset,p.fields,p.filters,p.page.total])));
assert.equal(checked.queryHash,sha(JSON.stringify({fields:p.fields,filters:Object.entries(p.filters)})));
const selection = join(dir,'selected.json');
await writeFile(selection,JSON.stringify(l.ids),{mode:0o600});
const cli = spawnSync(process.execPath,[new URL('../queue-dataset-cli.mjs',import.meta.url).pathname,
  '--root',root,'--intents',selection,'--out',join(dir,'legacy-delivery')],{encoding:'utf8'});
assert.equal(cli.status,0,cli.stderr);
assert.equal(JSON.parse(cli.stdout).rows,2);
const firstEvidence = join(evidenceDir,sha(a.ids[0])+'.json');
await writeFile(firstEvidence,await readFile(join(evidenceDir,sha(a.ids[1])+'.json')));
await assert.rejects(exportQueueDataset({root,intents:a.ids,destination:join(dir,'wrong-evidence')}),
  {code:'DATASET_ORIGINAL_EVIDENCE_MISMATCH'});
await writeFile(firstEvidence,await readFile(join(out,envelope.operations[0].evidence.path)));
await writeFile(join(dir,a.ids[0]+'.response.json'),'changed source bytes');
await assert.rejects(exportQueueDataset({root,intents:a.ids,destination:join(dir,'changed-response')}),
  {code:'DATASET_ORIGINAL_RESPONSE_CHANGED'});
assert.equal(signed,0);
console.log(JSON.stringify({status:'PASS',node:process.version,nativeRequests:calls,signatures:signed,
  advancedPages:a.ids.length,legacyPages:l.ids.length,rows:8,package:out,
  exercised:['native typed ranges and stable sort','original SF81 free response and SF82 outcome',
    'original SF31 saved bytes','original SF100 bulk delivery','legacy cursor compatibility',
    'unchanged source digests','ordered selection','no overwrite','invalid append stays recoverable','one JSON CLI']}));

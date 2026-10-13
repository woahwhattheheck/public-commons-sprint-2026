// Continue the saved original CanadaBuys customer through its actual HTTP and merchant interfaces.
import { mkdir, readFile, writeFile, open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
const root = process.env.CANADABUYS_CASE_ROOT;
const base = join(root, 'source/stellar/scf-starforge-20261009/sf30-seller-sdk/canadabuys');
const load = name => import(pathToFileURL(join(base, name)));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(message); };
const previous = JSON.parse(await readFile(join(root, 'case-result.json'), 'utf8'));
need(previous.operation === 'SCF-CANADABUYS-PROCUREMENT-9FCD-20261012' &&
  previous.source?.records === 908 && previous.source?.columns === 67, 'Restore the existing full-feed customer before continuation.');
const attempts = join(root, 'original-case-attempts');
await mkdir(attempts, {recursive:true, mode:0o700});
await writeFile(join(attempts, 'before-http-' + Date.now() + '.json'), JSON.stringify(previous, null, 2) + '\n', {mode:0o600});
const result = {...previous, status:'running', stage:'reopen-original-customer', continuedAt:new Date().toISOString(),
  browserAttempt:previous.browserAttempt || (previous.stage === 'browser-operating-and-receiving'
    ? {status:previous.status, failedAt:previous.failedAt, error:previous.error} : undefined)};
delete result.error; delete result.failedAt;
const save = async () => {
  const destination = join(root, 'case-result.json'), temporary = destination + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(JSON.stringify(result, null, 2) + '\n');
    await handle.sync(); await handle.close(); await rename(temporary, destination);
  } catch (error) {
    await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error;
  }
  console.log(JSON.stringify({stage:result.stage, status:result.status, completed:result.stages.length, memory:process.memoryUsage()}));
};
const stage = row => { result.stages = result.stages.filter(item => item.stage !== row.stage); result.stages.push(row); };
let server, receiving;
const traceClient = (client, role) => new Proxy(client, { get(target, key) {
  const value = Reflect.get(target, key, target);
  if (typeof value !== 'function') return value;
  return async (...args) => {
    console.log(JSON.stringify({stage:result.stage, role, api:String(key), state:'started', memory:process.memoryUsage()}));
    try {
      const returned = await value.apply(target, args);
      console.log(JSON.stringify({stage:result.stage, role, api:String(key), state:'completed', memory:process.memoryUsage()}));
      return returned;
    } catch (error) {
      console.log(JSON.stringify({stage:result.stage, role, api:String(key), state:'failed', code:error.code, status:error.status, message:error.message}));
      throw error;
    }
  };
} });
try {
  const {startCanadaBuysServer} = await load('server.mjs');
  const {CanadaBuysWorkspace} = await load('workspace.mjs');
  const {CanadaBuysClient} = await load('client.mjs');
  const {operateCanadaBuysApi} = await load('operator/OPERATING_API.mjs');
  const content = JSON.parse(await readFile(join(root, 'apm2-operating-content.json'), 'utf8'));
  const noticeId = content.workshare.noticeId;
  server = await startCanadaBuysServer({directory:join(root,'operator-workspace'),operator:'TJLabs engineering',title:'CanadaBuys procurement desk'});
  receiving = await startCanadaBuysServer({directory:join(root,'receiving-workspace'),operator:'TJLabs receiving',title:'CanadaBuys receiving desk'});
  need(server.workspace.view().counts.notices === 908, 'The original source collection changed.');
  {
    const originalSource = server.workspace.getSource(result.source.sourceId);
    need(originalSource.rowCount === 908 && sha(Buffer.from(originalSource.rawText)) === result.source.sha256,
      'The saved original customer source changed.');
  }
  const sourceNotice = server.workspace.getNotice(noticeId);
  need(sourceNotice.currentEntry.sourceId === result.source.sourceId && sourceNotice.presentInLatestOpenFeed,
    'The existing APM2 source selection changed.');
  stage({stage:result.stage, operator:server.workspace.metadata(), receiver:receiving.workspace.metadata(), notices:908});
  await save();

  result.stage = 'http-operator-and-receiving'; await save(); globalThis.gc?.();
  const journey = await operateCanadaBuysApi({
    client:traceClient(new CanadaBuysClient(server.url), 'operator'), receivingClient:traceClient(new CanadaBuysClient(receiving.url), 'receiving'),
    noticeId, review:content.review, workshare:content.workshare,
    workshareId:result.operator?.saved?.workshare?.id || result.browser?.saved?.workshare?.id,
    outputDirectory:join(root, 'operator-api-journey')
  });
  need(journey.status === 'completed' && journey.receiving.sourceMatches &&
    journey.receiving.reviewDifferences.length === 0 && journey.receiving.workshareDifferences.length === 0,
    'The actual operator package and receiving must complete.');
  need(journey.saved.workshare.feeCents === 720000, 'The source-backed original engineering fee changed.');
  result.operator = {interface:'http-api', status:journey.status, directory:journey.directory,
    saved:journey.saved, package:journey.package, receiving:journey.receiving};
  stage({stage:result.stage, sourceMatches:true, packageId:journey.package.packageId, workshareId:journey.saved.workshare.id});
  await save();

  result.stage = 'source-preserving-merchant'; await save(); globalThis.gc?.();
  const merchant = await load('merchant.mjs');
  let prepared = result.merchant?.prepared;
  if (!prepared) {
    const priorRevision = result.merchant?.intent?.sourceRevision;
    const candidates = priorRevision === undefined ? [] : server.workspace.view().publications
      .filter(publication => publication.kind === 'canadabuys-merchant' &&
        publication.sourceRevision === priorRevision && !publication.configured &&
        publication.noticeIds?.length === 1 && publication.noticeIds[0] === noticeId)
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    if (candidates.length) {
      const publication = candidates[0];
      const loaded = await merchant.loadMerchant(publication.directory, {expectedBundleSha256:publication.bundleSha256});
      prepared = {publication, bundle:loaded.bundle, directory:loaded.directory, bundleSha256:loaded.bundleSha256};
    } else {
      const sourceRevision = server.workspace.metadata().revision;
      result.merchant = {...result.merchant, intent:{noticeIds:[noticeId], sourceRevision}};
      await save();
      prepared = await merchant.prepareMerchant(server.workspace, {
        scope:'selected', noticeIds:[noticeId], expectedRevision:sourceRevision,
        name:'APM2 engineering workshare'
      });
    }
    result.merchant = {...result.merchant, prepared, directory:prepared.directory || prepared.publication?.directory};
    await save();
  }
  await writeFile(join(root, 'merchant-preparation.json'), JSON.stringify(prepared, null, 2) + '\n', {mode:0o600});
  const directory = prepared.directory || prepared.publication?.directory;
  need(directory, 'The original merchant publication must identify its retained directory.');
  await merchant.loadMerchant(directory, {expectedBundleSha256:prepared.bundleSha256 || prepared.publication?.bundleSha256});
  const preview = await merchant.previewMerchant(directory, {where_notice_id:noticeId, limit:'10', sort:'part_index'});
  await writeFile(join(root, 'merchant-preview.json'), JSON.stringify(preview, null, 2) + '\n', {mode:0o600});
  result.merchant = {directory, prepared, preview};
  stage({stage:result.stage, directory}); await save();

  result.stage = 'cold-reopen'; await save(); globalThis.gc?.();
  const workshare = server.workspace.getWorkshare(journey.saved.workshare.id);
  await server.close(); server = null; await receiving.close(); receiving = null;
  const cold = new CanadaBuysWorkspace(join(root,'operator-workspace'), {operator:'TJLabs cold reopen'});
  const coldReceiver = new CanadaBuysWorkspace(join(root,'receiving-workspace'), {operator:'TJLabs cold receiving'});
  try {
    need(cold.view().counts.notices === 908 && coldReceiver.view().counts.notices === 908,
      'Cold reopen changed the full original notice collection.');
    need(cold.getWorkshare(workshare.id).revision === workshare.revision &&
      coldReceiver.getWorkshare(workshare.id).feeCents === 720000, 'Cold reopen changed the original saved workshare.');
    need(sha(Buffer.from(coldReceiver.getSource(result.source.sourceId).rawText)) === result.source.sha256,
      'Cold receiving changed the original federal source.');
    stage({stage:result.stage, operator:cold.metadata(), receiver:coldReceiver.metadata(), counts:cold.view().counts});
  } finally { cold.close(); coldReceiver.close(); }
  result.completedInterfaces = ['http-api', 'source-preserving-merchant', 'cold-reopen'];
  result.stage = 'complete'; result.status = 'complete'; result.completedAt = new Date().toISOString();
  await save();
} catch (error) {
  result.status = 'failed'; result.failedAt = new Date().toISOString();
  result.error = {name:error.name, code:error.code, status:error.status, message:error.message, stack:error.stack,
    directory:error.operatorApiDirectory};
  await save(); process.exitCode = 1;
} finally {
  if (server) await server.close().catch(() => {});
  if (receiving) await receiving.close().catch(() => {});
}

// MIT. Operate the original CanadaBuys HTTP API on existing customer workspaces.
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const copy = value => JSON.parse(JSON.stringify(value));
const json = value => JSON.stringify(value, null, 2) + '\n';
const need = (ok, message) => { if (!ok) throw new Error(message); };
function differences(expected, actual, path = '') {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) return [{path, expected, actual: actual ?? null}];
    return expected.flatMap((value, index) => differences(value, actual[index], path + '[' + index + ']'));
  }
  if (expected !== null && typeof expected === 'object') return Object.entries(expected)
    .flatMap(([key, value]) => differences(value, actual?.[key], path ? path + '.' + key : key));
  return expected === actual ? [] : [{path, expected: expected ?? null, actual: actual ?? null}];
}
function reviewFields(record) {
  return Object.fromEntries(['disposition', 'owner', 'nextAction', 'note', 'shortlisted', 'qualification']
    .filter(key => Object.hasOwn(record || {}, key)).map(key => [key, record[key]]));
}
function workshareFields(record) {
  const fields = Object.fromEntries(['noticeId', 'title', 'status', 'partner', 'owner', 'currency', 'feeCents',
    'estimatedHours', 'partnerHours', 'availableFrom', 'deliveryDays', 'scope', 'deliverables',
    'partnerResponsibilities', 'inputs', 'acceptance', 'milestones', 'costs', 'note']
    .filter(key => Object.hasOwn(record || {}, key)).map(key => [key, record[key]]));
  if (fields.currency) fields.currency = fields.currency.toUpperCase();
  return fields;
}
async function atomicWrite(path, body) {
  const temporary = path + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(body);
    await handle.sync();
    await handle.close();
    await rename(temporary, path);
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
async function retainReport(client, directory, name, options) {
  const destination = join(directory, name);
  const temporary = destination + '.' + randomUUID() + '.tmp';
  const handle = await open(temporary, 'wx', 0o600);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    const response = await client.reportTo(async chunk => {
      let offset = 0;
      while (offset < chunk.byteLength) {
        const written = await handle.write(chunk, offset, chunk.byteLength - offset);
        need(written.bytesWritten > 0, 'The report output stopped accepting bytes.');
        offset += written.bytesWritten;
      }
      hash.update(chunk);
      bytes += chunk.byteLength;
    }, options);
    need(bytes === response.bytes, 'The complete report byte count changed during retention.');
    await handle.sync();
    await handle.close();
    await rename(temporary, destination);
    return {file:name, path:destination, bytes, sha256:hash.digest('hex'),
      mime:response.mime, sourceFilename:response.filename};
  } catch (error) {
    await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
async function optionalJSON(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/**
 * Save a real review/workshare, download complete reports and source, and receive
 * that exact package through caller-owned CanadaBuysClient instances.
 * A stable outputDirectory retains the original package and write receipts across
 * an explicit continuation. Mutations are never automatically retried.
 */
export async function operateCanadaBuysApi({
  client, noticeId, outputDirectory, review, workshare, workshareId, receivingClient
} = {}) {
  need(client?.workspace && client?.notice && client?.createWorkshare && client?.reportTo, 'Supply the original CanadaBuysClient.');
  need(typeof noticeId === 'string' && noticeId.length > 0, 'Select a retained notice.');
  need(typeof outputDirectory === 'string' && outputDirectory.length > 0, 'Use the original operation output directory.');
  if (workshare?.noticeId) need(workshare.noticeId === noticeId, 'The workshare selects another notice.');
  const directory = resolve(outputDirectory);
  await mkdir(directory, {recursive:true, mode:0o700});
  let initial = await client.workspace();
  need(initial.workspace?.id && initial.notices.some(item => item.id === noticeId), 'The original workspace must retain the selected notice.');
  const previous = await optionalJSON(join(directory, 'result.json'));
  if (previous) {
    need(previous.schema === 'commons.canadabuys.api-journey.v1' &&
      previous.noticeId === noticeId && previous.workspace.id === initial.workspace.id,
      'The retained operation belongs to another notice or workspace.');
    await atomicWrite(join(directory, 'previous-attempt-' + Date.now() + '.json'), json(previous));
  }
  const result = {
    schema:'commons.canadabuys.api-journey.v1', interface:'http-api', status:'running',
    startedAt:previous?.startedAt || new Date().toISOString(), continuedAt:new Date().toISOString(),
    directory, noticeId, workspace:copy(initial.workspace), stage:'original-source',
    saved:copy(previous?.saved || {}), downloads:{},
    receivingTarget:copy(previous?.receivingTarget || previous?.receiving?.before || previous?.receiving?.after || null),
    receiving:copy(previous?.receiving || null)
  };
  initial = null;
  const save = async () => atomicWrite(join(directory, 'result.json'), json(result));
  const write = async (name, value) => {
    const body = typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value);
    const bytes = Buffer.from(body);
    await atomicWrite(join(directory, name), bytes);
    return {file:name, path:join(directory, name), bytes:bytes.length, sha256:sha256(bytes)};
  };
  try {
    if (result.receivingTarget?.id) need(receivingClient, 'Supply the original receiving client to continue this operation.');
    if (receivingClient) {
      const target = (await receivingClient.workspace()).workspace;
      need(target?.id, 'The receiving client must identify its existing workspace.');
      if (result.receivingTarget?.id) need(result.receivingTarget.id === target.id,
        'Continue with the original receiving workspace.');
      else result.receivingTarget = copy(target);
      await save();
    }
    const originalRead = await client.notice(noticeId), original = originalRead.notice || originalRead;
    need(original.id === noticeId && original.currentEntry?.row && Array.isArray(original.history),
      'Retain the complete original notice and history.');
    result.originalNotice = await write('original-notice.json', original);
    const sourceId = original.currentEntry.sourceId;
    let sourceRead = await client.source(sourceId), source = sourceRead.source || sourceRead;
    need(typeof source.rawText === 'string', 'The source response must contain the complete original CSV.');
    let originalBytes = Buffer.from(source.rawText);
    need(source.bytes === originalBytes.length && source.sha256 === sha256(originalBytes), 'The original source bytes differ from their identity.');
    result.source = {id:sourceId, stream:source.stream, url:source.url, retrievedAt:source.retrievedAt,
      bytes:source.bytes, sha256:source.sha256, rowCount:source.rowCount,
      currentEntryId:original.currentEntry.id, rowNumber:original.currentEntry.rowNumber};
    result.downloads.originalSource = await write('original-source.csv', originalBytes);
    sourceRead = null; source = null; originalBytes = null;
    await save();

    result.stage = 'qualification';
    if (review !== undefined) {
      const wanted = reviewFields(review), current = original.review;
      if (differences(wanted, current).length) {
        const expectedRevision = current?.revision ?? 0;
        const saved = await client.updateReview(noticeId, {...wanted, expectedRevision});
        need(saved.workspace && saved.notices?.some(item => item.id === noticeId), 'The review write must return the complete saved workspace.');
        result.saved.reviewOperation = {expectedRevision, workspaceRevision:saved.workspace.revision};
        await save();
      }
    }
    const noticeRead = await client.notice(noticeId), notice = noticeRead.notice || noticeRead;
    if (review !== undefined) need(differences(reviewFields(review), notice.review).length === 0, 'The saved qualification differs from the supplied content.');
    result.saved.review = copy(notice.review);
    result.reviewRecord = await write('saved-review.json', notice.review);
    await save();

    result.stage = 'partner-workshare';
    let selectedId = workshareId || result.saved.workshare?.id || workshare?.id || null;
    let current;
    if (selectedId) {
      const found = await client.workshare(selectedId); current = found.workshare || found;
      need(current.noticeId === noticeId, 'The retained workshare belongs to another notice.');
    } else if (workshare) {
      const view = await client.workspace();
      const candidates = view.workshares.filter(item => item.noticeId === noticeId &&
        item.title === workshare.title && item.partner === workshare.partner);
      need(candidates.length <= 1, 'Select the intended existing workshare ID before continuing.');
      if (candidates.length) {
        selectedId = candidates[0].id;
        const found = await client.workshare(selectedId); current = found.workshare || found;
      }
    }
    if (workshare !== undefined) {
      const wanted = {...workshareFields(workshare), noticeId};
      if (wanted.currency) wanted.currency = wanted.currency.toUpperCase();
      if (!current || differences(wanted, current).length) {
        const expectedRevision = current ? current.revision : (await client.workspace()).workspace.revision;
        const saved = current
          ? await client.updateWorkshare(selectedId, {...wanted, expectedRevision})
          : await client.createWorkshare(wanted, expectedRevision);
        selectedId = saved.workshare?.id || selectedId;
        need(selectedId && saved.workspace && saved.workshares?.some(item => item.id === selectedId),
          'The workshare write must return its identity and complete saved workspace.');
        result.saved.workshareOperation = {id:selectedId, expectedRevision, workspaceRevision:saved.workspace.revision};
        result.saved.workshare = {id:selectedId, noticeId};
        await save();
      }
    }
    if (selectedId) {
      const savedRead = await client.workshare(selectedId), saved = savedRead.workshare || savedRead;
      if (workshare) need(differences({...workshareFields(workshare), noticeId}, saved).length === 0,
        'The saved workshare differs from the supplied content.');
      result.saved.workshare = {id:saved.id, noticeId, revision:saved.revision, title:saved.title,
        status:saved.status, currency:saved.currency, feeCents:saved.feeCents};
      result.workshareValues = workshareFields(saved);
      result.workshareRecord = await write('saved-workshare.json', saved);
      const handover = await client.report({format:'html', scope:'selected', noticeIds:[noticeId]});
      need(typeof handover.body === 'string' && handover.body.includes(String(saved.title).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;')),
        'The saved partner report must contain its workshare.');
      result.downloads.workshareHandover = await write('partner-workshare.html', handover.body);
    }
    await save();

    result.stage = 'reports-and-package';
    for (const format of ['html','csv','json']) {
      result.downloads['report_' + format] = await retainReport(client, directory,
        'canadabuys-report.' + format, {format, scope:'all'});
      await save();
    }
    const exporting = await client.workspace();
    let pkg = null;
    const oldPackage = await optionalJSON(join(directory, 'canadabuys-workspace.json'));
    if (oldPackage && previous?.package?.packageId === oldPackage.packageId &&
        previous.package.workspaceRevision === exporting.workspace.revision) pkg = oldPackage;
    else pkg = await client.exportPackage({scope:'all'});
    need(pkg?.packageId && Array.isArray(pkg.reviews) && Array.isArray(pkg.sources) && Array.isArray(pkg.selection?.noticeIds),
      'The original export must retain complete notices and sources.');
    result.downloads.workspacePackage = await write('canadabuys-workspace.json', pkg);
    result.package = {schema:pkg.schema, packageId:pkg.packageId, workspaceRevision:exporting.workspace.revision,
      bytes:result.downloads.workspacePackage.bytes, sha256:result.downloads.workspacePackage.sha256};
    await save();

    if (receivingClient) {
      result.stage = 'receive-same-package';
      const before = await receivingClient.workspace();
      need(before.workspace?.id === result.receivingTarget?.id,
        'Continue receiving into the original target workspace.');
      if (result.receiving?.packageId !== pkg.packageId) result.receiving = null;
      let priorReceipt = null;
      try { const value = await receivingClient.receiving(pkg.packageId); priorReceipt = value.receiving || value; }
      catch (error) { if (error.status !== 404) throw error; }
      let receipt;
      if (priorReceipt) receipt = {receiving:priorReceipt, ...(await receivingClient.workspace())};
      else {
        result.receiving = {before:copy(before.workspace), packageId:pkg.packageId,
          expectedRevision:before.workspace.revision, receiving:null};
        await save();
        receipt = await receivingClient.receivePackage(pkg, before.workspace.revision);
        result.receiving = {...result.receiving, after:receipt.workspace, receiving:receipt.receiving || null};
        await save();
      }
      need(receipt.workspace?.id === before.workspace.id, 'Receiving changed the original target workspace.');
      const receivedNoticeRead = await receivingClient.notice(noticeId), receivedNotice = receivedNoticeRead.notice || receivedNoticeRead;
      need(receivedNotice.history?.some(entry => entry.id === original.currentEntry.id && entry.sourceId === sourceId),
        'The receiver must retain the original notice entry and source identity.');
      const receivedSourceRead = await receivingClient.source(sourceId), receivedSource = receivedSourceRead.source || receivedSourceRead;
      need(typeof receivedSource.rawText === 'string' && sha256(Buffer.from(receivedSource.rawText)) === result.source.sha256,
        'The receiver changed the complete original source.');
      const reviewDifferences = differences(reviewFields(result.saved.review), reviewFields(receivedNotice.review));
      need(reviewDifferences.length === 0, 'The receiving workspace changed the saved qualification.');
      result.receiving = {...result.receiving, before:result.receiving?.before || before.workspace,
        after:receipt.workspace, packageId:pkg.packageId, receiving:receipt.receiving || priorReceipt,
        sourceMatches:true, reviewDifferences, notice:await write('received-notice.json', receivedNotice)};
      if (selectedId) {
        const read = await receivingClient.workshare(selectedId), received = read.workshare || read;
        const workshareDifferences = differences(result.workshareValues, workshareFields(received));
        need(workshareDifferences.length === 0, 'The receiving workspace changed the saved partner workshare.');
        result.receiving.workshareDifferences = workshareDifferences;
        result.receiving.workshareIdentity = {id:received.id, noticeId:received.noticeId, revision:received.revision};
        result.receiving.workshare = await write('received-workshare.json', received);
      }
      const retained = await receivingClient.receiving(pkg.packageId);
      result.receiving.record = await write('retained-receiving-record.json', retained.receiving || retained);
      await write('receiving-operation.json', result.receiving);
      await save();
    }
    result.stage = 'complete'; result.status = 'completed'; result.completedAt = new Date().toISOString();
    await save(); return result;
  } catch (error) {
    result.status = 'failed'; result.failedAt = new Date().toISOString();
    result.error = {message:error.message, code:error.code, status:error.status, details:error.details};
    await save(); error.operatorApiDirectory = directory; error.operatorApiResult = result; throw error;
  }
}

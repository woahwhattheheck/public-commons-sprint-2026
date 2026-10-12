// SPDX-License-Identifier: MIT
// Complete analyst delivery from the original immutable CO-OPS editions.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory, jsonBytes, stable } from '../../stellar-expert/store.mjs';
import { hashBytes, fault } from '../provider.mjs';
import { materializeExport, retainedExport } from '../exports.mjs';
import { INPUT_SCHEMA } from './core.mjs';
import { buildAnalysisBundle } from './bundle.mjs';

const SHA = /^[a-f0-9]{64}$/;
const ANALYSIS_ID = /^analysis-[a-f0-9]{24}$/;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));
const digest = bytes => hashBytes(Buffer.from(bytes));
const utf8 = bytes => new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
const fail = (code, message, details) => { throw fault(code, message, 409, details); };

function editionQuery(edition, product) {
  if (!plain(edition) || edition.schema !== 'stellar-forge.coops-edition.v1' || !SHA.test(edition.id ?? ''))
    fail('COOPS_ANALYSIS_EDITION', 'Choose an original retained coastal source edition.');
  const q = edition.query;
  if (!plain(q) || !Array.isArray(q.products) || !q.products.includes(product))
    fail('COOPS_ANALYSIS_PRODUCT', 'The selected edition must retain the original ' + product + ' product.');
  if (q.timeZone !== 'gmt' || product === 'predictions' && q.predictionInterval !== '6')
    fail('COOPS_ANALYSIS_SOURCE_BASIS', 'Select original GMT water levels and six-minute GMT predictions.');
  for (const key of ['beginDate', 'endDate']) {
    if (typeof q[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(q[key]) ||
        !Number.isFinite(Date.parse(q[key] + 'T00:00:00Z')) ||
        new Date(q[key] + 'T00:00:00Z').toISOString().slice(0, 10) !== q[key])
      fail('COOPS_ANALYSIS_SOURCE_WINDOW', 'The retained source needs its exact original daily request bounds.');
  }
  return {
    station: q.stationId, product, datum: q.datum, units: q.units, time_zone: q.timeZone,
    begin_date: q.beginDate + 'T00:00:00Z',
    end_date: q.endDate + 'T23:59:00Z',
    ...(product === 'predictions' ? { interval: q.predictionInterval } : {}),
  };
}

async function originalFile(store, receipt, index, role, kind) {
  if (!plain(receipt) || !SHA.test(receipt.sha256 ?? '') ||
      !Number.isSafeInteger(receipt.bytes) || receipt.bytes < 0)
    fail('COOPS_ANALYSIS_SOURCE_RECEIPT', 'Retain the original response identity and byte count.');
  const bytes = await store.object(receipt.sha256);
  if (bytes.length !== receipt.bytes || hashBytes(bytes) !== receipt.sha256)
    fail('COOPS_ANALYSIS_SOURCE_CHANGED', 'The retained coastal response no longer matches its original receipt.');
  let body;
  try { body = utf8(bytes); }
  catch { fail('COOPS_ANALYSIS_SOURCE_ENCODING', 'This workbook requires the original UTF-8 NOAA response.'); }
  return {
    name: role + '-' + kind + '-' + String(index + 1).padStart(3, '0') + '-' + receipt.sha256.slice(0, 12) + '.json',
    sha256: receipt.sha256, body, receipt: copy(receipt),
  };
}

/** Each role may select the same original edition when it contains both products. */
export async function analysisInputFromEditions(store, { observationsEditionId, predictionsEditionId } = {}) {
  for (const id of [observationsEditionId, predictionsEditionId])
    if (!SHA.test(id ?? '')) fail('COOPS_ANALYSIS_SELECTION', 'Select both original retained edition identities.');
  const loaded = new Map();
  const input = { schema: INPUT_SCHEMA };
  for (const [role, id, product] of [
    ['observations', observationsEditionId, 'water_level'],
    ['predictions', predictionsEditionId, 'predictions'],
  ]) {
    let edition = loaded.get(id);
    if (!edition) { edition = await store.edition(id); loaded.set(id, edition); }
    if (edition.id !== id) fail('COOPS_ANALYSIS_EDITION_CHANGED', 'The original selected edition identity changed.');
    const series = {
      editionId: id, selection: editionQuery(edition, product), pages: [], metadata: [], failedResponses: [],
      original: {
        schema: edition.schema, workspaceId: edition.workspaceId, profile: copy(edition.profile),
        query: copy(edition.query), sourceSha256: edition.sourceSha256, complete: edition.complete,
        metadataUnavailable: copy(edition.metadataUnavailable ?? []),
      },
    };
    if (!Array.isArray(edition.pages) || !Array.isArray(edition.failedResponses ?? []))
      fail('COOPS_ANALYSIS_SOURCE_REGISTER', 'The retained edition needs its complete response register.');
    for (let index = 0; index < edition.pages.length; index++) {
      const receipt = edition.pages[index];
      if (receipt.kind === 'data' && receipt.product === product) {
        if (receipt.parseState !== 'ACCEPTED')
          fail('COOPS_ANALYSIS_SOURCE_STATE', 'Select the accepted original response register.');
        series.pages.push(await originalFile(store, receipt, index, role, 'response'));
      } else if (receipt.kind === 'metadata') {
        if (receipt.parseState !== 'ACCEPTED')
          fail('COOPS_ANALYSIS_SOURCE_STATE', 'Select the accepted original metadata register.');
        series.metadata.push({
          ...await originalFile(store, receipt, index, role, 'metadata'), role: receipt.resource ?? 'metadata',
        });
      }
    }
    for (let index = 0; index < (edition.failedResponses?.length ?? 0); index++) {
      const receipt = edition.failedResponses[index];
      if (receipt.kind === 'metadata' || receipt.product === product)
        series.failedResponses.push(await originalFile(store, receipt, index, role, 'failed-response'));
    }
    input[role] = series;
  }
  return input;
}

function selectedDelivery(value) {
  if (!plain(value) || !ANALYSIS_ID.test(value.id ?? '') ||
      !SHA.test(value.observationsEditionId ?? '') || !SHA.test(value.predictionsEditionId ?? '') ||
      typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)))
    fail('COOPS_ANALYSIS_DELIVERY_SELECTION', 'Retain the original operation, edition pair and creation time.');
  for (const name of ['options', 'analyst'])
    if (value[name] !== undefined && !plain(value[name]))
      fail('COOPS_ANALYSIS_DELIVERY_FIELDS', 'Use an object for the selected ' + name + '.');
  if (Object.keys(value.analyst ?? {}).some(key => !['name', 'project', 'question', 'interpretation', 'followUp'].includes(key)))
    fail('COOPS_ANALYSIS_NOTES', 'Use the declared analyst, project, question, interpretation and follow-up fields.');
  return {
    schema: 'stellar-forge.coops-retained-analysis-selection.v1', id: value.id,
    observationsEditionId: value.observationsEditionId, predictionsEditionId: value.predictionsEditionId,
    createdAt: value.createdAt, options: copy(value.options ?? {}), analyst: copy(value.analyst ?? {}),
  };
}

/** Original export files and the completed delivery recover before any recalculation. */
export async function writeRetainedAnalysisBundle(store, request) {
  const selection = selectedDelivery(request);
  const directory = await privateDirectory(join(store.root, 'analyses'), { create: true });
  const recordPath = join(directory, selection.id + '.json');
  let previous;
  try { previous = JSON.parse(await readFile(recordPath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    if (stable(previous.selection) !== stable(selection) ||
        previous.result?.schema !== 'stellar-forge.coops-retained-analysis.v1' ||
        !Array.isArray(previous.result.files) || !previous.result.files.length)
      fail('COOPS_ANALYSIS_DELIVERY_CHANGED', 'The retained analysis belongs to a different original selection.');
    for (const item of previous.result.files) await retainedExport(store, item);
    return previous.result;
  }
  const input = await analysisInputFromEditions(store, selection);
  const bundle = await buildAnalysisBundle({
    input, options: selection.options, analyst: selection.analyst, createdAt: selection.createdAt,
  });
  const files = [];
  for (const file of bundle.files) {
    if (!/^(?:source\/)?[a-zA-Z0-9_.-]+$/.test(file.name))
      fail('COOPS_ANALYSIS_MEMBER', 'The generated workbook contains an invalid member path.');
    const item = {
      id: 'export-' + digest(selection.id + '\0' + file.name).slice(0, 24),
      kind: 'analysis', analysisId: selection.id, member: file.name,
      editionIds: [...new Set([selection.observationsEditionId, selection.predictionsEditionId])],
      observationsEditionId: selection.observationsEditionId, predictionsEditionId: selection.predictionsEditionId,
      sourceId: bundle.prepared.sourceId, analysisSha256: bundle.workbook.analysisSha256,
      format: 'coastal-analysis', createdAt: selection.createdAt,
      name: 'coops-' + bundle.prepared.common.station + '-' + selection.id.slice(9, 21) + '-' + file.name.replace('/', '-'),
      type: file.type, content: { bytes: file.bytes.length, sha256: file.sha256 },
    };
    const saved = await materializeExport(store, item, async function* () { yield file.bytes; });
    if (saved.bytes !== file.bytes.length || saved.sha256 !== file.sha256)
      fail('COOPS_ANALYSIS_EXPORT_CHANGED', 'The complete retained workbook member changed.');
    files.push(saved);
  }
  const result = {
    schema: 'stellar-forge.coops-retained-analysis.v1', id: selection.id, createdAt: selection.createdAt,
    observationsEditionId: selection.observationsEditionId, predictionsEditionId: selection.predictionsEditionId,
    sourceId: bundle.prepared.sourceId, analysisSha256: bundle.workbook.analysisSha256,
    context: bundle.prepared.common, options: bundle.result.options, analyst: bundle.workbook.analyst,
    coverage: bundle.result.coverage, statistics: bundle.result.statistics, episodes: bundle.result.episodes.length,
    manifest: bundle.manifest, files,
    workbookExportId: files.find(file => file.member === 'workbook.html').id,
    portableExportId: files.find(file => file.member === 'workbook.json').id,
  };
  await store.immutable(recordPath, jsonBytes({ selection, result }));
  return result;
}

/**
 * MIT. Original source -> briefing -> SDMX merchant -> SF88 buyer -> reopen.
 * Native payment intents and accounting remain in the configured original buyer.
 */
import { join, resolve } from 'node:path';
import { readFile, lstat } from 'node:fs/promises';
import { launchOecd } from './client.mjs';
import { prepareSdmxMerchant, readSdmxMerchant, startSdmxMerchant } from '../merchant.mjs';
import { reviewSdmxBuyer, prepareSdmxBuyer } from '../customer.mjs';
import { Buyer, DatasetDelivery } from '../../../sf88-operator-buyer-cli/node/index.mjs';
import { bytes, digest, identity, readJson, readPrivate, createFile, atomicJson,
  privateDirectory, acquireWorkspace, stamp } from '../../postgres/publisher/files.mjs';

function need(value, code, message = code) {
  if (!value) throw Object.assign(new Error(message), { code });
}
async function optional(path) {
  try { return await readJson(path, 16 * 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function exactFile(directory, name, content) {
  const path = join(directory, name);
  try { await createFile(path, content); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need((await readPrivate(path, Math.max(1, content.length))).equals(content),
      'OECD_RECEIVING_FILE_CHANGED', 'The original receiving artifact contains different bytes: ' + name);
  }
  return { path, bytes: content.length, sha256: digest(content) };
}
function compareSourceRows(delivered, original) {
  const expected = new Map(original.map(row => [row.series_key + '\0' + row.time_period, row]));
  need(expected.size === original.length && delivered.length === original.length, 'OECD_DELIVERY_ROW_COUNT');
  const observed = new Set();
  for (const row of delivered) {
    const key = row.series_key + '\0' + row.time_period, source = expected.get(key);
    need(source && !observed.has(key), 'OECD_DELIVERED_SERIES_PERIOD_CHANGED');
    observed.add(key);
    need(row.flow === source.flow && row.value_present === source.value_present &&
      row.value_kind === source.value_kind && row.observation_action === source.action &&
      row.observation_value === (source.value === '' ? null : source.value) &&
      identity(JSON.parse(row.attributes_json)) === identity(source.attributes),
      'OECD_DELIVERED_ORIGINAL_VALUE_CHANGED');
    for (const [dimension, code] of Object.entries(source.dimensions)) {
      need(row['dim_' + dimension.toLowerCase()] === code, 'OECD_DELIVERED_DIMENSION_CHANGED');
    }
  }
  return { comparedRows: delivered.length, series: new Set(original.map(r => r.series_key)).size,
    comparison: 'Every original series/period/value/presence/action/attribute/dimension is preserved.' };
}
export async function receiveOecd({ projectDirectory, config, pythonCommand = 'python3',
  signal, print = () => {} } = {}) {
  need(config?.schema === 'stellar-forge.oecd-receiving-config.v1' &&
    /^[A-Za-z0-9][A-Za-z0-9_.-]{0,69}$/.test(config.id ?? ''), 'OECD_RECEIVING_CONFIG');
  need(config.merchant && config.buyer && config.selection, 'OECD_RECEIVING_CONFIG');
  need(Number.isInteger(config.pageSize) && config.pageSize >= 1 && config.pageSize <= 250, 'OECD_NATIVE_PAGE_SIZE');
  const directory = resolve(projectDirectory);
  const buyerSettings = await readJson(resolve(config.buyer.configFile), 131072);
  const paymentBytes = await readPrivate(resolve(config.merchant.paymentFile), 16384);
  const payment = JSON.parse(paymentBytes.toString('utf8'));
  const bound = { ...config, projectDirectory: directory,
    merchant: { ...config.merchant, paymentFile: resolve(config.merchant.paymentFile),
      paymentSha256: digest(paymentBytes) },
    buyer: { ...config.buyer, configFile: resolve(config.buyer.configFile),
      configSha256: identity(buyerSettings), operatorWorkspace: resolve(config.buyer.operatorWorkspace) } };
  let exists;
  try { await lstat(join(directory, 'oecd-project.json')); exists = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
  const launched = await launchOecd({ projectDirectory: directory, create: !exists, pythonCommand,
    env: { ...process.env, SF30_XML_NODE: process.execPath },
    providerUsernameEnv: config.providerUsernameEnv, providerPasswordEnv: config.providerPasswordEnv });
  const client = launched.client;
  const folder = join(directory, 'receiving', config.id);
  await privateDirectory(folder, true);
  let unlock, merchant, state;
  try {
    unlock = await acquireWorkspace(folder);
    state = await optional(join(folder, 'receiving.json'));
    if (state) need(state.configurationSha256 === identity(bound) && identity(state.configuration) === identity(bound),
      'OECD_RECEIVING_BINDING_CHANGED', 'Resume this original operation with its retained configuration.');
    else {
      state = { schema: 'stellar-forge.oecd-receiving.v1', id: config.id, configuration: bound,
        configurationSha256: identity(bound), createdAt: stamp(), state: 'READY', steps: {} };
      await atomicJson(folder, 'receiving.json', state);
    }
    const save = async () => { state.updatedAt = stamp(); await atomicJson(folder, 'receiving.json', state); };
    const step = async (name, action) => {
      if (state.steps[name]) return state.steps[name];
      need(!signal?.aborted, 'OECD_RECEIVING_INTERRUPTED');
      state.phase = name; state.state = 'RUNNING'; await save();
      print({ operation: state.id, phase: name, checkpoint: join(folder, 'receiving.json') });
      const result = await action(); state.steps[name] = result; await save(); return result;
    };
    try {
      const capture = await step('source', () => client.seed({ operation_id: config.id + ':source' }));
      const briefing = await step('briefing', () => client.save({ ...config.selection,
        operation_id: config.id + ':briefing', capture_id: capture.id }));
      const completeBriefing = await client.briefing(briefing.id);
      const sourceRows = await client.sourceRows(briefing.id);
      await step('reportArtifacts', async () => {
        const target = join(folder, 'analyst-report'); await privateDirectory(target, true);
        const files = [];
        for (const name of ['briefing.html', 'briefing.json', 'observations.csv']) {
          files.push(await exactFile(target, name, (await client.reportFile(briefing.id, name)).body));
        }
        return { briefingId: briefing.id, directory: target, files,
          reportRows: completeBriefing.document.observation_count, nativeRows: sourceRows.row_count };
      });
      const exported = await step('dataset', () => client.exportDataset(briefing.id));
      const prepared = await step('merchantRelease', async () => {
        await prepareSdmxMerchant({ datasetDirectory: exported.directory,
          directory: resolve(config.merchant.directory), payment, origin: config.merchant.origin,
          path: config.merchant.path ?? '/sdmx' });
        const release = await readSdmxMerchant(resolve(config.merchant.directory));
        return { directory: release.directory, manifest: release.manifest };
      });
      need(prepared.manifest.snapshot === briefing.native_snapshot &&
        sourceRows.snapshot === briefing.native_snapshot, 'OECD_ORIGINAL_SNAPSHOT_CHANGED');
      await step('catalogPublication', async () => {
        const current = await client.state();
        if (current.catalog.current === briefing.catalog_edition_id) {
          return { catalogEdition: current.catalog.current, revision: current.catalog.revision, recovered: true };
        }
        const result = await client.activate({ briefing_id: briefing.id,
          expected_revision: current.catalog.revision, expected_current: current.catalog.current });
        return { catalogEdition: result.current, revision: result.revision };
      });
      const buyer = await new Buyer(buyerSettings).ready();
      let dataset = buyer.dataset(config.buyer.id);
      if (!state.steps.delivery) {
        merchant = await startSdmxMerchant({ directory: prepared.directory,
          stateDirectory: resolve(config.merchant.stateDirectory), port: config.merchant.port ?? 8423,
          facilitator: config.merchant.facilitator, allowLocalFacilitator: config.merchant.allowLocalFacilitator === true,
          controlTransport: config.merchant.controlTransport ?? 'unix' });
        need(merchant.mode === 'NATIVE_X402', 'OECD_NATIVE_MERCHANT_REQUIRED');
        await atomicJson(folder, 'merchant-session.json', { url: merchant.url, mode: merchant.mode,
          release: prepared.manifest.id, snapshot: prepared.manifest.snapshot, startedAt: stamp() });
        const acquisition = await step('buyerSelection', async () => {
          const query = { limit: String(config.pageSize), sort: 'series_key' };
          const offer = await reviewSdmxBuyer({ directory: prepared.directory, seller: merchant.url, query });
          need(offer.mode === 'NATIVE_X402', 'OECD_NATIVE_OFFER_REQUIRED');
          const result = await prepareSdmxBuyer({ directory: prepared.directory, seller: merchant.url, query,
            intentId: config.buyer.id, acceptIndex: config.buyer.acceptIndex ?? 0,
            offerSha256: offer.offerSha256, destination: join(folder, 'buyer-config.json') });
          return { configFile: result.saved.path, configSha256: result.saved.sha256,
            expectedRows: sourceRows.row_count, snapshot: offer.snapshot, offerSha256: offer.offerSha256 };
        });
        const savedEntry = await optional(join(dataset.directory, 'dataset.json'));
        const limits = { maxPages: config.buyer.maxPages, maxTotalAtomic: config.buyer.maxTotalAtomic,
          maxRows: sourceRows.row_count, maxPageBytes: config.buyer.maxPageBytes ?? 1048576 };
        if (savedEntry) {
          need(savedEntry.id === config.buyer.id && savedEntry.source?.kind === 'config' &&
            savedEntry.expectedSnapshot === briefing.native_snapshot && identity(savedEntry.limits) === identity(limits),
            'OECD_ORIGINAL_BUYER_BINDING_CHANGED');
          const profile = await buyer._profile(await readJson(acquisition.configFile));
          need(identity(await readJson(join(dataset.directory, 'config.json'))) === identity(profile),
            'OECD_ORIGINAL_BUYER_CONFIG_CHANGED');
          await dataset.initialize({ signal });
        } else {
          dataset = await buyer.createDataset({ id: config.buyer.id, config: acquisition.configFile,
            ...limits, expectedSnapshot: briefing.native_snapshot });
        }
        await step('buyerPages', async () => {
          let result = await dataset.inspect({ signal });
          if (result.native.status !== 'COMPLETE') {
            need(result.native.status !== 'RUNNING', 'OECD_ORIGINAL_BUYER_RUNNING',
              'The original native dataset attempt is still running; inspect its retained execution.');
            result = await dataset.run({ signal });
          }
          need(result.native.status === 'COMPLETE' && result.native.snapshot === briefing.native_snapshot &&
            result.native.acquiredRows === sourceRows.row_count, 'OECD_ORIGINAL_BUYER_PENDING',
            'Continue the same retained buyer attempt and original intents.');
          return result;
        });
        await step('accounting', async () => {
          const reports = [];
          for await (const result of dataset.finalizeAll({ workspaceDirectory: bound.buyer.operatorWorkspace, signal })) {
            reports.push(result); await atomicJson(folder, 'accounting-current.json', { reports });
          }
          const last = reports.at(-1);
          need(last && !last.native.interrupted && last.native.range.nextOffset === null &&
            !last.process.errorCode && reports.flatMap(r => r.native.entries)
              .every(entry => ['FINALIZED', 'IDEMPOTENT_FINALIZED'].includes(entry.outcome)),
            'OECD_ORIGINAL_ACCOUNTING_PENDING');
          return { reports };
        });
        await step('delivery', async () => {
          const delivery = await dataset.deliver(join(folder, 'buyer-delivery'), { signal });
          const rows = await delivery.readRows({ limit: 256 * 1024 * 1024, maxRows: 1000000, signal });
          const comparison = compareSourceRows(rows, sourceRows.rows);
          const destination = join(folder, 'buyer-delivery');
          const files = [];
          for (const name of ['briefing.html', 'briefing.json', 'observations.csv']) {
            files.push(await exactFile(destination, name, (await client.reportFile(briefing.id, name)).body));
          }
          files.push(await exactFile(destination, 'oecd-original-project.zip', (await client.exportProject(briefing.id)).body));
          files.push(await exactFile(destination, 'oecd-original-source-rows.json', bytes(sourceRows)));
          return { report: delivery.report, manifest: delivery.manifest, comparison, files };
        });
      }
      await step('deliveryReopen', async () => {
        const delivery = await DatasetDelivery.open(state.steps.delivery.report);
        const rows = await delivery.readRows({ limit: 256 * 1024 * 1024, maxRows: 1000000, signal });
        return { ...compareSourceRows(rows, sourceRows.rows), snapshot: delivery.manifest.dataset.snapshot };
      });
      const revised = await step('revisedBriefing', async () => {
        const result = await client.save({ ...briefing.selection,
          operation_id: config.id + ':customer-handover', project_id: briefing.project_id,
          expected_revision: briefing.project_revision,
          notes: [briefing.selection.notes,
            'Customer handover: the complete source responses, original monthly series and report files are retained together for reopening.']
            .filter(Boolean).join('\n\n') });
        need(result.project_id === briefing.project_id && result.project_revision === briefing.project_revision + 1,
          'OECD_ORIGINAL_EDITORIAL_REVISION_CHANGED');
        return result;
      });
      const revisedArtifacts = await step('revisedReportArtifacts', async () => {
        const target = join(folder, 'buyer-delivery', 'revised-briefing'); await privateDirectory(target, true);
        const files = [];
        for (const name of ['briefing.html', 'briefing.json', 'observations.csv']) {
          files.push(await exactFile(target, name, (await client.reportFile(revised.id, name)).body));
        }
        const rows = await client.sourceRows(revised.id);
        need(identity(rows.rows) === identity(sourceRows.rows) && rows.snapshot === sourceRows.snapshot,
          'OECD_EDITORIAL_REVISION_SOURCE_CHANGED');
        const packet = await exactFile(target, 'oecd-revised-original-project.zip',
          (await client.exportProject(revised.id)).body);
        return { briefingId: revised.id, directory: target, files, packet,
          projectRevision: revised.project_revision, sourceRows: rows.row_count,
          revisionKind: 'Editorial customer handover; original source observations unchanged.' };
      });
      await step('freshProjectReopen', async () => {
        const packet = await readPrivate(revisedArtifacts.packet.path, 128 * 1024 * 1024);
        need(digest(packet) === revisedArtifacts.packet.sha256, 'OECD_ORIGINAL_REVISED_PACKET_CHANGED');
        const reopenedDirectory = join(folder, 'reopened-customer-project');
        let create = false;
        try { await lstat(join(reopenedDirectory, 'oecd-project.json')); }
        catch (error) { if (error.code !== 'ENOENT') throw error; create = true; }
        const reopened = await launchOecd({ projectDirectory: reopenedDirectory, create, pythonCommand,
          env: { ...process.env, SF30_XML_NODE: process.execPath },
          providerUsernameEnv: config.providerUsernameEnv, providerPasswordEnv: config.providerPasswordEnv });
        try {
          const origin = await client.state(), destination = await reopened.client.state();
          need(destination.project.id !== origin.project.id &&
            resolve(destination.project.directory) === resolve(reopenedDirectory),
            'OECD_CUSTOMER_REOPEN_WORKSPACE_REQUIRED');
          const restored = await reopened.client.importProject(packet);
          need(restored.id === revised.id && restored.catalog_edition_id === revised.catalog_edition_id &&
            restored.project_id === revised.project_id && restored.project_revision === revised.project_revision &&
            identity(restored.report.files) === identity(revised.report.files),
            'OECD_ORIGINAL_PROJECT_REOPEN_CHANGED');
          const rows = await reopened.client.sourceRows(restored.id);
          need(identity(rows.rows) === identity(sourceRows.rows) && rows.snapshot === sourceRows.snapshot,
            'OECD_REOPENED_ORIGINAL_SOURCE_CHANGED');
          for (const name of ['briefing.html', 'briefing.json', 'observations.csv']) {
            const actual = (await reopened.client.reportFile(restored.id, name)).body;
            const expected = await readPrivate(join(revisedArtifacts.directory, name), 32 * 1024 * 1024);
            need(actual.equals(expected), 'OECD_REOPENED_ORIGINAL_REPORT_CHANGED');
          }
          return { directory: reopenedDirectory, workspaceId: destination.project.id,
            briefingId: restored.id, catalogEdition: restored.catalog_edition_id,
            projectId: restored.project_id, revision: restored.project_revision,
            files: restored.report.files, sourceRows: rows.row_count,
            packet: revisedArtifacts.packet, createdFresh: create,
            browser: { command: process.execPath,
              arguments: [new URL('./cli.mjs', import.meta.url).pathname, 'serve', '--project', reopenedDirectory] } };
        } finally { await reopened.close(); }
      });
      await step('provider', async () => {
        const capabilities = await client.provider('getcapabilities');
        const series = await client.provider('listseries');
        await exactFile(folder, 'provider-capabilities.json', bytes(capabilities));
        await exactFile(folder, 'provider-series.json', bytes(series));
        return { catalogEdition: briefing.catalog_edition_id, capabilities, series };
      });
      state.state = 'COMPLETE'; state.phase = 'complete'; delete state.error;
      await save();
      print({ operation: state.id, state: state.state, checkpoint: join(folder, 'receiving.json'),
        report: state.steps.reportArtifacts, delivery: state.steps.delivery,
        revisedReport: state.steps.revisedReportArtifacts, reopen: state.steps.freshProjectReopen });
      return state;
    } catch (error) {
      state.state = 'CONTINUE_ORIGINAL_OPERATION';
      state.error = { code: error.code ?? 'OECD_RECEIVING_INTERRUPTED', message: error.message, at: stamp() };
      await save(); print({ operation: state.id, phase: state.phase, error: state.error,
        checkpoint: join(folder, 'receiving.json') }); throw error;
    }
  } finally {
    try { await merchant?.close(); }
    finally { try { await unlock?.(); } finally { await launched.close(); } }
  }
}
export async function runOecdReceivingCli(args, { pythonCommand = 'python3' } = {}) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    need(['--project', '--config'].includes(args[i]) && args[i+1] && !options[args[i]], 'OECD_RECEIVING_ARGUMENTS');
    options[args[i]] = args[++i];
  }
  need(options['--project'] && options['--config'], 'OECD_RECEIVING_ARGUMENTS', 'Use --project DIR --config FILE');
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await receiveOecd({ projectDirectory: options['--project'], config: await readJson(resolve(options['--config']), 131072),
      pythonCommand, signal: controller.signal, print: value => process.stdout.write(JSON.stringify(value) + '\n') });
    return 0;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}

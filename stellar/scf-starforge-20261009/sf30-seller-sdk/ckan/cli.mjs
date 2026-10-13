#!/usr/bin/env node
// MIT. Native project, capture, publisher, and local UI commands.
import { resolve, dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openCkanWorkbench } from './model.mjs';
import { captureCkanResource, readCkanCapture, searchCkan } from './capture.mjs';
import { receivePublicSourceCapture } from './retained-public-source.mjs';
import { inspectCkanWorkspaceArchive, receiveCkanWorkspaceArchive } from './archive.mjs';
import { startCkanServer } from './server.mjs';
import { parseRemote, stringifyRemote } from './remote-json.mjs';
import { saveWorkbenchStartup } from './workbench-owner.mjs';
import { runDueCapturePlans, captureDueFailed } from './capture-plan-client.mjs';
import { readPrivate, createFile, privateDirectory, digest, fault } from '../postgres/publisher/files.mjs';

const usage = [
  'CKAN dataset merchant',
  '  ckan init --project DIR --origin https://catalog.example [--auth-token-env CKAN_TOKEN]',
  '  ckan serve --project DIR [--port 0] [--startup-file PRIVATE.json]',
  '  ckan search --origin https://catalog.example [--query TEXT] [--start 0] [--rows 20]',
  '  ckan capture --selection selection.json --out DIR',
  '  ckan capture-received --bundle FILE --bytes N --sha256 HASH --operation ID --selection selection.json --out DIR',
  '  ckan inspect-capture --capture DIR/capture.json',
  '  ckan import --project DIR --capture DIR/capture.json',
  '  ckan status --project DIR',
  '  ckan archive-workspace --project DIR [--out FILE.ckanw]',
  '  ckan inspect-workspace --archive FILE.ckanw [--sha256 HASH]',
  '  ckan receive-workspace --archive FILE.ckanw --project NEW_DIR --sha256 HASH',
  '  ckan edition --project DIR --id EDITION_ID',
  '  ckan compare --project DIR --before EDITION_ID --after EDITION_ID [--key _id]',
  '  ckan refresh-prepare --project DIR --id SOURCE_ID --input refresh.json',
  '  ckan refresh --project DIR --id REFRESH_ID',
  '  ckan refresh-preview --project DIR --id REFRESH_ID --input projection.json',
  '  ckan refresh-changes --project DIR --id REFRESH_ID --sha256 COMPARISON_HASH [--offset 0] [--limit 50]',
  '  ckan refresh-file --project DIR --id REFRESH_ID --sha256 COMPARISON_HASH',
  '  ckan refresh-review --project DIR --id REFRESH_ID --input decision.json',
  '  ckan refresh-resume --project DIR --id REFRESH_ID',
  '  ckan select --project DIR --id EDITION_ID --input selection.json',
  '  ckan prepare --project DIR --id SOURCE_ID --input publication.json',
  '  ckan inspect --project DIR --id PUBLICATION_ID [--query "physical_branch=1"]',
  '  ckan review --project DIR --id PUBLICATION_ID --input review.json',
  '  ckan recover --project DIR --id PUBLICATION_ID',
  '  ckan publish --project DIR --id PUBLICATION_ID --review-id REVIEW_ID',
  '  ckan export --project DIR --id PUBLICATION_ID --input merchant.json',
  '  ckan stage --project DIR --id EXPORT_ID --input release.json',
  '  ckan offer --project DIR --id EXPORT_ID --input buyer-query.json',
  '  ckan buyer --project DIR --id EXPORT_ID --input buyer-request.json',
  '  ckan resume --project DIR --id EDITION_ID [--input limits.json]',
  '  ckan remote-target-save --project DIR --input target.json',
  '  ckan remote-target --project DIR --id TARGET_ID',
  '  ckan remote-prepare --project DIR --input publication.json',
  '  ckan remote-inspect --project DIR --id RELEASE_ID',
  '  ckan remote-review --project DIR --id RELEASE_ID --input decision.json',
  '  ckan remote-publish --project DIR --id RELEASE_ID --sha256 PLAN_HASH --review-id REVIEW_ID',
  '  ckan remote-reconcile --project DIR --id RELEASE_ID',
  '  ckan remote-file --project DIR --id RELEASE_ID --kind plan|record|receipt [--receipt-id RECEIPT_ID]',
  '  ckan capture-plan-save --project DIR --input plan.json',
  '  ckan capture-plan --project DIR --id PLAN_ID [--offset 0] [--limit 50]',
  '  ckan capture-plan-preview --project DIR --input preview.json',
  '  ckan capture-plan-run --project DIR --input run.json',
  '  ckan capture-run --project DIR --id RUN_ID',
  '  ckan capture-run-resume --project DIR --id RUN_ID --sha256 INTENT_HASH',
  '  ckan capture-run-refresh --project DIR --id RUN_ID --input comparison.json',
  '  ckan capture-plan-file --project DIR --id PLAN_OR_RUN_ID --kind plan|run [--sha256 VERSION_HASH] [--out FILE.json]',
  '  ckan capture-due --project DIR [--startup-file PRIVATE.json] [--wait-ms 900000]',
  'All project mutations retain their result before exit. Serve opens the same original publisher workflow.',
].join('\n');
const print = (value, exact = false) => process.stdout.write((exact ? stringifyRemote(value) : JSON.stringify(value, null, 2)) + '\n');
export async function main(argv = process.argv.slice(2)) {
  const command = argv.shift(), options = {};
  for (let index = 0; index < argv.length; index += 2) {
    if (!/^--[a-z][a-z-]*$/.test(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith('--'))
      throw new Error('Use named --option value arguments.\n' + usage);
    const name = argv[index].slice(2);
    if (Object.hasOwn(options, name)) throw new Error('Duplicate option: ' + name);
    options[name] = argv[index + 1];
  }
  if (!command || command === 'help' || command === '--help') { process.stdout.write(usage + '\n'); return; }
  const exact = command.startsWith('remote-') || command.startsWith('capture-plan') ||
    command.startsWith('capture-run') || command === 'capture-due';
  const output = value => print(value, exact);
  const required = name => { if (!options[name]) throw new Error('Missing --' + name); return options[name]; };
  const input = async (name = 'input', optional = false) => !options[name] && optional ? {} :
    (exact ? parseRemote : JSON.parse)(await readFile(resolve(required(name)), 'utf8'));
  if (command === 'search') { output(await searchCkan(required('origin'), { q: options.query ?? '', start: Number(options.start ?? 0), rows: Number(options.rows ?? 20), authTokenEnv: options['auth-token-env'] })); return; }
  if (command === 'capture') { const result = await captureCkanResource(await input('selection'), resolve(required('out'))); output(result.manifest); return; }
  if (command === 'capture-received') {
    const result = await receivePublicSourceCapture({ bundleFile: resolve(required('bundle')),
      bundleBytes: Number(required('bytes')), bundleSha256: required('sha256'), operationId: required('operation'),
      selection: await input('selection'), captureDirectory: resolve(required('out')) });
    output({ ...result.locator, binding: result.binding, manifest: result.capture.manifest }); return;
  }
  if (command === 'inspect-capture') { const result = await readCkanCapture(resolve(required('capture'))); output({ manifest: result.manifest, sha256: result.manifestSha256, fields: result.fields, sample: result.rows.slice(0, 20) }); return; }
  if (command === 'inspect-workspace') { output(await inspectCkanWorkspaceArchive({ file: resolve(required('archive')), expectedSha256: options.sha256 })); return; }
  if (command === 'receive-workspace') { output(await receiveCkanWorkspaceArchive({ file: resolve(required('archive')), directory: resolve(required('project')), expectedSha256: required('sha256') })); return; }
  if (command === 'capture-due' && options['startup-file'] !== undefined) {
    const result = await runDueCapturePlans({startupFile: resolve(required('startup-file')),
      directory: resolve(required('project')), waitMs: Number(options['wait-ms'] ?? 900000)});
    output(result); if (captureDueFailed(result)) process.exitCode = 1; return;
  }
  const project = await openCkanWorkbench({ directory: resolve(required('project')), create: command === 'init',
    ...(command === 'init' ? { origin: required('origin'), authTokenEnv: options['auth-token-env'] } : {}) });
  let served = false;
  try {
    if (command === 'serve') {
      const web = await startCkanServer({ workbench: project, port: Number(options.port ?? 0) });
      let startup;
      try { startup = await saveWorkbenchStartup({project, web,
        ...(options['startup-file'] !== undefined ? {file: resolve(required('startup-file'))} : {})}); }
      catch (error) { await web.close(); throw error; }
      if (options['startup-file'] !== undefined) output(startup);
      else process.stdout.write('CKAN project: ' + web.url + '\n');
      served = true;
      let ending = false;
      const shutdown = async () => { if (ending) return; ending = true; await web.close(); await project.close(); };
      process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
      return { project, ...web, shutdown };
    }
    let result;
    if (command === 'init' || command === 'status') result = project.status();
    else if (command === 'archive-workspace') result = project.archiveWorkspace({ out: options.out });
    else if (command === 'import') result = project.importCapture(resolve(required('capture')));
    else if (command === 'edition') result = await project.edition(required('id'));
    else if (command === 'compare') result = await project.compare(required('before'), required('after'), options.key ?? '_id');
    else if (command === 'refresh-prepare') result = project.prepareRefresh(required('id'), await input());
    else if (command === 'refresh') result = await project.refresh(required('id'));
    else if (command === 'refresh-preview') result = await project.previewRefresh(required('id'), await input());
    else if (command === 'refresh-changes') result = await project.refreshChanges(required('id'), {
      expectedComparisonSha256: required('sha256'), offset: Number(options.offset ?? 0), limit: Number(options.limit ?? 50) });
    else if (command === 'refresh-file') result = await project.refreshChangesFile(required('id'), required('sha256'));
    else if (command === 'refresh-review') result = project.reviewRefresh(required('id'), await input());
    else if (command === 'refresh-resume') result = project.resumeRefresh(required('id'));
    else if (command === 'select') result = project.saveSource(required('id'), await input());
    else if (command === 'prepare') result = project.createPublication(required('id'), await input('input', true));
    else if (command === 'inspect') result = await project.publication(required('id'), options.query ?? '');
    else if (command === 'review') result = project.reviewPublication(required('id'), await input());
    else if (command === 'recover') result = project.recoverPublication(required('id'));
    else if (command === 'publish') result = project.publishDataset(required('id'), required('review-id'));
    else if (command === 'export') result = project.exportMerchant(required('id'), await input());
    else if (command === 'stage') result = project.stageMerchant(required('id'), await input());
    else if (command === 'offer') result = await project.buyerOffer(required('id'), await input());
    else if (command === 'buyer') result = project.prepareBuyer(required('id'), await input());
    else if (command === 'resume') result = project.resumeCapture(required('id'), await input('input', true));
    else if (command === 'capture-plan-save') result = project.saveCapturePlan(await input());
    else if (command === 'capture-plan') result = await project.capturePlan(required('id'), {
      offset: Number(options.offset ?? 0), limit: Number(options.limit ?? 50)});
    else if (command === 'capture-plan-preview') result = await project.previewCapturePlan(await input());
    else if (command === 'capture-plan-run') result = project.runCapturePlan(await input());
    else if (command === 'capture-run') result = await project.capturePlanRun(required('id'));
    else if (command === 'capture-run-resume') result = project.resumeCapturePlanRun(required('id'), {
      expectedIntentSha256: required('sha256')});
    else if (command === 'capture-run-refresh') result = await project.prepareCapturePlanRefresh(required('id'), await input());
    else if (command === 'capture-plan-file') {
      result = await project.capturePlanFile(required('id'), required('kind'), options.sha256);
      if (options.out) {
        const raw = await readPrivate(result.file, result.bytes);
        if (raw.length !== result.bytes || digest(raw) !== result.sha256)
          throw fault('CKAN_CAPTURE_FILE_CHANGED', 'The retained acquisition file changed during export.');
        const out = resolve(options.out);
        await privateDirectory(dirname(out)); await createFile(out, raw);
        result = {...result, out};
      }
    }
    else if (command === 'capture-due') {
      result = await runDueCapturePlans({project, directory: project.directory, waitMs: Number(options['wait-ms'] ?? 900000)});
      if (captureDueFailed(result)) process.exitCode = 1;
    }
    else if (command === 'remote-target-save') result = project.saveRemoteTarget(await input());
    else if (command === 'remote-target') result = await project.remoteTarget(required('id'));
    else if (command === 'remote-prepare') result = project.prepareRemotePublication(await input());
    else if (command === 'remote-inspect') result = await project.remotePublication(required('id'));
    else if (command === 'remote-review') result = project.reviewRemotePublication(required('id'), await input());
    else if (command === 'remote-publish') result = project.publishRemotePublication(required('id'), {
      expectedPlanSha256: required('sha256'), expectedReviewId: required('review-id') });
    else if (command === 'remote-reconcile') result = project.reconcileRemotePublication(required('id'));
    else if (command === 'remote-file') result = await project.remotePublicationFile(required('id'), required('kind'), options['receipt-id']);
    else throw new Error('Unknown command.\n' + usage);
    if (result?.completion) {
      result = await result.completion; output(result);
      if (result.state !== 'COMPLETE') process.exitCode = 1;
    } else output(result);
  } finally { if (!served) await project.close(); }
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href)
  main().catch(error => { process.stderr.write((error.code ?? 'CKAN_COMMAND_FAILED') + ': ' + error.message + '\n'); process.exitCode = 1; });


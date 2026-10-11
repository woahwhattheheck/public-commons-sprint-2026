#!/usr/bin/env node
// MIT. Native project, capture, publisher, and local UI commands.
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { openCkanWorkbench } from './model.mjs';
import { captureCkanResource, readCkanCapture, searchCkan } from './capture.mjs';
import { startCkanServer } from './server.mjs';

const usage = [
  'CKAN dataset merchant',
  '  ckan init --project DIR --origin https://catalog.example [--auth-token-env CKAN_TOKEN]',
  '  ckan serve --project DIR [--port 0]',
  '  ckan search --origin https://catalog.example [--query TEXT] [--start 0] [--rows 20]',
  '  ckan capture --selection selection.json --out DIR',
  '  ckan inspect-capture --capture DIR/capture.json',
  '  ckan import --project DIR --capture DIR/capture.json',
  '  ckan status --project DIR',
  '  ckan edition --project DIR --id EDITION_ID',
  '  ckan compare --project DIR --before EDITION_ID --after EDITION_ID [--key _id]',
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
  'All project mutations retain their result before exit. Serve opens the same original publisher workflow.',
].join('\n');
const output = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
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
  const required = name => { if (!options[name]) throw new Error('Missing --' + name); return options[name]; };
  const input = async (name = 'input', optional = false) => !options[name] && optional ? {} : JSON.parse(await readFile(resolve(required(name)), 'utf8'));
  if (command === 'search') { output(await searchCkan(required('origin'), { q: options.query ?? '', start: Number(options.start ?? 0), rows: Number(options.rows ?? 20), authTokenEnv: options['auth-token-env'] })); return; }
  if (command === 'capture') { const result = await captureCkanResource(await input('selection'), resolve(required('out'))); output(result.manifest); return; }
  if (command === 'inspect-capture') { const result = await readCkanCapture(resolve(required('capture'))); output({ manifest: result.manifest, sha256: result.manifestSha256, fields: result.fields, sample: result.rows.slice(0, 20) }); return; }
  const project = await openCkanWorkbench({ directory: resolve(required('project')), create: command === 'init',
    ...(command === 'init' ? { origin: required('origin'), authTokenEnv: options['auth-token-env'] } : {}) });
  let served = false;
  try {
    if (command === 'serve') {
      const web = await startCkanServer({ workbench: project, port: Number(options.port ?? 0) });
      process.stdout.write('CKAN project: ' + web.url + '\n'); served = true;
      let ending = false;
      const shutdown = async () => { if (ending) return; ending = true; await web.close(); await project.close(); };
      process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
      return { project, ...web, shutdown };
    }
    let result;
    if (command === 'init' || command === 'status') result = project.status();
    else if (command === 'import') result = project.importCapture(resolve(required('capture')));
    else if (command === 'edition') result = await project.edition(required('id'));
    else if (command === 'compare') result = await project.compare(required('before'), required('after'), options.key ?? '_id');
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
    else throw new Error('Unknown command.\n' + usage);
    if (result?.completion) {
      result = await result.completion; output(result);
      if (result.state !== 'COMPLETE') process.exitCode = 1;
    } else output(result);
  } finally { if (!served) await project.close(); }
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href)
  main().catch(error => { process.stderr.write((error.code ?? 'CKAN_COMMAND_FAILED') + ': ' + error.message + '\n'); process.exitCode = 1; });


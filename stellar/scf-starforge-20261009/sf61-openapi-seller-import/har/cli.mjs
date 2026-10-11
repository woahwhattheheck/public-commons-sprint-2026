#!/usr/bin/env node
// MIT. Original SF61 command extension; all capture processing is offline.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepare, inspectWorkspace, saveReview, exportReview, copyWorkspace, writeReviewPage } from './store.mjs';
import { renderReview } from './review.mjs';
const help = `Stellar Forge · HAR merchant source onboarding

  starforge openapi har prepare --har CAPTURE.har --out NEW_PRIVATE_WORKSPACE
  starforge openapi har inspect --workspace PRIVATE_WORKSPACE
  starforge openapi har review --workspace PRIVATE_WORKSPACE --out NEW_REVIEW.html [--revision SHA256]
  starforge openapi har save --workspace PRIVATE_WORKSPACE --decisions REVIEW.json
  starforge openapi har export --workspace PRIVATE_WORKSPACE --revision SHA256 --out NEW_DIRECTORY
  starforge openapi har copy --workspace PRIVATE_WORKSPACE --out NEW_PRIVATE_WORKSPACE
  starforge openapi har package --workspace PRIVATE_WORKSPACE --revision SHA256 --plan PLAN.json --parent PRIVATE_PARENT --name NAME

Source entrypoint: node sf61-openapi-seller-import/har/cli.mjs COMMAND ...
The source capture never leaves this process. Keep it and the workspace private.
The offline page writes a downloadable decision file; save returns its immutable revision.
Exported openapi.json enters the EXISTING SF61 merchant workspace as the original backend source.
Choose the separate public seller URL, exact payment terms and backend references there.
The package command delegates an explicit native merchant plan to the SAME savePackage implementation.
Capture-derived shapes are observations; review the provider contract before live deployment.
`;
export async function runHarCLI(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help' || args[0] === 'help') { process.stdout.write(help); return; }
  const [command, ...rest] = args;
  const allowed = {
    prepare: ['--har', '--out'], inspect: ['--workspace'], review: ['--workspace', '--out', '--revision'],
    package: ['--workspace', '--revision', '--plan', '--parent', '--name'],
    save: ['--workspace', '--decisions'], export: ['--workspace', '--revision', '--out'], copy: ['--workspace', '--out'],
  };
  if (!allowed[command]) throw new Error('Unknown HAR command. Use har --help.');
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = rest[i];
    if (!allowed[command].includes(k) || !rest[i + 1] || rest[i + 1].startsWith('--') || Object.hasOwn(options, k))
      throw new Error('Unknown, repeated or missing HAR option. Use har --help.');
    options[k] = rest[i + 1];
  }
  for (const k of allowed[command]) if (!(command === 'review' && k === '--revision') && !options[k]) throw new Error('Missing ' + k);
  let result;
  if (command === 'prepare') result = await prepare(options['--har'], options['--out']);
  else if (command === 'inspect') result = await inspectWorkspace(options['--workspace']);
  else if (command === 'review') result = await writeReviewPage(options['--workspace'], options['--out'], renderReview, options['--revision']);
  else if (command === 'save') result = await saveReview(options['--workspace'], options['--decisions']);
  else if (command === 'export') result = await exportReview(options['--workspace'], options['--revision'], options['--out']);
  else if (command === 'copy') result = await copyWorkspace(options['--workspace'], options['--out']);
  else if (command === 'package') result = await (await import('./merchant.mjs')).saveHarMerchant({workspace:options['--workspace'],revision:options['--revision'],planFile:options['--plan'],parent:options['--parent'],name:options['--name']});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runHarCLI().catch(e => { process.stderr.write(e.message + '\n'); process.exitCode = 1; });

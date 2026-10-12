// MIT. Complete capture-edition refresh using the original HAR and merchant engines.
import {
  prepareRefresh, inspectRefresh, writeRefreshPage, saveRefreshReview,
  exportRefresh, packageRefresh, copyRefresh,
} from './refresh.mjs';

const help = [
  'Stellar Forge · Captured API refresh',
  '',
  '  starforge openapi har refresh prepare --workspace PREVIOUS_WORKSPACE --revision PREVIOUS_SHA256 --har NEW_CAPTURE.har --out NEW_PRIVATE_PACKET',
  '  starforge openapi har refresh inspect --directory PRIVATE_PACKET',
  '  starforge openapi har refresh review --directory PRIVATE_PACKET --out NEW_REVIEW.html [--revision CANDIDATE_SHA256]',
  '  starforge openapi har refresh save --directory PRIVATE_PACKET --decisions REVIEW.json',
  '  starforge openapi har refresh export --directory PRIVATE_PACKET --revision CANDIDATE_SHA256 --out NEW_DIRECTORY',
  '  starforge openapi har refresh package --directory PRIVATE_PACKET --revision CANDIDATE_SHA256 --plan PLAN.json --parent PRIVATE_PARENT --name NAME',
  '  starforge openapi har refresh copy --directory PRIVATE_PACKET --out NEW_PRIVATE_PACKET',
  '',
  'A packet retains previous/ and candidate/ as original private HAR workspaces.',
  'Open review.html, review observed changes and save downloaded decisions to the same packet.',
  'Unchanged contracts retain their authored decisions; changed observations reopen review.',
  'Export and package delegate to the original SF61 source and merchant implementations.',
  'For another capture, use this packet candidate/ and its chosen saved revision as the next --workspace.',
  '',
].join('\n');

export async function runRefreshCLI(args = process.argv.slice(2)) {
  if (!args.length || ['help', '--help'].includes(args[0])) { process.stdout.write(help); return; }
  const [command, ...rest] = args;
  const allowed = {
    prepare: ['--workspace', '--revision', '--har', '--out'],
    inspect: ['--directory'], review: ['--directory', '--out', '--revision'],
    save: ['--directory', '--decisions'], export: ['--directory', '--revision', '--out'],
    package: ['--directory', '--revision', '--plan', '--parent', '--name'],
    copy: ['--directory', '--out'],
  };
  if (!Object.hasOwn(allowed, command)) throw new Error('Unknown HAR refresh command. Use har refresh --help.');
  const options = Object.create(null);
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i];
    if (!allowed[command].includes(key) || !rest[i + 1] || rest[i + 1].startsWith('--') || Object.hasOwn(options, key))
      throw new Error('Unknown, repeated or missing HAR refresh option. Use har refresh --help.');
    options[key] = rest[i + 1];
  }
  for (const key of allowed[command])
    if (!(command === 'review' && key === '--revision') && !options[key]) throw new Error('Missing ' + key);
  let result;
  if (command === 'prepare') result = await prepareRefresh({
    workspace: options['--workspace'], revision: options['--revision'], harFile: options['--har'], destination: options['--out'],
  });
  else if (command === 'inspect') result = await inspectRefresh(options['--directory']);
  else if (command === 'review') result = await writeRefreshPage(options['--directory'], options['--out'], options['--revision']);
  else if (command === 'save') result = await saveRefreshReview(options['--directory'], options['--decisions']);
  else if (command === 'export') result = await exportRefresh(options['--directory'], options['--revision'], options['--out']);
  else if (command === 'package') result = await packageRefresh({
    directory: options['--directory'], revision: options['--revision'], planFile: options['--plan'],
    parent: options['--parent'], name: options['--name'],
  });
  else if (command === 'copy') result = await copyRefresh(options['--directory'], options['--out']);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

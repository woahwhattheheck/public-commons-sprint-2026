// MIT. Original NocoDB publication -> retained SF82 deployment and client console.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readPrivate, fault } from '../postgres/publisher/files.mjs';
import { openNocoDBPublisher } from './publisher/model.mjs';
import { reviewNocoDBDeployment, prepareNocoDBDeployment, inspectNocoDBDeployment, stageNocoDBDeployment } from './deployment.mjs';

const HELP = 'NocoDB deployment from one originally published capture\n\n' +
  '  review --publisher PRIVATE_PUBLISHER --run ORIGINAL_RUN_ID --terms PRIVATE_TERMS.json\n' +
  '  prepare --publisher PRIVATE_PUBLISHER --run ORIGINAL_RUN_ID --terms PRIVATE_TERMS.json --review REVIEW_SHA256 --out PRIVATE_PACKAGE\n' +
  '  inspect --package PRIVATE_PACKAGE\n' +
  '  stage --package PRIVATE_PACKAGE --store PRIVATE_RELEASE_STORE --id RELEASE_ID --source SOURCE_SHA256 [--label LABEL] [--runtime PRIVATE_RUNTIME.json]\n' +
  '  console --store PRIVATE_RELEASE_STORE --client-exports PRIVATE_CLIENT_EXPORTS [original console options]\n\n' +
  'Review and prepare use the original candidate, review, publication and complete capture.\n' +
  'Stage reuses the original release ID on an identical request. It makes no provider call.\n' +
  'The original SF82 console manages start, readiness, activation, pinning, rollback, stop and client exports.\n';
async function readJson(filename) {
  let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readPrivate(resolve(filename), 65536))); }
  catch (issue) { if (issue.code) throw issue; throw fault('NOCODB_DEPLOYMENT_INPUT_INVALID'); }
  return value;
}
export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(HELP); return; }
  if (argv[0] === 'console') return (await import('../../sf82-seller-pilot/release-cli.mjs')).main(argv);
  const [command, ...args] = argv;
  const definitions = {
    review: ['--publisher', '--run', '--terms'],
    prepare: ['--publisher', '--run', '--terms', '--review', '--out'],
    inspect: ['--package'], stage: ['--package', '--store', '--id', '--source', '--label', '--runtime']
  };
  const allowed = definitions[command], options = {};
  if (!allowed) throw fault('NOCODB_DEPLOYMENT_COMMAND_REQUIRED', HELP);
  for (let index = 0; index < args.length; index++) {
    if (!allowed.includes(args[index]) || Object.hasOwn(options, args[index]) || !args[index + 1] || args[index + 1].startsWith('--'))
      throw fault('NOCODB_DEPLOYMENT_OPTION_INVALID', HELP);
    options[args[index]] = args[++index];
  }
  const required = command === 'stage' ? allowed.filter(key => !['--label', '--runtime'].includes(key)) : allowed;
  if (required.some(key => !options[key])) throw fault('NOCODB_DEPLOYMENT_OPTIONS_REQUIRED', HELP);
  let result, publisher;
  try {
    if (command === 'review' || command === 'prepare') {
      publisher = await openNocoDBPublisher({ directory: resolve(options['--publisher']) });
      const input = { publisher, runId: options['--run'], terms: await readJson(options['--terms']) };
      result = command === 'review' ? await reviewNocoDBDeployment(input) :
        await prepareNocoDBDeployment({ ...input, expectedReviewSha256: options['--review'], directory: resolve(options['--out']) });
    }
    if (command === 'inspect') result = await inspectNocoDBDeployment(resolve(options['--package']));
    if (command === 'stage') result = await stageNocoDBDeployment({
      packageDirectory: resolve(options['--package']), releaseDirectory: resolve(options['--store']), id: options['--id'],
      ...(options['--label'] ? { label: options['--label'] } : {}), expectedSourceSha256: options['--source'],
      runtime: options['--runtime'] ? await readJson(options['--runtime']) : { port: 0 } });
  } finally { await publisher?.close(); }
  process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write((issue.code ?? 'NOCODB_DEPLOYMENT') + ': ' +
    (issue.code ? issue.message : 'Review the original private deployment inputs.') + '\n'); process.exitCode = 1; });

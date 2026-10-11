// MIT. Maintained local extraction, review, publication and buyer handoff command.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openPostgresPublisher } from './model.mjs';
import { startPostgresPublisherServer } from './server.mjs';
import { openPostgresSchedule } from './schedule.mjs';
import { bytes, readJson, createFile, fault } from './files.mjs';

const HELP = `PostgreSQL retained dataset publisher (Linux, Node 22.16+, util-linux flock)

  serve --workspace DIR [--create --source FILE --state DATASET_DIR] [--port 8442]
        [--seller http://127.0.0.1:PORT --resource https://merchant.example/data]
  init --workspace NEW_DIR --source FILE --state DATASET_DIR
  source --workspace DIR
  template --workspace DIR --query NAME --out NEW_PLAN.json
  save --workspace DIR --input REVIEWED_PLAN.json
  extract --workspace DIR --plan NUMBER
  status --workspace DIR [--limit 25 --plans-offset N --runs-offset N --history-offset N]
  inspect --workspace DIR --run ID [--query 'limit=20']
  review --workspace DIR --run ID --reviewer NAME --note TEXT
         (--expect SNAPSHOT --expect-revision NUMBER | --initialize)
  publish --workspace DIR --run ID --review REVIEW_ID
  recover --workspace DIR --run ID
  buyer --workspace DIR --run ID --seller LOCAL_ORIGIN --resource HTTPS_RESOURCE
        [--query QUERY] [--intent ID --option NUMBER --offer-sha HASH]
  schedule --workspace DIR [--limit 25 --history-offset N]
  schedule-save --workspace DIR --input POLICY.json --revision NUMBER
  schedule-enable --workspace DIR --revision NUMBER --expect SNAPSHOT --expect-revision NUMBER
  schedule-pause --workspace DIR --revision NUMBER
  schedule-run --workspace DIR --revision NUMBER [--request UUID]
  schedule-continue --workspace DIR --revision NUMBER

Plans retain the original source configuration and environment references, not credentials.
Extraction never changes the target. Review and publish are separate explicit actions.
Publication uses the original live dataset control and its exact current/revision pair.
Initialize creates a new original version store; use the original configure/serve commands.
Buyer without --intent reads actual terms. With --intent it writes an original SF88 config.
The browser has the same workflow. Stop it before opening this workspace with another CLI.
Saved schedules run only while serve owns this workspace. See SCHEDULES.md for the complete
plan/row-limit policy, target reconciliation, retained native run and restart behavior.`;
const ALL = ['--workspace', '--source', '--state', '--port', '--create', '--query', '--out', '--input',
  '--plan', '--run', '--reviewer', '--note', '--expect', '--expect-revision', '--initialize', '--review',
  '--seller', '--resource', '--intent', '--option', '--offer-sha',
  '--limit', '--plans-offset', '--runs-offset', '--history-offset', '--revision', '--request'];
function parse(argv, help = HELP) {
  const [command, ...args] = argv, options = {};
  if (!['serve', 'init', 'source', 'template', 'save', 'extract', 'status', 'inspect', 'review', 'publish', 'recover', 'buyer',
    'schedule', 'schedule-save', 'schedule-enable', 'schedule-pause', 'schedule-run', 'schedule-continue'].includes(command))
    throw fault('COMMAND_REQUIRED', help);
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!ALL.includes(key) || Object.hasOwn(options, key)) throw fault('INVALID_OPTION', key);
    if (['--create', '--initialize'].includes(key)) { options[key] = true; continue; }
    if (!args[index + 1] || args[index + 1].startsWith('--')) throw fault('OPTION_VALUE_REQUIRED', key);
    options[key] = args[++index];
  }
  if (!options['--workspace']) throw fault('WORKSPACE_REQUIRED');
  if (options['--create'] && command !== 'serve') throw fault('CREATE_IS_FOR_SERVE');
  return { command, options };
}
const number = (value, fallback) => {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) throw fault('INTEGER_OPTION_REQUIRED');
  return Number(value);
};
const required = (options, key) => { if (!options[key]) throw fault('OPTION_REQUIRED', key); return options[key]; };
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

async function scheduleCommand(publisher, command, options) {
  let schedule;
  try {
    schedule = await openPostgresSchedule({ publisher });
    const revision = command === 'schedule' ? null : number(required(options, '--revision'));
    let result;
    if (command === 'schedule') result = schedule.status({
      limit: number(options['--limit']), offset: number(options['--history-offset']) });
    if (command === 'schedule-save') result = await schedule.configure({
      ...await readJson(resolve(required(options, '--input'))), revision });
    if (command === 'schedule-enable') result = await schedule.enable({ revision,
      expectedSnapshot: required(options, '--expect'), expectedRevision: number(required(options, '--expect-revision')) });
    if (command === 'schedule-pause') result = await schedule.pause({ revision });
    if (command === 'schedule-run') result = await schedule.runNow({ revision, requestId: options['--request'] }).completion;
    if (command === 'schedule-continue') result = await schedule.continueRun({ revision }).completion;
    print(result); return result;
  } finally { try { await schedule?.close(); } finally { await publisher.close(); } }
}

export async function main(argv = process.argv.slice(2), { openPublisher = openPostgresPublisher,
  sourceName = 'PostgreSQL', defaultPort = 8442 } = {}) {
  const help = HELP.replaceAll('PostgreSQL', sourceName).replaceAll('8442', String(defaultPort));
  if (argv.length === 1 && argv[0] === '--help') { process.stdout.write(help + '\n'); return; }
  const { command, options } = parse(argv, help);
  const publisher = await openPublisher({ directory: resolve(options['--workspace']),
    create: command === 'init' || options['--create'] === true,
    sourceFile: options['--source'] ? resolve(options['--source']) : undefined,
    targetDirectory: options['--state'] ? resolve(options['--state']) : undefined,
    seller: options['--seller'] ?? null, resource: options['--resource'] ?? null });
  if (command.startsWith('schedule')) return scheduleCommand(publisher, command, options);
  if (command === 'serve') {
    try {
      const service = await startPostgresPublisherServer({ publisher, port: number(options['--port'], defaultPort) });
      print({ url: service.url, workspace: publisher.directory, source: publisher.settings.sourceFile,
        target: publisher.settings.targetDirectory });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => service.close().catch(() => { process.exitCode = 1; }));
      return service;
    } catch (issue) { await publisher.close(); throw issue; }
  }
  try {
    let output;
    if (command === 'init' || command === 'status') output = publisher.status({
      limit: number(options['--limit']), plansOffset: number(options['--plans-offset']),
      runsOffset: number(options['--runs-offset']), historyOffset: number(options['--history-offset']) });
    if (command === 'source') output = await publisher.source();
    if (command === 'template') {
      const source = await publisher.source(), query = required(options, '--query'), item = source.queries[query];
      if (!item) throw fault('QUERY_NOT_FOUND');
      const value = { title: query + ' snapshot', query, input: {}, sourceHash: source.hash,
        dataset: { name: query, columns: Object.fromEntries(item.columns.map(name => [name, { type: 'string', nullable: false }])),
          filters: [], ranges: [], sorts: [], defaultLimit: 50, maxLimit: 250 },
        extraction: { order: [{ column: item.columns[0], direction: 'asc' }], maxRows: 250000,
          maxBytes: 67108864, maxRowBytes: 1048576, timeoutMs: 30000 } };
      const path = resolve(required(options, '--out')); await createFile(path, bytes(value)); output = { created: path };
    }
    if (command === 'save') output = await publisher.savePlan(await readJson(resolve(required(options, '--input'))));
    if (command === 'extract') output = await publisher.startExtraction(number(required(options, '--plan'))).completion;
    if (command === 'inspect') output = await publisher.inspect(required(options, '--run'), options['--query']);
    if (command === 'review') output = await publisher.review(required(options, '--run'), {
      reviewer: required(options, '--reviewer'), note: required(options, '--note'), initialize: options['--initialize'] === true,
      expectedSnapshot: options['--expect'], expectedRevision: number(options['--expect-revision']) });
    if (command === 'publish') output = await publisher.publish(required(options, '--run'), required(options, '--review'));
    if (command === 'recover') output = await publisher.recover(required(options, '--run'));
    if (command === 'buyer') output = options['--intent'] ? await publisher.prepareBuyer(required(options, '--run'), {
      query: options['--query'] ?? '', intentId: options['--intent'], acceptIndex: number(required(options, '--option')),
      offerSha256: required(options, '--offer-sha') }) : await publisher.buyerOffer(required(options, '--run'), options['--query'] ?? '');
    print(output); return output;
  } finally { await publisher.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(issue => { process.stderr.write(`${issue.code ?? 'PUBLISHER'}: ${issue.code ? issue.message : 'Operation failed; inspect the selected inputs.'}\n`); process.exitCode = 1; });

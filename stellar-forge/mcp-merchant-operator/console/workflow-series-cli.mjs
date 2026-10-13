#!/usr/bin/env node
// MIT. Recurring customer work, original native runs and complete receiving.
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { MerchantWorkflowSeriesClient, writeWorkflowSeriesFile } from './workflow-series-client.mjs';
import { reopenWorkflowSeriesHandover } from './workflow-series-handover.mjs';
import { exportWorkflowInstallation } from './workflow-installation-handover.mjs';
import { fail } from './records.mjs';

const HELP = [
  'starforge merchant-workflow-series COMMAND --url http://127.0.0.1:PORT/operator/ [options]',
  '',
  'Original profiles: host, profiles, profile, profile-save, bind, profile-export, profile-import',
  'Recurring work: list, series, save, calendar, agenda, agenda-calendar, prepare, plan, start-prepare, start, cycle, cancel',
  'Original execution: run, resume, pause, resolve, handover',
  'Whole customer receiving: capture, receive, reopen, installation',
  '',
  '--input FILE          Complete original JSON request, saved review or profile',
  '--output FILE         New private output filename; identical completed retries reopen',
  '--id ID               Original series, cycle, run or profile ID',
  '--profile ID          Original profile for list or capture',
  '--revision N          Exact series edition for series',
  '--from YYYY-MM-DD     First due date for agenda or agenda-calendar',
  '--to YYYY-MM-DD       Last due date (up to 366 days in one window)',
  '--today YYYY-MM-DD    Calendar date used for overdue work; defaults to UTC today',
  '--query TEXT          Search customer, task, series or source',
  '--status STATE        open (default), all, PROPOSED, PLANNED, READY, RUNNING,',
  '                      PAUSED, WAITING, COMPLETE or CANCELLED',
  '--no-overdue          Exclude earlier overdue saved periods',
  '--no-proposals        Show only saved original periods',
  '--offset N            Cycle history page offset, default 0',
  '--limit N             Cycle history page size, default 50, maximum 100',
  '--directory PATH      One private complete customer handover directory',
  '--delivery ID         Customer delivery to capture; repeat for selected deliveries',
  '--python PATH         Original installed Python for Installation source packaging',
  '--token-env NAME      Original Console bearer environment variable; default MCP_ACCESS_TOKEN',
  '--wait                Wait for the original active native work to settle',
  '--timeout-ms N        Maximum wait, default 120000',
  '',
  'prepare saves every cycle input, source selection and native request for review.',
  'plan reads that same complete file and saves the immutable customer period.',
  'start-prepare saves the current host review. start reads the same file and',
  'starts or reopens its one original native run. Repeat the same saved request',
  'after a lost response. Continue pause, recovery and handover with the native',
  'run controls; use a new period key for an explicitly different customer task.',
  '',
  'capture keeps profile.json, the exact selected customer files and handover.json.',
  'Its first snapshot is retained across retries. By default it includes every',
  'COMPLETE customer delivery local to this Console. --delivery selects exact IDs.',
  'receive opens the whole directory and imports the profile through its original',
  'Console API. reopen reads the same complete customer files offline; no URL needed.',
  'Use a new directory to capture a later completed period or changed source.',
  'installation --directory PATH --input selection.json --output FILE.zip receives',
  'the complete original profile, native reports and customer files for Grant',
  'Operations. Input is {periods:[{cycleId,deliveryIds:[]}]}; keep explicit original',
  'cycle and customer delivery identities. This command needs no Console URL.',
  ''
].join('\n');
const COMMANDS = new Set(['host','profiles','profile','profile-save','bind','profile-export','profile-import',
  'list','series','save','calendar','agenda','agenda-calendar','prepare','plan','start-prepare','start','cycle','cancel',
  'run','resume','pause','resolve','handover','capture','receive','reopen','installation']);
async function readInput(path, maximum = 32 * 1024 * 1024) {
  if (typeof path !== 'string' || !path) throw fail('CONSOLE_SERIES_INPUT_FILE', 'Select the complete original JSON file with --input.', 400);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size > maximum) throw fail('CONSOLE_SERIES_INPUT_FILE', 'Read a complete regular JSON file within its original capacity.', 400);
    const bytes = await handle.readFile(), after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw fail('CONSOLE_SERIES_INPUT_FILE', 'The selected original JSON changed during reading.', 409);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally { await handle.close(); }
}
function receivingSummary(value) {
  return { state: value.state, directory: value.directory, profileId: value.profileId, contentSha256: value.contentSha256,
    files: value.files, customers: value.manifest.customers.map(customer => ({ id: customer.id, files: customer.files.length })),
    otherDeliveries: value.manifest.otherDeliveries, ...(value.imported ? { imported: value.imported } : {}) };
}
export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    python: { type: 'string' }, url: { type: 'string' }, input: { type: 'string' }, output: { type: 'string' }, id: { type: 'string' },
    profile: { type: 'string' }, revision: { type: 'string' }, offset: { type: 'string' }, limit: { type: 'string' },
    directory: { type: 'string' }, delivery: { type: 'string', multiple: true }, 'token-env': { type: 'string' },
    from: { type: 'string' }, to: { type: 'string' }, today: { type: 'string' }, query: { type: 'string' }, status: { type: 'string' },
    'no-overdue': { type: 'boolean', default: false }, 'no-proposals': { type: 'boolean', default: false },
    wait: { type: 'boolean', default: false }, 'timeout-ms': { type: 'string' }, help: { type: 'boolean', default: false }
  } });
  if (values.help) { process.stdout.write(HELP); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !COMMANDS.has(command))
    throw fail('CONSOLE_SERIES_COMMAND', 'Choose one recurring-work command; use --help for the complete workflow.', 400);
  if (['prepare','start-prepare','profile-export','installation','agenda-calendar'].includes(command) && !values.output)
    throw fail('CONSOLE_SERIES_OUTPUT', 'Retain this complete original review or profile with --output before continuing.', 400);
  const client = ['reopen','installation'].includes(command) ? null : new MerchantWorkflowSeriesClient({
    url: values.url, tokenEnv: values['token-env'] ?? 'MCP_ACCESS_TOKEN'
  });
  const waiting = { timeoutMs: Number(values['timeout-ms'] ?? 120000) };
  let result, outputWritten = false;
  try {
    switch (command) {
      case 'host': result = await client.host(); break;
      case 'profiles': result = await client.profiles(); break;
      case 'profile': result = await client.profile(values.id); break;
      case 'profile-save': result = await client.createProfile(await readInput(values.input)); break;
      case 'bind': result = await client.bindProfile(await readInput(values.input)); break;
      case 'list': result = await client.list(values.profile ?? values.id); break;
      case 'series': result = await client.series(values.id, { offset: Number(values.offset ?? 0), limit: Number(values.limit ?? 50),
        ...(values.revision === undefined ? {} : { revision: Number(values.revision) }) }); break;
      case 'save': result = await client.saveSeries(await readInput(values.input)); break;
      case 'calendar': result = await client.calendar(await readInput(values.input)); break;
      case 'agenda': case 'agenda-calendar': {
        const query = values.input ? await readInput(values.input) : {
          profileId: values.profile ?? values.id, from: values.from, to: values.to,
          ...(values.today === undefined ? {} : { today: values.today }),
          query: values.query ?? '', status: values.status ?? 'open',
          includeOverdue: !values['no-overdue'], includeProposed: !values['no-proposals'],
          offset: Number(values.offset ?? 0), limit: Number(values.limit ?? 50)
        };
        if (command === 'agenda') result = await client.agenda(query);
        else {
          const calendar = await client.agendaCalendar(query);
          const file = await writeWorkflowSeriesFile(values.output, Buffer.from(calendar.content, 'utf8'));
          result = { file, events: calendar.events, query: calendar.query, generatedAt: calendar.generatedAt };
          outputWritten = true;
        }
        break;
      }
      case 'prepare': result = await client.prepareCycle(await readInput(values.input)); break;
      case 'plan': result = await client.saveCycle(await readInput(values.input)); break;
      case 'start-prepare': result = await client.prepareStart(values.id); break;
      case 'start': {
        const original = await readInput(values.input); result = await client.startCycle(original);
        if (values.wait) result = await client.waitCycle(result.cycle.id, waiting);
        break;
      }
      case 'cycle': result = values.wait ? await client.waitCycle(values.id, waiting) : await client.cycle(values.id); break;
      case 'cancel': result = await client.cancelCycle(await readInput(values.input)); break;
      case 'run': result = values.wait ? await client.console.waitRun(values.id, waiting) : await client.run(values.id); break;
      case 'resume': case 'pause': case 'resolve': case 'handover': {
        const request = await readInput(values.input); result = await client[command](request);
        if (values.wait && command === 'resume') result = await client.console.waitRun(request.id, waiting);
        break;
      }
      case 'profile-export': {
        const packet = await client.exportProfile(values.id);
        const file = await writeWorkflowSeriesFile(values.output, packet.bytes);
        result = { profileId: packet.archive.profile.id, contentSha256: packet.archive.contentSha256, file };
        outputWritten = true; break;
      }
      case 'profile-import': result = await client.importProfile(await readInput(values.input, 128 * 1024 * 1024)); break;
      case 'capture': result = receivingSummary(await client.capture({
        profileId: values.profile ?? values.id, directory: values.directory,
        ...(values.delivery === undefined ? {} : { deliveryIds: values.delivery })
      })); break;
      case 'receive': result = receivingSummary(await client.receive({ directory: values.directory })); break;
      case 'reopen': result = receivingSummary(await reopenWorkflowSeriesHandover({ directory: values.directory })); break;
      case 'installation': result = await exportWorkflowInstallation({directory:values.directory,input:await readInput(values.input),
        output:values.output,...(values.python?{python:values.python}:{})}); outputWritten=true; break;
    }
    if (values.output && !outputWritten) {
      const file = await writeWorkflowSeriesFile(values.output, result);
      process.stdout.write(JSON.stringify({ file }, null, 2) + '\n');
    } else process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { client?.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {
    process.stderr.write(JSON.stringify({ code: error.code ?? 'CONSOLE_SERIES_ERROR', reason: error.message,
      ...(error.outcomeUnknown ? { outcomeUnknown: true } : {}) }) + '\n');
    process.exitCode = 1;
  });

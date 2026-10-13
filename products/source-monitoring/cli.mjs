#!/usr/bin/env node
// MIT. Complete operator commands for the original open monitoring workspace.
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { MonitoringClient, MonitoringError, GET_OPERATIONS, POST_OPERATIONS,
  readJsonInput, writeReply } from './client.mjs';

const HELP = [
  'Source monitoring operator client',
  '',
  'Use the original private connection written by Applications or:',
  '  starforge source-monitoring --python PYTHON --workspace WORKSPACE serve',
  '    --startup-format json --connection-file CONNECTION',
  '',
  'starforge source-monitoring-client --connection CONNECTION COMMAND',
  'starforge source-monitoring-client customer-setup --help',
  'starforge source-monitoring-client customer-receive --help',
  '',
  '  inspect                                      Read the current native identity',
  '  get OPERATION [--params JSON_FILE]            Read the original console',
  '  post OPERATION --input JSON_FILE             Apply an exact original operation',
  '  upload --file FILE [--name NAME] [--media MIME] [--source-url URL]',
  '  edition --input JSON_FILE                    Receive metadata and flat FtM files',
  '  portfolio --input JSON_FILE                  Receive original counterparties',
  '  statements --input JSON_FILE                 Receive original statement CSV',
  '  update --input JSON_FILE                     Receive the complete selected delta chain',
  '  response --input JSON_FILE                   Attach an existing native response',
  '  import --file ZIP                            Receive the complete customer workspace',
  '  export --out ZIP                             Download the complete customer workspace',
  '  download object|source --id SHA256 --out FILE Download an original retained file',
  '  download review-exchange --id ID --role ROLE --out FILE [--sha256 SHA]',
  '',
  'Global: --timeout-ms INTEGER --expected-workspace PATH --expected-binding SHA256',
  'JSON replies: --response-out FILE saves the exact full response bytes.',
  'File paths in edition/portfolio/statements/update/response selections resolve',
  'relative to that selection file. Native post bodies are forwarded unchanged.',
  '',
  'Read operations: ' + GET_OPERATIONS.join(', '),
  'Write operations: ' + POST_OPERATIONS.join(', '),
].join('\n') + '\n';
function need(condition, message) {
  if (!condition) throw new MonitoringError('MONITORING_CLI_INPUT', message);
}
function emit(value) {
  const raw = value?.raw instanceof Uint8Array ? Buffer.from(value.raw) :
    Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
  process.stdout.write(raw);
  if (!raw.length || raw.at(-1) !== 10) process.stdout.write('\n');
  return { raw };
}
export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'customer-setup') return (await import('./customer-setup.mjs')).customerSetupMain(argv.slice(1));
  if (argv[0] === 'customer-receive') return (await import('./receiving/customer-agent.mjs')).main(argv.slice(1));
  if (!argv.length || argv.includes('--help') || argv[0] === 'help') {
    process.stdout.write(HELP);
    return 0;
  }
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, strict: true,
    options: Object.fromEntries([
      'connection', 'timeout-ms', 'expected-workspace', 'expected-binding',
      'params', 'input', 'file', 'name', 'media', 'source-url', 'out', 'id', 'response-out', 'role', 'sha256',
    ].map(name => [name, { type: 'string' }])) });
  need(typeof values.connection === 'string', 'Select the original --connection file.');
  const [command, operation, ...rest] = positionals;
  need(command && !rest.length, 'Choose one complete client command.');
  const global = new Set(['connection', 'timeout-ms', 'expected-workspace', 'expected-binding', 'response-out']);
  const used = new Set(global);
  const take = (key, required = false) => {
    used.add(key);
    if (required) need(typeof values[key] === 'string' && values[key].length > 0, 'Supply --' + key + '.');
    return values[key];
  };
  const client = new MonitoringClient({
    connectionFile: values.connection,
    ...(values['timeout-ms'] === undefined ? {} : { timeoutMs: Number(values['timeout-ms']) }),
    ...(values['expected-workspace'] === undefined ? {} : { expectedWorkspace: values['expected-workspace'] }),
    ...(values['expected-binding'] === undefined ? {} : { expectedBindingSha256: values['expected-binding'] }),
  });
  const select = async () => {
    const path = resolve(take('input', true));
    const body = JSON.parse((await readJsonInput(path)).toString('utf8'));
    const selectedPath = value => {
      need(typeof value === 'string' && value.length > 0, 'Select each original input file.');
      return resolve(dirname(path), value);
    };
    if (command === 'edition') {
      body.metadataFile = selectedPath(body.metadataFile);
      body.entitiesFile = selectedPath(body.entitiesFile);
    } else if (command === 'update') {
      body.indexFile = selectedPath(body.indexFile);
      need(Array.isArray(body.deltas), 'Select every original required delta.');
      body.deltas = body.deltas.map(entry => ({ ...entry, file: selectedPath(entry.file) }));
    } else body.file = selectedPath(body.file);
    return body;
  };
  let execute;
  if (command === 'inspect') {
    need(operation === undefined, 'inspect does not take an operation name.');
    execute = () => client.inspect();
  } else if (command === 'get') {
    need(GET_OPERATIONS.includes(operation), 'Choose an original read operation from help.');
    const parameters = take('params');
    execute = async () => client.get(operation, parameters ?
      JSON.parse((await readJsonInput(parameters)).toString('utf8')) : {});
  } else if (command === 'post') {
    need(POST_OPERATIONS.includes(operation), 'Choose an original write operation from help.');
    const input = take('input', true);
    execute = async () => client.post(operation, await readJsonInput(input));
  } else if (command === 'upload') {
    need(operation === undefined, 'upload selects its original --file.');
    const file = take('file', true), name = take('name'), media = take('media'), sourceUrl = take('source-url');
    execute = () => client.upload(file, { ...(name === undefined ? {} : { name }),
      ...(media === undefined ? {} : { media }), ...(sourceUrl === undefined ? {} : { sourceUrl }) });
  } else if (['edition', 'portfolio', 'statements', 'update', 'response'].includes(command)) {
    need(operation === undefined, 'This receiving command selects one --input JSON file.');
    take('input', true);
    const method = { edition: 'receiveEdition', portfolio: 'receivePortfolio',
      statements: 'receiveStatements', update: 'receiveUpdate', response: 'receiveResponse' }[command];
    execute = async () => client[method](await select());
  } else if (command === 'import') {
    need(operation === undefined, 'import selects its complete --file ZIP.');
    const file = take('file', true);
    execute = () => client.receiveArchive(file);
  } else if (command === 'export' || command === 'download') {
    if (command === 'export') need(operation === undefined, 'export selects the complete workspace.');
    else need(['object', 'source', 'review-exchange'].includes(operation), 'download selects object, source or review-exchange.');
    const output = take('out', true), id = command === 'download' ? take('id', true) : undefined;
    const role = operation === 'review-exchange' ? take('role', true) : undefined;
    const expectedSha256 = take('sha256');
    execute = () => client.download(command === 'export' ? 'workspace' : operation,
      { output, ...(id === undefined ? {} : { id }), ...(role === undefined ? {} : { role }),
        ...(expectedSha256 === undefined ? {} : { expectedSha256 }) });
  } else {
    need(false, 'Unknown client command. Use source-monitoring-client help.');
  }
  need(Object.keys(values).every(key => used.has(key)), 'An option does not belong to this command.');
  try {
    const result = await execute();
    const reply = emit(result);
    if (values['response-out']) await writeReply(values['response-out'], reply);
    return 0;
  } finally { await client.close(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().then(code => { process.exitCode = code; }).catch(error => {
    process.stderr.write(JSON.stringify(error instanceof MonitoringError ? error.toJSON() :
      { error: error.code ?? error.name, message: error.message }) + '\n');
    process.exitCode = 1;
  });

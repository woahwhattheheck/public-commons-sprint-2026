#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, rename, unlink } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requestEngagement, normalizeDestinationConfig } from './wordpress.mjs';

const MAX_JSON = 34 * 1024 * 1024;
const sha = body => createHash('sha256').update(body).digest('hex');
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const fail = message => { throw new Error(message); };
const help = `CSKT native engagement operator

All destination commands reuse the existing WordPress destination JSON and its
env: or private file: application-password reference.

node destination/engagement.mjs COMMAND --config /private/wordpress.json [OPTIONS]

Commands:
  inspect                      Current native forms, capabilities and mail setup
  parents [--search TEXT]      Existing project, notice, page or news bindings
  staff                        Assignable native staff directory
  forms | entries | mail      Native collection; --all traverses every page
  form | entry | message      Read one record (--id UUID)
  save-form                   Save complete definition (--input JSON)
  decide                      Submission decision (--id UUID --input JSON)
  mail-decision               Draft, cancel, copy or reconcile (--id UUID --input JSON)
  send-mail                   Send saved native message (--id UUID --input JSON)
  export                      Complete selected forms (--input JSON --out JSON)
  export-csv                  Operational CSV (--input JSON --out CSV)
  receive-preview             Review a transfer (--input JSON --out JSON)
  receive                     Apply retained preview (--input JSON --out JSON)
  operation                   Save a new UUID for use in one retained JSON request
  help

Collection filters: --form-id UUID --state STATE --mode TYPE --search TEXT
                   --after N (one page) --all (complete collection)
All commands accept --out FILE. Output files are private and atomically replaced.
Mutations require their retained operationId UUID; edits also require the current
expectedRevision. Exact input replay returns the original operation.
See destination/ENGAGEMENT.md for the full staff and receiving workflow.
`;
function options(argv) {
  const command = argv.shift() || 'help';
  const values = {};
  while (argv.length) {
    const key = argv.shift();
    if (!key.startsWith('--')) fail('Use named --options after the command.');
    const name = key.slice(2);
    if (Object.hasOwn(values, name)) fail('An option may appear only once: ' + key);
    if (name === 'all') { values[name] = true; continue; }
    const value = argv.shift();
    if (value === undefined || value.startsWith('--')) fail('An option needs its value: ' + key);
    values[name] = value;
  }
  const allowed = ['config','input','out','id','search','page','form-id','state','mode','after','all'];
  for (const key of Object.keys(values)) if (!allowed.includes(key)) fail('Unknown option: --' + key);
  return { command, values };
}
async function json(path) {
  if (!path) fail('Provide the complete --input JSON path.');
  const handle = await open(resolve(path), 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_JSON) fail('Use a regular JSON file of at most 34 MiB.');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_JSON) fail('The JSON file exceeds 34 MiB.');
    return JSON.parse(bytes.toString('utf8'));
  } finally { await handle.close(); }
}
async function save(path, bytes) {
  const destination = resolve(path);
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = destination + '.partial-' + randomUUID();
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, destination);
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return { path: destination, bytes: bytes.length, sha256: sha(bytes) };
}
function integer(value, name, minimum = 0) {
  if (!/^d+$/.test(String(value))) fail(name + ' needs a complete nonnegative integer.');
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < minimum) fail(name + ' is outside its supported range.');
  return n;
}
function id(value) {
  if (!UUID.test(value || '')) fail('Use the complete original --id UUID.');
  return value;
}
function mutation(command, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Use a complete JSON request object.');
  if (!UUID.test(body.operationId || '')) fail('Retain one operationId UUID in the original input JSON.');
  if (command !== 'receive' && !Number.isSafeInteger(body.expectedRevision)) fail('Retain the current expectedRevision in the original input JSON.');
  return body;
}
function filters(values) {
  const result = new URLSearchParams();
  for (const [option, key] of [['form-id','formId'],['state','state'],['mode','mode'],['search','search']]) {
    if (values[option] !== undefined) result.set(key, values[option]);
  }
  if (values.after !== undefined) result.set('after', integer(values.after, '--after'));
  return result;
}
export async function run(argv = process.argv.slice(2)) {
  const { command, values } = options([...argv]);
  if (values.out && [values.input, values.config].filter(Boolean).some(path => resolve(path) === resolve(values.out))) fail('Keep the output separate from its retained input and destination configuration.');
  if (command === 'help' || command === '--help') { process.stdout.write(help); return; }
  let result;
  if (command === 'operation') {
    result = { operationId: randomUUID() };
  } else {
    if (!values.config) fail('Select the original --config WordPress destination JSON.');
    const config = normalizeDestinationConfig(await json(values.config));
    if (['inspect','staff'].includes(command)) result = await requestEngagement(config, '/' + command);
    else if (command === 'parents') {
      const q = new URLSearchParams();
      if (values.search !== undefined) q.set('search', values.search);
      if (values.page !== undefined) q.set('page', integer(values.page, '--page', 1));
      result = await requestEngagement(config, '/parents?' + q);
    } else if (['forms','entries','mail'].includes(command)) {
      const q = filters(values);
      if (values.all && values.after !== undefined) fail('Choose --all from the start, or one --after page.');
      if (!values.all) result = await requestEngagement(config, '/' + command + '?' + q);
      else {
        const items = []; const seen = new Set(); let after = 0;
        do {
          q.set('after', after);
          const page = await requestEngagement(config, '/' + command + '?' + q);
          if (!Array.isArray(page.items) || !Object.hasOwn(page, 'next')) fail('The native collection page is incomplete.');
          for (const item of page.items) {
            if (!item.data?.id || seen.has(item.data.id)) fail('The native collection repeated a record; reopen its current complete export.');
            seen.add(item.data.id); items.push(item);
          }
          if (page.next !== null && (!Number.isSafeInteger(page.next) || page.next < 1 || (after && page.next >= after))) fail('The native collection cursor did not advance.');
          after = page.next;
        } while (after !== null);
        result = { items, next: null, complete: true };
      }
    } else if (['form','entry','message'].includes(command)) {
      const collection = { form: 'forms', entry: 'entries', message: 'mail' }[command];
      result = await requestEngagement(config, '/' + collection + '/' + id(values.id));
    } else {
      const endpoints = {
        'save-form': '/forms', decide: '/entries/' + (values.id ? id(values.id) : '') + '/decide',
        'mail-decision': '/mail/' + (values.id ? id(values.id) : '') + '/decide',
        'send-mail': '/mail/' + (values.id ? id(values.id) : '') + '/send',
        export: '/export', 'export-csv': '/export-csv', 'receive-preview': '/receive/preview', receive: '/receive/apply'
      };
      if (!Object.hasOwn(endpoints, command)) fail('Unknown command. Run help for the native operator commands.');
      if (['decide','mail-decision','send-mail'].includes(command)) id(values.id);
      if (['export','export-csv','receive-preview','receive'].includes(command) && !values.out) fail('Use --out to retain this complete private result.');
      const body = await json(values.input);
      if (['save-form','decide','mail-decision','send-mail','receive'].includes(command)) mutation(command, body);
      result = await requestEngagement(config, endpoints[command], { method: 'POST', body });
      if (command === 'export-csv') {
        if (typeof result.content !== 'string') fail('The native CSV response is incomplete.');
        const bytes = Buffer.from(result.content, 'utf8');
        if (bytes.length !== result.bytes || sha(bytes) !== result.sha256) fail('The CSV bytes differ from their original native identity.');
        const saved = await save(values.out, bytes);
        process.stdout.write(JSON.stringify({ ...saved, rows: result.rows, filename: result.filename }) + '
');
        return;
      }
    }
  }
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '
', 'utf8');
  if (values.out) process.stdout.write(JSON.stringify(await save(values.out, bytes)) + '
');
  else process.stdout.write(bytes);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error => {
    process.stderr.write(JSON.stringify({ error: error.code || error.name || 'engagement_error', message: error.message, status: error.status || null }) + '
');
    process.exitCode = 1;
  });
}

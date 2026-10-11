// MIT. Read the private capability locally; never place it in arguments or URLs.
import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: node control.mjs status --state PRIVATE_DIRECTORY
       node control.mjs prepare --state PRIVATE_DIRECTORY --manifest FILE --expect REVISION
       node control.mjs activate --state PRIVATE_DIRECTORY --candidate ID --expect REVISION
       node control.mjs rollback --state PRIVATE_DIRECTORY --expect REVISION [--revision RETAINED_REVISION]`;

export async function fleetControl(directory, action, payload = {}) {
  const path = join(resolve(directory), 'control.json');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let control;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) || stat.size > 4096)
      throw new Error('FLEET_PRIVATE_CONTROL_FILE_REQUIRED');
    control = JSON.parse(readFileSync(fd, 'utf8'));
  } finally { closeSync(fd); }
  if (control?.schema !== 'stellar-forge.fleet-control.v1' ||
      !/^[A-Za-z0-9_-]{43}$/.test(control.token ?? '') ||
      !/^[a-f0-9-]{36}$/.test(control.instance ?? '') ||
      typeof control.url !== 'string') throw new Error('FLEET_CONTROL_FILE_INVALID');
  const endpoint = new URL(control.url);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port ||
      endpoint.username || endpoint.password || endpoint.pathname !== '/' || endpoint.search || endpoint.hash)
    throw new Error('FLEET_LOOPBACK_CONTROL_REQUIRED');
  if (!['status', 'prepare', 'activate', 'rollback'].includes(action)) throw new Error(USAGE);
  const bytes = action === 'status' ? null : Buffer.from(JSON.stringify(payload));
  if (bytes && bytes.length > 16 * 1024) throw new Error('FLEET_CONTROL_BODY_LIMIT');
  return new Promise((done, fail) => {
    const call = request({ hostname: '127.0.0.1', port: Number(endpoint.port),
      method: bytes ? 'POST' : 'GET', path: '/_fleet/' + (action === 'status' ? 'health' : action),
      headers: { authorization: 'Bearer ' + control.token, 'x-fleet-instance': control.instance,
        ...(bytes ? { 'content-type': 'application/json', 'content-length': bytes.length } : {}) } }, response => {
      const chunks = []; let length = 0;
      response.on('data', chunk => {
        length += chunk.length;
        if (length > 1024 * 1024) response.destroy(new Error('FLEET_CONTROL_RESPONSE_LIMIT'));
        else chunks.push(chunk);
      });
      response.on('error', fail);
      response.on('end', () => {
        try {
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (response.statusCode !== 200)
            throw Object.assign(new Error(result.error ?? 'FLEET_CONTROL_FAILED'), { status: response.statusCode });
          done(result);
        } catch (error) { fail(error); }
      });
    });
    const timer = setTimeout(() => call.destroy(new Error('FLEET_CONTROL_TIMEOUT')), 30000);
    call.once('close', () => clearTimeout(timer));
    call.on('error', fail); call.end(bytes);
  });
}

export async function run(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') return { usage: USAGE };
  const [action, ...rest] = args, options = new Map();
  for (let i = 0; i < rest.length; i += 2) {
    const name = rest[i];
    if (!['--state', '--manifest', '--expect', '--candidate', '--revision'].includes(name) ||
        options.has(name) || !rest[i + 1] || rest[i + 1].startsWith('--')) throw new Error(USAGE);
    options.set(name, rest[i + 1]);
  }
  const accepted = { status: ['--state'], prepare: ['--state', '--manifest', '--expect'],
    activate: ['--state', '--candidate', '--expect'], rollback: ['--state', '--expect', '--revision'] }[action];
  if (!accepted || !options.has('--state') || [...options.keys()].some(key => !accepted.includes(key)))
    throw new Error(USAGE);
  const revision = flag => {
    const raw = options.get(flag);
    if (!/^[1-9]\d*$/.test(raw ?? '') || !Number.isSafeInteger(Number(raw))) throw new Error(USAGE);
    return Number(raw);
  };
  const payload = action === 'status' ? {} : { expectedRevision: revision('--expect') };
  if (action === 'prepare') {
    if (!options.has('--manifest')) throw new Error(USAGE);
    payload.manifestPath = resolve(options.get('--manifest'));
  }
  if (action === 'activate') {
    if (!options.has('--candidate')) throw new Error(USAGE);
    payload.candidateId = options.get('--candidate');
  }
  if (options.has('--revision')) payload.targetRevision = revision('--revision');
  return fleetControl(options.get('--state'), action, payload);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n'))
    .catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
}

#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import crypto from 'node:crypto';

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index], value = process.argv[index + 1];
  if (!['--env-file', '--env-name', '--output'].includes(name) || !value) throw Error('Use --env-file FILE --output FILE [--env-name APP_RPC_URL]');
  if (name in options) throw Error('Duplicate option');
  options[name] = value;
}
if (!options['--env-file'] || !options['--output']) throw Error('Select the environment and output files');
const selected = options['--env-name'] || 'APP_RPC_URL';
const values = fs.readFileSync(options['--env-file'], 'utf8').split(/\r?\n/).flatMap(line => {
  const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
  if (!match || match[1] !== selected) return [];
  const input = match[2].trim();
  if (input.startsWith("'")) {
    const quoted = input.match(/^'([^']*)'\s*(?:#.*)?$/);
    if (!quoted) throw Error('Use a complete single-line literal endpoint');
    return [quoted[1]];
  }
  if (input.startsWith('"')) {
    const quoted = input.match(/^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/);
    if (!quoted) throw Error('Use a complete single-line literal endpoint');
    return [JSON.parse(quoted[1])];
  }
  return [input.replace(/\s+#.*$/, '').trim()];
});
if (values.length !== 1 || !values[0] || values[0].includes('$')) throw Error('Select one literal endpoint binding');
const endpoint = new URL(values[0]);
if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash) throw Error('Use the selected HTTPS endpoint');
const responses = [];
async function rpc(method, params) {
  const request = {jsonrpc:'2.0', id:'application-' + (responses.length + 1), method, params};
  const body = Buffer.from(JSON.stringify(request));
  const raw = await new Promise((resolve, reject) => {
    const req = https.request(endpoint, {method:'POST', headers:{'content-type':'application/json', 'content-length':body.length}}, response => {
      if (response.statusCode !== 200) { response.resume(); reject(Error('Application HTTP status ' + response.statusCode)); return; }
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 1048576) { response.destroy(Error('Application response exceeds one MiB')); } else chunks.push(chunk); });
      response.on('error', reject);
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(15000, () => req.destroy(Error('Application RPC timeout')));
    req.on('error', reject);
    req.end(body);
  });
  const envelope = JSON.parse(raw);
  if (envelope.jsonrpc !== '2.0' || envelope.id !== request.id || envelope.error || !('result' in envelope)) throw Error('Application RPC did not return its matching result');
  responses.push({request, responseUtf8:raw.toString('utf8'), responseSha256:crypto.createHash('sha256').update(raw).digest('hex')});
  return envelope.result;
}
const genesis = await rpc('chain_getBlockHash', [0]);
const finalizedHash = await rpc('chain_getFinalizedHead', []);
const header = await rpc('chain_getHeader', [finalizedHash]);
const runtimeVersion = await rpc('state_getRuntimeVersion', [finalizedHash]);
const result = {client:'node', endpointHost:endpoint.hostname, genesis, finalizedHash, header, runtimeVersion, responses};
const output = path.resolve(options['--output']);
fs.mkdirSync(path.dirname(output), {recursive:true, mode:0o700});
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', {flag:'wx', mode:0o600});
process.stdout.write(JSON.stringify({client:'node', endpointHost:endpoint.hostname, genesis, finalizedHash, height:Number(BigInt(header.number))}) + '\n');

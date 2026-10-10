// One focused offline source-integration check. No network or payment calls.
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importOpenApi } from './importer.mjs';
import { run } from './cli.mjs';
const spec = JSON.parse(await readFile(new URL('./openapi.example.json', import.meta.url)));
const selections = JSON.parse(await readFile(new URL('./selections.example.json', import.meta.url)));
const result = importOpenApi(spec, selections);
const [get, post] = result.offers;
assert.equal(get.seller.resource.url, 'https://weather.example/api/v1/forecast/Louisville');
assert.equal(get.seller.extensions.bazaar.routeTemplate, '/api/v1/forecast/:city');
assert.deepEqual(get.seller.extensions.bazaar.info.input.pathParams, { city: 'Louisville' });
assert.equal(get.seller.extensions.bazaar.info.input.queryParams.days, 3);
assert.equal(post.seller.resource.url, 'https://weather.example/api/v2/forecast');
assert.deepEqual(post.seller.extensions.bazaar.info.input.body, { latitude: 38.25, longitude: -85.76 });
assert.deepEqual(JSON.parse(Buffer.from(get.response.headers['PAYMENT-REQUIRED'], 'base64')), get.seller);
assert.equal(result.resourcesRegistered, 0);

const missing = structuredClone(spec);
missing.paths['/forecast'].post.requestBody.content['application/json'].example = { latitude: 1 };
assert.throws(() => importOpenApi(missing, selections), /INFO_SCHEMA_MISMATCH/);
const badQuery = structuredClone(spec);
badQuery.paths['/forecast/{city}'].get.parameters[0].example = 8;
assert.throws(() => importOpenApi(badQuery, selections), /INFO_SCHEMA_MISMATCH/);
const badPath = structuredClone(spec);
badPath.components.parameters.City.schema.maxLength = 2;
assert.throws(() => importOpenApi(badPath, selections), /INFO_SCHEMA_MISMATCH/);
const auth = structuredClone(spec); auth.security = [{ apiKey: [] }];
assert.throws(() => importOpenApi(auth, selections), /additional authentication/);
auth.paths['/forecast/{city}'].get.security = [];
auth.paths['/forecast'].post.security = [{}];
assert.equal(importOpenApi(auth, selections).offers.length, 2);
const semantic = structuredClone(spec);
semantic.paths['/forecast'].post.requestBody.content['application/json'].schema.required = ['extra'];
assert.throws(() => importOpenApi(semantic, selections), /Semantic schema \$ref siblings/);

const temp = await mkdtemp(join(tmpdir(), 'sf61-import-'));
try {
  const out = join(temp, 'offers');
  await run(['--spec', fileURLToPath(new URL('./openapi.example.json', import.meta.url)),
    '--config', fileURLToPath(new URL('./selections.example.json', import.meta.url)), '--out', out]);
  const disk = JSON.parse(await readFile(join(out, 'offers.json')));
  assert.deepEqual(disk, result);
  assert.equal(JSON.parse(await readFile(join(out, 'manifest.json'))).operations.length, 2);
} finally { await rm(temp, { recursive: true, force: true }); }
process.stdout.write('SF61 acceptance passed: original SF30 compilation, SF25 schema acceptance, OpenAPI inheritance and CLI export.\n');

// Two integrated journeys through the real importer, seller compiler and validator.
// Run: node --test openapi30-acceptance.mjs (Node 22+, no installs/network).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { run } from './cli.mjs';
import { importOpenApi } from './importer.mjs';
import { adaptOpenApi30Schema } from './schema-compat.mjs';
import { validateBazaarExtension } from '../../../stellar-forge/payment-auto-catalog/schema-validation.mjs';

const selections = [{ method: 'POST', path: '/quote/{sku}', accepts: [{
  scheme: 'exact', network: 'stellar:testnet', amount: '1',
  asset: 'TEST_ONLY_ASSET', payTo: 'TEST_ONLY_RECIPIENT', maxTimeoutSeconds: 60,
}] }];
const schema = () => ({ type: 'object', properties: {
  units: { type: 'integer', minimum: 0, exclusiveMinimum: true, maximum: 10, exclusiveMaximum: true, example: 2 },
  note: { type: 'string', nullable: true, enum: ['ok', null], example: null },
  opaque: { type: 'object', additionalProperties: true, example: { nullable: true, minimum: 0, exclusiveMinimum: true, $ref: 'literal-data' } },
}, required: ['units', 'note', 'opaque'], additionalProperties: false });
const document = () => ({ openapi: '3.0.4', info: { title: 'Offline acceptance', version: '1' },
  servers: [{ url: 'https://seller.example.invalid/api' }],
  components: {
    schemas: { Body: schema() },
    parameters: { Sku: { name: 'sku', in: 'path', required: true, schema: { type: 'string', example: 'A B' } } },
  }, paths: { '/quote/{sku}': { parameters: [{ $ref: '#/components/parameters/Sku' }],
    post: { operationId: 'quote', requestBody: { required: true, content: { 'application/json': {
      schema: { $ref: '#/components/schemas/Body', nullable: true },
    } } } },
  } },
});
const extensionOf = doc => importOpenApi(doc, selections).offers[0].seller.extensions.bazaar;

test('3.0 seller onboarding preserves examples, refs, nullability and numeric boundaries', async () => {
  const doc = document(), original = structuredClone(doc);
  const result = importOpenApi(doc, selections), offer = result.offers[0];
  assert.deepEqual(doc, original);
  assert.equal(result.openapiVersion, '3.0.4');
  assert.equal(result.paymentsInitiated, 0);
  assert.equal(result.resourcesRegistered, 0);
  assert.equal(offer.seller.resource.url, 'https://seller.example.invalid/api/quote/A%20B');
  assert.equal(offer.seller.extensions.bazaar.routeTemplate, '/api/quote/:sku');
  const ext = offer.seller.extensions.bazaar;
  const body = ext.schema.properties.input.properties.body;
  // 3.0 Reference Object siblings do not make the referenced body nullable.
  assert.equal(body.type, 'object');
  assert.deepEqual(body.properties.note.type, ['string', 'null']);
  assert.deepEqual(ext.info.input.body.opaque, schema().properties.opaque.example);
  assert.equal(body.properties.units.exclusiveMinimum, 0);
  assert.equal(body.properties.units.exclusiveMaximum, 10);
  assert.equal(Object.hasOwn(body.properties.units, 'minimum'), false);
  assert.deepEqual(validateBazaarExtension(ext), { ok: true });
  const wire = JSON.parse(Buffer.from(offer.response.headers['PAYMENT-REQUIRED'], 'base64').toString('utf8'));
  assert.deepEqual(wire, offer.seller);
  for (const units of [-1, 0, 10, 11]) {
    const rejected = structuredClone(ext); rejected.info.input.body.units = units;
    assert.equal(validateBazaarExtension(rejected).ok, false);
  }
  for (const units of [1, 9]) {
    const accepted = structuredClone(ext); accepted.info.input.body.units = units;
    assert.equal(validateBazaarExtension(accepted).ok, true);
  }
  const noNull = document(); noNull.components.schemas.Body.properties.note.enum = ['ok'];
  assert.throws(() => extensionOf(noNull), /INFO_SCHEMA_MISMATCH/);
  // nullable without a local type has no effect, and cannot loosen composition.
  assert.deepEqual(adaptOpenApi30Schema({ nullable: true, allOf: [{ type: 'string' }] }), { allOf: [{ type: 'string' }] });
  assert.deepEqual(adaptOpenApi30Schema({ type: 'number', minimum: 0, exclusiveMinimum: false }), { type: 'number', minimum: 0 });
  const temp = await mkdtemp(join(tmpdir(), 'sf61-openapi30-'));
  try {
    const spec = join(temp, 'spec.json'), config = join(temp, 'config.json'), out = join(temp, 'offers');
    await writeFile(spec, JSON.stringify(doc)); await writeFile(config, JSON.stringify(selections));
    const args = ['--spec', spec, '--config', config, '--out', out];
    const manifest = await run(args);
    assert.deepEqual(JSON.parse(await readFile(join(out, 'offers.json'))), result);
    assert.deepEqual(JSON.parse(await readFile(join(out, 'manifest.json'))), manifest);
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(manifest.schemaCompatibilitySha256, sha(await readFile(new URL('./schema-compat.mjs', import.meta.url))));
    assert.equal(manifest.validatorSha256, sha(await readFile(new URL('../../../stellar-forge/payment-auto-catalog/schema-validation.mjs', import.meta.url))));
    await assert.rejects(run(args), /EEXIST/);
  } finally { await rm(temp, { recursive: true, force: true }); }

});

test('3.1 parity and malformed/unsupported schema rejection keep original constraints', () => {
  const modern = document(); modern.openapi = '3.1.0';
  const body = modern.components.schemas.Body;
  body.properties.units = { type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10, example: 2 };
  body.properties.note = { type: ['string', 'null'], enum: ['ok', null], example: null };
  delete modern.paths['/quote/{sku}'].post.requestBody.content['application/json'].schema.nullable;
  assert.deepEqual(extensionOf(modern), extensionOf(document()));
  for (const invalid of [
    { type: ['string', 'null'] }, { type: 'null' }, { type: 'string', nullable: 'true' },
    { type: 'number', minimum: 0, exclusiveMinimum: 0 },
    { type: 'number', exclusiveMaximum: true }, { const: 2 },
  ]) assert.throws(() => adaptOpenApi30Schema(invalid), TypeError);
  for (const invalid of [true, '0', null, Infinity]) {
    const ext = extensionOf(modern);
    ext.schema.properties.input.properties.body.properties.units.exclusiveMinimum = invalid;
    assert.equal(validateBazaarExtension(ext).ok, false);
  }
  const auth = document(); auth.security = [{ apiKey: [] }];
  assert.throws(() => extensionOf(auth), /additional authentication/);
  const remote = document(); remote.components.schemas.Body = { $ref: 'https://example.invalid/schema.json' };
  assert.throws(() => extensionOf(remote), /document-local/);
  const unsupported = document(); unsupported.components.schemas.Body.properties.units.multipleOf = 2;
  assert.throws(() => extensionOf(unsupported), /SCHEMA_KEYWORD_UNSUPPORTED:multipleOf/);
});

// MIT. One joined original importer -> customer package -> native Python operation.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { importOpenApi } from '../../../sf61-openapi-seller-import/importer.mjs';
import { compileSellerRoutes } from '../../resource-server.mjs';
import { compileSellerOpenApi } from '../../developer-portal.mjs';
import { encodeMultipart } from '../../multipart.mjs';
import { inspectSellerClientExport } from '../client-export.mjs';
import { exportPythonSellerClient, copyPythonSellerClient, completePythonSellerClient,
  inspectPythonSellerClient } from './export.mjs';

const directory = await mkdtemp(join(tmpdir(), 'starforge-python-customer-'));
try {
  const document = JSON.parse(await readFile(new URL('../../../sf61-openapi-seller-import/openapi.example.json', import.meta.url)));
  const item = { parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string', example: 'A01' } }] };
  for (const method of ['get', 'head', 'delete', 'put', 'patch']) item[method] = {
    operationId: 'item_' + method, summary: method + ' item',
    ...(['put', 'patch'].includes(method) ? { requestBody: { required: true, content: { 'application/json': {
      schema: { type: 'object', properties: { title: { type: 'string' }, units: { type: 'integer' } },
        required: ['title'], additionalProperties: false }, example: { title: 'sample', units: 2 } } } } } : {}),
    responses: { '200': { description: 'Original response' } },
  };
  document.paths['/items/{sku}'] = item;
  document.paths['/upload'] = { post: { operationId: 'upload', summary: 'Retained multipart bytes', requestBody: {
    required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: {
      label: { type: 'string' }, attachment: { type: 'string', format: 'binary' } },
      required: ['label', 'attachment'], additionalProperties: false }, example: { label: 'sample', attachment: 'sample' } } } },
    responses: { '200': { description: 'Uploaded' } } } };
  document.paths['/optional'] = { post: { operationId: 'optional', summary: 'Optional body', requestBody: {
    required: false, content: { 'application/json': { schema: { type: 'object', properties: {}, additionalProperties: false }, example: {} } } },
    responses: { '200': { description: 'Accepted' } } } };
  const options = [
    { scheme: 'exact', network: 'stellar:testnet', amount: '9007199254740993', asset: 'DEMO_NONPAYABLE_ASSET', payTo: 'DEMO_NONPAYABLE_RECIPIENT', maxTimeoutSeconds: 61 },
    { scheme: 'exact', network: 'stellar:testnet', amount: '27', asset: 'DEMO_ALTERNATIVE_ASSET', payTo: 'DEMO_ALTERNATIVE_RECIPIENT', maxTimeoutSeconds: 73 },
  ];
  const selections = [];
  for (const [path, item] of Object.entries(document.paths)) for (const method of Object.keys(item))
    if (['get', 'head', 'delete', 'post', 'put', 'patch'].includes(method))
      selections.push({ method: method.toUpperCase(), path, serviceName: 'Python customer journey', accepts: options });
  const imported = importOpenApi(document, selections);
  const compiled = compileSellerRoutes(imported.offers.map(value => ({ id: value.operationId, offer: value.seller, handler: async () => ({ body: {} }) })));
  const openapi = join(directory, 'seller-openapi.json');
  await writeFile(openapi, JSON.stringify(compileSellerOpenApi(compiled), null, 2) + '\n');
  const original = await exportPythonSellerClient({ openapi, out: join(directory, 'customer') });
  const receiver = join(directory, 'receiver');
  await mkdir(receiver); await copyFile(join(original.directory, 'seller-client.mjs'), join(receiver, 'seller-client.mjs'));
  const copied = await copyPythonSellerClient({ directory: original.directory, out: receiver, resume: true });
  assert.equal(copied.manifestSha256, original.manifestSha256);
  const jsDigest = (await inspectSellerClientExport({ directory: receiver })).manifestFile.sha256;
  await unlink(join(receiver, 'python-client.json')); await unlink(join(receiver, 'seller_client.pyi'));
  await completePythonSellerClient({ directory: receiver });
  assert.equal((await inspectSellerClientExport({ directory: receiver })).manifestFile.sha256, jsDigest);
  const form = encodeMultipart({ fields: { label: 'native upload' }, files: [{ field: 'attachment', filename: 'input.bin',
    contentType: 'application/octet-stream', bytes: Buffer.from(Array.from({ length: 250013 }, (_, index) => index % 256)) }] });
  await writeFile(join(directory, 'upload.body'), form.raw);
  const script = String.raw`
from hashlib import sha256
import json, pathlib, subprocess, sys, tempfile
from seller_client import SellerClient, SellerClientError
from stellar_forge_buyer import Buyer
from stellar_forge_buyer.errors import StateError
context = json.loads(sys.stdin.buffer.read())
root = pathlib.Path(context['directory'])
api = SellerClient(root/'customer')
buyer = Buyer(checkout=context['source'], state_dir=root/'buyer')
inputs = {
 'cityForecast': {'path': {'city':'Québec City'}, 'query': {'days':['1','3']}},
 'coordinateForecast': {'body': {'latitude':38.25, 'longitude':-85.76}},
 'item_get': {'path': {'sku':'A & B'}}, 'item_head': {'path': {'sku':'head'}},
 'item_delete': {'path': {'sku':'delete'}},
 'item_put': {'path': {'sku':'put'}, 'body': {'title':'native ✓', 'units':9007199254740991}},
 'item_patch': {'path': {'sku':'patch'}, 'body': {'title':'partial'}},
 'upload': {'multipart': {'body':(root/'upload.body').read_bytes(), 'contentType':context['contentType']}},
 'optional': {'omitBody':True},
}
rows = []
for index,(name,values) in enumerate(inputs.items()):
    bound = api.build_request(name, values, intent_id='customer-'+name, accept_index=index%2,
                             max_atomic='27' if index%2 else '9007199254740993')
    loaded = api.load_request(bound.save(root/('request-'+name)))
    assert loaded.body == bound.body and loaded.describe() == bound.describe()
    operation = api.prepare(buyer, loaded)
    review = operation.review()
    assert review.native['acceptedTerms'] == bound.describe()['request']['expect']
    assert review.body_sha256 == sha256(bound.body or b'').hexdigest()
    reopened = SellerClient(root/'receiver').reopen(buyer, bound.intent_id)
    assert reopened.directory == operation.directory and reopened.recover() is None
    rows.append({'operation':name,'method':review.native['method'],'bodyBytes':review.native['bodyBytes']})
assert api.reopen(buyer,'customer-upload').review().native['multipart']['files'][0]['bytes'] == 250013
bound = api.build_request('item_get', {'path':{'sku':'interrupted'}}, intent_id='lost-preparation', accept_index=0, max_atomic='9007199254740993')
with tempfile.TemporaryDirectory(dir=buyer.state_dir) as temporary:
    config = pathlib.Path(temporary)/'request.json'
    config.write_text(json.dumps(bound.configuration())); config.chmod(0o600)
    native = buyer.from_config(config)
assert not (native.directory/'seller-client-source.json').exists()
assert api.resume_preparation(buyer,bound).directory == native.directory
try:
    api.prepare(buyer,bound)
except StateError as error:
    assert 'INTENT_ALREADY_EXISTS' in str(error)
else:
    raise AssertionError('Repeated intent created another operation')
try:
    api.build_request('item_put',{'path':{'sku':'x'},'body':{'units':9007199254740993}},intent_id='bad-number',max_atomic='1',accept_index=0)
except SellerClientError:
    pass
else:
    raise AssertionError('Lossy integer accepted')
operation = api.reopen(buyer,'customer-upload')
operation.configure(max_response_bytes=1048576, request_timeout_ms=45000)
assert api.reopen(buyer,'customer-upload').review().native['requestTimeoutMs'] == 45000
child_code = 'from seller_client import SellerClient; from stellar_forge_buyer import Buyer; import sys; b=Buyer(checkout=sys.argv[1],state_dir=sys.argv[2]); o=SellerClient(sys.argv[3]).reopen(b,"customer-upload"); assert o.review().native["multipart"]["files"][0]["bytes"]==250013; print(o.inspect()["state"])'
child = subprocess.run([sys.executable,'-c',child_code,context['source'],str(root/'buyer'),str(root/'receiver')],capture_output=True,text=True,check=True)
assert child.stdout.strip() == 'PREPARED'
print(json.dumps({'operations':rows,'lostPreparationRecovered':True,'freshProcessReopen':True,'exactAtomicCeiling':'9007199254740993'}))
`;
  const source = fileURLToPath(new URL('../../../../../', import.meta.url));
  const pythonSource = fileURLToPath(new URL('../../../sf88-operator-buyer-cli/python', import.meta.url));
  const run = spawnSync(process.env.PYTHON ?? 'python3', ['-c', script], {
    input: JSON.stringify({ directory, source, contentType: form.contentType }), encoding: 'utf8', timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, PYTHONPATH: [pythonSource, original.directory, process.env.PYTHONPATH].filter(Boolean).join(delimiter) },
  });
  assert.equal(run.status, 0, run.stderr || String(run.error));
  const result = JSON.parse(run.stdout);
  await writeFile(join(receiver, 'seller_client.pyi'), 'changed');
  await assert.rejects(inspectPythonSellerClient({ directory: receiver }), /differs from completion/);
  process.stdout.write(JSON.stringify({ sourceSha256: original.sourceSha256, customerFiles: original.files.length + 1,
    originalJsCompletionPreserved: true, ...result }) + '\n');
} finally { await rm(directory, { recursive: true, force: true }); }

#!/usr/bin/env node
/** MIT. Trusted source-owner capture of the original closed public demonstration. */
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {nativeModules, readSourceFile, writeSourceFile, packetIdentity, validatePacket, PACKET_SCHEMA} from './workspace.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const need = (condition, message) => { if (!condition) throw new Error(message); };
const readJson = async path => { const bytes = await readSourceFile(resolve(path)); return {bytes, value:JSON.parse(bytes)}; };

export async function captureGrantDemo({quoteDirectory, operationFile, inspectionFile, merchantPackage, output, sourceRoot} = {}) {
  const native = await nativeModules(sourceRoot);
  const operation = await readJson(operationFile), inspection = await readJson(inspectionFile);
  need(operation.value.status === 'COMPLETE' && inspection.value.status === 'COMPLETED' &&
    inspection.value.originalOperation === operation.value.operationId, 'Use the original completed purchase and inspection.');
  const pack = await readJson(join(merchantPackage, 'mcp-package.json'));
  const customer = await readJson(join(merchantPackage, 'customer/mcp.json'));
  const query = await readJson(join(merchantPackage, 'mysql/package/source.json'));
  need(pack.value.reviewId === operation.value.mysqlPackageReopened.reviewId &&
    customer.value.reviewId === pack.value.reviewId, 'The original reviewed merchant package changed.');
  for (const [name, received] of [['customer/mcp.json', customer], ['mysql/package/source.json', query]]) {
    const original = pack.value.files.find(row => row.file === name);
    need(original && received.bytes.length === original.bytes && digest(received.bytes) === original.sha256,
      'The original merchant file changed: ' + name);
  }
  // These three explicit source files carry public descriptors, SQL and
  // environment-variable names. No account, signer, approval, facilitator,
  // private runtime configuration or arbitrary source directory is captured.
  const documents = [], quotes = [], history = [];
  const add = (path, bytes, origin) => {
    documents.push({path, contentType:'application/json', bytes:bytes.length, sha256:digest(bytes),
      encoding:'base64', data:bytes.toString('base64'), ...(origin ? {origin} : {})});
  };
  let store;
  try {
    store = new native.SqliteQuoteStore({directory:resolve(quoteDirectory), readOnly:true});
    const originals = store.load().filter(quote =>
      inspection.value.observations.some(item => item.quoteId === quote.quoteId));
    need(originals.length === inspection.value.quoteCount, 'An original closed quote is missing.');
    for (const quote of originals) {
      const observed = inspection.value.observations.find(item => item.quoteId === quote.quoteId);
      need(quote.status === observed.originalStatus && quote.attempts === observed.attempts &&
        quote.result?.responseFile?.status === 'SAVED', 'The original closed quote changed.');
      const bytes = await native.readPrivateResultSource(quote.result.responseFile.path);
      need(bytes.length === observed.originalResult.bytes && digest(bytes) === observed.originalResult.sha256,
        'The complete original response changed.');
      const resultFile = 'results/' + quote.quoteId + '.json';
      add(resultFile, bytes, {kind:'original-native-mcp-result', quoteId:quote.quoteId});
      const snapshot = native.quoteSnapshot(quote);
      delete snapshot.result.responseFile; // Local receiving paths are assigned by the original result store.
      quotes.push({snapshot, resultFile});
      history.push({quoteId:quote.quoteId, checkpoints:store.transitions(quote.quoteId, 1000)});
    }
  } finally { store?.close(); }
  need(quotes.some(item => item.snapshot.quoteId === operation.value.quoteId &&
    item.snapshot.status === 'CONFIRMED_BY_SERVER'), 'The original completed quote is missing.');
  const primary = quotes.find(item => item.snapshot.quoteId === operation.value.quoteId);
  const primaryFile = documents.find(item => item.path === primary.resultFile);
  need(primaryFile.bytes === operation.value.result.bytes &&
    primaryFile.sha256 === operation.value.result.sha256, 'The source operation and result disagree.');
  const successful = JSON.parse(Buffer.from(primaryFile.data, 'base64'));
  need(successful._meta?.['x402/payment-response']?.transaction === operation.value.chain.hash &&
    successful.structuredContent?.rowCount === 100 && successful.structuredContent.columns?.length === 14 &&
    successful.structuredContent.truncated === true && successful.structuredContent.valueEncoding === 'mysql-exact-scalars',
    'The original filmed result identity changed.');
  add('source/native-payment-inspection.json', inspection.bytes,
    {kind:'original-source-file', sha256:digest(inspection.bytes)});
  add('source/mysql-package.json', pack.bytes, {kind:'original-source-file', filename:'mcp-package.json'});
  add('source/customer-mcp.json', customer.bytes, {kind:'original-source-file', filename:'customer/mcp.json'});
  add('source/mysql-source.json', query.bytes, {kind:'original-source-file', filename:'mysql/package/source.json'});
  add('source/quote-history.json', encoded({
    schema:'stellar-forge.grant-reviewer-source-history.v1',
    source:'Original completed payment-inspection SqliteQuoteStore',
    inspectionOperationId:inspection.value.operationId, quotes:history
  }));
  add('source/source-context.json', encoded(operation.value.source),
    {kind:'json-projection', originalFileSha256:digest(operation.bytes), jsonPointer:'/source'});
  const fields = ['schema','operationId','sourceCommit','status','startedAt','finishedAt','query','arguments',
    'amount','network','quoteId','result','chain','mysqlPackageReopened'];
  add('source/operation-summary.json', encoded(Object.fromEntries(fields.filter(name =>
    operation.value[name] !== undefined).map(name => [name, operation.value[name]]))),
    {kind:'json-projection', originalFileSha256:digest(operation.bytes), jsonPointers:fields.map(name => '/' + name)});
  const tool = customer.value.tools.find(item => item.name === primary.snapshot.invocation.toolName);
  need(tool && query.value.queries[tool.name], 'The original query descriptor is absent.');
  const packet = {schema:PACKET_SCHEMA, capturedAt:new Date().toISOString(),
    source:{operationId:operation.value.operationId, operationSourceCommit:operation.value.sourceCommit,
      operationFileSha256:digest(operation.bytes), inspectionOperationId:inspection.value.operationId,
      inspectionFileSha256:digest(inspection.bytes), filmSourceCommit:'57835a18f005cf63b5e5e76e0538860806196cc9',
      filmUrl:'https://github.com/woahwhattheheck/public-commons-sprint-2026/releases/download/scf-presentation-20261011/stellar-forge-scf46-presentation.mp4',
      discoveryUrl:customer.value.discoveryUrl, description:tool.description,
      publicSourceUrl:operation.value.source.url, dataAsOf:operation.value.source.data_as_of,
      merchantReviewId:pack.value.reviewId},
    primaryQuoteId:operation.value.quoteId, quotes, documents, receivingHistory:[]};
  packet.packetId = packetIdentity(packet);
  await validatePacket(packet, native);
  const saved = await writeSourceFile(resolve(output), encoded(packet));
  return {schema:PACKET_SCHEMA, packetId:packet.packetId, ...saved,
    operationId:packet.source.operationId, quoteCount:quotes.length,
    resultBytes:primaryFile.bytes, resultSha256:primaryFile.sha256, newPayments:0};
}

async function main() {
  const argv = process.argv.slice(2), options = {};
  if (!argv.length || argv.includes('--help')) {
    process.stdout.write('Trusted original-source capture:\nnode capture.mjs --quote-dir DIR --operation FILE --inspection FILE --merchant-package DIR --out FILE [--source-root DIR]\n');
    return;
  }
  const names = {'--quote-dir':'quoteDirectory','--operation':'operationFile','--inspection':'inspectionFile',
    '--merchant-package':'merchantPackage','--out':'output','--source-root':'sourceRoot'};
  for (let index = 0; index < argv.length; index += 2) {
    const name = names[argv[index]], value = argv[index + 1];
    need(name && value && !value.startsWith('--') && options[name] === undefined, 'Unknown or incomplete source option.');
    options[name] = resolve(value);
  }
  for (const name of ['quoteDirectory','operationFile','inspectionFile','merchantPackage','output'])
    need(options[name], 'Missing source input: ' + name);
  process.stdout.write(JSON.stringify(await captureGrantDemo(options), null, 2) + '\n');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { process.stderr.write((error.code ?? 'REVIEWER_CAPTURE_FAILED') + ': ' + error.message + '\n'); process.exitCode = 2; });


#!/usr/bin/env node
// MIT. Full ERP operations through the original merchant configuration and client.
import {readFile,open,mkdir,unlink} from 'node:fs/promises';
import {basename,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';

const HELP = [
  'WooCommerce ERP order delivery — Node 22+',
  '',
  'Use the existing merchant-operator.v1 configuration and named WordPress',
  'application-password environment variables. Do not place credentials in arguments.',
  '',
  'node merchant-erp-cli.mjs COMMAND --config /private/operator.json [OPTIONS]',
  '',
  'status',
  'maps',
  'map --map MAP_SHA [--out /private/map.json]',
  'map-save --input /private/map.json --expected-map MAP_SHA|none',
  'map-check --map MAP_SHA',
  'orders [--q TEXT] [--state STATE] [--page N] [--limit N]',
  'inspect --operation OP_SHA [--out /private/order-view.json]',
  'prepare --order WOO_ID --map MAP_SHA --revision N',
  'approve --operation OP_SHA --revision N --edition EDITION_SHA',
  '        --reason TEXT [--baseline TARGET_SHA]',
  'deliver --operation OP_SHA --revision N --edition EDITION_SHA',
  'reconcile --operation OP_SHA --revision N',
  'identify-target --operation OP_SHA --revision N --baseline TARGET_SHA',
  '        --reason TEXT [--operation-ended yes --provider-outcome TEXT]',
  'authorize-retry --operation OP_SHA --revision N --reason TEXT',
  '        --confirm-no-order yes --operation-ended yes --provider-outcome TEXT',
  'bind-import --operation OP_SHA --revision N --reason TEXT',
  'export --operation OP_SHA --out /private/complete-project.json',
  'import --input /private/complete-project.json',
  '',
  'Connector sources — same authenticated merchant configuration:',
  'kcf-status [--page N --limit N]',
  'kcf-create --input /private/installation-request.json',
  'kcf-installation --installation INSTALLATION_SHA',
  'kcf-list --installation SHA --collection receipts|editions|recipes|reviews|links|imports [--page N --limit N]',
  'kcf-source-add --installation SHA --input /private/receipt-request.json [--file /private/original.json]',
  'kcf-receipt --installation SHA --receipt SHA',
  'kcf-browse --installation SHA --receipt SHA [--pointer /items/0 --page N --limit N]',
  'kcf-source-download --installation SHA --receipt SHA --out /private/original.json',
  'kcf-edition-save --installation SHA --input /private/edition-request.json',
  'kcf-edition --installation SHA --source-edition SHA',
  'kcf-select --installation SHA --input /private/selection-request.json',
  'kcf-recipe-save --installation SHA --input /private/recipe-request.json',
  'kcf-recipe --installation SHA --recipe SHA',
  'kcf-preview --installation SHA --recipe SHA',
  'kcf-preview-draft --installation SHA --input /private/recipe.json',
  'kcf-map-apply --installation SHA --recipe SHA --input /private/apply-request.json',
  'kcf-impacts --installation SHA --recipe SHA [--page N --limit N]',
  'kcf-compare --installation SHA --before SHA --after SHA [--change TYPE --q TEXT --page N --limit N]',
  'kcf-review --installation SHA --input /private/review-request.json',
  'kcf-operation --installation SHA --operation-id ORIGINAL_ID',
  'kcf-export --installation SHA [--include-orders yes|no] --out /private/full-connector.json',
  'kcf-import --input /private/full-connector.json --operation-id ORIGINAL_ID',
  '',
  'Every connector mutation JSON includes its stable operationId and the exact',
  'required current revision. A lost response is recovered with kcf-operation',
  'and the unchanged original request. KCF.md contains complete input examples.',
  '',
  'Use revision 0 only when preparing a new order. Every later write names the',
  'current journal revision. Approve and deliver name the exact retained edition.',
  'Use --reason-file PATH or --provider-outcome-file PATH for multiline decisions.',
  'Existing output files are preserved. Byte-identical output is reused.',
  'Full exports contain private original order/customer data and no credential values.',
  'No command polls, retries a write, creates a payment, or changes Woo fulfillment.',
  '',
].join('\n');
function need(value,message) { if (!value) throw Error(message); }
function parse(argv) {
  const command = argv.shift() || 'help', options = {};
  while (argv.length) {
    const key = argv.shift(); need(/^--[a-z][a-z-]*$/.test(key),'Use named command options.');
    need(!Object.hasOwn(options,key.slice(2)) && argv.length > 0 && !argv[0].startsWith('--'),'Each named option requires exactly one value.');
    options[key.slice(2)] = argv.shift();
  }
  return {command,options};
}
const COMMON = ['config','out'];
const FIELDS = {
  status:[],maps:[],map:['map'],'map-save':['input','expected-map'],'map-check':['map'],
  orders:['q','state','page','limit'],inspect:['operation'],prepare:['order','map','revision'],
  approve:['operation','revision','edition','reason','reason-file','baseline'],
  deliver:['operation','revision','edition'],reconcile:['operation','revision'],
  'identify-target':['operation','revision','baseline','reason','reason-file','operation-ended','provider-outcome','provider-outcome-file'],
  'authorize-retry':['operation','revision','reason','reason-file','confirm-no-order','operation-ended','provider-outcome','provider-outcome-file'],
  'bind-import':['operation','revision','reason','reason-file'],export:['operation'],import:['input'],
  'kcf-status':['page','limit'],'kcf-create':['input'],'kcf-installation':['installation'],
  'kcf-list':['installation','collection','page','limit'],'kcf-source-add':['installation','input','file'],
  'kcf-receipt':['installation','receipt'],'kcf-browse':['installation','receipt','pointer','page','limit'],
  'kcf-source-download':['installation','receipt'],'kcf-edition-save':['installation','input'],
  'kcf-edition':['installation','source-edition'],'kcf-select':['installation','input'],
  'kcf-recipe-save':['installation','input'],'kcf-recipe':['installation','recipe'],
  'kcf-preview':['installation','recipe'],'kcf-preview-draft':['installation','input'],
  'kcf-map-apply':['installation','recipe','input'],'kcf-impacts':['installation','recipe','page','limit'],
  'kcf-compare':['installation','before','after','change','q','page','limit'],'kcf-review':['installation','input'],
  'kcf-operation':['installation','operation-id'],'kcf-export':['installation','include-orders'],
  'kcf-import':['input','operation-id'],
};
async function file(path,max = 16 * 1024 * 1024) {
  need(typeof path === 'string' && path !== '','Select the input file.');
  const handle = await open(resolve(path),'r');
  try {
    const stat = await handle.stat(); need(stat.isFile() && stat.size <= max,'The input file exceeds its supported size or is not a regular file.');
    const bytes = await handle.readFile(); need(bytes.length <= max,'The input file grew beyond its supported size.'); return bytes;
  } finally { await handle.close(); }
}
async function input(path) { return JSON.parse((await file(path)).toString('utf8')); }
async function textOption(options,name) {
  need(!(options[name] !== undefined && options[name + '-file'] !== undefined),'Select one source for ' + name + '.');
  const value = options[name + '-file'] ? (await file(options[name + '-file'],8192)).toString('utf8').trim() : options[name];
  need(typeof value === 'string' && value.trim() !== '', 'Supply --' + name + ' or --' + name + '-file.');
  return value.trim();
}
function integer(value,name,min = 1) {
  need(typeof value === 'string' && /^[0-9]+$/.test(value),'Supply the exact ' + name + '.');
  const n = Number(value); need(Number.isSafeInteger(n) && n >= min,'The selected ' + name + ' is invalid.'); return n;
}
function result(value) {
  if (value && Number.isInteger(value.httpStatus) && Object.hasOwn(value,'response')) {
    if (value.httpStatus !== 200) { const error = Error(value.response?.message || 'The ERP operation returned HTTP ' + value.httpStatus + '.'); error.httpStatus = value.httpStatus; throw error; }
    return value.response;
  }
  return value;
}
async function writeOutput(path,value) {
  const target = resolve(path), bytes = Buffer.from(JSON.stringify(value,null,2) + '\n');
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  let handle,created = false;
  try {
    handle = await open(target,'wx',0o600); created = true; await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error.code === 'EEXIST') {
      const existing = await file(target,bytes.length);
      need(existing.equals(bytes),'The selected output file already contains different retained data. Choose a new output name.');
    } else { if (created) await unlink(target).catch(() => {}); throw error; }
  }
  return {path:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function connectorInput(path) { return JSON.parse((await file(path,32*1024*1024+4096)).toString('utf8')); }
async function writeOriginalOutput(path,bytes) {
  const target=resolve(path);await mkdir(dirname(target),{recursive:true,mode:0o700});let handle,created=false;
  try { handle=await open(target,'wx',0o600);created=true;await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null; }
  catch(error){await handle?.close().catch(()=>{});if(error.code==='EEXIST')need((await file(target,bytes.length)).equals(bytes),'The output contains different original bytes; choose another path.');else{if(created)await unlink(target).catch(()=>{});throw error;}}
  return{path:target,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
async function main() {
  const {command,options:o} = parse(process.argv.slice(2));
  if (command === 'help') { process.stdout.write(HELP); return; }
  need(Object.hasOwn(FIELDS,command),'Unknown ERP command. Run help for the complete operating flow.');
  need(Object.keys(o).every(key => [...COMMON,...FIELDS[command]].includes(key)),'This command contains an unsupported option.');
  need(o.config,'Select the original merchant operator configuration.');
  const {loadOperator,createMerchantClient} = await import('./merchant-operator.mjs');
  const client = createMerchantClient(await loadOperator(o.config));
  const revision = () => integer(o.revision,'retained journal revision');
  let value;
  switch (command) {
    case 'kcf-status': value=await client.kcfStatus({page:o.page?integer(o.page,'installation page'):1,limit:o.limit?integer(o.limit,'installation limit'):50});break;
    case 'kcf-create': value=await client.kcfCreateInstallation(await connectorInput(o.input));break;
    case 'kcf-installation': value=await client.kcfInstallation(o.installation);break;
    case 'kcf-list': value=await client.kcfList(o.installation,o.collection,{page:o.page?integer(o.page,'source page'):1,limit:o.limit?integer(o.limit,'source limit'):50});break;
    case 'kcf-source-add': {
      const body=await connectorInput(o.input);
      if(o.file){const{connectorSourceFile}=await import('./merchant-kcf-client.mjs');const original=connectorSourceFile(await file(o.file,4*1024*1024),{name:body.file?.name||basename(o.file),format:body.file?.format,delimiter:body.file?.delimiter??','});body.file=original;}
      value=await client.kcfRetainSource(o.installation,body);break;
    }
    case 'kcf-receipt': value=await client.kcfReceipt(o.installation,o.receipt);break;
    case 'kcf-browse': value=await client.kcfBrowse(o.installation,o.receipt,{pointer:o.pointer||'',page:o.page?integer(o.page,'source value page'):1,limit:o.limit?integer(o.limit,'source value limit'):50});break;
    case 'kcf-source-download': {
      need(o.out,'Select --out for the exact original source bytes.');const original=await client.kcfOriginal(o.installation,o.receipt);
      const retained=await writeOriginalOutput(o.out,Buffer.from(original.contentBase64,'base64'));
      process.stdout.write(JSON.stringify({retained,receiptId:original.receiptId})+'\n');return;
    }
    case 'kcf-edition-save': value=await client.kcfSaveEdition(o.installation,await connectorInput(o.input));break;
    case 'kcf-edition': value=await client.kcfEdition(o.installation,o['source-edition']);break;
    case 'kcf-select': value=await client.kcfSelect(o.installation,await connectorInput(o.input));break;
    case 'kcf-recipe-save': value=await client.kcfSaveRecipe(o.installation,await connectorInput(o.input));break;
    case 'kcf-recipe': value=await client.kcfRecipe(o.installation,o.recipe);break;
    case 'kcf-preview': value=await client.kcfPreview(o.installation,o.recipe);break;
    case 'kcf-preview-draft': value=await client.kcfPreviewDraft(o.installation,await connectorInput(o.input));break;
    case 'kcf-map-apply': value=await client.kcfApply(o.installation,o.recipe,await connectorInput(o.input));break;
    case 'kcf-impacts': value=await client.kcfImpacts(o.installation,o.recipe,{page:o.page?integer(o.page,'impact page'):1,limit:o.limit?integer(o.limit,'impact limit'):50});break;
    case 'kcf-compare': value=await client.kcfCompare(o.installation,{before:o.before,after:o.after,change:o.change||'all',q:o.q||'',page:o.page?integer(o.page,'comparison page'):1,limit:o.limit?integer(o.limit,'comparison limit'):50});break;
    case 'kcf-review': value=await client.kcfReview(o.installation,await connectorInput(o.input));break;
    case 'kcf-operation': value=await client.kcfOperation(o.installation,o['operation-id']);break;
    case 'kcf-export':
      need(o.out,'Select --out for the complete private connector project.');need(o['include-orders']===undefined||['yes','no'].includes(o['include-orders']),'Use --include-orders yes or no.');
      value=await client.kcfExport(o.installation,{includeOrders:o['include-orders']!=='no'});break;
    case 'kcf-import': value=await client.kcfImport(await connectorInput(o.input),o['operation-id']);break;
    case 'status': value = await client.erpStatus(); break;
    case 'maps': { const status = await client.erpStatus(); value = {currentMapId:status.currentMapId,maps:status.maps}; break; }
    case 'map': value = await client.erpMap(o.map); break;
    case 'map-save':
      need(typeof o['expected-map'] === 'string','Supply --expected-map with the current selection or none.');
      value = await client.erpSaveMap(await input(o.input),o['expected-map'] === 'none' ? '' : o['expected-map']); break;
    case 'map-check': value = await client.erpCheckMap(o.map); break;
    case 'orders': value = await client.erpOrders({q:o.q || '',state:o.state || '',page:o.page ? integer(o.page,'queue page') : 1,limit:o.limit ? integer(o.limit,'queue limit') : 25}); break;
    case 'inspect': value = await client.erpInspect(o.operation); break;
    case 'prepare': value = await client.erpPrepare({orderId:o.order,mapId:o.map,expectedRevision:integer(o.revision,'journal revision',0)}); break;
    case 'approve': value = await client.erpApprove(o.operation,{expectedRevision:revision(),editionId:o.edition,reason:await textOption(o,'reason'),...(o.baseline ? {targetBaselineSha256:o.baseline} : {})}); break;
    case 'deliver': value = await client.erpDeliver(o.operation,{expectedRevision:revision(),editionId:o.edition}); break;
    case 'reconcile': value = await client.erpReconcile(o.operation,{expectedRevision:revision()}); break;
    case 'identify-target': {
      const body = {expectedRevision:revision(),targetBaselineSha256:o.baseline,reason:await textOption(o,'reason')};
      if (o['operation-ended'] !== undefined) { need(o['operation-ended'] === 'yes','Use --operation-ended yes only after checking the original ERP processing.'); body.confirmOperationEnded = true; body.providerOutcome = await textOption(o,'provider-outcome'); }
      value = await client.erpIdentifyTarget(o.operation,body); break;
    }
    case 'authorize-retry':
      need(o['confirm-no-order'] === 'yes' && o['operation-ended'] === 'yes','A retry requires the checked completed ERP operation and no received order.');
      value = await client.erpAuthorizeRetry(o.operation,{expectedRevision:revision(),confirmNoOrder:true,reason:await textOption(o,'reason'),providerOutcome:await textOption(o,'provider-outcome')}); break;
    case 'bind-import': value = await client.erpBindImport(o.operation,{expectedRevision:revision(),reason:await textOption(o,'reason')}); break;
    case 'export': need(o.out,'Select --out for the complete private ERP project.'); value = await client.erpExport(o.operation); break;
    case 'import': value = await client.erpImport(await input(o.input)); break;
  }
  value = result(value);
  if (o.out) {
    const retained = await writeOutput(o.out,value);
    process.stdout.write(JSON.stringify({retained,operationId:value.operation?.operationId || value.record?.operationId || null,revision:value.operation?.revision || value.record?.revision || null}) + '\n');
  } else process.stdout.write(JSON.stringify(value,null,2) + '\n');
}
main().catch(error => { process.stderr.write(JSON.stringify({error:error.message,httpStatus:error.httpStatus ?? null}) + '\n'); process.exitCode = 1; });

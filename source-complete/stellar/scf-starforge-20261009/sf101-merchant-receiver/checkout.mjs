// MIT. Original SF101 enrollment + original Python/SF30 checkout + native outbox.
import { spawn } from 'node:child_process';
import { open, lstat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPythonSource } from '../sf30-seller-sdk/python/source.mjs';
import { startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { startSellerOperations } from '../sf30-seller-sdk/operations/server.mjs';
import { validateAvailabilityDirectory } from '../sf30-seller-sdk/availability/store.mjs';
import { openOutbox, instrumentNativeSettlement } from '../sf98-merchant-delivery/outbox.mjs';
import { application, readCheckout, orderHandoff, reference, privatePath, need } from './checkout-config.mjs';
import {idPattern} from '../sf93-seller-support-bundle/incident-config.mjs';

const receiver = fileURLToPath(new URL('./receiver.py', import.meta.url));
const USAGE = `node checkout.mjs inspect --config PRIVATE_CHECKOUT.json
node checkout.mjs init --config PRIVATE_CHECKOUT.json
node checkout.mjs enroll --config PRIVATE_CHECKOUT.json --ref ORDER --file PRIVATE_FILE --out NEW_HANDOFF.json [--claim-env SF101_CLAIM_TOKEN]
node checkout.mjs handoff --config PRIVATE_CHECKOUT.json --ref ORDER --out NEW_HANDOFF.json
node checkout.mjs serve --config PRIVATE_CHECKOUT.json [--port 8423] [--operations-port 8424]
  [--facilitator HTTPS_URL] [--allow-local-facilitator]
  [--availability-dir PRIVATE_ABSOLUTE_DIRECTORY]
  [--delivery-workspace PRIVATE_DIRECTORY]
  [--incident-state PRIVATE_MONITOR_DIRECTORY --incident-merchant REGISTERED_ID]

The original receiver.py serve and original SF98 delivery worker use the SAME
private state/outbox. Their existing HTTPS proxy and HMAC setup are in CHECKOUT.md.`;

function environment(compiled, provided = process.env, secretName) {
  const env = {};
  for (const name of ['PATH','LANG','LC_ALL','SYSTEMROOT']) if (provided[name] !== undefined) env[name] = provided[name];
  env.SF101_CHECKOUT_CONTEXT = JSON.stringify(compiled.context);
  if (secretName) {
    need(/^[A-Z][A-Z0-9_]{1,64}$/.test(secretName), 'CLAIM_ENV_NAME_INVALID');
    if (provided[secretName] !== undefined) env[secretName] = provided[secretName];
  }
  return env;
}
function pythonCommand(compiled, entry, args, env) {
  return new Promise((done, fail) => {
    const child = spawn(compiled.python.options.executable, [entry, ...args], {
      env, stdio:['ignore','pipe','ignore'], shell:false, windowsHide:true,
    });
    const chunks = []; let size = 0, failed = false;
    const timer = setTimeout(() => { failed = true; child.kill('SIGKILL'); }, 15000);
    child.stdout.on('data', bytes => {
      size += bytes.length;
      if (size > 32768) { failed = true; child.kill('SIGKILL'); } else chunks.push(bytes);
    });
    child.once('error', () => { clearTimeout(timer); fail(new Error('ORIGINAL_RECEIVER_START_FAILED')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (code !== 0 || failed) { fail(new Error('ORIGINAL_RECEIVER_OPERATION_FAILED')); return; }
      try { done(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { fail(new Error('ORIGINAL_RECEIVER_RESULT_INVALID')); }
    });
  });
}
export async function inspectOrder(compiled, ref) {
  need(reference(ref), 'ORDER_REFERENCE_INVALID');
  return pythonCommand(compiled, application, ['inspect','--state',compiled.state,'--ref',ref], environment(compiled));
}
export async function initializeMerchant(compiled) {
  return pythonCommand(compiled, receiver, ['init','--state',compiled.state], environment(compiled));
}
async function requireAbsent(path) {
  privatePath(path);
  try { await lstat(path); throw new Error('OUTPUT_ALREADY_EXISTS'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function writePrivateJson(path, value) {
  privatePath(path);
  const file = await open(path, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); }
  finally { await file.close(); }
}
export async function prepareHandoff(compiled, {ref, output, file, claimEnv = 'SF101_CLAIM_TOKEN', env = process.env}) {
  need(reference(ref), 'ORDER_REFERENCE_INVALID');
  await requireAbsent(output);
  let order;
  if (file !== undefined) {
    privatePath(file);
    order = await pythonCommand(compiled, application,
      ['enroll','--state',compiled.state,'--ref',ref,'--file',file,'--claim-env',claimEnv], environment(compiled, env, claimEnv));
  } else order = await inspectOrder(compiled, ref);
  const handoff = orderHandoff(compiled, order);
  // Enrollment is already durable. If publication fails, `handoff` recovers the
  // same approved order without enrolling it again or changing its token/file.
  await writePrivateJson(output, handoff);
  return {status:'ORIGINAL_ORDER_HANDOFF_WRITTEN', orderReference:ref, output,
    originalOrderState:order.state, sourceSha256:handoff.file.sha256, sourceBytes:handoff.file.bytes,
    recipientBinding:handoff.recipientBinding};
}

export async function startCheckout(compiled, {port = 8423, operationsPort = 8424,
  nativeFactory = null, env = process.env, maxInFlight = 64, drainGraceMs = 60000,
  historyDirectory, historyRetentionDays = 90, deliveryRecovery = null, availabilityDirectory,
  deliveryWorkspaceDirectory = null, deliveryWorkspaceOptions = {}, incidentSource = null} = {}) {
  if (availabilityDirectory !== undefined) {
    validateAvailabilityDirectory(availabilityDirectory);
    need(![compiled.state, compiled.outbox, historyDirectory, deliveryWorkspaceDirectory, incidentSource?.directory].includes(availabilityDirectory),
      'SEPARATE_AVAILABILITY_DIRECTORY_REQUIRED');
  }
  let source, seller, operations, closing;
  const outbox = await openOutbox(compiled.outbox);
  const close = () => closing ??= (async () => {
    let failure;
    for (const part of [seller, operations, source]) try { await part?.close(); } catch (error) { failure ??= error; }
    if (failure) throw failure;
  })();
  try {
    // This trusted Python application only READS original approved orders. It
    // never receives the buyer claim token or sender HMAC key.
    source = await createPythonSource(compiled.python, {env:environment(compiled, env)});
    const original = source.route('purchase');
    const handlers = {
      purchase:original.handler,
      async purchaseAdmission(context) {
        const validated = original.admit(context);
        if (validated !== true) return validated;
        const ref = context.query.sf98_order;
        if (!reference(ref) || new Headers(context.headers).get('x-sf98-order-id') !== ref)
          return {status:422, body:{error:'APPROVED_URL_AND_ORDER_HEADER_MUST_MATCH'}};
        try { await source.call('purchase', context, {signal:context.signal}); return true; }
        catch (error) {
          return {status:error.code === 'PYTHON_FUNCTION_FAILED' ? 404 : 429,
            body:{error:'APPROVED_PENDING_ORDER_UNAVAILABLE'}};
        }
      },
    };
    seller = await startSellerService({config:compiled.service, handlers, port, maxInFlight, drainGraceMs, availabilityDirectory,
      nativeFactory:nativeFactory ? async routes => instrumentNativeSettlement(await nativeFactory(routes), {
        compiled:routes, outbox, onWriteFailure:() => process.stderr.write('SF101_NATIVE_OUTBOX_WRITE_FAILED\n'),
      }) : null});
    operations = await startSellerOperations(seller, {port:operationsPort, deliveryOutbox:outbox,
      historyDirectory, historyRetentionDays, deliveryRecovery,
      deliveryWorkspaceDirectory, deliveryWorkspaceOptions, incidentSource});
    return {seller, operations, source, outbox, close};
  } catch (error) { await close().catch(() => {}); throw error; }
}

function options(args) {
  const action = args[0], result = new Map();
  need(['inspect','init','enroll','handoff','serve'].includes(action), 'CHECKOUT_ACTION_REQUIRED');
  const allowed = {inspect:['--config'], init:['--config'],
    enroll:['--config','--ref','--file','--out','--claim-env'], handoff:['--config','--ref','--out'],
    serve:['--config','--port','--operations-port','--facilitator','--allow-local-facilitator',
      '--availability-dir','--delivery-workspace','--incident-state','--incident-merchant']}[action];
  for (let i=1; i<args.length; i++) {
    const flag = args[i];
    need(allowed.includes(flag) && !result.has(flag), 'CHECKOUT_OPTION_INVALID');
    if (flag === '--allow-local-facilitator') result.set(flag, true);
    else { need(typeof args[i+1] === 'string' && !args[i+1].startsWith('--'), 'CHECKOUT_OPTION_VALUE_REQUIRED'); result.set(flag,args[++i]); }
  }
  need(result.has('--config'), 'CHECKOUT_CONFIG_REQUIRED');
  if (['enroll','handoff'].includes(action)) need(result.has('--ref') && result.has('--out'), 'ORDER_AND_OUTPUT_REQUIRED');
  if (action === 'enroll') need(result.has('--file'), 'APPROVED_PRIVATE_FILE_REQUIRED');
  return {action, values:result};
}
export async function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0] === '--help') { console.log(USAGE); return; }
  const {action, values:v} = options(args);
  const c = await readCheckout(resolve(v.get('--config')));
  let result;
  if (action === 'inspect') result = {status:'CHECKOUT_CONFIG_VALID', offer:c.service.routes[0].offer,
    approvedOrderQuery:'sf98_order', orderHeader:'X-SF98-Order-ID', workerCount:c.python.options.workerCount};
  if (action === 'init') result = await initializeMerchant(c);
  if (['enroll','handoff'].includes(action)) result = await prepareHandoff(c,
    {ref:v.get('--ref'), output:resolve(v.get('--out')), ...(action === 'enroll' ? {file:resolve(v.get('--file'))} : {}),
      ...(v.has('--claim-env') ? {claimEnv:v.get('--claim-env')} : {})});
  if (action === 'serve') {
    const availabilityDirectory = v.has('--availability-dir')
      ? validateAvailabilityDirectory(v.get('--availability-dir')) : undefined;
    let nativeFactory = null;
    need(!v.has('--allow-local-facilitator') || v.has('--facilitator'), 'FACILITATOR_URL_REQUIRED');
    if (v.has('--facilitator')) {
      const url = new URL(v.get('--facilitator'));
      const local = v.has('--allow-local-facilitator') && url.protocol === 'http:' && url.hostname === '127.0.0.1';
      need((local || url.protocol === 'https:') && !url.username && !url.password && !url.search && !url.hash,
        'FACILITATOR_URL_INVALID');
      const [{HTTPFacilitatorClient},{createNativeSellerServer}] = await Promise.all([
        import('@x402/core/server'), import('../sf30-seller-sdk/native-factory.mjs')]);
      nativeFactory = routes => createNativeSellerServer(routes, {facilitatorClient:new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')})});
    }
    for (const key of ['--port','--operations-port']) if (v.has(key)) need(/^\d{1,5}$/.test(v.get(key)) && Number(v.get(key)) <= 65535, 'CHECKOUT_PORT_INVALID');
    need(v.has('--incident-state')===v.has('--incident-merchant') &&
      (!v.has('--incident-merchant')||idPattern.test(v.get('--incident-merchant'))),'INCIDENT_DIRECTORY_AND_REGISTERED_MERCHANT_REQUIRED');
    for(const key of ['--delivery-workspace','--incident-state'])if(v.has(key))privatePath(v.get(key));
    const directories=[c.state,c.outbox,availabilityDirectory,v.get('--delivery-workspace'),v.get('--incident-state')].filter(Boolean);
    need(new Set(directories).size===directories.length,'SEPARATE_PRIVATE_SERVICE_DIRECTORIES_REQUIRED');
    const session = await startCheckout(c, {nativeFactory, port:Number(v.get('--port') ?? 8423), operationsPort:Number(v.get('--operations-port') ?? 8424),availabilityDirectory,
      deliveryWorkspaceDirectory:v.get('--delivery-workspace') ?? null,
      incidentSource:v.has('--incident-state')?{directory:v.get('--incident-state'),merchantId:v.get('--incident-merchant')}:null});
    result = {mode:session.seller.mode, seller:session.seller.url, operations:session.operations.url,
      developer:session.seller.url + '/_seller/docs', delivery:session.operations.url + '/fulfillment',
      deliveryControl:session.operations.deliveryControlUrl,receiverWorkspace:session.operations.deliveryWorkspaceUrl,
      availability:session.operations.availabilityUrl,availabilityControl:session.operations.availabilityControlUrl};
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => session.close().catch(() => {process.exitCode=1;}));
  }
  console.log(JSON.stringify(result)); return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(error => { console.error(/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'CHECKOUT_COMMAND_FAILED'); process.exitCode=1; });

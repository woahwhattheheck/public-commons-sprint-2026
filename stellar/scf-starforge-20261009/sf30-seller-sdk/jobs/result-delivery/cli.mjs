#!/usr/bin/env node
// MIT. Foreground result delivery for the original durable merchant.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDeliveryConfig } from './config.mjs';
import { openResultDelivery } from './dispatcher.mjs';
import { deliveryError } from './wire.mjs';
const help = [
  'Starforge completed result delivery', '',
  '  jobs delivery status|scan|drain|work --config MERCHANT_JSON --state MERCHANT_STATE',
  '       --destinations DESTINATIONS_JSON [--delivery-state DELIVERY_DIRECTORY]',
  '  jobs delivery show --config MERCHANT_JSON --state MERCHANT_STATE',
  '       --destinations DESTINATIONS_JSON --id DELIVERY_SHA256',
  '  jobs delivery requeue --config MERCHANT_JSON --state MERCHANT_STATE',
  '       --destinations DESTINATIONS_JSON --id DELIVERY_SHA256 --revision N --reason TEXT', '',
  'status shows retained deliveries and destination readiness; scan queues completed',
  'paid-job results; drain sends the currently due deliveries; work runs the dispatcher',
  'in this foreground process until SIGINT/SIGTERM.',
  'show inspects one retained manifest, receipt and attempt history.',
  'requeue gives a RETRY or EXHAUSTED delivery a new attempt budget, preserving its',
  'original identity and result. Supply the current revision and an operator reason.', '',
  'Use the private delivery workspace while jobs serve owns the merchant state.',
  'For offline commands, stop that service first. Its original lease has one owner.',
  'Configure the destination secret in the named environment variable before sending.', '',
].join('\n');
const allowed = { status: [], scan: [], drain: [], work: [], show: ['--id'], requeue: ['--id', '--revision', '--reason'] };
const problem = message => Object.assign(deliveryError('JRD_COMMAND_INVALID'), { message });
function options(argv) {
  const command = argv[0];
  if (!Object.hasOwn(allowed, command)) throw problem('Choose a delivery command from --help.');
  const keys = new Set(['--config', '--state', '--destinations', '--delivery-state', ...allowed[command]]), values = new Map();
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (!keys.has(flag) || values.has(flag)) throw problem('Unknown or repeated option: ' + flag);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw problem('Supply a value for ' + flag + '.');
    values.set(flag, value);
  }
  for (const flag of ['--config', '--state', '--destinations', ...allowed[command]])
    if (!values.has(flag)) throw problem('Supply ' + flag + '.');
  if (values.has('--revision') && (!/^[1-9][0-9]*$/.test(values.get('--revision')) ||
      !Number.isSafeInteger(Number(values.get('--revision'))))) throw problem('Supply a positive safe integer revision.');
  return { command, values };
}
export async function runDeliveryCommand(argv = process.argv.slice(2), { print = value => console.log(value) } = {}) {
  if (!argv.length || argv.length === 1 && ['--help', '-h', 'help'].includes(argv[0])) { print(help); return; }
  const { command, values } = options(argv), config = await readDeliveryConfig(values.get('--destinations'));
  const { openJobMerchant } = await import('../model.mjs');
  const model = await openJobMerchant({ configPath: resolve(values.get('--config')), directory: resolve(values.get('--state')) });
  let delivery;
  const emit = value => print(JSON.stringify(value, null, 2));
  try {
    delivery = await openResultDelivery({ model, config,
      directory: values.has('--delivery-state') ? resolve(values.get('--delivery-state')) : undefined });
    if (command === 'status') return emit(delivery.snapshot());
    if (command === 'show') return emit(delivery.get(values.get('--id')));
    if (command === 'scan') return emit(await delivery.scan());
    if (command === 'drain') return emit(await delivery.drain());
    if (command === 'requeue') return emit(await delivery.requeue({ id: values.get('--id'),
      expectedRevision: Number(values.get('--revision')), reason: values.get('--reason') }));
    if (command === 'work') {
      let finish;
      const stopped = new Promise(resolveStop => { finish = resolveStop; });
      const onSignal = () => finish();
      process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
      try { emit(delivery.start()); await stopped; }
      finally { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); }
    }
  } finally {
    try { await delivery?.close(); } finally { await model.close(); }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runDeliveryCommand().catch(error => { console.error(error.code ? error.code + ': ' + error.message : error.message); process.exitCode = 1; });

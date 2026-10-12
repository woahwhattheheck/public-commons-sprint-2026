#!/usr/bin/env node
// MIT. Verified adjustment import, explicit Woo credit, original-store recovery.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need, safeCode} from '../sf88-operator-buyer-cli/node/store.mjs';
import {loadOperator} from './merchant-operator.mjs';
import {inspectRefunds, prepareRefund, applyRefund, recoverRefund, inspectRefund,
  listRefunds, exportRefund} from './refund-operator.mjs';
import {receiveRefund} from './refund-handoff.mjs';

export const HELP = [
  'starforge woo-refund inspect --config /private/woo-operator.json --order 123',
  'starforge woo-refund prepare --config /private/woo-operator.json --adjustments /private/adjustments.json --adjustment UUID --order 123 --woo-amount 4.25',
  'starforge woo-refund apply --config /private/woo-operator.json --adjustment UUID --confirm-order 123',
  'starforge woo-refund recover --config /private/woo-operator.json --adjustment UUID',
  'starforge woo-refund read --config /private/woo-operator.json --adjustment UUID [--live]',
  'starforge woo-refund history --config /private/woo-operator.json',
  'starforge woo-refund receive --config /private/receiving-operator.json --from /private/refund-handoff --manifest-sha256 SHA256 [--check]',
  'starforge woo-refund export --config /private/woo-operator.json --adjustment UUID --out /private/refund-handoff',
  '',
  'Prepare imports one VERIFIED refund from the original settlement adjustments export.',
  'The native reverse transfer must match the exact released Woo payment and original payer.',
  '--woo-amount is an explicit positive amount in the order currency; asset atomic units',
  'and store currency remain separate. Amounts use a decimal point and store precision.',
  '',
  'Apply records the reviewed credit through WooCommerce and its normal refund hooks.',
  'This amount-only operation records no item restock and sends no second gateway payment.',
  'Each write is followed by a fresh order read. Recover performs a GET only.',
  'REFUND_SAVED_JOURNAL_PENDING means the native child exists; apply with the same',
  'adjustment and confirmed order reconciles that saved child into the bridge journal.',
  'After a timeout, use recover, then explicitly repeat the relevant command if needed.',
  'The same adjustment UUID, exact export bytes, and selected Woo amount are retained.',
  'Receive verifies a complete original handoff into the configured operator workspace.',
  'Use --check to inspect it first. Repeat the same receive after interruption;',
  'its original manifest hash and records identify the same local transfer.',
  '',
  'The existing merchant operator config supplies site URL, auth environment names,',
  'original outbox path, and private workspace. Read/history/export work offline.',
  'Run this file with Node from a source checkout or use the installed command above.',
].join('\n');

function parse(args) {
  const action = args[0] === 'show' ? 'read' : args[0];
  const allowed = {
    inspect:['--config', '--order'],
    prepare:['--config', '--adjustments', '--adjustment', '--order', '--woo-amount'],
    apply:['--config', '--adjustment', '--confirm-order'],
    recover:['--config', '--adjustment'], read:['--config', '--adjustment', '--live'],
    history:['--config'], export:['--config', '--adjustment', '--out'],
    receive:['--config', '--from', '--manifest-sha256', '--check'],
  }[action];
  need(allowed, 'WOO_REFUND_ACTION_REQUIRED');
  const values = new Map();
  for (let i = 1; i < args.length; i++) {
    const key = args[i];
    need(allowed.includes(key) && !values.has(key), 'WOO_REFUND_ARGUMENT_INVALID');
    if (['--live', '--check'].includes(key)) { values.set(key, true); continue; }
    need(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'WOO_REFUND_ARGUMENT_VALUE_REQUIRED');
    values.set(key, args[++i]);
  }
  need(allowed.filter(key => !['--live', '--check'].includes(key)).every(key => values.has(key)), 'WOO_REFUND_ARGUMENT_REQUIRED');
  return {action, get:key => values.get(key)};
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || (args.length === 1 && ['--help', 'help'].includes(args[0]))) {
    process.stdout.write(HELP + '\n'); return {exitCode:0};
  }
  const {action, get} = parse(args), config = await loadOperator(get('--config'));
  let result;
  if (action === 'inspect') result = await inspectRefunds(config, get('--order'));
  if (action === 'prepare') result = await prepareRefund(config, {adjustmentId:get('--adjustment'),
    order:get('--order'), adjustmentsPath:resolve(get('--adjustments')), wooAmount:get('--woo-amount')});
  if (action === 'apply') result = await applyRefund(config, get('--adjustment'), {confirmOrder:get('--confirm-order')});
  if (action === 'recover') result = await recoverRefund(config, get('--adjustment'));
  if (action === 'read') result = await inspectRefund(config, get('--adjustment'), {live:get('--live') === true});
  if (action === 'history') result = {refunds:await listRefunds(config)};
  if (action === 'export') result = await exportRefund(config, get('--adjustment'), resolve(get('--out')));
  if (action === 'receive') result = await receiveRefund(config, resolve(get('--from')),
    {expectedManifestSha256:get('--manifest-sha256'), check:get('--check') === true});
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  const incomplete = action === 'apply' ? result.status !== 'APPLIED' :
    action === 'prepare' ? !['PREPARED', 'APPLIED'].includes(result.status) :
    action === 'recover' || (action === 'read' && get('--live')) ?
      !['PREPARED', 'APPLIED', 'NOT_PREPARED'].includes(result.status) : false;
  return {exitCode:incomplete ? 2 : 0, result};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => { process.exitCode = value.exitCode; }).catch(error => {
    process.stderr.write(JSON.stringify({error:safeCode(error.code, 'WOO_REFUND_COMMAND_FAILED')}) + '\n');
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
// MIT. Complete review -> original native reconciliation -> explicit Woo release.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need, safeCode} from '../sf88-operator-buyer-cli/node/store.mjs';
import {loadOperator, createMerchantClient, reviewOrder, resumeReview, releaseOrder,
  inspectReview, listReviews, exportReview} from './merchant-operator.mjs';

export const HELP = `starforge woo-operator inspect --config /private/woo-operator.json --order 123
starforge woo-operator review --config /private/woo-operator.json --id order-123-native --order 123 --record /private/original-native-record.json --payer G...
starforge woo-operator show --config /private/woo-operator.json --id order-123-native [--live]
starforge woo-operator release --config /private/woo-operator.json --id order-123-native --confirm-order 123
starforge woo-operator resume --config /private/woo-operator.json --id order-123-native
starforge woo-operator history --config /private/woo-operator.json
starforge woo-operator export --config /private/woo-operator.json --id order-123-native --out /private/order-123-handoff

Review reads the same WordPress order, original SF98 outbox and native record,
then calls the original SF86 network verifier. It saves that complete review.
Release explicitly invokes WooCommerce payment completion for the selected order;
the normal store stock, download and notification hooks apply. After interruption,
show --live reads the original order and release reuses the same reviewed operation.

The config uses existing WordPress manager/application-password environment names,
the site's exact URL, original private outbox and a private review workspace.
An optional --rpc-endpoint selects an endpoint allowed by the original verifier;
--max-event-pages is 1..100. Show/history/export can reopen saved work offline.
Run this file with Node from a source checkout or use the installed command above.`;

function parse(args) {
  const action = args[0];
  const allowed = {
    inspect:['--config', '--order'],
    review:['--config', '--id', '--order', '--record', '--payer', '--rpc-endpoint', '--max-event-pages'],
    resume:['--config', '--id'], release:['--config', '--id', '--confirm-order'],
    show:['--config', '--id', '--live'], history:['--config'], export:['--config', '--id', '--out'],
  }[action];
  need(allowed, 'WOO_OPERATOR_ACTION_REQUIRED');
  const values = new Map();
  for (let i = 1; i < args.length; i++) {
    const key = args[i]; need(allowed.includes(key) && !values.has(key), 'WOO_OPERATOR_ARGUMENT_INVALID');
    if (key === '--live') { values.set(key, true); continue; }
    need(typeof args[i + 1] === 'string' && !args[i + 1].startsWith('--'), 'WOO_OPERATOR_ARGUMENT_VALUE_REQUIRED');
    values.set(key, args[++i]);
  }
  const required = {
    inspect:['--config', '--order'], review:['--config', '--id', '--order', '--record', '--payer'],
    resume:['--config', '--id'], release:['--config', '--id', '--confirm-order'],
    show:['--config', '--id'], history:['--config'], export:['--config', '--id', '--out'],
  }[action];
  need(required.every(key => values.has(key)), 'WOO_OPERATOR_ARGUMENT_REQUIRED');
  return {action, get:key => values.get(key)};
}

export async function main(args = process.argv.slice(2)) {
  if (!args.length || (args.length === 1 && ['--help', 'help'].includes(args[0]))) {
    process.stdout.write(HELP + '\n'); return {exitCode:0};
  }
  const {action, get} = parse(args), config = await loadOperator(get('--config'));
  let result;
  if (action === 'inspect') result = await createMerchantClient(config).inspect(get('--order'));
  if (action === 'review') result = await reviewOrder(config, {id:get('--id'), order:get('--order'),
    recordPath:resolve(get('--record')), payer:get('--payer'), rpcEndpoint:get('--rpc-endpoint'),
    maxEventPages:get('--max-event-pages') === undefined ? 24 : Number(get('--max-event-pages'))});
  if (action === 'resume') result = await resumeReview(config, get('--id'));
  if (action === 'release') result = await releaseOrder(config, get('--id'), {confirmOrder:get('--confirm-order')});
  if (action === 'show') result = await inspectReview(config, get('--id'), {live:get('--live') === true});
  if (action === 'history') result = {reviews:await listReviews(config)};
  if (action === 'export') result = await exportReview(config, get('--id'), resolve(get('--out')));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return {exitCode:action === 'release' && result.status !== 'RELEASE_CONFIRMED' ? 2 : 0, result};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => { process.exitCode = value.exitCode; }).catch(error => {
    process.stderr.write(JSON.stringify({error:safeCode(error.code, 'WOO_OPERATOR_COMMAND_FAILED')}) + '\n');
    process.exitCode = 1;
  });
}

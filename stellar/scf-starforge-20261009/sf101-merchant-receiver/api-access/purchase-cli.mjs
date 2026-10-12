#!/usr/bin/env node
// MIT — Installed purchased-pass workflow; the original native operator reviews payment.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Buyer } from '../../sf88-operator-buyer-cli/node/index.mjs';
import { absolute, readJson, need, safeCode } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { createApiAccessPurchase, openApiAccessPurchase } from './purchase.mjs';

const HELP = `api-purchase prepare --directory PRIVATE_DIRECTORY --handoff FILE
  --workspace ORIGINAL_OPERATOR_DIRECTORY --inbox ORIGINAL_INBOX_DIRECTORY
  --buyer-state ORIGINAL_BUYER_STATE --intent STABLE_INTENT --gateway HTTPS_OR_LOOPBACK_ORIGIN
  [--runtime ORIGINAL_SF88_DIRECTORY] [--claim-env NAME] [--python EXECUTABLE]

api-purchase review|buy|recover-purchase|status --directory PRIVATE_DIRECTORY
api-purchase purchase-response --directory PRIVATE_DIRECTORY --out NEW_FILE
api-purchase finalize --directory PRIVATE_DIRECTORY [--merchant-outbox ORIGINAL_OUTBOX]
api-purchase history --directory PRIVATE_DIRECTORY --out NEW_HTML
api-purchase inspect|calls --directory PRIVATE_DIRECTORY [--after REQUEST_ID] [--limit 100]
api-purchase call --directory PRIVATE_DIRECTORY --route ROUTE --request-id STABLE_ID
  --out NEW_FILE [--method GET] [--query NAME VALUE] [--body FILE] [--content-type MIME]
api-purchase recover-call --directory PRIVATE_DIRECTORY --request-id STABLE_ID --out NEW_FILE

Supply the selected claim environment variable only for API inspection/calls.
The original SF88 workspace supplies payment policy and signer custody.
buy uses its original controlling terminal approval. Reopen the same directory
and use recover-purchase after an interrupted purchase, or recover-call after
an interrupted API operation. Output files are exclusive and stay private.
`;

function options(argv) {
  const value = {query:[]};
  const known = new Set(['directory','handoff','workspace','inbox','buyer-state','intent','gateway',
    'runtime','claim-env','python','out','merchant-outbox','after','limit','route','request-id',
    'method','body','content-type']);
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    need(typeof flag === 'string' && flag.startsWith('--'), 'OPTION_REQUIRED');
    const key = flag.slice(2);
    if (key === 'query') {
      need(index + 2 < argv.length, 'QUERY_NAME_AND_VALUE_REQUIRED');
      value.query.push([argv[++index],argv[++index]]);
    } else {
      need(known.has(key) && value[key] === undefined && index + 1 < argv.length, 'OPTION_INVALID');
      value[key] = argv[++index];
    }
  }
  return value;
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === 'help') {
    process.stdout.write(HELP); return;
  }
  const [action,...rest] = argv, args = options(rest);
  const actions = {
    prepare:['handoff','workspace','inbox','buyer-state','intent','gateway','runtime','claim-env'],
    review:[], buy:[], 'recover-purchase':[], status:[], 'purchase-response':['out'],
    finalize:['merchant-outbox'], history:['out'], inspect:[], calls:['after','limit'],
    call:['route','request-id','method','query','body','content-type','out'],
    'recover-call':['request-id','out'],
  };
  need(Object.hasOwn(actions, action), 'ACTION_INVALID');
  const permitted = new Set(['directory','python',...actions[action]]);
  need(Object.entries(args).every(([key,value]) =>
    key === 'query' && value.length === 0 || permitted.has(key)), 'OPTION_NOT_USED_BY_ACTION');
  const directory = absolute(args.directory);
  let purchase;
  if (action === 'prepare') {
    const runtimeDirectory = args.runtime || fileURLToPath(new URL('../../sf88-operator-buyer-cli', import.meta.url));
    const buyer = new Buyer({runtimeDirectory:absolute(runtimeDirectory), stateDirectory:absolute(args['buyer-state'])});
    purchase = await createApiAccessPurchase({directory, buyer, workspaceDirectory:absolute(args.workspace),
      inboxDirectory:absolute(args.inbox), handoffFile:absolute(args.handoff), intentId:args.intent,
      gatewayBaseUrl:args.gateway, claimEnv:args['claim-env'] || 'SF101_CLAIM_TOKEN', python:args.python});
    return {schema:purchase.metadata.schema, directory, intentId:purchase.intentId,
      orderReference:purchase.orderReference, purchase:await purchase.inspect()};
  }
  const metadata = await readJson(join(directory,'customer.json'));
  const buyer = new Buyer({runtimeDirectory:metadata.runtimeDirectory, stateDirectory:metadata.buyerStateDirectory});
  purchase = await openApiAccessPurchase({directory, buyer, python:args.python});
  switch (action) {
    case 'review': return purchase.review();
    case 'buy': return purchase.execute({review:await purchase.review()});
    case 'recover-purchase': return purchase.recover();
    case 'status': return purchase.inspect();
    case 'purchase-response': {
      const response = await purchase.response();
      need(response !== null, 'ORIGINAL_PURCHASE_RESPONSE_UNAVAILABLE');
      const output = await response.saveAs(absolute(args.out));
      return {file:output, ...await response.verify(), intentId:purchase.intentId};
    }
    case 'finalize': return purchase.finalize({outboxDirectory:args['merchant-outbox']});
    case 'history': return purchase.exportReport(absolute(args.out));
    case 'inspect': return purchase.api.inspect();
    case 'calls': return purchase.api.calls({after:args.after, limit:args.limit === undefined ? 100 : Number(args.limit)});
    case 'call': return (await purchase.api.call({route:args.route, requestId:args['request-id'],
      method:args.method || 'GET', query:args.query, bodyFile:args.body,
      contentType:args['content-type'] || 'application/octet-stream', output:absolute(args.out)})).metadata;
    case 'recover-call': return (await purchase.api.recover(args['request-id'], {output:absolute(args.out)})).metadata;
    default: throw Object.assign(new Error('ACTION_INVALID'), {code:'ACTION_INVALID'});
  }
}
if (process.argv[1] && absolute(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(value => { if (value !== undefined) process.stdout.write(JSON.stringify(value,null,2)+'\n'); })
    .catch(error => { process.stderr.write(JSON.stringify({ok:false,error:safeCode(error?.code,'API_PURCHASE_COMMAND_FAILED')})+'\n'); process.exitCode = 1; });
}

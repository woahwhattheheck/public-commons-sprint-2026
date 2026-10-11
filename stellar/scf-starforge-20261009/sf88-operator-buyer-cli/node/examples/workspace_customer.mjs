#!/usr/bin/env node
// MIT — Complete customer stages over the original Node Buyer and operator workspace.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Buyer, BuyerError } from '../index.mjs';

const help = `Original Node workspace customer
  prepare --runtime SF88_DIRECTORY --state PRIVATE_APP --workspace PRIVATE_OPERATOR
    [--config AUTHORED_REQUEST.json] [--intent EXPLICIT_ID]
  review|execute|recover|inspect --runtime SF88_DIRECTORY --state PRIVATE_APP --intent ID
  enqueue --runtime SF88_DIRECTORY --state PRIVATE_APP --intent ID --inbox EXISTING_INBOX

Only execute starts the original terminal approval. enqueue delegates this one
prepared operation to an existing native inbox; use that inbox afterward.
No command creates a wallet, operator policy, ledger, or automatic retry.`;

export async function main(args = process.argv.slice(2)) {
  if (!args.length || args[0] === '--help') { console.log(help); return; }
  const action = args[0], allowed = {
    prepare: ['--runtime','--state','--workspace','--config','--intent'],
    review: ['--runtime','--state','--intent'],
    execute: ['--runtime','--state','--intent'],
    recover: ['--runtime','--state','--intent'],
    inspect: ['--runtime','--state','--intent'],
    enqueue: ['--runtime','--state','--intent','--inbox'],
  };
  if (!allowed[action] || args.length % 2 !== 1) throw new BuyerError('WORKSPACE_EXAMPLE_ARGUMENTS_INVALID');
  const options = new Map();
  for (let i = 1; i < args.length; i += 2) {
    if (!allowed[action].includes(args[i]) || options.has(args[i]) || !args[i+1] || args[i+1].startsWith('--'))
      throw new BuyerError('WORKSPACE_EXAMPLE_ARGUMENTS_INVALID');
    options.set(args[i], args[i+1]);
  }
  const required = name => {
    if (!options.has(name)) throw new BuyerError('WORKSPACE_EXAMPLE_ARGUMENT_REQUIRED', { option: name });
    return options.get(name);
  };
  const buyer = new Buyer({ runtimeDirectory: resolve(required('--runtime')),
    stateDirectory: resolve(required('--state')) });
  const op = action === 'prepare'
    ? await buyer.fromWorkspace(resolve(required('--workspace')), {
      configuration: options.has('--config') ? resolve(options.get('--config')) : undefined,
      intentId: options.get('--intent'),
    })
    : buyer.operation(required('--intent'));
  let output;
  if (action === 'prepare' || action === 'review') output = await op.review();
  else if (action === 'inspect') output = await op.inspect();
  else if (action === 'enqueue') {
    const result = await buyer.inbox(resolve(required('--inbox'))).enqueue(op);
    output = { native: result.native, process: result.process, commandDirectory: result.commandDirectory,
      retry: 'USE_ORIGINAL_INBOX' };
  } else {
    const result = action === 'execute' ? await op.execute({ review: await op.review() }) : await op.recover();
    output = result === null ? { intentId: op.intentId, status: 'ORIGINAL_RESULT_NOT_RECORDED',
      retry: 'NO_AUTOMATIC_RETRY' } : { intentId: op.intentId, native: result.native,
      exitCode: result.record.exitCode, runtimeError: result.record.runtimeError,
      recovered: result.record.recovered, retry: 'NO_AUTOMATIC_RETRY' };
  }
  console.log(JSON.stringify(output, null, 2));
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(JSON.stringify({ error: error?.code ?? 'WORKSPACE_CUSTOMER_FAILED' })); process.exitCode = 1; });

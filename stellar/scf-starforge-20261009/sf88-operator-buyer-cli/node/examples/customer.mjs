#!/usr/bin/env node
// MIT — Runnable original SF30 generated-client -> original SF88 application.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { Buyer } from '../index.mjs';

const usage = `
node examples/customer.mjs review --runtime SF88_DIR --state PRIVATE_DIR \\
  --profile OPERATOR_JSON --client SELLER_CLIENT_MJS --operation OPERATION_ID \\
  --inputs INPUTS_JSON --intent STABLE_ID --max-atomic CEILING [--accept INDEX]
node examples/customer.mjs execute --runtime SF88_DIR --state PRIVATE_DIR --intent STABLE_ID [--output NEW_FILE]
node examples/customer.mjs recover --runtime SF88_DIR --state PRIVATE_DIR --intent STABLE_ID [--output NEW_FILE]
node examples/customer.mjs list --runtime SF88_DIR --state PRIVATE_DIR

review performs original offline validation; execute invokes the original approval
and buyer exactly once. recover/list never purchase. Supply only a trusted local
generated client module. Original signer secrets stay in the process environment.
`;
const allowed = new Set(['runtime', 'state', 'profile', 'client', 'operation', 'inputs', 'intent', 'max-atomic', 'accept', 'output']);
async function main([mode, ...args]) {
  if (!mode || mode === '--help') { console.log(usage.trim()); return; }
  if (!['review', 'execute', 'recover', 'list'].includes(mode)) throw new Error('MODE_INVALID');
  const flags = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.slice(2), value = args[index + 1];
    if (!args[index].startsWith('--') || !allowed.has(key) || key in flags || value === undefined)
      throw new Error('ARGUMENTS_INVALID');
    flags[key] = value;
  }
  const required = name => { if (!flags[name]) throw new Error('REQUIRED_ARGUMENT_' + name.toUpperCase().replaceAll('-', '_')); return flags[name]; };
  const buyer = new Buyer({ runtimeDirectory: resolve(required('runtime')), stateDirectory: resolve(required('state')),
    ...(flags.profile ? { operatorProfile: resolve(flags.profile) } : {}) });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    if (mode === 'list') {
      for await (const operation of buyer.list()) console.log(JSON.stringify(await operation.inspect()));
      return;
    }
    if (mode === 'review') {
      const generated = await import(pathToFileURL(resolve(required('client'))).href);
      const client = generated.createSellerClient({ buyer });
      const inputs = JSON.parse(await readFile(resolve(required('inputs')), 'utf8'));
      const authorization = { intentId: required('intent'), maxAtomic: required('max-atomic'),
        ...(flags.accept === undefined ? {} : { acceptIndex: Number(flags.accept) }) };
      const operation = await buyer.fromRequest(client.request(required('operation'), inputs, authorization));
      console.log(JSON.stringify(await operation.review(), null, 2));
      return;
    }
    const operation = buyer.operation(required('intent'));
    const result = mode === 'execute'
      ? await operation.execute({ review: await operation.review(), signal: controller.signal })
      : await operation.recover();
    if (!result) { console.log(JSON.stringify(await operation.inspect(), null, 2)); return; }
    const output = flags.output ? await result.saveAs(resolve(flags.output), { signal: controller.signal }) : null;
    console.log(JSON.stringify({ intentId: operation.intentId, status: result.status,
      httpStatus: result.native.httpStatus, ok: result.ok, delivery: result.delivery,
      recovered: result.record.recovered, runtimeError: result.record.runtimeError, output }, null, 2));
    if (!result.ok) process.exitCode = 2;
  } finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
main(process.argv.slice(2)).catch(error => {
  const code = error?.code ?? error?.message;
  console.error(JSON.stringify({ error: typeof code === 'string' && /^[A-Z0-9_]{1,120}$/.test(code) ? code : 'CUSTOMER_APPLICATION_FAILED', retry: 'NO_AUTOMATIC_RETRY' }));
  process.exitCode = 1;
});

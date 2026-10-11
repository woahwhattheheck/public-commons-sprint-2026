#!/usr/bin/env node
// MIT. Original completed SF31 purchase -> retained recovery -> original reports.
import { pathToFileURL } from 'node:url';
import { isAbsolute, resolve } from 'node:path';
import { reviewRecoveredSettlement, importRecoveredSettlement, readRecoveredSettlements,
  exportRecoveredResponse } from './recovery.mjs';

const choices = {
  review: ['--config'],
  import: ['--config', '--recovered-dir'],
  list: ['--recovered-dir'],
  response: ['--recovered-dir', '--id', '--out'],
  report: ['--recovered-dir', '--outbox', '--proof-dir', '--terms', '--out'],
};
const usage = `Usage:
  node recovery-cli.mjs review --config /private/recovery-request.json
  node recovery-cli.mjs import --config /private/recovery-request.json --recovered-dir /private/recovered
  node recovery-cli.mjs list --recovered-dir /private/recovered
  node recovery-cli.mjs response --recovered-dir /private/recovered --id RECOVERY_SHA256 --out /private/new-response.json
  node recovery-cli.mjs report --recovered-dir /private/recovered --outbox /private/sf98 --proof-dir /private/sf86 --terms /private/prices.json --out /private/new-report
`;
function parse(argv) {
  const [command, ...rest] = argv, required = choices[command];
  if (!required || rest.length !== required.length * 2) throw new Error('RECOVERY_INVALID_CLI_ARGUMENTS');
  const args = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i], value = rest[i + 1];
    if (!required.includes(key) || Object.hasOwn(args, key) || !value)
      throw new Error('RECOVERY_INVALID_CLI_ARGUMENTS');
    if (key !== '--id' && (!isAbsolute(value) || resolve(value) !== value || value === '/'))
      throw new Error('RECOVERY_ABSOLUTE_NORMALIZED_PATH_REQUIRED');
    args[key] = value;
  }
  return { command, args };
}
const summary = ({ data, fileDigest, proof }) => ({ schema: data.schema, recoveryId: data.recoveryId,
  origin: data.origin, importedAt: data.importedAt, intentId: data.intentId,
  routeId: data.routeId, method: data.method, network: data.network,
  amountAtomic: data.amountAtomic, transaction: data.transaction,
  fileDigest, verification: proof.data.verdict, ledger: proof.data.ledger,
  response: data.response, reservation: data.reservation, outbox: data.outbox });
const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');

export async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ['--help', 'help'].includes(argv[0])) {
    process.stdout.write(usage); return 0;
  }
  const { command, args } = parse(argv);
  if (command === 'review') print(await reviewRecoveredSettlement({ configFile: args['--config'] }));
  if (command === 'import') {
    const controller = new AbortController();
    const stop = () => controller.abort(new Error('RECOVERY_OPERATOR_CANCELLED'));
    process.once('SIGINT', stop);
    try {
      const result = await importRecoveredSettlement({ configFile: args['--config'],
        recoveredDir: args['--recovered-dir'], signal: controller.signal });
      print({ status: result.status, ...summary(result) });
    } finally { process.removeListener('SIGINT', stop); }
  }
  if (command === 'list') {
    const result = await readRecoveredSettlements(args['--recovered-dir']);
    print({ recoveries: result.entries.map(summary), hashes: result.hashes });
  }
  if (command === 'response') print(await exportRecoveredResponse({
    recoveredDir: args['--recovered-dir'], recoveryId: args['--id'], outputFile: args['--out'] }));
  if (command === 'report') {
    if (args['--out'] === args['--recovered-dir'] || args['--out'].startsWith(args['--recovered-dir'] + '/'))
      throw new Error('RECOVERY_REPORT_OUTPUT_MUST_BE_OUTSIDE_STORE');
    // The maintained CLI owns the report classifier, HTML, CSV and manifest.
    const { runOriginalAccounting } = await import('./reconcile.mjs');
    const { writeOriginalAccountingPack } = await import('./cli.mjs');
    const result = await runOriginalAccounting({ outboxDir: args['--outbox'],
      proofDir: args['--proof-dir'], termsFile: args['--terms'], recoveredDir: args['--recovered-dir'] });
    print(await writeOriginalAccountingPack(result, args['--out']));
  }
  return 0;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch(error => {
    const raw = error?.code ?? error?.message;
    const code = typeof raw === 'string' && /^[A-Z0-9_]{1,160}$/.test(raw) ? raw : 'RECOVERY_FAILED';
    process.stderr.write(JSON.stringify({ status: 'RECOVERY_COMMAND_FAILED', code }) + '\n');
    if (code === 'RECOVERY_INVALID_CLI_ARGUMENTS') process.stderr.write(usage);
    process.exitCode = 2;
  });

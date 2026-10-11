#!/usr/bin/env node
// MIT — Direct merchant source to the original private buyer workspace and inbox.
import { observe, prepare, show, review, diagnose, execute, finalize, recover, cancel, report, PilotError } from './operator.mjs';

const print = value => process.stdout.write(JSON.stringify(value, null, 2) + '\n');
let signalExit;
async function main(args) {
  const [command, ...rest] = args;
  if (command === '--help' && !rest.length) {
    process.stdout.write(`Usage: node operator-cli.mjs COMMAND [OPTION VALUE]\n\n` +
      `observe  --url HTTPS --allow-origin ORIGIN --out ABS [original SF85 options]\n` +
      `prepare  --capture ABS --offer-index N --intent-id ID --max-atomic N --dir ABS\n` +
      `         --actor ID --service ID --payer GADDRESS --python ABS [workspace options]\n` +
      `prepare  --handoff ABS --dir ABS --actor ID --service ID --payer GADDRESS --python ABS\n` +
      `review | diagnose | show | execute | finalize | recover | cancel --dir ABS\n` +
      `report   --dir ABS --out ABS\n\n` +
      `Prepare preserves the selected Stellar network and initializes local state only.\n` +
      `Workspace options include --rpc HTTPS and one of --https-proxy URL / --https-proxy-env NAME.\n` +
      `Execute enters the original SF88 approval path once; finalize reuses its existing accounting.\n`);
    return;
  }
  if (command === 'observe') return print(await observe(rest));
  if (command === 'prepare') return print(await prepare(rest));
  if (!['review','diagnose','show','execute','finalize','recover','cancel','report'].includes(command) ||
    rest[0] !== '--dir' || typeof rest[1] !== 'string' ||
    (command === 'report' ? rest.length !== 4 || rest[2] !== '--out' : rest.length !== 2))
    throw new PilotError('PILOT_COMMAND_AND_DIRECTORY_REQUIRED');
  const directory = rest[1];
  if (command === 'show') return print(await show(directory));
  if (command === 'diagnose') return print(await diagnose(directory));
  if (command === 'recover') return print(await recover(directory));
  if (command === 'cancel') return print(await cancel(directory));
  if (command === 'report') return print(await report(directory, rest[3]));
  const controller = new AbortController();
  const interrupt = () => {signalExit = 130; controller.abort('SIGINT');};
  const terminate = () => {signalExit = 143; controller.abort('SIGTERM');};
  process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
  try {
    if (command === 'review') {
      const source = await show(directory);
      print({source:source.source, state:source.buyer.state});
      const outcome = await review(directory, {signal:controller.signal});
      process.exitCode = outcome.exitCode ?? 1;
    } else {
      const operation = command === 'finalize' ? finalize : execute;
      const outcome = await operation(directory, {signal:controller.signal});
      print(outcome);
      process.exitCode = outcome.originalCommand.exitCode ?? 1;
    }
  } finally {
    process.off('SIGINT', interrupt); process.off('SIGTERM', terminate);
    if (signalExit !== undefined) process.exitCode = signalExit;
  }
}
main(process.argv.slice(2)).catch(error => {
  const code = /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'PILOT_OPERATION_FAILED';
  process.stderr.write(JSON.stringify({error:code, retry:'NO_AUTOMATIC_RETRY'}) + '\n');
  process.exitCode = signalExit ?? 1;
});

#!/usr/bin/env node
// MIT. Use the original Postman CLI to create its retained packet and plan.
import { mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runPostmanCLI } from '../../cli.mjs';

export async function main(args=process.argv.slice(2)) {
  if (args.length !== 1 || args[0] === '--help') {
    console.log('node prepare-example.mjs NEW_PRIVATE_DIRECTORY');
    return;
  }
  const destination=resolve(args[0]);
  const input=['--collection',fileURLToPath(new URL('./collection.json',import.meta.url)),
    '--environment',fileURLToPath(new URL('./public.environment.json',import.meta.url)),
    '--decisions',fileURLToPath(new URL('./decisions.json',import.meta.url))];
  await runPostmanCLI(['inspect',...input]);
  await mkdir(destination,{mode:0o700});
  const source=join(destination,'source.json'), plan=join(destination,'merchant-plan.json');
  await runPostmanCLI(['source',...input,'--out',source]);
  await runPostmanCLI(['plan','--source',source,'--out',plan]);
  console.log(JSON.stringify({source,plan,
    edit:['sellerServer','serviceName','payment.network','payment.asset','payment.payTo','operations[].amountAtomic'],
    workspace:'Open source.json in the maintained API merchant workspace, or use the original postman merchant command.'},null,2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => { console.error(error.message); process.exitCode=1; });

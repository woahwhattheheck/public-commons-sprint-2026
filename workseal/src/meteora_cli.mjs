#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildMeteoraDbcLaunchPlan } from './meteora_dbc.mjs';

function usage() {
  console.error('Usage: node src/meteora_cli.mjs <verified-workseal.json> <launch-input.json>');
  console.error('verified-workseal.json must be the successful output of web/core.mjs verifyBrowserBundle().');
  process.exitCode = 2;
}

const [, , verificationPath, inputPath] = process.argv;
if (!verificationPath || !inputPath) {
  usage();
} else {
  const [verification, input] = await Promise.all([
    readFile(verificationPath, 'utf8').then(JSON.parse),
    readFile(inputPath, 'utf8').then(JSON.parse),
  ]);
  const plan = buildMeteoraDbcLaunchPlan(verification, input);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

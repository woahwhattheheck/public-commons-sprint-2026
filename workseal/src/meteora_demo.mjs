import { pathToFileURL } from 'node:url';
import { buildDemoBundle, verifyBrowserBundle } from '../web/core.mjs';
import { buildMeteoraDbcLaunchPlan } from './meteora_dbc.mjs';

const DEMO_INPUT = Object.freeze({
  name: 'WorkSeal Proof Launch',
  symbol: 'SEAL',
  description: 'A proof-bound launch whose metadata commits to an accepted WorkSeal result.',
  website: 'https://example.com/workseal',
  creator: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
  feeClaimer: '11111111111111111111111111111111',
  leftoverReceiver: 'So11111111111111111111111111111111111111112',
  initialMarketCap: 20,
  migrationMarketCap: 600,
});

export async function buildMeteoraDemoPlan() {
  const browserBundle = await buildDemoBundle();
  const verifiedWorkSeal = await verifyBrowserBundle(browserBundle);
  return buildMeteoraDbcLaunchPlan(verifiedWorkSeal, DEMO_INPUT);
}

async function main() {
  const plan = await buildMeteoraDemoPlan();
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

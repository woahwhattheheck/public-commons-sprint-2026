import { checkSignature, DEMO_SIGNATURE, parseProviders } from './finality.mjs';

const demo = process.env.FINALITY_MODE !== 'live';
const signature = process.argv[2] || (demo ? DEMO_SIGNATURE : '');
const scenario = process.argv[3] || 'aligned';
try {
  const providers = demo ? [] : parseProviders(process.env.FINALITY_RPC_URLS);
  const result = await checkSignature(signature, { providers, demo, scenario });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exitCode = result.assessment.verdict === 'AGREED_FINALIZED' ? 0 : 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }

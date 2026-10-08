import { buildDemoBundle, verifyBrowserBundle } from '../web/core.mjs';
import { buildSolamiAcceptanceObservation } from './solami_receipt.mjs';

// Supply the actual owner-managed Solami RPC URL at runtime. Never print it:
// it may include account-specific routing or credentials.
const endpoint = process.env.SOLAMI_RPC_URL;
if (!endpoint) {
  process.stderr.write('Set SOLAMI_RPC_URL to an existing Solami mainnet HTTPS RPC endpoint. No account is created.\n');
  process.exitCode = 2;
} else {
  const verified = await verifyBrowserBundle(await buildDemoBundle());
  const receipt = await buildSolamiAcceptanceObservation({ verified, endpoint });
  // Demo WorkSeal acceptance is generated locally, not a real customer delivery.
  process.stdout.write(JSON.stringify({ demoWorkSealOnly: true, liveSolamiMainnetObservation: receipt }, null, 2) + '\n');
}

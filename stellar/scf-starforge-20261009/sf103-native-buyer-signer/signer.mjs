// MIT. Point original SF88 signerModule here; private configuration stays local.
import { loadOperatorSigner } from './operator.mjs';
import { requireValue } from './adapter.mjs';

let session;
export async function sign(input) {
  // Importing this module never reads a key or instantiates a payment client.
  // SF88 invokes sign only after the unchanged SF81/SF36 approval/reservation.
  requireValue(typeof process.env.SF103_SIGNER_CONFIG === 'string', 'SF103_SIGNER_CONFIG_REQUIRED');
  session ??= loadOperatorSigner(process.env.SF103_SIGNER_CONFIG);
  const { adapter } = await session;
  return adapter.sign(input);
}

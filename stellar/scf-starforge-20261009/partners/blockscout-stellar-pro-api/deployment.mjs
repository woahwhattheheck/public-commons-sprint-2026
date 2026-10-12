// MIT. Explicit merchant deployment mode; plan and provider-account identity are unchanged.
const error = code => Object.assign(new Error(code), { code, status: 400 });

export const DEPLOYMENT_SCHEMA = 'stellar-forge.blockscout-deployment.v1';
export const DEPLOYMENT_MODES = Object.freeze(['paid', 'challenge-only']);

export function normalizeBlockscoutDeployment({ mode = 'paid', facilitator,
  allowLocalFacilitator = false, nativeFactory } = {}) {
  if (!DEPLOYMENT_MODES.includes(mode)) throw error('BLOCKSCOUT_DEPLOYMENT_MODE_INVALID');
  if (typeof allowLocalFacilitator !== 'boolean') throw error('BLOCKSCOUT_FACILITATOR_INVALID');
  if (nativeFactory !== undefined && typeof nativeFactory !== 'function')
    throw error('BLOCKSCOUT_NATIVE_FACTORY_INVALID');
  if (mode === 'challenge-only' && nativeFactory !== undefined)
    throw error('BLOCKSCOUT_CHALLENGE_NATIVE_FACTORY_CONFLICT');
  let url = null;
  if (facilitator !== undefined && facilitator !== null && facilitator !== '') {
    try { url = new URL(facilitator); } catch { throw error('BLOCKSCOUT_FACILITATOR_INVALID'); }
    const local = allowLocalFacilitator && url.protocol === 'http:' && url.hostname === '127.0.0.1';
    if (typeof facilitator !== 'string' || facilitator.length > 4096 ||
        (!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash)
      throw error('BLOCKSCOUT_FACILITATOR_INVALID');
  }
  if (mode === 'paid' && nativeFactory === undefined && !url)
    throw error('BLOCKSCOUT_FACILITATOR_REQUIRED');
  return Object.freeze({ mode, merchantMode: mode === 'paid' ? 'NATIVE_X402' : 'CHALLENGE_ONLY',
    facilitator: url?.href.replace(/\/$/, '') ?? null });
}

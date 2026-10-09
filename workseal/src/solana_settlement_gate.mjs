// SPDX-License-Identifier: MIT
// Opt-in proof-before-state-transition adapter: never mark SETTLED on a mere signature string.
import { createSettlementIntent, settleState } from './protocol.mjs';
import {
  verifyFinalizedSolanaSettlement,
  fetchFinalizedSolanaSettlement,
} from './solana_settlement_readback.mjs';

function transition(state, proof) {
  // settleState cannot be reached without successful exact-intent verification.
  const reference = `solana-finalized:${proof.signature}:${proof.slot}`;
  return Object.freeze({
    state: settleState(state, reference),
    evidence: proof,
  });
}

/** Convert a parsed, already-fetched finalized transaction to a SETTLED state. */
export function settleWithFinalizedSolanaProof(state, { signature, commitment, transaction }) {
  const intent = createSettlementIntent(state); // Requires signed ACCEPTED WorkSeal state.
  const proof = verifyFinalizedSolanaSettlement({ intent, signature, commitment, transaction });
  return transition(state, proof);
}

/** Ask an explicitly selected HTTPS RPC for finalized evidence before settling. */
export async function settleWithFinalizedSolanaRpc(state, { signature, rpcUrl, fetchImpl, timeoutMs }) {
  const intent = createSettlementIntent(state);
  const proof = await fetchFinalizedSolanaSettlement({ intent, signature, rpcUrl, fetchImpl, timeoutMs });
  return transition(state, proof);
}

// MIT. One private buyer identity, serial state transitions and retained native signatures.
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { STATE_SCHEMA, requireValue, WalletError, digest, readJson, writeAtomic, requestIdentity,
  publicRequest, PASSPHRASES } from './common.mjs';

const ACTIVE = new Set(['PENDING', 'SIGNING']);
const TERMINAL = new Set(['SIGNED', 'REJECTED', 'EXPIRED', 'INTERRUPTED']);
const CLIENT_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HEARTBEAT_MS = 15000;
export async function openWalletStore(config, verifier, { now = () => Date.now() } = {}) {
  const path = join(config.directory, 'wallet-state.json');
  let state;
  try { state = await readJson(path, 16777216); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    state = { schema: STATE_SCHEMA, walletId: config.walletId, buyerSha256: config.buyerSha256, revision: 0, requests: [] };
  }
  requireValue(state.schema === STATE_SCHEMA && state.walletId === config.walletId &&
    state.buyerSha256 === config.buyerSha256 && Array.isArray(state.requests) && state.requests.length <= 64 &&
    Number.isSafeInteger(state.revision) && state.revision >= 0, 'WALLET_STATE_INVALID');
  const ids = new Set();
  for (const row of state.requests) {
    requireValue(row.id === requestIdentity(config, row.entryXdr) && !ids.has(row.id) &&
      Number.isSafeInteger(row.revision) && (ACTIVE.has(row.state) || TERMINAL.has(row.state)),
    'WALLET_REQUEST_HISTORY_INVALID');
    ids.add(row.id);
    const details = verifier.inspect(row.entryXdr);
    requireValue(details.payloadSha256 === row.details.payloadSha256, 'WALLET_REQUEST_HISTORY_CHANGED');
    if (row.state === 'SIGNED') verifier.verify(row.entryXdr, row.result);
  }
  let queue = Promise.resolve();
  let closed = false;
  let connection = null;
  const providerSeen = new Map();
  const stamp = () => new Date(now()).toISOString();
  const clone = value => structuredClone(value);
  function finish(row, nextState, error) {
    row.state = nextState; row.error = error;
    row.completedAt = stamp(); row.revision++; delete row.claimId;
    providerSeen.delete(row.id);
  }
  function expire(next) {
    let changed = false;
    const disconnected = connection && now() - connection.seenAt >= HEARTBEAT_MS;
    for (const row of next.requests) {
      if (!ACTIVE.has(row.state)) continue;
      if (Date.parse(row.expiresAt) <= now()) {
        finish(row, 'EXPIRED', 'WALLET_REQUEST_EXPIRED'); changed = true;
      } else if (disconnected && row.state === 'SIGNING') {
        finish(row, 'INTERRUPTED', 'WALLET_BROWSER_DISCONNECTED'); changed = true;
      } else if (providerSeen.has(row.id) && now() - providerSeen.get(row.id) >= HEARTBEAT_MS) {
        finish(row, 'INTERRUPTED', 'WALLET_BUYER_DISCONNECTED'); changed = true;
      }
    }
    if (disconnected) connection = null;
    return changed;
  }
  function transaction(fn) {
    const run = queue.then(async () => {
      requireValue(!closed, 'WALLET_CLOSED', 409);
      const next = clone(state);
      // Persist expiry before the requested action: a late heartbeat or failed
      // claim cannot revive the old connection or discard a terminal transition.
      if (expire(next)) {
        next.revision++;
        await writeAtomic(path, next);
        state = clone(next);
      }
      const outcome = await fn(next);
      if (outcome.changed) {
        next.revision++;
        await writeAtomic(path, next);
        state = next;
      }
      return clone(outcome.value);
    });
    queue = run.catch(() => {});
    return run;
  }
  const find = (s, id) => {
    const row = s.requests.find(item => item.id === id);
    requireValue(row, 'WALLET_REQUEST_NOT_FOUND', 404); return row;
  };
  const ready = (id, clientId) => {
    requireValue(connection && connection.id === id && connection.clientId === clientId &&
      connection.address === config.payer &&
      connection.networkPassphrase === PASSPHRASES[config.network], 'WALLET_CONNECTION_CHANGED', 409);
  };
  const claimView = row => ({
    id: row.id, revision: row.revision, claimId: row.claimId, entryXdr: row.entryXdr,
    details: row.details, expiresAt: row.expiresAt, address: config.payer,
    networkPassphrase: PASSPHRASES[config.network],
  });

  // A stopped process never re-opens an earlier wallet popup or repeats signing.
  await transaction(async next => {
    let changed = state.revision === 0;
    for (const row of next.requests) {
      if (ACTIVE.has(row.state)) {
        row.state = 'INTERRUPTED'; row.error = 'WALLET_SESSION_INTERRUPTED';
        row.completedAt = stamp(); row.revision++; delete row.claimId; changed = true;
      }
    }
    return { changed, value: null };
  });

  return Object.freeze({
    async view() {
      return transaction(async next => ({ changed: false, value: {
        walletId: config.walletId, revision: next.revision, network: config.network,
        payer: config.payer, operation: config.operation, connection: connection ? {
          id: connection.id, address: connection.address, networkPassphrase: connection.networkPassphrase,
          connectedAt: connection.connectedAt, clientId: connection.clientId,
          heartbeatExpiresAt: new Date(connection.seenAt + HEARTBEAT_MS).toISOString(),
        } : null, requests: next.requests.map(publicRequest),
      } }));
    },
    async connect({ address, networkPassphrase, clientId }) {
      requireValue(address === config.payer, 'WALLET_ACCOUNT_MISMATCH', 409);
      requireValue(networkPassphrase === PASSPHRASES[config.network], 'WALLET_NETWORK_MISMATCH', 409);
      requireValue(typeof clientId === 'string' && CLIENT_ID.test(clientId), 'WALLET_CLIENT_ID_INVALID');
      return transaction(async next => {
        requireValue(!connection || connection.clientId === clientId, 'WALLET_CONNECTION_OWNED', 409);
        requireValue(!next.requests.some(row => row.state === 'SIGNING'), 'WALLET_SIGNING_IN_PROGRESS', 409);
        connection = { id: randomUUID(), clientId, address, networkPassphrase,
          connectedAt: stamp(), seenAt: now() };
        return { changed: false, value: {
          id: connection.id, clientId, address, networkPassphrase, connectedAt: connection.connectedAt,
        } };
      });
    },
    async heartbeat({ connectionId, clientId, address, networkPassphrase }) {
      return transaction(async () => {
        ready(connectionId, clientId);
        requireValue(address === config.payer && networkPassphrase === PASSPHRASES[config.network],
          'WALLET_PROVIDER_IDENTITY_MISMATCH', 409);
        connection.seenAt = now();
        return { changed: false, value: {
          connectionId, clientId, heartbeatExpiresAt: new Date(now() + HEARTBEAT_MS).toISOString(),
        } };
      });
    },
    async disconnect(connectionId, clientId) {
      return transaction(async next => {
        ready(connectionId, clientId);
        let changed = false;
        for (const row of next.requests) {
          if (row.state === 'SIGNING') {
            row.state = 'INTERRUPTED'; row.error = 'WALLET_DISCONNECTED_DURING_SIGNING';
            row.completedAt = stamp(); row.revision++; delete row.claimId; changed = true;
          }
        }
        connection = null;
        return { changed, value: { disconnected: true } };
      });
    },
    async enqueue({ id, entryXdr, address, networkPassphrase }) {
      requireValue(address === config.payer && networkPassphrase === PASSPHRASES[config.network],
        'WALLET_PROVIDER_IDENTITY_MISMATCH', 409);
      requireValue(id === requestIdentity(config, entryXdr), 'WALLET_REQUEST_ID_MISMATCH', 409);
      const details = verifier.inspect(entryXdr);
      return transaction(async next => {
        const existing = next.requests.find(row => row.id === id);
        if (existing) return { changed: false, value: {
          ...publicRequest(existing), ...(existing.state === 'SIGNED' ? { result: existing.result } : {}),
        } };
        requireValue(next.requests.length < 64, 'WALLET_OPERATION_HISTORY_FULL', 409);
        requireValue(!next.requests.some(row => ACTIVE.has(row.state)), 'WALLET_OTHER_REQUEST_ACTIVE', 409);
        const row = { id, revision: 1, state: 'PENDING', entryXdr, details, createdAt: stamp(),
          expiresAt: new Date(now() + config.requestLifetimeMs).toISOString() };
        next.requests.push(row);
        providerSeen.set(row.id, now());
        return { changed: true, value: publicRequest(row) };
      });
    },
    async result(id) {
      return transaction(async next => {
        const row = find(next, id);
        // transaction() has already expired stale requests before this pulse.
        if (ACTIVE.has(row.state)) providerSeen.set(row.id, now());
        return { changed: false, value: { ...publicRequest(row),
          ...(row.state === 'SIGNED' ? { result: row.result } : {}) } };
      });
    },
    async claim({ id, revision, payloadSha256, connectionId, clientId, claimId }) {
      requireValue(typeof claimId === 'string' && CLIENT_ID.test(claimId), 'WALLET_CLAIM_ID_INVALID');
      return transaction(async next => {
        ready(connectionId, clientId);
        const row = find(next, id);
        if (row.state === 'SIGNING' && row.claimId === claimId &&
            row.connectionId === connectionId && row.clientId === clientId &&
            row.details.payloadSha256 === payloadSha256) {
          return { changed: false, value: claimView(row) };
        }
        requireValue(row.state === 'PENDING' && row.revision === revision &&
          row.details.payloadSha256 === payloadSha256, 'WALLET_REQUEST_CHANGED', 409);
        requireValue(!next.requests.some(other => other.state === 'SIGNING'), 'WALLET_SIGNING_IN_PROGRESS', 409);
        row.state = 'SIGNING'; row.revision++; row.attemptedAt = stamp();
        row.claimId = claimId; row.connectionId = connectionId; row.clientId = clientId;
        return { changed: true, value: claimView(row) };
      });
    },
    async complete({ id, claimId, connectionId, clientId, result, error }) {
      return transaction(async next => {
        const row = find(next, id);
        // A lost success response may be reconciled with the same verified bytes.
        // It cannot sign again or change the original terminal result.
        if (row.state === 'SIGNED' && !error && row.claimId === claimId &&
            row.connectionId === connectionId && row.clientId === clientId) {
          const verified = verifier.verify(row.entryXdr, result);
          requireValue(verified.signedAuthEntry === row.result.signedAuthEntry &&
            verified.signerAddress === row.result.signerAddress, 'WALLET_SIGNATURE_CHANGED', 409);
          return { changed: false, value: publicRequest(row) };
        }
        ready(connectionId, clientId);
        requireValue(row.state === 'SIGNING' && row.claimId === claimId &&
          row.connectionId === connectionId && row.clientId === clientId,
        'WALLET_SIGNING_CLAIM_CHANGED', 409);
        if (error) {
          requireValue(typeof error === 'string' && /^[A-Z0-9_]{1,80}$/.test(error), 'WALLET_ERROR_INVALID');
          row.state = 'REJECTED'; row.error = error;
        } else {
          try {
            row.result = verifier.verify(row.entryXdr, result);
            row.state = 'SIGNED';
          } catch (e) {
            row.state = 'REJECTED';
            row.error = e instanceof WalletError ? e.code : 'WALLET_SIGNATURE_INVALID';
          }
        }
        row.completedAt = stamp(); row.revision++;
        if (row.state !== 'SIGNED') delete row.claimId;
        providerSeen.delete(row.id);
        return { changed: true, value: publicRequest(row) };
      });
    },
    async cancel(id) {
      return transaction(async next => {
        const row=find(next,id);
        const changed=ACTIVE.has(row.state);
        if(changed) {
          row.state='INTERRUPTED';row.error='WALLET_BUYER_CANCELLED';
          row.completedAt=stamp();row.revision++;delete row.claimId;
        }
        return {changed,value:publicRequest(row)};
      });
    },
    async reject({ id, revision }) {
      return transaction(async next => {
        const row = find(next, id);
        requireValue(row.state === 'PENDING' && row.revision === revision, 'WALLET_REQUEST_CHANGED', 409);
        row.state = 'REJECTED'; row.error = 'WALLET_OPERATOR_REJECTED';
        row.completedAt = stamp(); row.revision++;
        return { changed: true, value: publicRequest(row) };
      });
    },
    async close() {
      if (closed) return;
      await transaction(async next => {
        let changed = false;
        for (const row of next.requests) {
          if (ACTIVE.has(row.state)) {
            row.state = 'INTERRUPTED'; row.error = 'WALLET_SESSION_CLOSED';
            row.completedAt = stamp(); row.revision++; delete row.claimId; changed = true;
          }
        }
        connection = null;
        return { changed, value: null };
      });
      closed = true;
    },
  });
}

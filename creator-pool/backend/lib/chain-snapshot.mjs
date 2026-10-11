// One canonical block per original Creator Pool state response. The cache holds
// chain data only; the API joins current local metadata and operation state later.
import { performance } from 'node:perf_hooks';

export class ChainSnapshotError extends Error {
  constructor(code, message) { super(message); this.name = 'ChainSnapshotError'; this.code = code; }
}
class ChangedBlock extends Error {}

async function mapLimit(length, limit, work) {
  const values = new Array(length);
  let next = 0, failure;
  await Promise.all(Array.from({ length: Math.min(length, limit) }, async () => {
    for (;;) {
      if (failure) return;
      const index = next++;
      if (index >= length) return;
      try { values[index] = await work(index); }
      catch (error) { failure ||= error; return; }
    }
  }));
  if (failure) throw failure;
  return values;
}

function count(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('Invalid on-chain record count');
  return number;
}

function eventRow(log, decoded) {
  const logIndex = count(BigInt(log.logIndex));
  return {
    id: `${log.transactionHash}:${logIndex}`, txHash: log.transactionHash,
    logIndex, blockNumber: count(BigInt(log.blockNumber)), event: decoded.name,
    args: Object.fromEntries(decoded.fragment.inputs.map((input, index) => [input.name, String(decoded.args[index])]))
  };
}

export function createChainSnapshotReader({ provider, pool, token, deployment, getActors, concurrency = 8 }) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) throw new Error('Snapshot concurrency must be 1..32');
  const deployBlock = count(deployment.deployBlock || 0);
  let cached = null, active = null;
  const metrics = { builds: 0, cacheHits: 0, sharedReads: 0, reorgRetries: 0, lastBuildMs: 0 };

  async function blockAt(number = 'latest') {
    // send() avoids the provider's short-lived getBlock('latest') cache. A
    // refresh begun after a confirmed transaction sees the current RPC head.
    const tag = number === 'latest' ? number : '0x' + number.toString(16);
    const block = await provider.send('eth_getBlockByNumber', [tag, false]);
    if (!block) return null;
    if (!/^0x[0-9a-f]{64}$/i.test(block.hash || '') || !/^0x[0-9a-f]+$/i.test(block.number || '') || !/^0x[0-9a-f]+$/i.test(block.timestamp || '')) {
      throw new ChainSnapshotError('chain_snapshot_unavailable', 'RPC returned an incomplete block header');
    }
    return { number: count(BigInt(block.number)), hash: block.hash.toLowerCase(), timestamp: count(BigInt(block.timestamp)) };
  }

  async function head() {
    // Each caller observes its own head. Joining an earlier head request could
    // miss a transaction confirmed before this caller began its refresh.
    const block = await blockAt();
    if (!block) throw new ChainSnapshotError('chain_snapshot_unavailable', 'RPC has no current block');
    return block;
  }

  async function ledgerAt(block, previous) {
    // A forward head does not prove that the prior indexed block survived a
    // reorganization. Verify its hash before reusing any prefix or index.
    let prefix = null;
    if (previous && previous.block.number < block.number) {
      const ancestor = await blockAt(previous.block.number);
      if (ancestor?.hash === previous.block.hash) prefix = previous;
    }
    const from = prefix ? prefix.block.number + 1 : deployBlock;
    // Bypass ethers' short-lived getLogs cache: the same numeric range can
    // contain different logs immediately after a same-height replacement.
    const logs = from <= block.number ? await provider.send('eth_getLogs', [{
      address: deployment.poolAddress, fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + block.number.toString(16), topics: []
    }]) : [];
    const added = [];
    for (const log of logs) {
      const decoded = pool.interface.parseLog(log);
      if (decoded) added.push(eventRow(log, decoded));
    }
    const ledger = [...(prefix?.ledger || []), ...added];
    const txBySub = { ...(prefix?.txBySub || {}) }, txByCampaign = { ...(prefix?.txByCampaign || {}) };
    for (const event of added) {
      const sid = event.args.submissionId, cid = event.args.campaignId;
      if (sid) txBySub[sid] = { ...(txBySub[sid] || {}), [event.event]: event.txHash };
      else if (cid) {
        const prior = txByCampaign[cid] || {};
        txByCampaign[cid] = { ...prior, [event.event]: [...(prior[event.event] || []), event.txHash] };
      }
    }
    return { ledger, txBySub, txByCampaign };
  }

  async function load(block, previous) {
    const started = performance.now(), overrides = { blockTag: block.number };
    const actorEntries = Object.entries(getActors() || {});
    const initial = [
      () => pool.campaignCount(overrides),
      () => pool.submissionCount(overrides),
      () => token.balanceOf(deployment.poolAddress, overrides),
      ...actorEntries.map(([, address]) => () => token.balanceOf(address, overrides))
    ];
    // Start the event read once, alongside a fixed-width contract read batch.
    const initialResults = await Promise.allSettled([
      mapLimit(initial.length, concurrency, index => initial[index]()),
      ledgerAt(block, previous)
    ]);
    const failed = initialResults.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const [base, events] = initialResults.map(result => result.value);
    const campaignCount = count(base[0]), submissionCount = count(base[1]);
    const rows = await mapLimit(campaignCount + submissionCount, concurrency, async index => {
      if (index < campaignCount) {
        const id = campaignCount - index;
        return { id: String(id), value: await pool.getCampaign(BigInt(id), overrides) };
      }
      const id = submissionCount - (index - campaignCount);
      return { id: String(id), value: await pool.getSubmission(BigInt(id), overrides) };
    });
    const canonical = await blockAt(block.number);
    if (canonical?.hash !== block.hash) throw new ChangedBlock('The selected block changed while reading');
    const buildMs = performance.now() - started;
    return {
      block, ...events, campaigns: rows.slice(0, campaignCount), submissions: rows.slice(campaignCount),
      balances: actorEntries.length ? Object.fromEntries(actorEntries.map(([name], index) => [name, base[index + 3].toString()])) : null,
      poolBalanceAtomic: base[2].toString(), buildMs
    };
  }

  async function read() {
    let block = await head(), changes = 0;
    for (;;) {
      if (cached?.block.hash === block.hash) { metrics.cacheHits++; return cached; }
      if (active) {
        const pending = active, sameHead = pending.hash === block.hash;
        try {
          const result = await pending.promise;
          if (sameHead) { metrics.sharedReads++; return result; }
        } catch (error) { if (!(error instanceof ChangedBlock)) throw error; changes++; }
        // A request that observed a newer head never inherits an earlier
        // in-flight response. Re-read the head after the one active build.
      } else {
        const slot = { hash: block.hash };
        slot.promise = load(block, cached).then(result => {
          cached = result; metrics.builds++; metrics.lastBuildMs = result.buildMs; return result;
        }).catch(async error => {
          // A disappearing historical block can make eth_call fail before the
          // final check. Retry only when the canonical hash actually changed.
          if (error instanceof ChangedBlock) throw error;
          const current = await blockAt(block.number);
          if (current?.hash !== block.hash) throw new ChangedBlock('The selected block disappeared');
          throw error;
        }).finally(() => { if (active === slot) active = null; });
        active = slot;
        try { return await slot.promise; }
        catch (error) { if (!(error instanceof ChangedBlock)) throw error; changes++; }
      }
      if (changes >= 3) throw new ChainSnapshotError('chain_snapshot_unstable', 'The chain changed repeatedly while reading; refresh the current state');
      if (changes) metrics.reorgRetries++;
      block = await head();
    }
  }

  return { read, statistics: () => ({ ...metrics, cachedBlock: cached?.block.number ?? null, active: Boolean(active) }) };
}

// MIT. Native settled-metadata queue over the original guarded SF60 batch writer.
// prepare() must invoke the original synchronous SF25 ingest before it returns
// its SF54 outcome promise. Each outcome waits for its own durable decision.
export const NATIVE_CATALOG_BATCH_SIZE = 32;
const reject = reason => ({decision:'reject',reason});
const code = error => /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.message ?? '')
  ? error.message : 'CATALOG_UNAVAILABLE';
const identity = operation => ({
  operationId:operation.provenance.settlementReceipt.operationId,
  sequence:operation.candidate.sequence,
});
const replay = (operation,head) => ({
  decision:'soft_drop',reason:'EXACT_REPLAY',head,...identity(operation),
});
const accepted = decision => decision.decision === 'accepted' ||
  decision.decision === 'soft_drop' && decision.reason === 'EXACT_REPLAY';

/**
 * One queue belongs to one already-open, exclusively owned SF60 journal.
 * Entries and prepared operations are private to the native catalog owner.
 * Payment execution, payload validation and filesystem publication stay with
 * their original SDK, SF25/SF54 and SF60 implementations.
 */
export function createNativeCatalogCommitQueue(journal) {
  const waiting = [];
  const counters = {groups:0,commitAttempts:0,commits:0,committedOperations:0,
    isolatedRejections:0,largestCommit:0};
  let running = null, closing = false, inFlight = 0;

  function context() {
    const sources = new Map(), claims = new Map(), sequences = new Map(), staged = [];
    let preparing = true;
    const assertPreparing = () => {
      if (!preparing) throw new Error('CATALOG_PREPARATION_CLOSED');
    };
    const lookupProvenance = query => {
      assertPreparing();
      if (query?.authority !== 'settlement_hook' || typeof query.sourceURL !== 'string')
        throw new Error('PROVENANCE_LOOKUP_INVALID');
      if (claims.has(query.sourceURL)) return claims.get(query.sourceURL).operation;
      if (!sources.has(query.sourceURL))
        sources.set(query.sourceURL,journal.lookupProvenance(query));
      return sources.get(query.sourceURL);
    };
    const api = Object.freeze({
      lookupProvenance,
      nextSellerSequence(sellerId) {
        assertPreparing();
        const sequence = sequences.has(sellerId) ? sequences.get(sellerId)
          : journal.nextSellerSequence(sellerId);
        if (!Number.isSafeInteger(sequence) || sequence < 1)
          throw new Error('SELLER_SEQUENCE_EXHAUSTED');
        sequences.set(sellerId,sequence + 1);
        return sequence;
      },
      ingest(candidate,authority,provenance) {
        assertPreparing();
        const operation = {kind:'upsert',candidate,authority,provenance};
        const previous = lookupProvenance(provenance);
        if (previous) {
          if (previous.provenance.sourceSha256 !== provenance.sourceSha256 ||
              previous.candidate.sellerId !== candidate.sellerId ||
              previous.authority.signer !== authority.signer)
            return {...reject('SETTLEMENT_REPLAY_MISMATCH'),...identity(operation)};
          const leader = claims.get(provenance.sourceURL);
          if (leader) {
            // A duplicate waiting in this same group succeeds only if its
            // original operation commits; an isolated rejection stays rejected.
            return leader.promise.then(decision => accepted(decision)
              ? replay(leader.operation,decision.head) : {...decision});
          }
          // A retained older receipt cannot resurrect a newer/retired revision.
          return replay(previous,journal.head);
        }
        let resolve;
        const promise = new Promise(done => {resolve = done;});
        const row = {operation,promise,resolve};
        claims.set(provenance.sourceURL,row);
        staged.push(row);
        return promise;
      },
    });
    return {api,staged,finishPreparation:() => {preparing = false;}};
  }

  async function commit(staged) {
    if (!staged.length) return;
    let expectedHead;
    try {expectedHead = journal.head;}
    catch (error) {
      for (const row of staged) row.resolve({...reject(code(error)),...identity(row.operation)});
      return;
    }
    const remaining = [...staged];
    while (remaining.length) {
      let result;
      try {
        counters.commitAttempts++;
        result = await journal.commitBatch(remaining.map(row => row.operation),{expectedHead});
      } catch (error) {
        const index = error?.operationIndex;
        // Only SF60's indexed, pre-publication validation failure can be
        // isolated. Keep the original lease and candidate sequences when
        // staging the surviving rows again; no payment is repeated.
        const indexed = Number.isSafeInteger(index) && index >= 0 && index < remaining.length &&
          typeof error.code === 'string' &&
          error.message === 'BATCH_ITEM_' + index + '_' + error.code;
        if (indexed) {
          const [row] = remaining.splice(index,1);
          row.resolve({...reject(code({message:error.code})),...identity(row.operation)});
          counters.isolatedRejections++;
          continue;
        }
        // A failed rename/fsync may already have published. SF60's poisoned
        // owner reports the required reopen through its ordinary head getter.
        // Do not retry any member of this attempted group on an unknown result.
        let reason = code(error);
        try {void journal.head;} catch (stateError) {reason = code(stateError);}
        for (const row of remaining)
          row.resolve({...reject(reason),...identity(row.operation)});
        return;
      }
      if (result.applied) {
        counters.commits++;
        counters.committedOperations += result.applied;
        counters.largestCommit = Math.max(counters.largestCommit,result.applied);
      }
      for (const [index,row] of remaining.entries()) {
        const decision = result.changes[index].decision === 'exact_replay'
          ? replay(row.operation,result.head)
          : {decision:'accepted',reason:'COMMITTED',head:result.head,
              operations:result.operationsAfter,...identity(row.operation)};
        row.resolve(decision);
      }
      return;
    }
  }

  async function drain() {
    while (waiting.length) {
      const group = waiting.splice(0,NATIVE_CATALOG_BATCH_SIZE);
      const batch = context();
      const outcomes = [];
      inFlight = group.length;
      counters.groups++;
      // Start every original SF54 call without awaiting its deferred commit.
      // Immediate SF25 refusals never enter the shared write operation.
      for (const row of group) {
        try {
          outcomes.push(Promise.resolve(row.prepare(batch.api)).then(
            value => ({value}),error => ({error})));
        } catch (error) {outcomes.push(Promise.resolve({error}));}
      }
      batch.finishPreparation();
      try {await commit(batch.staged);}
      catch (error) {
        // Keep every admitted outcome resolvable even if composition fails.
        for (const row of batch.staged)
          row.resolve({...reject(code(error)),...identity(row.operation)});
      }
      const completed = await Promise.all(outcomes);
      for (const [index,outcome] of completed.entries()) {
        if (Object.hasOwn(outcome,'error')) group[index].reject(outcome.error);
        else group[index].resolve(outcome.value);
      }
      inFlight = 0;
    }
  }
  function start() {
    if (running) return;
    // No timer or throughput delay: collect the currently pending work and
    // naturally combine arrivals waiting behind an existing journal commit.
    const job = Promise.resolve().then(drain);
    running = job;
    const finish = () => {
      if (running === job) running = null;
      if (waiting.length) start();
    };
    job.then(finish,error => {
      inFlight = 0;
      for (const row of waiting.splice(0)) row.reject(error);
      finish();
    });
  }
  return Object.freeze({
    enqueue(prepare) {
      if (closing) return Promise.reject(new Error('CATALOG_CLOSING'));
      if (typeof prepare !== 'function') return Promise.reject(new TypeError('CATALOG_PREPARER_REQUIRED'));
      const result = new Promise((resolve,reject) => {waiting.push({prepare,resolve,reject});});
      start();
      return result;
    },
    status:() => ({queued:waiting.length,inFlight,batchSizeLimit:NATIVE_CATALOG_BATCH_SIZE,...counters}),
    async close() {
      closing = true;
      while (running) await running;
    },
  });
}

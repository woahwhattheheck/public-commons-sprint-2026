import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyAuthorityState } from './authority.mjs';

const EMPTY = Object.freeze({ version: 1, missions: {}, inventory: {}, outbox: [], receipts: [], authority: emptyAuthorityState() });
const clone = (value) => structuredClone(value);

export class JsonStore {
  constructor(path) { this.path = path; this.state = clone(EMPTY); this.loaded = false; this.loading = null; this.mutationChain = Promise.resolve(); this.writeChain = Promise.resolve(); }
  async load() {
    if (this.loaded) return;
    // A cold store can receive several MCP tool requests before its first read ends.
    // They must share one load, particularly when the file does not exist yet.
    if (!this.loading) {
      this.loading = (async () => {
        await mkdir(dirname(this.path), { recursive: true });
        try {
          const parsed = JSON.parse(await readFile(this.path, 'utf8'));
          if (parsed?.version !== 1 || typeof parsed.missions !== 'object') throw new Error('unsupported Hearthline store format');
          this.state = { ...clone(EMPTY), ...parsed, missions: parsed.missions ?? {}, inventory: parsed.inventory ?? {}, outbox: parsed.outbox ?? [], receipts: parsed.receipts ?? [], authority: parsed.authority ?? emptyAuthorityState() };
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          await this.#persist();
        }
        this.loaded = true;
      })();
    }
    const pending = this.loading;
    try { await pending; }
    finally { if (this.loading === pending) this.loading = null; }
  }
  snapshot() { return clone(this.state); }
  async mutate(fn) {
    await this.load();
    // Work on an isolated draft and commit it only after a durable write.
    // Serializing the entire transaction also prevents a failed sibling from
    // rolling back another operation's persisted inventory or approval receipt.
    const transaction = this.mutationChain.then(async () => {
      const draft = clone(this.state);
      const result = await fn(draft);
      await this.#persist(draft);
      this.state = draft;
      return clone(result);
    });
    // Keep the queue usable after a rejected transaction; propagate the original
    // error to its caller rather than poisoning future writes.
    this.mutationChain = transaction.then(() => undefined, () => undefined);
    return transaction;
  }
  async #persist(nextState = this.state) {
    const payload = JSON.stringify(nextState, null, 2) + '\n';
    const tmp = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    // An I/O failure rejects the current operation but must not permanently
    // disable future recovery attempts on this store instance.
    this.writeChain = this.writeChain.catch(() => undefined).then(async () => {
      await writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 });
      await rename(tmp, this.path);
    });
    await this.writeChain;
  }
}

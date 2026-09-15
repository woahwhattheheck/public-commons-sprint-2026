import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const EMPTY = Object.freeze({ version: 1, missions: {}, inventory: {}, outbox: [], receipts: [] });
const clone = (value) => structuredClone(value);

export class JsonStore {
  constructor(path) { this.path = path; this.state = clone(EMPTY); this.loaded = false; this.writeChain = Promise.resolve(); }
  async load() {
    if (this.loaded) return;
    await mkdir(dirname(this.path), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8'));
      if (parsed?.version !== 1 || typeof parsed.missions !== 'object') throw new Error('unsupported Hearthline store format');
      this.state = { ...clone(EMPTY), ...parsed, missions: parsed.missions ?? {}, inventory: parsed.inventory ?? {}, outbox: parsed.outbox ?? [], receipts: parsed.receipts ?? [] };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await this.#persist();
    }
    this.loaded = true;
  }
  snapshot() { return clone(this.state); }
  async mutate(fn) {
    await this.load();
    const before = clone(this.state);
    try { const result = await fn(this.state); await this.#persist(); return clone(result); }
    catch (error) { this.state = before; throw error; }
  }
  async #persist() {
    const payload = JSON.stringify(this.state, null, 2) + '\n';
    const tmp = `${this.path}.tmp-${process.pid}-${randomUUID()}`;
    this.writeChain = this.writeChain.then(async () => { await writeFile(tmp, payload, { encoding: 'utf8', mode: 0o600 }); await rename(tmp, this.path); });
    await this.writeChain;
  }
}

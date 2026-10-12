// MIT. Ownership and shutdown of the original configured merchant providers.
export class MerchantProviderOwners {
  #definitions; #config; #options; #loads; #instances; #states; #failure;
  #starting = new Map(); #stops = new Map(); #signals = new Map(); #closing = false;
  constructor({ definitions, config, options, loads, instances, states, failure }) {
    this.#definitions = definitions; this.#config = config; this.#options = options;
    this.#loads = loads; this.#instances = instances; this.#states = states; this.#failure = failure;
  }
  get closing() { return this.#closing; }
  get pendingStarts() { return [...this.#starting.values()].reduce((sum, count) => sum + count, 0); }
  get shutdown() {
    return [...this.#instances.keys()].map(name => {
      const stop = this.#stops.get(name);
      return { name, state: stop?.state ?? (this.#closing ? 'DRAINING' : 'OPEN'),
        starting: this.#starting.get(name) ?? 0, attempts: stop?.attempts ?? 0,
        ...(stop?.error ? { error: { code: stop.error.code ?? 'PROVIDER_CLOSE_FAILED' } } : {}) };
    });
  }
  async resolve(key, dependency = false, ancestry = []) {
    if (ancestry.includes(key)) throw this.#failure('PROVIDER_DEPENDENCY_CYCLE', 'Provider ownership dependencies contain a cycle.');
    const definition = this.#definitions[key];
    if (!definition) throw this.#failure('PROVIDER_NOT_FOUND', 'Unknown configured merchant provider.');
    if (!dependency && definition.configKey !== null && this.#config[definition.configKey] == null)
      throw this.#failure('TOOL_NOT_FOUND', 'Choose a tool advertised by this configured merchant.');
    let loading = this.#loads.get(key);
    if (!loading) {
      const started = performance.now();
      this.#states.set(key, { state: 'LOADING', durationMs: null });
      loading = Promise.resolve().then(async () => {
        try {
          const [module, entries] = await Promise.all([
            definition.load(),
            Promise.all((definition.dependencies ?? []).map(async name => [name, await this.resolve(name, true, [...ancestry, key])])),
          ]);
          const provider = await definition.create(module, this.#config, this.#options, Object.fromEntries(entries));
          this.#instances.set(key, provider);
          this.#states.set(key, { state: 'READY', durationMs: Math.round((performance.now() - started) * 1000) / 1000 });
          this.#beginProviderClose(key);
          return provider;
        } catch (error) {
          this.#loads.delete(key);
          this.#states.set(key, { state: 'ERROR', durationMs: Math.round((performance.now() - started) * 1000) / 1000,
            error: { code: error.code ?? 'PROVIDER_LOAD_FAILED', message: error.message } });
          throw error;
        }
      });
      this.#loads.set(key, loading);
    }
    return loading;
  }
  async invoke(key, action) {
    // Register before importing: close can arrive while the original module loads.
    this.#starting.set(key, (this.#starting.get(key) ?? 0) + 1);
    let admitted = true;
    const entered = () => {
      if (!admitted) return;
      admitted = false;
      const remaining = this.#starting.get(key) - 1;
      if (remaining) this.#starting.set(key, remaining); else this.#starting.delete(key);
      this.#beginProviderClose(key);
    };
    try {
      const provider = await this.resolve(key);
      let work;
      try { work = action(provider); } finally { entered(); }
      return await work;
    } finally { entered(); }
  }
  #borrowers(key) {
    return [...this.#loads.keys()].filter(name =>
      (this.#definitions[name].dependencies ?? []).includes(key) && this.#stops.get(name)?.state !== 'CLOSED');
  }
  #signal(key) {
    const definition = this.#definitions[key], provider = this.#instances.get(key);
    if (!definition.requestClose || this.#signals.has(key)) return;
    const signal = Promise.resolve().then(() => definition.requestClose(provider))
      .then(() => ({ status: 'fulfilled' }), error => ({ status: 'rejected', reason: error }));
    this.#signals.set(key, signal);
  }
  #startStop(key) {
    const existing = this.#stops.get(key);
    if (existing?.promise) return existing.promise;
    const provider = this.#instances.get(key);
    const stop = { state: 'CLOSING', attempts: (existing?.attempts ?? 0) + 1, error: null, promise: null };
    this.#stops.set(key, stop);
    stop.promise = Promise.resolve().then(() => provider.close?.()).then(
      value => { stop.state = 'CLOSED'; return { status: 'fulfilled', value }; },
      error => { stop.state = 'FAILED'; stop.error = error; return { status: 'rejected', reason: error }; },
    );
    return stop.promise;
  }
  #beginProviderClose(key) {
    if (!this.#closing || !this.#instances.has(key) || this.#starting.has(key)) return;
    this.#signal(key);
    if (this.#definitions[key].shutdown === 'provider' && this.#borrowers(key).length === 0)
      void this.#startStop(key);
  }
  beginClose() {
    this.#closing = true;
    // A new explicit host close retries failed owners; successful owners stay closed.
    for (const [key, stop] of this.#stops) {
      if (stop.state === 'FAILED' || stop.state === 'DEPENDENCY_WAIT') {
        this.#stops.set(key, { state: 'DRAINING', attempts: stop.attempts, error: null, promise: null });
        this.#signals.delete(key);
      }
    }
    for (const key of this.#instances.keys()) this.#beginProviderClose(key);
  }
  async finishClose() {
    const failures = [];
    const remaining = new Set(this.#instances.keys());
    // Borrowers finish before their dependencies; a failed borrower retains its owner.
    while (remaining.size) {
      const layer = [...remaining].filter(key =>
        ![...remaining].some(name => (this.#definitions[name].dependencies ?? []).includes(key)));
      if (!layer.length) {
        throw this.#failure('PROVIDER_DEPENDENCY_CYCLE', 'Provider shutdown dependencies contain a cycle.');
      }
      const outcomes = await Promise.all(layer.map(async key => {
        const blockers = this.#borrowers(key);
        if (blockers.length) {
          const old = this.#stops.get(key);
          this.#stops.set(key, { state: 'DEPENDENCY_WAIT', attempts: old?.attempts ?? 0,
            promise: null, error: this.#failure('PROVIDER_DEPENDENCY_ACTIVE', 'An original borrowing provider still owns work.') });
          return { key, status: 'rejected', code: 'PROVIDER_DEPENDENCY_ACTIVE', dependencies: blockers };
        }
        const stopped = await this.#startStop(key);
        await (this.#signals.get(key) ?? Promise.resolve({ status: 'fulfilled' }));
        if (stopped.status === 'rejected') return { key, status: 'rejected', code: stopped.reason.code ?? 'PROVIDER_CLOSE_FAILED' };
        return { key, status: 'fulfilled' };
      }));
      for (const outcome of outcomes) {
        remaining.delete(outcome.key);
        if (outcome.status === 'rejected') failures.push(outcome);
      }
    }
    if (failures.length) {
      const error = this.#failure('OPERATOR_SHUTDOWN_INCOMPLETE', 'Original provider shutdown is incomplete; retry close on this operator.');
      error.providers = failures.map(({ key, code, dependencies }) => ({ name: key, code, ...(dependencies ? { dependencies } : {}) }));
      throw error;
    }
    return this.shutdown;
  }
}

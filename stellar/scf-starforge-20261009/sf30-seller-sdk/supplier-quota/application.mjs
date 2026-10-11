// MIT. Generic upstreams share the ORIGINAL Routescan account quota engine.
import { openRoutescanQuota } from '../routescan/quota.mjs';
import { compileSupplierAccounts } from './config.mjs';

export const SUPPLIER_QUOTA_SCHEMA = 'stellar-forge.supplier-quotas.v1';
const safeCode = error => typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)
  ? error.code : 'SUPPLIER_QUOTA_STORAGE_UNAVAILABLE';
const unavailable = (status, code, retryAfter) => ({ status,
  headers: { 'content-type': 'application/json; charset=utf-8',
    ...(retryAfter === undefined ? {} : { 'retry-after': String(Math.max(1, Math.ceil(retryAfter))) }) },
  body: { error: code } });

/** Construction is inert. Each account opens only on an explicit local read or
 * actual admission/dispatch; all processes select its SAME original directory. */
export function createSupplierQuotaRegistry(config) {
  const accounts = compileSupplierAccounts(config.supplierAccounts, config.bindings);
  const controls = new Map();
  let closed = false, closing;
  const failClosed = () => {
    if (closed) throw Object.assign(new Error('Supplier quota controller closed'), { code: 'SUPPLIER_QUOTA_CLOSED' });
  };

  for (const [id, account] of Object.entries(accounts)) {
    let native = null, opening = null, last = null, lastError = null;
    const observations = [];
    let flushing = Promise.resolve();
    async function original() {
      failClosed();
      if (native) return native;
      if (!opening) opening = openRoutescanQuota(account).then(async value => {
        if (closed) { await value.close(); failClosed(); }
        native = value; return value;
      }).catch(error => { opening = null; throw error; });
      return opening;
    }
    function flush(value) {
      const result = flushing.then(async () => {
        while (observations.length) {
          await value.observe(observations[0]);
          observations.shift();
        }
      });
      flushing = result.catch(() => {});
      return result;
    }
    async function current() {
      const value = await original();
      await flush(value);
      last = await value.snapshot(); lastError = null;
      return last;
    }
    async function read() {
      try {
        const quota = await current();
        return { name: id, bindings: [...account.bindings], status: 'AVAILABLE', quota, errorCode: null };
      } catch (error) {
        lastError = safeCode(error);
        return { name: id, bindings: [...account.bindings], status: 'UNAVAILABLE', quota: last, errorCode: lastError };
      }
    }
    const control = {
      name: id,
      /** Admission reads only. The atomic source reservation remains at dispatch. */
      async admit(context = {}) {
        context.signal?.throwIfAborted();
        const quota = await current();
        context.signal?.throwIfAborted();
        return quota.allowed ? true : unavailable(429, 'SUPPLIER_QUOTA_UNAVAILABLE', quota.retryAfterSeconds);
      },
      /** No target, payload or credential is passed into the account controller. */
      async reserve({ signal } = {}) {
        signal?.throwIfAborted();
        try {
          const value = await original();
          await flush(value);
          signal?.throwIfAborted();
          last = await value.reserve();
          signal?.throwIfAborted();
          lastError = null;
          return true;
        } catch (error) {
          if (signal?.aborted) throw error;
          lastError = safeCode(error);
          if (error?.code === 'ROUTESCAN_QUOTA_UNAVAILABLE') {
            last = error.quota ?? last;
            return unavailable(429, 'SUPPLIER_QUOTA_UNAVAILABLE', error.retryAfter);
          }
          return unavailable(503, 'SUPPLIER_QUOTA_STORAGE_UNAVAILABLE');
        }
      },
      /** Retain only the original public 429/Retry-After, never source content.
       * A failed local save is retried by the next explicit read/reservation
       * before that process may make another backend call. */
      async observe(response) {
        if ((response?.body?.upstreamStatus ?? response?.status) !== 429) return;
        const raw = response.headers?.['retry-after'];
        const selected = { status: 429, headers: typeof raw === 'string' && raw.length <= 128
          ? { 'retry-after': raw } : {} };
        observations.push(selected);
        try {
          const value = await original();
          await flush(value);
          last = await value.snapshot(); lastError = null;
        } catch (error) { lastError = safeCode(error); }
      },
      read,
      localStatus: () => Object.freeze({ name: id, observed: last !== null, errorCode: lastError }),
      async close() {
        if (opening) await opening.catch(() => {});
        if (native) {
          // Already returned provider outcomes are preserved even if final
          // shutdown cannot save their cooldown. No new request is started.
          try { await flush(native); } finally { await native.close(); }
        }
      },
    };
    controls.set(id, Object.freeze(control));
  }

  return Object.freeze({
    names: Object.freeze([...controls.keys()]),
    controller(id) {
      failClosed();
      const value = controls.get(id);
      if (!value) throw new TypeError('Unknown supplier account');
      return value;
    },
    async snapshot() {
      const rows = await Promise.all([...controls.values()].map(control => control.read()));
      return { schema: SUPPLIER_QUOTA_SCHEMA, capturedAt: new Date().toISOString(), accounts: rows };
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = Promise.all([...controls.values()].map(control => control.close()));
      return closing;
    },
  });
}

/** Compose into the original application admission. Reusable cache/replay paths
 * retain their existing admission: only an actual source miss reserves quota. */
export function attachSupplierQuota(handler, control, { preflight = true } = {}) {
  if (typeof handler !== 'function' || typeof handler.snapshot !== 'function' ||
      !control || typeof control.admit !== 'function') throw new TypeError('Original handler and supplier quota required');
  const wrapped = context => handler(context);
  wrapped.admit = async context => {
    const decision = typeof handler.admit === 'function' ? await handler.admit(context) : true;
    if (decision !== true) return decision;
    return preflight ? control.admit(context) : true;
  };
  wrapped.snapshot = () => Object.freeze({ ...handler.snapshot(), supplierAccount: control.name,
    supplierQuota: control.localStatus() });
  if (handler.idempotency !== undefined) wrapped.idempotency = handler.idempotency;
  if (handler.cache !== undefined) wrapped.cache = handler.cache;
  return wrapped;
}

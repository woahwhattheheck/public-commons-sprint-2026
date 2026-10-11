// MIT. Session capability over the original bound handlers; no second store or issuer.
export function createUpstreamOperationControl(compiled, handlers) {
  const operations = new Map();
  const bindings = [];
  for (const [name,binding] of Object.entries(compiled)) {
    const original = handlers[name]?.idempotency;
    if (!binding.idempotency || !original) continue;
    operations.set(name,original);
    bindings.push(Object.freeze({name,method:binding.method,scope:binding.idempotency.scope,
      maxResponseBytes:binding.maxResponseBytes}));
  }
  function original(name) {
    if (typeof name !== 'string' || !operations.has(name)) throw Object.assign(
      new Error('OPERATION_BINDING_NOT_FOUND'),{code:'OPERATION_BINDING_NOT_FOUND',status:404});
    return operations.get(name);
  }
  return Object.freeze({ bindings:Object.freeze(bindings),
    list:(name,options) => original(name).list(options),
    inspect:(name,key) => original(name).inspect(key),
    audit:(name,key,options) => original(name).audit(key,options),
    recover:(name,options) => original(name).recover(options),
  });
}

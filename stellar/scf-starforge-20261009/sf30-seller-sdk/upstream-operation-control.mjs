// MIT. Session capability over the original bound handlers; no second store or issuer.
export function createUpstreamOperationControl(compiled, handlers, {closeHandlers} = {}) {
  if (closeHandlers !== undefined && typeof closeHandlers !== 'function') throw new TypeError('Original handler cleanup must be a function');
  const operations = new Map();
  const bindings = [];
  const pending = new Set();
  let closed = false, closing;
  for (const [name,binding] of Object.entries(compiled)) {
    const original = handlers[name]?.idempotency;
    if (!binding.idempotency || !original) continue;
    operations.set(name,original);
    bindings.push(Object.freeze({name,method:binding.method,scope:binding.idempotency.scope,
      maxResponseBytes:binding.maxResponseBytes,requestHeader:binding.idempotency.requestHeader,
      maxTicketSeconds:binding.idempotency.maxTicketSeconds}));
  }
  function original(name) {
    if (closed) throw Object.assign(new Error('OPERATION_CONTROL_CLOSED'),{code:'OPERATION_CONTROL_CLOSED',status:503});
    if (typeof name !== 'string' || !operations.has(name)) throw Object.assign(
      new Error('OPERATION_BINDING_NOT_FOUND'),{code:'OPERATION_BINDING_NOT_FOUND',status:404});
    return operations.get(name);
  }
  function run(name, work) {
    const controller = original(name);
    const result = Promise.resolve().then(() => work(controller));
    pending.add(result);
    result.finally(() => pending.delete(result)).catch(() => {});
    return result;
  }
  return Object.freeze({ bindings:Object.freeze(bindings),
    issue:(name,context,terms) => original(name).issue(context,terms),
    list:(name,options) => run(name,controller => controller.list(options)),
    inspect:(name,key) => run(name,controller => controller.inspect(key)),
    audit:(name,key,options) => run(name,controller => controller.audit(key,options)),
    recover:(name,options) => run(name,controller => controller.recover(options)),
    // The launcher first waits for original seller dispatch. Finish accepted
    // console calls too before closing the same bound SQLite controllers.
    close(options) {
      if (closing) return closing;
      closed = true;
      closing = Promise.allSettled([...pending]).then(() => closeHandlers ? closeHandlers(options) :
        Promise.all([...operations.values()].map(controller => controller.close())));
      return closing;
    },
  });
}
